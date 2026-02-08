/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KbnClient } from '@kbn/scout';
import type { AutoImportEvalExample, AutoImportTaskOutput, GeneratedPipeline } from '../src/types';

/** Maximum time to wait for the agent to complete (5 minutes). */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
/** How often to poll for results. */
const POLL_INTERVAL_MS = 5_000;

/**
 * Creates the task function used by the eval runner.
 *
 * The task:
 * 1. Creates an integration + data stream (triggering the agent via Task Manager)
 * 2. Uploads sample logs to the samples index
 * 3. Polls the results endpoint until the agent completes
 * 4. Returns the generated pipeline + simulated docs
 */
export const createAutoImportTask = ({
  kbnClient,
  connectorId,
}: {
  kbnClient: KbnClient;
  connectorId: string;
}) => {
  return async (example: AutoImportEvalExample): Promise<AutoImportTaskOutput> => {
    const { integration_id: integrationId, datastream_id: datastreamId, samples } = example.input;
    const startTime = Date.now();

    // -----------------------------------------------------------------------
    // 1. Upload samples first
    // -----------------------------------------------------------------------
    await kbnClient.request({
      method: 'POST',
      path: `/api/automatic_import_v2/integrations/${integrationId}/data_streams/${datastreamId}/upload`,
      headers: {
        'elastic-api-version': '1',
      },
      body: {
        samples,
        originalSource: {
          sourceType: 'file',
          sourceValue: 'eval-suite-samples.log',
        },
      },
    });

    // -----------------------------------------------------------------------
    // 2. Create integration + data stream (triggers the agent)
    // -----------------------------------------------------------------------
    await kbnClient.request({
      method: 'PUT',
      path: '/api/automatic_import_v2/integrations',
      headers: {
        'elastic-api-version': '1',
      },
      body: {
        connectorId,
        integrationId,
        title: `Eval: ${integrationId}`,
        description: `Evaluation run for ${integrationId}/${datastreamId}`,
        dataStreams: [
          {
            dataStreamId: datastreamId,
            title: `Eval: ${datastreamId}`,
            description: `Evaluation data stream for ${datastreamId}`,
            inputTypes: [{ name: 'filestream' }],
          },
        ],
      },
    });

    // -----------------------------------------------------------------------
    // 3. Poll for results
    // -----------------------------------------------------------------------
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (true) {
      if (Date.now() > deadline) {
        return {
          pipeline: null,
          simulated_docs: [],
          pipeline_success_rate: 0,
          failed_sample_count: samples.length,
          failure_details: [{ sample: '*', error: 'Timed out waiting for agent to complete' }],
          duration_ms: Date.now() - startTime,
        };
      }

      await sleep(POLL_INTERVAL_MS);

      try {
        const response = await kbnClient.request({
          method: 'GET',
          path: `/api/automatic_import_v2/integrations/${integrationId}/data_streams/${datastreamId}/results`,
          headers: {
            'elastic-api-version': '1',
          },
        });

        const { ingest_pipeline: ingestPipeline, results: pipelineDocs } = response.data as {
          ingest_pipeline: Record<string, unknown>;
          results: Array<Record<string, unknown>>;
        };

        const pipeline = ingestPipeline as unknown as GeneratedPipeline;
        const successCount = pipelineDocs.filter((doc) => !doc._error).length;
        const failedDocs = pipelineDocs.filter((doc) => doc._error);

        return {
          pipeline,
          simulated_docs: pipelineDocs,
          pipeline_success_rate: pipelineDocs.length > 0 ? successCount / pipelineDocs.length : 0,
          failed_sample_count: failedDocs.length,
          failure_details: failedDocs.map((doc) => ({
            sample: String(doc._source ?? ''),
            error: String(doc._error ?? 'unknown error'),
          })),
          duration_ms: Date.now() - startTime,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Not completed yet — keep polling
        if (message.includes('has not completed yet')) {
          continue;
        }
        // Failed — return error
        if (message.includes('failed and has no results')) {
          return {
            pipeline: null,
            simulated_docs: [],
            pipeline_success_rate: 0,
            failed_sample_count: samples.length,
            failure_details: [{ sample: '*', error: `Agent failed: ${message}` }],
            duration_ms: Date.now() - startTime,
          };
        }
        throw err;
      }
    }
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
