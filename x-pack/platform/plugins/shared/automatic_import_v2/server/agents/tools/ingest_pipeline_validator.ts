/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolRunnableConfig } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { z } from '@kbn/zod';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';
import type { estypes } from '@elastic/elasticsearch';

interface DocTemplate {
  _index: string;
  _id: string;
  _source: {
    message: string;
    [key: string]: unknown;
  };
}

function formatSample(sample: string): DocTemplate {
  return {
    _index: 'index',
    _id: 'id',
    _source: { message: sample },
  };
}

interface FailedSample {
  sample: string;
  error: string;
}

/**
 * Structured analysis of a processor error with actionable fix suggestions.
 */
interface ProcessorErrorAnalysis {
  processorType: string | null;
  processorIndex: number | null;
  errorCategory:
    | 'pattern_mismatch'
    | 'field_missing'
    | 'type_conversion'
    | 'script_error'
    | 'config_error'
    | 'unknown';
  problemField: string | null;
  suggestedFix: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Common error patterns from Elasticsearch ingest pipeline errors.
 * Maps regex patterns to error categories and fix suggestions.
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  category: ProcessorErrorAnalysis['errorCategory'];
  extractInfo: (match: RegExpMatchArray, fullError: string) => Partial<ProcessorErrorAnalysis>;
}> = [
  // Grok pattern errors
  {
    pattern: /grok.*?pattern.*?(?:not match|didn't match|no match)/i,
    category: 'pattern_mismatch',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      return {
        processorType: 'grok',
        problemField: fieldMatch?.[1] ?? 'message',
        suggestedFix:
          'The grok pattern does not match the input. Review the log format and adjust the pattern. Consider using a more flexible pattern or adding pattern_definitions for complex formats.',
        confidence: 'high',
      };
    },
  },
  {
    pattern: /Provided Grok expressions do not match/i,
    category: 'pattern_mismatch',
    extractInfo: () => ({
      processorType: 'grok',
      suggestedFix:
        'None of the grok patterns matched the input. Check that the patterns array covers all log variations. Consider adding fallback patterns or using ignore_failure: true with on_failure handlers.',
      confidence: 'high',
    }),
  },
  // Dissect pattern errors
  {
    pattern: /dissect.*?(?:unable to find|could not find|missing)/i,
    category: 'pattern_mismatch',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      const keyMatch = fullError.match(/key \[([^\]]+)\]/i);
      return {
        processorType: 'dissect',
        problemField: fieldMatch?.[1] ?? keyMatch?.[1] ?? null,
        suggestedFix:
          'The dissect pattern expects a delimiter or structure not present in the input. Verify the log format matches the dissect pattern exactly. Dissect is strict - consider grok for variable formats.',
        confidence: 'high',
      };
    },
  },
  {
    pattern: /Unable to find match for dissect pattern/i,
    category: 'pattern_mismatch',
    extractInfo: () => ({
      processorType: 'dissect',
      suggestedFix:
        'Dissect pattern structure does not match the input. Check delimiter positions and named capture groups. The input may have extra/missing delimiters compared to the pattern.',
      confidence: 'high',
    }),
  },
  // Field not found errors
  {
    pattern: /field \[([^\]]+)\] (?:not present|doesn't exist|is null|missing)/i,
    category: 'field_missing',
    extractInfo: (match) => ({
      problemField: match[1],
      suggestedFix: `Field "${match[1]}" does not exist. Add "if": "ctx.${match[1].replace(
        /\./g,
        '?.'
      )} != null" condition to the processor, or ensure a previous processor creates this field.`,
      confidence: 'high',
    }),
  },
  {
    pattern: /field \[([^\]]+)\] is null/i,
    category: 'field_missing',
    extractInfo: (match) => ({
      problemField: match[1],
      suggestedFix: `Field "${match[1]}" is null. Add null check: "if": "ctx.${match[1].replace(
        /\./g,
        '?.'
      )} != null" to skip processing when field is missing.`,
      confidence: 'high',
    }),
  },
  {
    pattern: /cannot access (?:field|property) \[([^\]]+)\]/i,
    category: 'field_missing',
    extractInfo: (match) => ({
      problemField: match[1],
      suggestedFix: `Cannot access field path "${match[1]}". The parent object may not exist. Use optional chaining in conditions or ensure parent objects are created first.`,
      confidence: 'medium',
    }),
  },
  // Type conversion errors
  {
    pattern:
      /(?:cannot convert|failed to convert|unable to convert).*?(?:to|into) (integer|long|float|double|boolean|ip|date)/i,
    category: 'type_conversion',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      const valueMatch = fullError.match(/value \[([^\]]+)\]/i);
      return {
        processorType: 'convert',
        problemField: fieldMatch?.[1] ?? null,
        suggestedFix: `Cannot convert value${valueMatch ? ` "${valueMatch[1]}"` : ''} to ${
          match[1]
        }. Add "ignore_failure": true or validate the value format before conversion. For IPs, ensure the value is a valid IP address.`,
        confidence: 'high',
      };
    },
  },
  {
    pattern:
      /(?:NumberFormatException|IllegalArgumentException.*?(?:number|integer|long|float|double))/i,
    category: 'type_conversion',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      return {
        processorType: 'convert',
        problemField: fieldMatch?.[1] ?? null,
        suggestedFix:
          'Number conversion failed. The value may contain non-numeric characters. Use a script to clean the value first, or add a conditional to skip non-numeric values.',
        confidence: 'medium',
      };
    },
  },
  // Date parsing errors
  {
    pattern: /(?:failed to parse|unable to parse).*?date/i,
    category: 'type_conversion',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      const formatMatch = fullError.match(/format(?:s)? \[([^\]]+)\]/i);
      return {
        processorType: 'date',
        problemField: fieldMatch?.[1] ?? null,
        suggestedFix: `Date parsing failed${
          formatMatch ? ` with format "${formatMatch[1]}"` : ''
        }. Add more date formats to the "formats" array, or use "UNIX", "UNIX_MS", or "ISO8601" for standard formats.`,
        confidence: 'high',
      };
    },
  },
  // Rename errors
  {
    pattern: /rename.*?field \[([^\]]+)\].*?(?:doesn't exist|not found|missing)/i,
    category: 'field_missing',
    extractInfo: (match) => ({
      processorType: 'rename',
      problemField: match[1],
      suggestedFix: `Cannot rename field "${match[1]}" because it doesn't exist. Add "ignore_missing": true to the rename processor, or ensure the field is created by a previous processor.`,
      confidence: 'high',
    }),
  },
  // Script errors
  {
    pattern: /(?:script|painless).*?(?:error|exception|failed)/i,
    category: 'script_error',
    extractInfo: (match, fullError) => {
      const lineMatch = fullError.match(/line (\d+)/i);
      const varMatch = fullError.match(/variable \[([^\]]+)\]/i);
      return {
        processorType: 'script',
        problemField: varMatch?.[1] ?? null,
        suggestedFix: `Script error${lineMatch ? ` at line ${lineMatch[1]}` : ''}${
          varMatch ? ` with variable "${varMatch[1]}"` : ''
        }. Check for null values before accessing properties. Use ctx.containsKey('field') or ctx.field != null checks.`,
        confidence: 'medium',
      };
    },
  },
  {
    pattern: /NullPointerException/i,
    category: 'script_error',
    extractInfo: () => ({
      processorType: 'script',
      suggestedFix:
        'NullPointerException in script. A field or nested property is null. Add null checks: if (ctx.field != null && ctx.field.subfield != null) { ... }',
      confidence: 'high',
    }),
  },
  // JSON parsing errors
  {
    pattern: /(?:json|JSON).*?(?:parse|parsing).*?(?:error|failed|exception)/i,
    category: 'pattern_mismatch',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      return {
        processorType: 'json',
        problemField: fieldMatch?.[1] ?? 'message',
        suggestedFix:
          'JSON parsing failed. The field value is not valid JSON. Check for truncated data, encoding issues, or non-JSON content. Consider adding ignore_failure with a fallback.',
        confidence: 'high',
      };
    },
  },
  // Set/Append errors
  {
    pattern: /set.*?processor.*?(?:error|failed)/i,
    category: 'config_error',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      return {
        processorType: 'set',
        problemField: fieldMatch?.[1] ?? null,
        suggestedFix:
          'Set processor error. Check that the value template syntax is correct. Use {{field}} for field references. Ensure referenced fields exist.',
        confidence: 'medium',
      };
    },
  },
  // Remove processor errors
  {
    pattern: /remove.*?field \[([^\]]+)\].*?(?:doesn't exist|not found)/i,
    category: 'field_missing',
    extractInfo: (match) => ({
      processorType: 'remove',
      problemField: match[1],
      suggestedFix: `Cannot remove field "${match[1]}" because it doesn't exist. Add "ignore_missing": true to the remove processor.`,
      confidence: 'high',
    }),
  },
  // KV processor errors
  {
    pattern: /kv.*?(?:error|failed|exception)/i,
    category: 'pattern_mismatch',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      return {
        processorType: 'kv',
        problemField: fieldMatch?.[1] ?? null,
        suggestedFix:
          'KV processor error. Check that field_split and value_split characters are correct. Verify the input contains key=value pairs with the expected delimiters.',
        confidence: 'medium',
      };
    },
  },
  // CSV processor errors
  {
    pattern: /csv.*?(?:error|failed|exception)/i,
    category: 'pattern_mismatch',
    extractInfo: (match, fullError) => {
      const fieldMatch = fullError.match(/field \[([^\]]+)\]/i);
      return {
        processorType: 'csv',
        problemField: fieldMatch?.[1] ?? null,
        suggestedFix:
          'CSV processor error. Check separator character and quote character settings. Verify the number of target_fields matches the number of columns in the input.',
        confidence: 'medium',
      };
    },
  },
];

