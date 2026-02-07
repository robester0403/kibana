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
import { Command } from '@langchain/langgraph';
import { z } from '@kbn/zod';

/**
 * Universal pattern definitions for detecting extractable content.
 * These detect DATA TYPES, not vendor-specific formats.
 */
const EXTRACTION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  ecsFields: string[];
  description: string;
  confidence: 'high' | 'medium' | 'low';
}> = [
  // IP Addresses (universal)
  {
    name: 'IPv4 Address',
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    ecsFields: ['source.ip', 'destination.ip', 'client.ip', 'server.ip', 'host.ip'],
    description: 'IPv4 address - use context to determine ECS field',
    confidence: 'high',
  },
  {
    name: 'IPv4:Port',
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})\b/g,
    ecsFields: ['*.ip', '*.port'],
    description: 'IP with port - context determines source vs destination',
    confidence: 'high',
  },
  {
    name: 'IPv6 Address',
    pattern: /\b((?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})\b/g,
    ecsFields: ['source.ip', 'destination.ip', 'client.ip', 'server.ip', 'host.ip'],
    description: 'IPv6 address',
    confidence: 'medium',
  },

  // Timestamps (universal)
  {
    name: 'ISO8601 Timestamp',
    pattern: /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/g,
    ecsFields: ['@timestamp'],
    description: 'ISO8601 format - most reliable timestamp format',
    confidence: 'high',
  },
  {
    name: 'Syslog Timestamp',
    pattern: /\b([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\b/g,
    ecsFields: ['@timestamp'],
    description: 'Syslog timestamp (MMM dd HH:mm:ss)',
    confidence: 'high',
  },
  {
    name: 'Unix Epoch',
    pattern: /\b(1[0-9]{9,12})\b/g,
    ecsFields: ['@timestamp'],
    description: 'Unix epoch (10 digits=seconds, 13=milliseconds)',
    confidence: 'medium',
  },

  // User/Identity (universal)
  {
    name: 'Email Address',
    pattern: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    ecsFields: ['user.email'],
    description: 'Email address',
    confidence: 'high',
  },

  // Network Ports (universal)
  {
    name: 'Port Number',
    pattern: /\b(?:port[=: ]*)?(\d{1,5})\b/gi,
    ecsFields: ['source.port', 'destination.port'],
    description: 'Network port (1-65535) - context determines direction',
    confidence: 'low',
  },

  // HTTP (universal)
  {
    name: 'HTTP Method',
    pattern: /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\b/g,
    ecsFields: ['http.request.method'],
    description: 'HTTP request method',
    confidence: 'high',
  },
  {
    name: 'HTTP Status Code',
    pattern: /\b([1-5]\d{2})\b/g,
    ecsFields: ['http.response.status_code'],
    description: 'HTTP response status (context needed)',
    confidence: 'low',
  },
  {
    name: 'URL Path',
    pattern: /\s(\/[^\s"'<>]*)/g,
    ecsFields: ['url.path', 'url.original'],
    description: 'URL path starting with /',
    confidence: 'medium',
  },

  // Hashes (universal - length-based detection)
  {
    name: 'MD5 Hash',
    pattern: /\b([a-fA-F0-9]{32})\b/g,
    ecsFields: ['file.hash.md5', 'related.hash'],
    description: 'MD5 hash (32 hex chars)',
    confidence: 'medium',
  },
  {
    name: 'SHA1 Hash',
    pattern: /\b([a-fA-F0-9]{40})\b/g,
    ecsFields: ['file.hash.sha1', 'related.hash'],
    description: 'SHA1 hash (40 hex chars)',
    confidence: 'high',
  },
  {
    name: 'SHA256 Hash',
    pattern: /\b([a-fA-F0-9]{64})\b/g,
    ecsFields: ['file.hash.sha256', 'related.hash'],
    description: 'SHA256 hash (64 hex chars)',
    confidence: 'high',
  },

  // Identifiers (universal)
  {
    name: 'UUID',
    pattern: /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g,
    ecsFields: ['event.id', 'trace.id'],
    description: 'UUID/GUID',
    confidence: 'high',
  },

  // MAC Address (universal)
  {
    name: 'MAC Address',
    pattern: /\b((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})\b/g,
    ecsFields: ['source.mac', 'destination.mac', 'host.mac'],
    description: 'MAC address',
    confidence: 'high',
  },

  // Syslog (universal)
  {
    name: 'Syslog Priority',
    pattern: /<(\d{1,3})>/g,
    ecsFields: ['log.syslog.priority'],
    description: 'Syslog priority in angle brackets',
    confidence: 'high',
  },

  // File Paths (universal)
  {
    name: 'Unix Path',
    pattern: /(\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+)/g,
    ecsFields: ['file.path', 'process.executable'],
    description: 'Unix-style file path',
    confidence: 'medium',
  },
  {
    name: 'Windows Path',
    pattern: /([A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*)/g,
    ecsFields: ['file.path', 'process.executable'],
    description: 'Windows-style file path',
    confidence: 'high',
  },

  // Process (universal)
  {
    name: 'Process ID in Brackets',
    pattern: /\[(\d{1,7})\]/g,
    ecsFields: ['process.pid'],
    description: 'Process ID in brackets like [1234]',
    confidence: 'medium',
  },
];

interface ExtractionResult {
  patternName: string;
  matches: string[];
  ecsFields: string[];
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

/**
 * Analyzes a log message for extractable content patterns.
 */
function analyzeMessage(message: string): ExtractionResult[] {
  const results: ExtractionResult[] = [];

  for (const patternDef of EXTRACTION_PATTERNS) {
    // Reset regex lastIndex for global patterns
    patternDef.pattern.lastIndex = 0;

    const matches: string[] = [];
    let match;

    while ((match = patternDef.pattern.exec(message)) !== null) {
      matches.push(match[1] || match[0]);
    }

    if (matches.length > 0) {
      results.push({
        patternName: patternDef.name,
        matches: [...new Set(matches)], // Deduplicate
        ecsFields: patternDef.ecsFields,
        confidence: patternDef.confidence,
        description: patternDef.description,
      });
    }
  }

  return results;
}

/**
 * Creates a tool for analyzing log messages to find extractable data types.
 * Uses universal patterns that work across any vendor's log format.
 */
export function deepExtractionAnalyzerTool(): DynamicStructuredTool {
  const schema = z.object({
    messages: z
      .array(z.string())
      .describe('Array of log messages to analyze for extractable patterns'),
    focusPatterns: z
      .array(z.enum(['ip', 'timestamp', 'http', 'hash', 'identifier', 'path', 'all']))
      .optional()
      .default(['all'])
      .describe('Types of patterns to focus on'),
  });

  return new DynamicStructuredTool({
    name: 'deep_extraction_analyzer',
    description:
      'Analyzes log messages to identify extractable data types (IPs, timestamps, hashes, UUIDs, etc.). ' +
      'Uses universal patterns that work for any vendor. Returns detected patterns with suggested ECS fields.',
    schema,
    func: async (
      input: z.infer<typeof schema>,
      _runManager?: CallbackManagerForToolRun,
      config?: ToolRunnableConfig
    ) => {
      const { messages, focusPatterns } = input;

      const allResults: Array<{
        message: string;
        truncatedMessage: string;
        extractionOpportunities: ExtractionResult[];
      }> = [];

      for (const message of messages.slice(0, 10)) {
        const results = analyzeMessage(message);

        let filteredResults = results;
        if (!focusPatterns.includes('all')) {
          const focusSet = new Set(focusPatterns);
          filteredResults = results.filter((r) => {
            const name = r.patternName.toLowerCase();
            return (
              (focusSet.has('ip') && (name.includes('ip') || name.includes('mac'))) ||
              (focusSet.has('timestamp') && (name.includes('timestamp') || name.includes('epoch'))) ||
              (focusSet.has('http') && (name.includes('http') || name.includes('url'))) ||
              (focusSet.has('hash') && name.includes('hash')) ||
              (focusSet.has('identifier') && (name.includes('uuid') || name.includes('id'))) ||
              (focusSet.has('path') && name.includes('path'))
            );
          });
        }

        if (filteredResults.length > 0) {
          allResults.push({
            message,
            truncatedMessage: message.length > 100 ? message.substring(0, 100) + '...' : message,
            extractionOpportunities: filteredResults,
          });
        }
      }

      // Aggregate findings
      const aggregatedFindings: Record<
        string,
        {
          occurrences: number;
          exampleMatches: string[];
          ecsFields: string[];
          confidence: 'high' | 'medium' | 'low';
        }
      > = {};

      for (const result of allResults) {
        for (const opp of result.extractionOpportunities) {
          if (!aggregatedFindings[opp.patternName]) {
            aggregatedFindings[opp.patternName] = {
              occurrences: 0,
              exampleMatches: [],
              ecsFields: opp.ecsFields,
              confidence: opp.confidence,
            };
          }
          aggregatedFindings[opp.patternName].occurrences++;
          for (const match of opp.matches) {
            if (
              aggregatedFindings[opp.patternName].exampleMatches.length < 3 &&
              !aggregatedFindings[opp.patternName].exampleMatches.includes(match)
            ) {
              aggregatedFindings[opp.patternName].exampleMatches.push(match);
            }
          }
        }
      }

      const output = {
        analyzedMessages: messages.length,
        messagesWithExtractableContent: allResults.length,
        summary: aggregatedFindings,
        details: allResults.slice(0, 3),
        recommendations:
          Object.keys(aggregatedFindings).length > 0
            ? Object.entries(aggregatedFindings)
                .filter(([, v]) => v.confidence === 'high')
                .map(
                  ([pattern, data]) =>
                    `Extract ${pattern} → ${data.ecsFields.slice(0, 2).join(' or ')}`
                )
            : ['No high-confidence extractable patterns found. Analyze log structure manually.'],
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
