/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CallbackManagerForToolRun } from '@langchain/core/callbacks/manager';
import type { ToolRunnableConfig } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ToolMessage } from '@langchain/core/messages';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { z } from '@kbn/zod';
import type { estypes } from '@elastic/elasticsearch';
import type { JsonObject, JsonValue } from '@kbn/utility-types';

import type { AutomaticImportAgentState } from '../state';

/**
 * Mapping of ECS fields to their corresponding related.* aggregation field.
 */
const RELATED_FIELD_MAPPINGS: Record<string, { relatedField: string; priority: number }> = {
  // IP fields -> related.ip
  'source.ip': { relatedField: 'related.ip', priority: 1 },
  'destination.ip': { relatedField: 'related.ip', priority: 1 },
  'client.ip': { relatedField: 'related.ip', priority: 2 },
  'server.ip': { relatedField: 'related.ip', priority: 2 },
  'host.ip': { relatedField: 'related.ip', priority: 3 },
  'observer.ip': { relatedField: 'related.ip', priority: 3 },
  'source.nat.ip': { relatedField: 'related.ip', priority: 4 },
  'destination.nat.ip': { relatedField: 'related.ip', priority: 4 },

  // User fields -> related.user
  'user.name': { relatedField: 'related.user', priority: 1 },
  'user.id': { relatedField: 'related.user', priority: 2 },
  'source.user.name': { relatedField: 'related.user', priority: 2 },
  'destination.user.name': { relatedField: 'related.user', priority: 2 },
  'user.target.name': { relatedField: 'related.user', priority: 3 },
  'user.effective.name': { relatedField: 'related.user', priority: 3 },

  // Host fields -> related.hosts
  'host.name': { relatedField: 'related.hosts', priority: 1 },
  'host.hostname': { relatedField: 'related.hosts', priority: 1 },
  'observer.hostname': { relatedField: 'related.hosts', priority: 2 },
  'source.address': { relatedField: 'related.hosts', priority: 3 },
  'destination.address': { relatedField: 'related.hosts', priority: 3 },

  // Hash fields -> related.hash
  'file.hash.md5': { relatedField: 'related.hash', priority: 1 },
  'file.hash.sha1': { relatedField: 'related.hash', priority: 1 },
  'file.hash.sha256': { relatedField: 'related.hash', priority: 1 },
  'file.hash.sha512': { relatedField: 'related.hash', priority: 1 },
  'process.hash.md5': { relatedField: 'related.hash', priority: 2 },
  'process.hash.sha256': { relatedField: 'related.hash', priority: 2 },
};

/**
 * Extracts a nested field value from an object using dot notation.
 */
function getNestedValue(obj: JsonObject, path: string): JsonValue | undefined {
  const parts = path.split('.');
  let current: JsonValue = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (Array.isArray(current)) {
      return undefined;
    }
    current = (current as JsonObject)[part];
  }

  return current;
}

/**
 * Analyzes pipeline results to identify which fields should be aggregated into related.* fields.
 */