/**
 * Extracts processor index from Elasticsearch error messages.
 */
const extractProcessorIndex = (error: string): number | null => {
  // Match patterns like "processor [grok] [5]" or "at processor index [5]"
  const indexMatch =
    error.match(/processor.*?\[(\d+)\]/i) ??
    error.match(/index.*?\[(\d+)\]/i) ??
    error.match(/\[(\d+)\].*?processor/i);
  return indexMatch ? parseInt(indexMatch[1], 10) : null;
};

/**
 * Extracts processor type from Elasticsearch error messages.
 */
const extractProcessorType = (error: string): string | null => {
  const typeMatch =
    error.match(/processor \[([a-z_]+)\]/i) ??
    error.match(/type \[([a-z_]+)\]/i) ??
    error.match(/\[([a-z_]+)\] processor/i);
  return typeMatch ? typeMatch[1].toLowerCase() : null;
};

/**
 * Analyzes an error message to provide structured feedback and fix suggestions.
 */
const analyzeProcessorError = (error: string): ProcessorErrorAnalysis => {
  const processorIndex = extractProcessorIndex(error);
  const processorType = extractProcessorType(error);

  // Try to match against known error patterns
  for (const errorPattern of ERROR_PATTERNS) {
    const match = error.match(errorPattern.pattern);
    if (match) {
      const extracted = errorPattern.extractInfo(match, error);
      return {
        processorType: extracted.processorType ?? processorType,
        processorIndex,
        errorCategory: errorPattern.category,
        problemField: extracted.problemField ?? null,
        suggestedFix: extracted.suggestedFix ?? 'Review the processor configuration.',
        confidence: extracted.confidence ?? 'medium',
      };
    }
  }

  // Fallback for unrecognized errors
  return {
    processorType,
    processorIndex,
    errorCategory: 'unknown',
    problemField: null,
    suggestedFix:
      'Unrecognized error. Review the error message and processor configuration. Consider adding ignore_failure: true with an on_failure handler for debugging.',
    confidence: 'low',
  };
};

