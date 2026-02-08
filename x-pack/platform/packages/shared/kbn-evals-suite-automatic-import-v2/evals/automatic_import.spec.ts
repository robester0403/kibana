/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { evaluate } from './evaluate';
import { ALL_DATASETS } from './datasets';
import { createAutoImportTask } from './task';
import { calculateMetrics, getMissingEcsFields, getMissingProcessorTypes } from './metrics';
import { createLlmJudgeEvaluator } from './judge_prompt';
import type { AutoImportEvalExpectedOutput, AutoImportTaskOutput } from '../src/types';
import {
  collectEvalResult,
  buildAdvisorPrompt,
  parseAdvisorResponse,
  formatAdvisorReport,
  type EvalRunResult,
} from './prompt_advisor';
import {
  applyPromptImprovements,
  formatAutoImproveReport,
  resolveAutoImproveMode,
} from './auto_improver';

/**
 * Automatic Import V2 Pipeline Quality Evaluation
 *
 * Evaluates the LangGraph multi-agent system's ability to generate
 * Elasticsearch ingest pipelines from raw log samples.
 *
 * Run with:
 *   node scripts/evals run --suite automatic-import-v2 --evaluation-connector-id <connector>
 *
 * @tags @ess
 */

evaluate.describe.configure({ timeout: 600_000 });

evaluate.describe('Automatic Import V2 - Pipeline Quality', () => {
  /** Accumulated results for the prompt improvement advisor. */
  const allEvalResults: EvalRunResult[] = [];

  // Format helpers
  const fmt = (n: number): string => `${(n * 100).toFixed(0)}%`;

  // ===========================================================================
  // Code-based deterministic evaluator
  // ===========================================================================

  const codeBasedEvaluator = {
    name: 'auto_import_quality_score',
    kind: 'CODE' as const,
    evaluate: async ({
      output,
      expected,
    }: {
      output: AutoImportTaskOutput;
      expected: AutoImportEvalExpectedOutput | null;
    }) => {
      if (!output.pipeline || !expected) {
        return { score: 0, reasoning: 'No pipeline produced or no expected output.' };
      }

      const metrics = calculateMetrics(output, expected);
      const missingEcs = getMissingEcsFields(output, expected);
      const missingProcs = getMissingProcessorTypes(output, expected);

      const issues: string[] = [];
      if (metrics.pipeline_success_rate < expected.min_pipeline_success_rate) {
        issues.push(
          `Low parse rate: ${fmt(metrics.pipeline_success_rate)} (min: ${fmt(
            expected.min_pipeline_success_rate
          )})`
        );
      }
      if (metrics.ecs_field_coverage < 0.7) {
        issues.push(`Low ECS coverage: ${fmt(metrics.ecs_field_coverage)}`);
      }
      if (metrics.timestamp_parsing === 0) {
        issues.push('Timestamp not parsed from logs');
      }
      if (missingEcs.length > 0) {
        issues.push(`Missing ECS: ${missingEcs.slice(0, 5).join(', ')}`);
      }
      if (missingProcs.length > 0) {
        issues.push(`Missing processors: ${missingProcs.join(', ')}`);
      }

      return {
        score: metrics.overall_quality,
        details: {
          ...metrics,
          missing_ecs_fields: missingEcs,
          missing_processor_types: missingProcs,
          duration_ms: output.duration_ms,
        },
        reasoning:
          issues.length > 0
            ? `Issues: ${issues.join('; ')}`
            : `Good quality: ${fmt(metrics.overall_quality)}`,
      };
    },
  };

  // ===========================================================================
  // Test runner — iterate over each dataset and example
  // ===========================================================================

  ALL_DATASETS.forEach((dataset) => {
    evaluate.describe(dataset.name, { tag: '@ess' }, () => {
      dataset.examples.forEach((example, idx) => {
        evaluate(
          `${idx + 1}. ${example.input.integration_id}/${example.input.datastream_id} [${
            example.metadata.difficulty
          }]`,
          async ({ phoenixClient, kbnClient, connector, evaluators }) => {
            // Build the task function
            const task = createAutoImportTask({
              kbnClient,
              connectorId: connector.id,
            });

            // Build evaluators
            const llmJudge = createLlmJudgeEvaluator(evaluators);

            // Run the experiment
            await phoenixClient.runExperiment(
              {
                dataset: {
                  name: `Auto Import V2 - ${example.input.integration_id}`,
                  description: dataset.description,
                  examples: [
                    {
                      input: example.input,
                      output: example.output as unknown as Record<string, unknown>,
                      metadata: example.metadata,
                    },
                  ],
                },
                task: async () => {
                  const output = await task(example);

                  // Collect result for the prompt advisor
                  const evalResult = collectEvalResult(
                    `${dataset.name} / ${example.input.integration_id}`,
                    output,
                    example.output
                  );
                  evalResult.integrationId = example.input.integration_id;
                  evalResult.datastreamId = example.input.datastream_id;
                  allEvalResults.push(evalResult);

                  return output;
                },
              },
              [codeBasedEvaluator, llmJudge]
            );
          }
        );
      });
    });
  });

  // ===========================================================================
  // After all examples: run the Prompt Improvement Advisor
  // ===========================================================================

  evaluate.afterAll(async ({ inferenceClient }) => {
    if (allEvalResults.length === 0) {
      // eslint-disable-next-line no-console
      console.log('\n📋 No evaluation results to analyze for prompt improvements.\n');
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`\n🔍 Running Prompt Improvement Advisor on ${allEvalResults.length} results...\n`);

    try {
      const advisorPrompt = buildAdvisorPrompt(allEvalResults);

      const advisorResponse = await inferenceClient.chatComplete({
        messages: [
          {
            role: 'user' as const,
            content: advisorPrompt,
          },
        ],
      });

      const responseText =
        typeof advisorResponse === 'string'
          ? advisorResponse
          : String(
              (advisorResponse as { content?: string })?.content ?? JSON.stringify(advisorResponse)
            );

      const suggestions = parseAdvisorResponse(responseText);
      const report = formatAdvisorReport(suggestions);

      // eslint-disable-next-line no-console
      console.log(report);

      // -----------------------------------------------------------------------
      // Auto-improve: when AUTO_IMPROVE_PROMPTS is set, propose or apply
      //
      //   AUTO_IMPROVE_PROMPTS=review  → write .proposed file + show diff
      //   AUTO_IMPROVE_PROMPTS=apply   → overwrite prompts.ts (with backup)
      //   (unset / false)              → do nothing beyond printing suggestions
      // -----------------------------------------------------------------------
      const autoImproveMode = resolveAutoImproveMode();
      if (autoImproveMode !== 'off' && suggestions.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`\n🤖 AUTO_IMPROVE_PROMPTS=${autoImproveMode} — generating prompt changes…\n`);

        const improveResult = await applyPromptImprovements(
          suggestions,
          inferenceClient,
          autoImproveMode
        );
        const improveReport = formatAutoImproveReport(improveResult);

        // eslint-disable-next-line no-console
        console.log(improveReport);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Prompt Improvement Advisor failed:', err);
    }
  });
});
