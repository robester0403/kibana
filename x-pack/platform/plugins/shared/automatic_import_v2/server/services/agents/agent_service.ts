/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, LoggerFactory, Logger } from '@kbn/core/server';
import type { InferenceChatModel } from '@kbn/inference-langchain';
import { getLangSmithTracer } from '@kbn/langchain/server/tracers/langsmith';
import { createAutomaticImportAgent } from '../../agents';
import {
  createIngestPipelineGeneratorAgent,
  createLogsAnalyzerAgent,
  createTextToEcsAgent,
} from '../../agents/sub_agents';
import {
  fetchSamplesTool,
  fetchUniqueKeysTool,
  ingestPipelineValidatorTool,
  ecsSchemaLookupTool,
  deepExtractionAnalyzerTool,
  relatedFieldsAggregatorTool,
  semanticEventClassifierTool,
} from '../../agents/tools';
import type { AutomaticImportSamplesIndexService } from '../samples_index/index_service';
import { INGEST_PIPELINE_GENERATOR_PROMPT } from '../../agents/prompts';
import type { LangSmithOptions } from '../../routes/types';

export class AgentService {
  private logger: Logger;

  constructor(
    private readonly samplesIndexService: AutomaticImportSamplesIndexService,
    logger: LoggerFactory
  ) {
    this.logger = logger.get('agentService');
  }

  /**
   * Invokes the deep research agent with samples fetched from the index.
   * Uses tool-based approach:
   * - Service creates tools with samples and esClient
   * - Agent can fetch samples on demand using fetch_log_samples tool
   * - Validator tool has access to all samples
   * - No samples in context unless agent explicitly requests them (saves tokens)
   *
   * @param integration_id - The integration ID
   * @param data_stream_id - The data stream ID
   * @param esClient - The Elasticsearch client
   * @param model - The model to use for the agent
   */
  public async invokeAutomaticImportAgent(
    integrationId: string,
    dataStreamId: string,
    esClient: ElasticsearchClient,
    model: InferenceChatModel,
    langSmithOptions?: LangSmithOptions
  ) {
    this.logger.debug(
      `invokeAutomaticImportAgent: Invoking automatic import agent for integration ${integrationId} and data stream ${dataStreamId}`
    );

    // Fetch samples from the index (decoupled from agent building)
    const samples = await this.samplesIndexService.getSamplesForDataStream(
      integrationId,
      dataStreamId,
      esClient
    );

    // Create tools at the service level
    // Tools capture samples and esClient in their closures
    const fetchSamplesToolInstance = fetchSamplesTool(samples);
    const validatorTool = ingestPipelineValidatorTool(esClient, samples);
    const uniqueKeysTool = fetchUniqueKeysTool();

    // Create enhanced tools for improved pipeline quality
    // These tools work with ANY log format - no assumptions about vendor or structure
    const ecsLookupTool = ecsSchemaLookupTool();
    const extractionTool = deepExtractionAnalyzerTool();
    const relatedTool = relatedFieldsAggregatorTool();
    const classifierTool = semanticEventClassifierTool();

    // Create the sub agents with tools
    const logsAnalyzerSubAgent = createLogsAnalyzerAgent({
      prompt: `You have access to tools for analyzing log samples. Use them to retrieve and analyze log samples for ingest pipeline generation.
      <workflow>
        1. Call fetch_log_samples to retrieve 5-10 sample logs
        2. Use deep_extraction_analyzer to identify extractable patterns (IPs, users, timestamps, etc.)
        3. Use ecs_schema_lookup to verify ECS field mappings for detected patterns (e.g., lookup "source.*" for source IPs, "event.*" for categorization)
        4. Analyze the samples to identify format, fields, and characteristics
        5. Provide structured analysis output as specified in your system prompt, including preliminary ECS field recommendations
      </workflow>`,
      tools: [fetchSamplesToolInstance, extractionTool, ecsLookupTool],
    });

    const pipelineGeneratorSubAgent = createIngestPipelineGeneratorAgent({
      name: 'ingest_pipeline_generator',
      description:
        'Generates an Elasticsearch ingest pipeline for the provided log samples and documentation.',
      prompt: INGEST_PIPELINE_GENERATOR_PROMPT,
      tools: [validatorTool, ecsLookupTool],
      sampleCount: samples.length,
    });

    const textToEcsSubAgent = createTextToEcsAgent({
      prompt: `You have access to tools for ECS mapping and field analysis.
      <workflow>
        1. Use fetch_unique_keys to inspect recent pipeline outputs
        2. Use ecs_schema_lookup to find correct ECS field definitions
        3. Use semantic_event_classifier to determine event.category/type values
        4. Use related_fields_aggregator to ensure proper related.* field population
        5. Propose comprehensive ECS mappings following the schema
      </workflow>`,
      tools: [uniqueKeysTool, ecsLookupTool, relatedTool, classifierTool],
    });

    // Create and invoke the agent
    const automaticImportAgent = createAutomaticImportAgent({
      model,
      subagents: [logsAnalyzerSubAgent, pipelineGeneratorSubAgent, textToEcsSubAgent],
    });

    const langSmithTracers =
      langSmithOptions?.apiKey && langSmithOptions?.projectName
        ? getLangSmithTracer({
            apiKey: langSmithOptions.apiKey,
            projectName: langSmithOptions.projectName,
            logger: this.logger,
          })
        : [];

    const result = await automaticImportAgent.invoke(
      {
        messages: [
          {
            role: 'user',
            content: `You are tasked with generating an Elasticsearch ingest pipeline for the integration \`${integrationId}\` and data stream \`${dataStreamId}\`.`,
          },
        ],
      },
      {
        callbacks: [...langSmithTracers],
        runName: 'automatic_import_agent',
        tags: ['automatic_import_agent'],
      }
    );

    return result;
  }
}