/**
 * Aggregates error analyses to identify patterns across multiple failures.
 */
const aggregateErrorAnalyses = (
  analyses: ProcessorErrorAnalysis[]
): {
  mostCommonErrorType: string | null;
  mostCommonProcessor: string | null;
  prioritizedFixes: string[];
  summary: string;
} => {
  if (analyses.length === 0) {
    return {
      mostCommonErrorType: null,
      mostCommonProcessor: null,
      prioritizedFixes: [],
      summary: 'No errors to analyze.',
    };
  }

  // Count error categories
  const categoryCounts: Record<string, number> = {};
  const processorCounts: Record<string, number> = {};
  const fixesWithConfidence: Array<{ fix: string; confidence: string }> = [];

  for (const analysis of analyses) {
    categoryCounts[analysis.errorCategory] = (categoryCounts[analysis.errorCategory] || 0) + 1;
    if (analysis.processorType) {
      processorCounts[analysis.processorType] = (processorCounts[analysis.processorType] || 0) + 1;
    }
    fixesWithConfidence.push({ fix: analysis.suggestedFix, confidence: analysis.confidence });
  }

  const mostCommonErrorType =
    Object.entries(categoryCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  const mostCommonProcessor =
    Object.entries(processorCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  // Deduplicate and prioritize fixes by confidence
  const seenFixes = new Set<string>();
  const prioritizedFixes = fixesWithConfidence
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (
        (order[a.confidence as keyof typeof order] || 2) -
        (order[b.confidence as keyof typeof order] || 2)
      );
    })
    .filter((f) => {
      if (seenFixes.has(f.fix)) return false;
      seenFixes.add(f.fix);
      return true;
    })
    .slice(0, 5)
    .map((f) => f.fix);

  const summary = `${analyses.length} error(s) analyzed. Most common issue: ${
    mostCommonErrorType ?? 'unknown'
  }${mostCommonProcessor ? ` in ${mostCommonProcessor} processor` : ''}.`;

  return {
    mostCommonErrorType,
    mostCommonProcessor,
    prioritizedFixes,
    summary,
  };
};