function analyzeForRelatedFields(docs: estypes.IngestSimulateDocumentResult[]): {
  recommendations: Array<{
    sourceField: string;
    targetField: string;
    sampleValues: string[];
    occurrenceCount: number;
    priority: number;
  }>;
  existingRelatedFields: Record<string, string[]>;
  missingAggregations: Array<{
    sourceField: string;
    targetField: string;
    reason: string;
  }>;
  pipelineProcessors: Array<{
    type: string;
    field: string;
    value: string;
    condition?: string;
  }>;
} {
  const fieldOccurrences: Record<string, Set<string>> = {};
  const existingRelatedFields: Record<string, Set<string>> = {};

  // Analyze each document
  for (const doc of docs) {
    const source = doc.doc?._source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }

    const sourceObj = source as JsonObject;

    // Check for existing related.* fields
    const related = sourceObj.related;
    if (related && typeof related === 'object' && !Array.isArray(related)) {
      const relatedObj = related as JsonObject;
      for (const [key, value] of Object.entries(relatedObj)) {
        const fieldName = `related.${key}`;
        if (!existingRelatedFields[fieldName]) {
          existingRelatedFields[fieldName] = new Set();
        }
        if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === 'string' || typeof v === 'number') {
              existingRelatedFields[fieldName].add(String(v));
            }
          }
        }
      }
    }

    // Check for fields that should be aggregated
    for (const [fieldPath, mapping] of Object.entries(RELATED_FIELD_MAPPINGS)) {
      const value = getNestedValue(sourceObj, fieldPath);
      if (value !== undefined && value !== null && value !== '') {
        if (!fieldOccurrences[fieldPath]) {
          fieldOccurrences[fieldPath] = new Set();
        }
        if (typeof value === 'string' || typeof value === 'number') {
          fieldOccurrences[fieldPath].add(String(value));
        } else if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === 'string' || typeof v === 'number') {
              fieldOccurrences[fieldPath].add(String(v));
            }
          }
        }
      }
    }
  }

  // Build recommendations
  const recommendations: Array<{
    sourceField: string;
    targetField: string;
    sampleValues: string[];
    occurrenceCount: number;
    priority: number;
  }> = [];

  for (const [fieldPath, values] of Object.entries(fieldOccurrences)) {
    const mapping = RELATED_FIELD_MAPPINGS[fieldPath];
    if (mapping && values.size > 0) {
      recommendations.push({
        sourceField: fieldPath,
        targetField: mapping.relatedField,
        sampleValues: Array.from(values).slice(0, 3),
        occurrenceCount: values.size,
        priority: mapping.priority,
      });
    }
  }

  // Sort by priority then by occurrence count
  recommendations.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.occurrenceCount - a.occurrenceCount;
  });

  // Identify missing aggregations (fields present but not in related.*)
  const missingAggregations: Array<{
    sourceField: string;
    targetField: string;
    reason: string;
  }> = [];

  for (const rec of recommendations) {
    const existingValues = existingRelatedFields[rec.targetField];
    if (!existingValues || existingValues.size === 0) {
      missingAggregations.push({
        sourceField: rec.sourceField,
        targetField: rec.targetField,
        reason: `${rec.targetField} is empty but ${rec.sourceField} has values`,
      });
    } else {
      // Check if any sample values are missing from the related field
      const missing = rec.sampleValues.filter((v) => !existingValues.has(v));
      if (missing.length > 0) {
        missingAggregations.push({
          sourceField: rec.sourceField,
          targetField: rec.targetField,
          reason: `Values from ${rec.sourceField} not found in ${rec.targetField}: ${missing.join(', ')}`,
        });
      }
    }
  }

  // Generate pipeline processors for missing aggregations
  const pipelineProcessors: Array<{
    type: string;
    field: string;
    value: string;
    condition?: string;
  }> = [];

  // Group by target field
  const byTargetField = new Map<string, string[]>();
  for (const rec of recommendations) {
    if (!byTargetField.has(rec.targetField)) {
      byTargetField.set(rec.targetField, []);
    }
    byTargetField.get(rec.targetField)!.push(rec.sourceField);
  }

  for (const [targetField, sourceFields] of byTargetField) {
    pipelineProcessors.push({
      type: 'append',
      field: targetField,
      value: sourceFields.map((f) => `{{${f}}}`).join(', '),
      condition: sourceFields
        .map((f) => {
          const parts = f.split('.');
          const conditions = [];
          let path = 'ctx';
          for (const part of parts) {
            path += `?.${part}`;
            conditions.push(`${path} != null`);
          }
          return conditions[conditions.length - 1];
        })
        .join(' || '),
    });
  }

  return {
    recommendations,
    existingRelatedFields: Object.fromEntries(
      Object.entries(existingRelatedFields).map(([k, v]) => [k, Array.from(v)])
    ),
    missingAggregations,
    pipelineProcessors,
  };
}

/**
 * Creates a tool for analyzing pipeline results and recommending related.* field aggregations.
 */
export function relatedFieldsAggregatorTool(): DynamicStructuredTool {
  const schema = z.object({});

  return new DynamicStructuredTool({
    name: 'related_fields_aggregator',
    description:
      'Analyzes pipeline results to identify IP, user, and host fields that should be aggregated into related.* fields. ' +
      'Provides recommendations for append processors to ensure proper related.ip, related.user, and related.hosts population.',
    schema,
    func: async (
      _input: z.infer<typeof schema>,
      _runManager?: CallbackManagerForToolRun,
      config?: ToolRunnableConfig
    ) => {
      const state = getCurrentTaskInput<z.infer<typeof AutomaticImportAgentState>>();
      const docs = state.pipeline_generation_results;

      if (!docs || docs.length === 0) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: JSON.stringify({
                  error: 'No pipeline results available. Run the pipeline validator first.',
                  recommendations: [],
                }),
                tool_call_id: config?.toolCall?.id as string,
              }),
            ],
          },
        });
      }

      const analysis = analyzeForRelatedFields(docs);

      const output = {
        analyzedDocuments: docs.length,
        ...analysis,
        summary: {
          totalFieldsToAggregate: analysis.recommendations.length,
          missingAggregations: analysis.missingAggregations.length,
          relatedFieldsPresent: Object.keys(analysis.existingRelatedFields),
        },
      };

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: JSON.stringify(output, null, 2),
              tool_call_id: config?.toolCall?.id as string,
            }),
          ],
        },
      });
    },
  });
}
