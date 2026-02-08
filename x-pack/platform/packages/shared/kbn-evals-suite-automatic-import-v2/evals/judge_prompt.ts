/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalExpectedOutput, AutoImportTaskOutput } from '../src/types';
import { calculateMetrics, getMissingEcsFields, getMissingProcessorTypes } from './metrics';

// ---------------------------------------------------------------------------
// LLM-as-a-judge evaluator
// ---------------------------------------------------------------------------

/**
 * Criteria for the LLM-as-a-judge evaluator.
 * Each criterion is scored 0-5 and the final score is the average normalized to 0-1.
 */
export const LLM_JUDGE_CRITERIA = [
  `PIPELINE CORRECTNESS (0-5): Does the generated ingest pipeline parse all provided sample logs correctly?
  - 5: ≥95% of samples parse without errors, all key fields extracted
  - 4: ≥85% success rate, most key fields extracted
  - 3: ≥70% success rate, some fields missing
  - 2: ≥50% success rate, many fields missing or wrong
  - 1: <50% success rate
  - 0: Pipeline fails to parse or is null`,

  `ECS COMPLIANCE (0-5): Does the pipeline produce output documents that follow the Elastic Common Schema?
  - 5: All standard ECS fields mapped correctly (source.ip, @timestamp, event.category, related.*)
  - 4: Most ECS fields mapped, minor omissions
  - 3: Core fields present but significant ECS fields missing
  - 2: Only basic fields present, poor ECS coverage
  - 1: Very few ECS fields, mostly raw/unmapped data
  - 0: No ECS compliance at all`,

  `EVENT CATEGORIZATION (0-5): Are events correctly categorized per ECS event.category/type/action conventions?
  - 5: Correct event.category, event.type, event.action, and event.outcome for all event types
  - 4: Mostly correct categorization, minor mismatches
  - 3: Some categorization present but incomplete
  - 2: Only event.category set, type/action missing
  - 1: Wrong categorization
  - 0: No event categorization`,

  `DEEP EXTRACTION QUALITY (0-5): Are embedded values (IPs, users, hostnames) extracted from message bodies?
  - 5: All embedded IPs, usernames, hostnames extracted into proper fields + related.* populated
  - 4: Most embedded values extracted, related.* mostly populated
  - 3: Some extraction but missing important embedded values
  - 2: Only surface-level extraction, no deep parsing of message content
  - 1: Almost no extraction from message bodies
  - 0: No deep extraction attempted`,

  `INTEGRATION QUALITY (0-5): Would this pipeline be suitable for a production Elastic integration?
  - 5: Production-ready, matches quality of human-crafted integrations
  - 4: Near production quality, minor improvements needed
  - 3: Functional but needs significant polish
  - 2: Rough draft quality, major improvements needed
  - 1: Barely functional
  - 0: Not suitable for any use`,
];

/**
 * Create the LLM-as-a-judge evaluator for the automatic import pipeline.
 *
 * This evaluator uses the `evaluators.criteria(...)` API from @kbn/evals
 * to score the pipeline output on a structured rubric.
 */
export const createLlmJudgeEvaluator = (evaluators: {
  criteria: (criteria: string[]) => {
    evaluate: (args: {
      input: unknown;
      output: unknown;
      expected: unknown;
    }) => Promise<{ score: number; reasoning: string }>;
  };
}) => {
  return {
    name: 'llm_pipeline_judge',
    kind: 'LLM' as const,
    evaluate: async ({
      input,
      output,
      expected,
    }: {
      input: { integration_id: string; datastream_id: string; samples: string[] };
      output: AutoImportTaskOutput;
      expected: AutoImportEvalExpectedOutput;
    }) => {
      if (!output.pipeline) {
        return {
          score: 0,
          reasoning: 'Pipeline generation failed — no pipeline produced.',
        };
      }

      const metrics = calculateMetrics(output, expected);
      const missingEcs = getMissingEcsFields(output, expected);
      const missingProcessors = getMissingProcessorTypes(output, expected);

      return evaluators.criteria(LLM_JUDGE_CRITERIA).evaluate({
        input: {
          integration_id: input.integration_id,
          datastream_id: input.datastream_id,
          sample_count: input.samples.length,
          sample_preview: input.samples.slice(0, 3),
        },
        output: {
          pipeline_json: JSON.stringify(output.pipeline, null, 2).slice(0, 4000),
          simulated_doc_sample: output.simulated_docs.slice(0, 3),
          deterministic_metrics: metrics,
          missing_ecs_fields: missingEcs,
          missing_processor_types: missingProcessors,
          failed_sample_count: output.failed_sample_count,
          failure_details_sample: output.failure_details.slice(0, 3),
        },
        expected: {
          expected_ecs_fields: expected.expected_ecs_fields,
          expected_event_categories: expected.expected_event_categories,
          expected_event_types: expected.expected_event_types,
          expected_related_fields: expected.expected_related_fields,
          expected_processor_types: expected.expected_processor_types,
          min_pipeline_success_rate: expected.min_pipeline_success_rate,
        },
      });
    },
  };
};
