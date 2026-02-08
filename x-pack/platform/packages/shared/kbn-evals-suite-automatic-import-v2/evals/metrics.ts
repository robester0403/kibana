/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  AutoImportEvalExpectedOutput,
  AutoImportTaskOutput,
  AutoImportQualityMetrics,
  SimulatedDocument,
} from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object to dot-notation keys.
 * e.g. { source: { ip: '1.2.3.4' } } → { 'source.ip': '1.2.3.4' }
 */
const flattenKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.push(fullKey);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    }
  }
  return keys;
};

/**
 * Collect all unique top-level and nested field names from simulated docs.
 */
const collectFieldNames = (docs: SimulatedDocument[]): Set<string> => {
  const allKeys = new Set<string>();
  for (const doc of docs) {
    for (const key of flattenKeys(doc as Record<string, unknown>)) {
      allKeys.add(key);
    }
  }
  return allKeys;
};

/**
 * Get all processor type names from a pipeline.
 */
const extractProcessorTypes = (pipeline: AutoImportTaskOutput['pipeline']): string[] => {
  if (!pipeline?.processors) return [];
  return pipeline.processors.map((proc) => Object.keys(proc)[0]).filter(Boolean);
};

/**
 * Recursively retrieve a dotted-path value from a nested object.
 * e.g. getNestedValue(doc, 'related.ip') → ['1.2.3.4']
 */
const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

// ---------------------------------------------------------------------------
// Individual metric calculators
// ---------------------------------------------------------------------------

/**
 * Pipeline success rate — fraction of samples that parsed without errors.
 */
const pipelineSuccessRate = (output: AutoImportTaskOutput): number => {
  return output.pipeline_success_rate;
};

/**
 * ECS field coverage — fraction of expected ECS fields present in output docs.
 */
const ecsFieldCoverage = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): number => {
  if (expected.expected_ecs_fields.length === 0) return 1;
  const presentFields = collectFieldNames(output.simulated_docs);
  const found = expected.expected_ecs_fields.filter((f) => presentFields.has(f));
  return found.length / expected.expected_ecs_fields.length;
};

/**
 * Vendor namespace quality — whether the vendor-specific fields match the expected pattern.
 * We look for ANY field in the output that matches the regex pattern (outside ECS core).
 */
const vendorNamespaceQuality = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): number => {
  if (!expected.expected_vendor_namespace_pattern) return 1;
  const presentFields = collectFieldNames(output.simulated_docs);
  const pattern = new RegExp(expected.expected_vendor_namespace_pattern);
  for (const field of presentFields) {
    if (pattern.test(field)) {
      return 1;
    }
  }
  return 0;
};

/**
 * Related fields completeness — fraction of expected related.* sub-fields that are populated.
 */
const relatedFieldsCompleteness = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): number => {
  const { expected_related_fields: expectedRelated } = expected;
  const categories = Object.keys(expectedRelated) as Array<keyof typeof expectedRelated>;
  if (categories.length === 0) return 1;

  let totalExpected = 0;
  let totalFound = 0;

  for (const category of categories) {
    const expectedValues = expectedRelated[category];
    if (!expectedValues || expectedValues.length === 0) continue;
    totalExpected += 1; // We just check that the related.{category} array exists and is non-empty

    // Check if ANY doc has a non-empty related.{category}
    const found = output.simulated_docs.some((doc) => {
      const value = getNestedValue(doc as Record<string, unknown>, `related.${category}`);
      return Array.isArray(value) ? value.length > 0 : value != null;
    });

    if (found) {
      totalFound += 1;
    }
  }

  return totalExpected === 0 ? 1 : totalFound / totalExpected;
};

/**
 * Timestamp parsing — whether @timestamp is correctly parsed (not ingest time).
 * We check that at least one doc has a @timestamp that differs from the current time
 * by more than 1 hour (meaning it was actually parsed from the log).
 */
const timestampParsing = (output: AutoImportTaskOutput): number => {
  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;

  for (const doc of output.simulated_docs) {
    const ts = doc['@timestamp'];
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!isNaN(parsed) && Math.abs(now - parsed) > oneHourMs) {
        return 1; // Timestamp was parsed from the log, not ingest time
      }
    }
  }
  return 0;
};