/**
 * Creates a standalone langgraph tool that validates an ingest pipeline against samples.
 * This function can be used independently or through the IngestPipelineValidatorTool class.
 *
 * @param esClient - Elasticsearch client for simulating the pipeline
 * @param samples - Array of log samples to validate the pipeline against
 * @returns DynamicStructuredTool instance for use in langgraph agents
 */
export function ingestPipelineValidatorTool(
  esClient: ElasticsearchClient,
  samples: string[]
): DynamicStructuredTool {
  const validatorSchema = z.object({
    // We intentionally keep this schema permissive to avoid LangChain output
    // parsing failures. The model can return the pipeline as:
    // - a JSON object
    // - a JSON string
    // - a loosely-shaped object that we'll validate at runtime
    //
    // Detailed validation happens inside the tool implementation so that
    // we can surface rich error messages instead of generic
    // OUTPUT_PARSING_FAILURE errors.
    generatedPipeline: z
      .any()
      .describe('The generated ingest pipeline to validate (object or JSON string)'),
  });
  return new DynamicStructuredTool({
    name: 'validate_ingest_pipeline',
    description:
      'Validates a generated ingest pipeline by testing it against log samples. ' +
      'Simulates the pipeline to verify it works correctly. ' +
      'Returns validation results including success rate, failed samples, and error details.',
    schema: validatorSchema,
    func: async (
      input: z.infer<typeof validatorSchema>,
      _runManager?: CallbackManagerForToolRun,
      config?: ToolRunnableConfig
    ) => {
      const { generatedPipeline } = input;

      // Normalize the generated pipeline into an object we can pass to the
      // Elasticsearch client. We keep this logic here (rather than in Zod)
      // so that bad inputs produce interpretable validation errors instead
      // of LangChain OUTPUT_PARSING_FAILURE errors.
      let generatedPipelineObject: unknown = generatedPipeline;

      // Handle common case where the model returns a JSON string.
      if (typeof generatedPipelineObject === 'string') {
        try {
          generatedPipelineObject = JSON.parse(generatedPipeline);
        } catch (e) {
          const errorMessage = `Failed to parse generatedPipeline JSON string: ${
            (e as Error).message
          }`;
          return new Command({
            update: {
              pipeline_generation_results: [],
              failure_count: samples.length,
              pipeline_validation_results: {
                success_rate: 0,
                successful_samples: 0,
                failed_samples: samples.length,
                total_samples: samples.length,
                failure_details: [
                  {
                    error: errorMessage,
                    sample: 'Pipeline validation error',
                  },
                ],
              },
              messages: [
                new ToolMessage({
                  content: errorMessage,
                  tool_call_id: config?.toolCall?.id as string,
                }),
              ],
            },
          });
        }
      }

      // Basic shape validation so we don't send obviously invalid structures
      // to the Elasticsearch simulate API.
      if (
        !generatedPipelineObject ||
        typeof generatedPipelineObject !== 'object' ||
        Array.isArray((generatedPipelineObject as any).processors)
          ? (generatedPipelineObject as any).processors.length === 0
          : !(generatedPipelineObject as any).processors
      ) {
        const errorMessage =
          'generated_pipeline must contain a non-empty processors array with valid processor objects';
        return new Command({
          update: {
            pipeline_generation_results: [],
            failure_count: samples.length,
            pipeline_validation_results: {
              success_rate: 0,
              successful_samples: 0,
              failed_samples: samples.length,
              total_samples: samples.length,
              failure_details: [
                {
                  error: errorMessage,
                  sample: 'Pipeline validation error',
                },
              ],
            },
            messages: [
              new ToolMessage({
                content: errorMessage,
                tool_call_id: config?.toolCall?.id as string,
              }),
            ],
          },
        });
      }

      try {
        if (!samples || samples.length === 0) {
          const message = `No samples available for validation`;
          return new Command({
            update: {
              pipeline_generation_results: [],
              failure_count: 0,
              pipeline_validation_results: {
                success_rate: 0,
                successful_samples: 0,
                failed_samples: 0,
                total_samples: 0,
                failure_details: [],
              },
              messages: [
                new ToolMessage({
                  content: message,
                  tool_call_id: config?.toolCall?.id as string,
                }),
              ],
            },
          });
        }

        // Format samples for pipeline simulation
        const docs = samples.map((sample: string) => formatSample(sample));

        // Simulate the pipeline
        let response: estypes.IngestSimulateResponse;
        try {
          // Cast to IngestPipeline to satisfy the Elasticsearch client types.
          // Shape is validated above by zod (processors/on_failure arrays, each with a type field).
          response = await esClient.ingest.simulate({
            docs,
            pipeline: generatedPipelineObject as estypes.IngestPipeline,
          });
        } catch (simulateError) {
          const errorMessage = `Pipeline simulation failed: ${(simulateError as Error).message}`;
          return new Command({
            update: {
              pipeline_generation_results: [],
              failure_count: samples.length,
              pipeline_validation_results: {
                success_rate: 0,
                successful_samples: 0,
                failed_samples: samples.length,
                total_samples: samples.length,
                failure_details: [
                  {
                    error: errorMessage,
                    sample: 'Pipeline validation error',
                  },
                ],
              },
              messages: [
                new ToolMessage({
                  content: errorMessage,
                  tool_call_id: config?.toolCall?.id as string,
                }),
              ],
            },
          });
        }

        // Process simulation results
        const failedSamples: FailedSample[] = [];
        const errorAnalyses: ProcessorErrorAnalysis[] = [];
        const successfulDocuments: Array<estypes.IngestDocumentSimulation['doc']> = [];
        let successfulCount = 0;

        response.docs.forEach((doc, index) => {
          if (!doc) {
            // Document was dropped
            const error = 'Document was dropped by the pipeline';
            failedSamples.push({
              sample: samples[index],
              error,
            });
            errorAnalyses.push(analyzeProcessorError(error));
          } else if (doc.doc?._source?.error) {
            // Document has an error
            const errorDetail =
              typeof doc.doc._source.error === 'string'
                ? doc.doc._source.error
                : JSON.stringify(doc.doc._source.error);
            failedSamples.push({
              sample: samples[index],
              error: errorDetail,
            });
            errorAnalyses.push(analyzeProcessorError(errorDetail));
          } else if (doc.doc?._source) {
            // Document processed successfully
            successfulCount++;
            successfulDocuments.push(doc.doc._source);
          }
        });

        const failedCount = failedSamples.length;
        const totalSamples = samples.length;
        const successRate = totalSamples > 0 ? (successfulCount / totalSamples) * 100 : 0;

        // Aggregate error analyses for actionable feedback
        const errorSummary = aggregateErrorAnalyses(errorAnalyses);

        // Build detailed message with fix suggestions for the agent
        let message: string;
        if (failedCount === 0) {
          message = `Pipeline validation successful! All ${totalSamples} samples processed correctly.`;
        } else {
          const fixSuggestions =
            errorSummary.prioritizedFixes.length > 0
              ? `\n\n**Suggested Fixes (in priority order):**\n${errorSummary.prioritizedFixes
                  .map((fix, i) => `${i + 1}. ${fix}`)
                  .join('\n')}`
              : '';

          const errorBreakdown = errorAnalyses
            .slice(0, 3)
            .map((analysis, i) => {
              const processorInfo = analysis.processorType
                ? `[${analysis.processorType}${
                    analysis.processorIndex !== null ? ` at index ${analysis.processorIndex}` : ''
                  }]`
                : '';
              const fieldInfo = analysis.problemField ? ` on field "${analysis.problemField}"` : '';
              return `  ${i + 1}. ${analysis.errorCategory}${processorInfo}${fieldInfo}`;
            })
            .join('\n');

          message = `Pipeline validation completed with ${successfulCount}/${totalSamples} samples successful (${successRate.toFixed(
            1
          )}% success rate). ${failedCount} samples failed.

**Error Analysis:**
${errorSummary.summary}

**Error Breakdown:**
${errorBreakdown}${fixSuggestions}`;
        }

        return new Command({
          update: {
            current_pipeline: generatedPipelineObject,
            pipeline_generation_results: successfulDocuments,
            failure_count: failedCount,
            pipeline_validation_results: {
              success_rate: successRate,
              successful_samples: successfulCount,
              failed_samples: failedCount,
              total_samples: totalSamples,
              failure_details: failedSamples.slice(0, 100).map((f, i) => ({
                error: f.error,
                sample: f.sample,
                analysis: errorAnalyses[i]
                  ? {
                      processorType: errorAnalyses[i].processorType,
                      processorIndex: errorAnalyses[i].processorIndex,
                      errorCategory: errorAnalyses[i].errorCategory,
                      problemField: errorAnalyses[i].problemField,
                      suggestedFix: errorAnalyses[i].suggestedFix,
                      confidence: errorAnalyses[i].confidence,
                    }
                  : undefined,
              })),
              error_summary:
                failedCount > 0
                  ? {
                      most_common_error: errorSummary.mostCommonErrorType,
                      most_common_processor: errorSummary.mostCommonProcessor,
                      prioritized_fixes: errorSummary.prioritizedFixes,
                    }
                  : undefined,
            },
            messages: [
              new ToolMessage({
                content: message,
                tool_call_id: config?.toolCall?.id as string,
              }),
            ],
          },
        });
      } catch (error) {
        const errorMessage = `Validation tool error: ${(error as Error).message}`;
        return new Command({
          update: {
            pipeline_generation_results: [],
            failure_count: 1,
            pipeline_validation_results: {
              success_rate: 0,
              successful_samples: 0,
              failed_samples: 1,
              total_samples: 1,
              failure_details: [
                {
                  error: errorMessage,
                  sample: 'Tool execution error',
                },
              ],
            },
            messages: [
              new ToolMessage({
                content: errorMessage,
                tool_call_id: config?.toolCall?.id as string,
              }),
            ],
          },
        });
      }
    },
  });
}
