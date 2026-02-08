/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

// ---------------------------------------------------------------------------
// Dataset types
// ---------------------------------------------------------------------------

/**
 * Input for a single evaluation example: the sample logs and identifiers
 * needed to trigger the Automatic Import V2 agent.
 */
export interface AutoImportEvalInput {
  /** Human-readable integration id, e.g. "citrix_adc" */
  integration_id: string;
  /** Human-readable data stream id, e.g. "sslvpn" */
  datastream_id: string;
  /** Raw log lines to feed as samples */
  samples: string[];
}

/**
 * Golden expected output – the ground truth we score against.
 */
export interface AutoImportEvalExpectedOutput {
  /** ECS fields that MUST appear in the output docs, e.g. ['source.ip', '@timestamp'] */
  expected_ecs_fields: string[];
  /**
   * A regex or glob pattern the vendor namespace should match.
   * Example: 'netscaler\\.sslvpn\\..*' or 'fortinet\\.firewall\\..*'
   */
  expected_vendor_namespace_pattern: string;
  /** Expected event.category values, e.g. ['authentication'] */
  expected_event_categories: string[];
  /** Expected event.type values, e.g. ['start', 'info'] */
  expected_event_types?: string[];
  /** Which related.* fields should be populated and with what source fields */
  expected_related_fields: {
    ip?: string[];
    user?: string[];
    hosts?: string[];
  };
  /** Processor types expected in the pipeline, e.g. ['dissect', 'grok', 'date'] */
  expected_processor_types: string[];
  /** Minimum acceptable pipeline success rate (0-1), e.g. 0.95 */
  min_pipeline_success_rate: number;
}

/**
 * Metadata about an evaluation example, used for filtering / reporting.
 */
export interface AutoImportEvalMetadata {
  difficulty: 'easy' | 'medium' | 'hard';
  log_format: 'syslog' | 'json' | 'csv' | 'kv' | 'cef' | 'leef' | 'unstructured';
  notes?: string;
}

/**
 * A single evaluation example (compatible with @kbn/evals Example shape).
 */
export interface AutoImportEvalExample {
  input: AutoImportEvalInput;
  output: AutoImportEvalExpectedOutput;
  metadata: AutoImportEvalMetadata;
}

/**
 * A complete dataset of evaluation examples.
 */
export interface AutoImportEvalDataset {
  name: string;
  description: string;
  examples: AutoImportEvalExample[];
}

// ---------------------------------------------------------------------------
// Task output types — what the agent produces
// ---------------------------------------------------------------------------

/**
 * A single processor in an Elasticsearch ingest pipeline.
 */
export interface PipelineProcessor {
  [processorType: string]: {
    field?: string;
    target_field?: string;
    patterns?: string[];
    pattern?: string;
    value?: unknown;
    [key: string]: unknown;
  };
}

/**
 * The ingest pipeline produced by the agent.
 */
export interface GeneratedPipeline {
  processors: PipelineProcessor[];
  on_failure?: PipelineProcessor[];
}

/**
 * A single simulated document result from the pipeline.
 */
export interface SimulatedDocument {
  [field: string]: unknown;
}

/**
 * The complete output returned by the task function after running the agent.
 */
export interface AutoImportTaskOutput {
  /** The generated ingest pipeline */
  pipeline: GeneratedPipeline | null;
  /** Documents produced by simulating the pipeline against the samples */
  simulated_docs: SimulatedDocument[];
  /** Fraction of samples that parsed successfully (0-1) */
  pipeline_success_rate: number;
  /** Number of samples that failed */
  failed_sample_count: number;
  /** Error details for failed samples */
  failure_details: Array<{ sample: string; error: string }>;
  /** Total time taken in milliseconds */
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Metrics types
// ---------------------------------------------------------------------------

/**
 * Deterministic quality metrics calculated from task output vs ground truth.
 */
export interface AutoImportQualityMetrics {
  /** % of samples that parsed without errors (0-1) */
  pipeline_success_rate: number;
  /** % of expected ECS fields present in output docs (0-1) */
  ecs_field_coverage: number;
  /** Whether vendor namespace matches expected pattern (0 or 1) */
  vendor_namespace_quality: number;
  /** % of expected related.* fields populated (0-1) */
  related_fields_completeness: number;
  /** Whether @timestamp is correctly parsed (0 or 1) */
  timestamp_parsing: number;
  /** % of embedded IPs/users in messages that are extracted (0-1) */
  deep_extraction: number;
  /** Whether event.category/type match expected values (0-1) */
  event_categorization: number;
  /** Weighted composite quality score (0-1) */
  overall_quality: number;
}

// ---------------------------------------------------------------------------
// Prompt improvement advisor types
// ---------------------------------------------------------------------------

/**
 * A single prompt improvement suggestion from the LLM-as-a-judge advisor.
 */
export interface PromptImprovementSuggestion {
  /** Which prompt to modify */
  target_prompt: 'orchestrator' | 'logs_analyzer' | 'pipeline_generator' | 'text_to_ecs';
  /** What specific change to make */
  suggestion: string;
  /** Why this change is needed, linked to specific failures */
  reasoning: string;
  /** Confidence in this suggestion */
  confidence: 'high' | 'medium' | 'low';
}
