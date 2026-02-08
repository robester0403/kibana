/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  AutoImportQualityMetrics,
  AutoImportEvalExpectedOutput,
  AutoImportTaskOutput,
  PromptImprovementSuggestion,
} from '../src/types';
import { calculateMetrics, getMissingEcsFields, getMissingProcessorTypes } from './metrics';

// ---------------------------------------------------------------------------
// System prompt for the Prompt Improvement Advisor
// ---------------------------------------------------------------------------

const ADVISOR_SYSTEM_PROMPT = `You are an expert at improving LLM prompts for Elasticsearch ingest pipeline generation.

You will be given:
1. Evaluation results from running the Automatic Import V2 LangGraph agent
2. The specific failures (which fields were missing, which samples failed, etc.)
3. The deterministic quality metrics

Your job is to produce SPECIFIC, ACTIONABLE prompt improvement suggestions.

The Automatic Import V2 system has these prompts that can be modified:
- **orchestrator**: The main agent prompt (AUTOMATIC_IMPORT_AGENT_PROMPT) - controls high-level workflow and sub-agent delegation
- **logs_analyzer**: Analyzes log format and structure (LOG_ANALYZER_PROMPT)
- **pipeline_generator**: Generates the ingest pipeline YAML (INGEST_PIPELINE_GENERATOR_PROMPT)  
- **text_to_ecs**: Maps extracted fields to ECS (TEXT_TO_ECS_PROMPT)

For each suggestion, you MUST provide:
1. Which prompt to modify (one of the four above)
2. The SPECIFIC text change or addition to make
3. WHY this change will fix the observed failure
4. Your confidence level (high/medium/low)

IMPORTANT RULES:
- Be SPECIFIC. Don't say "improve the prompt". Say exactly what text to add/change.
- Link each suggestion to a SPECIFIC failure from the evaluation data.
- Prioritize suggestions by impact (most impactful first).
- Keep suggestions minimal and focused. Don't rewrite entire prompts.
- Maximum 5 suggestions per evaluation run.

Output your suggestions as a JSON array of objects with these fields:
- target_prompt: "orchestrator" | "logs_analyzer" | "pipeline_generator" | "text_to_ecs"
- suggestion: string (the specific change to make)
- reasoning: string (why, linked to specific failures)
- confidence: "high" | "medium" | "low"`;

// ---------------------------------------------------------------------------
// Types for per-example results collected during the eval run
// ---------------------------------------------------------------------------

export interface EvalRunResult {
  datasetName: string;
  integrationId: string;
  datastreamId: string;
  metrics: AutoImportQualityMetrics;
  missingEcsFields: string[];
  missingProcessorTypes: string[];
  failureDetails: Array<{ sample: string; error: string }>;
  llmJudgeScore?: number;
  llmJudgeReasoning?: string;
}

// ---------------------------------------------------------------------------
// Advisor functions
// ---------------------------------------------------------------------------

/**
 * Collect evaluation results from a single example run for the advisor.
 */
export const collectEvalResult = (
  datasetName: string,
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput,
  llmJudgeResult?: { score: number; reasoning: string }
): EvalRunResult => {
  return {
    datasetName,
    integrationId: '',
    datastreamId: '',
    metrics: calculateMetrics(output, expected),
    missingEcsFields: getMissingEcsFields(output, expected),
    missingProcessorTypes: getMissingProcessorTypes(output, expected),
    failureDetails: output.failure_details,
    llmJudgeScore: llmJudgeResult?.score,
    llmJudgeReasoning: llmJudgeResult?.reasoning,
  };
};

/**
 * Build the prompt for the advisor LLM call.
 */
export const buildAdvisorPrompt = (results: EvalRunResult[]): string => {
  const summaryLines = results.map((r) => {
    const m = r.metrics;
    return [
      `## ${r.datasetName}`,
      `- Overall quality: ${fmt(m.overall_quality)}`,
      `- Pipeline success rate: ${fmt(m.pipeline_success_rate)}`,
      `- ECS field coverage: ${fmt(m.ecs_field_coverage)}`,
      `- Timestamp parsing: ${m.timestamp_parsing === 1 ? '✅' : '❌'}`,
      `- Event categorization: ${fmt(m.event_categorization)}`,
      `- Deep extraction: ${fmt(m.deep_extraction)}`,
      `- Related fields: ${fmt(m.related_fields_completeness)}`,
      `- Vendor namespace: ${m.vendor_namespace_quality === 1 ? '✅' : '❌'}`,
      r.missingEcsFields.length > 0 ? `- Missing ECS fields: ${r.missingEcsFields.join(', ')}` : '',
      r.missingProcessorTypes.length > 0
        ? `- Missing processor types: ${r.missingProcessorTypes.join(', ')}`
        : '',
      r.failureDetails.length > 0
        ? `- Sample failures (first 3):\n${r.failureDetails
            .slice(0, 3)
            .map((f) => `  - ${f.error}`)
            .join('\n')}`
        : '',
      r.llmJudgeScore != null ? `- LLM judge score: ${r.llmJudgeScore}/1.0` : '',
      r.llmJudgeReasoning ? `- LLM judge notes: ${r.llmJudgeReasoning}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return `${ADVISOR_SYSTEM_PROMPT}

---

# Evaluation Results

${summaryLines.join('\n\n')}

---

Based on the evaluation results above, provide your prompt improvement suggestions as a JSON array.
Remember: maximum 5 suggestions, prioritized by impact.`;
};

/**
 * Parse the advisor LLM response into structured suggestions.
 */
export const parseAdvisorResponse = (response: string): PromptImprovementSuggestion[] => {
  try {
    // Try to extract JSON array from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // eslint-disable-next-line no-console
      console.error('Could not find JSON array in advisor response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: unknown): item is PromptImprovementSuggestion =>
          typeof item === 'object' &&
          item !== null &&
          'target_prompt' in item &&
          'suggestion' in item &&
          'reasoning' in item &&
          'confidence' in item
      )
      .slice(0, 5); // Maximum 5 suggestions
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to parse advisor response:', err);
    return [];
  }
};

/**
 * Format the advisor suggestions for terminal output.
 */
export const formatAdvisorReport = (suggestions: PromptImprovementSuggestion[]): string => {
  if (suggestions.length === 0) {
    return '\n📋 Prompt Improvement Advisor: No suggestions generated.\n';
  }

  const lines = [
    '',
    '═══════════════════════════════════════════════════════════════',
    '📋 PROMPT IMPROVEMENT SUGGESTIONS',
    '═══════════════════════════════════════════════════════════════',
    '',
  ];

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i];
    const confidence = s.confidence === 'high' ? '🟢' : s.confidence === 'medium' ? '🟡' : '🔴';

    lines.push(`  ${i + 1}. [${s.target_prompt}] ${confidence} ${s.confidence.toUpperCase()}`);
    lines.push(`     Suggestion: ${s.suggestion}`);
    lines.push(`     Reasoning:  ${s.reasoning}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number): string => `${(n * 100).toFixed(0)}%`;