/**
 * Deep extraction — whether embedded IPs/users are extracted from message fields.
 * Checks whether source.ip / user.name are populated (these require deep extraction
 * from syslog/message bodies).
 */
const deepExtraction = (output: AutoImportTaskOutput): number => {
  const deepFields = ['source.ip', 'destination.ip', 'user.name'];
  let found = 0;
  let checked = 0;

  for (const field of deepFields) {
    const hasValue = output.simulated_docs.some((doc) => {
      const val = getNestedValue(doc as Record<string, unknown>, field);
      return val != null && val !== '';
    });
    checked++;
    if (hasValue) found++;
  }

  return checked === 0 ? 1 : found / checked;
};

/**
 * Event categorization — whether event.category and event.type match expected values.
 */
const eventCategorization = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): number => {
  let score = 0;
  let checks = 0;

  // Check event.category
  if (expected.expected_event_categories.length > 0) {
    checks++;
    const foundCategories = new Set<string>();
    for (const doc of output.simulated_docs) {
      const cat = getNestedValue(doc as Record<string, unknown>, 'event.category');
      if (typeof cat === 'string') foundCategories.add(cat);
      if (Array.isArray(cat)) cat.forEach((c) => foundCategories.add(String(c)));
    }
    const matched = expected.expected_event_categories.filter((c) => foundCategories.has(c));
    score += matched.length / expected.expected_event_categories.length;
  }

  // Check event.type
  if (expected.expected_event_types && expected.expected_event_types.length > 0) {
    checks++;
    const foundTypes = new Set<string>();
    for (const doc of output.simulated_docs) {
      const t = getNestedValue(doc as Record<string, unknown>, 'event.type');
      if (typeof t === 'string') foundTypes.add(t);
      if (Array.isArray(t)) t.forEach((v) => foundTypes.add(String(v)));
    }
    const matched = expected.expected_event_types.filter((t) => foundTypes.has(t));
    score += matched.length / expected.expected_event_types.length;
  }

  return checks === 0 ? 1 : score / checks;
};

// ---------------------------------------------------------------------------
// Composite metric calculation
// ---------------------------------------------------------------------------

/** Weights for the overall quality composite score. */
const WEIGHTS = {
  pipeline_success_rate: 0.25,
  ecs_field_coverage: 0.2,
  timestamp_parsing: 0.15,
  event_categorization: 0.1,
  related_fields_completeness: 0.1,
  deep_extraction: 0.1,
  vendor_namespace_quality: 0.05,
} as const;

/**
 * Calculate all deterministic quality metrics for a single eval example.
 */
export const calculateMetrics = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): AutoImportQualityMetrics => {
  const metrics: Omit<AutoImportQualityMetrics, 'overall_quality'> = {
    pipeline_success_rate: pipelineSuccessRate(output),
    ecs_field_coverage: ecsFieldCoverage(output, expected),
    vendor_namespace_quality: vendorNamespaceQuality(output, expected),
    related_fields_completeness: relatedFieldsCompleteness(output, expected),
    timestamp_parsing: timestampParsing(output),
    deep_extraction: deepExtraction(output),
    event_categorization: eventCategorization(output, expected),
  };

  // Weighted composite
  let overall = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    overall += (metrics[key as keyof typeof WEIGHTS] ?? 0) * weight;
  }
  // Normalize to 0-1 (weights should already sum to ~0.95, leave 0.05 spare)
  const weightSum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  overall = overall / weightSum;

  return {
    ...metrics,
    overall_quality: Math.min(1, Math.max(0, overall)),
  };
};

/**
 * Returns the names of processors expected but NOT found in the generated pipeline.
 */
export const getMissingProcessorTypes = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): string[] => {
  const actualTypes = new Set(extractProcessorTypes(output.pipeline));
  return expected.expected_processor_types.filter((t) => !actualTypes.has(t));
};

/**
 * Returns the names of ECS fields expected but NOT found in the output docs.
 */
export const getMissingEcsFields = (
  output: AutoImportTaskOutput,
  expected: AutoImportEvalExpectedOutput
): string[] => {
  const presentFields = collectFieldNames(output.simulated_docs);
  return expected.expected_ecs_fields.filter((f) => !presentFields.has(f));
};
