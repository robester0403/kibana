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
 * Classification rules for semantic event categorization.
 * Maps keywords and patterns to ECS event.category and event.type values.
 */
interface ClassificationRule {
  keywords: string[];
  category: string[];
  types: string[];
  outcome?: 'success' | 'failure' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // Authentication events
  {
    keywords: [
      'login',
      'logon',
      'logged in',
      'authenticated',
      'authentication',
      'sign in',
      'signin',
      'sso',
    ],
    category: ['authentication'],
    types: ['start'],
    confidence: 'high',
  },
  {
    keywords: ['logout', 'logoff', 'logged out', 'sign out', 'signout', 'session ended'],
    category: ['authentication'],
    types: ['end'],
    confidence: 'high',
  },
  {
    keywords: [
      'login failed',
      'authentication failed',
      'auth failure',
      'invalid password',
      'invalid credentials',
      'access denied',
    ],
    category: ['authentication'],
    types: ['start'],
    outcome: 'failure',
    confidence: 'high',
  },

  // Network events
  {
    keywords: ['connection', 'connected', 'connect', 'tcp', 'udp', 'socket'],
    category: ['network'],
    types: ['connection'],
    confidence: 'medium',
  },
  {
    keywords: [
      'firewall',
      'fw',
      'allowed',
      'permitted',
      'accept',
      'pass',
      'forward',
      'rule matched',
    ],
    category: ['network'],
    types: ['allowed'],
    outcome: 'success',
    confidence: 'high',
  },
  {
    keywords: ['denied', 'blocked', 'dropped', 'rejected', 'refused', 'discard'],
    category: ['network'],
    types: ['denied'],
    outcome: 'failure',
    confidence: 'high',
  },
  {
    keywords: ['vpn', 'tunnel', 'ssl vpn', 'ipsec', 'sslvpn', 'remote access'],
    category: ['authentication'],
    types: ['info'],
    confidence: 'high',
  },

  // Session events
  {
    keywords: ['session', 'session start', 'session established', 'session created'],
    category: ['session'],
    types: ['start'],
    confidence: 'medium',
  },
  {
    keywords: ['session end', 'session terminated', 'session closed', 'session timeout'],
    category: ['session'],
    types: ['end'],
    confidence: 'medium',
  },

  // File events
  {
    keywords: ['file created', 'file written', 'write file', 'new file'],
    category: ['file'],
    types: ['creation'],
    confidence: 'high',
  },
  {
    keywords: ['file deleted', 'file removed', 'delete file', 'remove file'],
    category: ['file'],
    types: ['deletion'],
    confidence: 'high',
  },
  {
    keywords: ['file modified', 'file changed', 'file updated', 'modify file'],
    category: ['file'],
    types: ['change'],
    confidence: 'high',
  },
  {
    keywords: ['file accessed', 'file read', 'read file', 'file open'],
    category: ['file'],
    types: ['access'],
    confidence: 'high',
  },

  // Process events
  {
    keywords: ['process started', 'process created', 'exec', 'execute', 'spawn', 'fork'],
    category: ['process'],
    types: ['start'],
    confidence: 'high',
  },
  {
    keywords: ['process terminated', 'process ended', 'process killed', 'exit'],
    category: ['process'],
    types: ['end'],
    confidence: 'high',
  },
  {
    keywords: ['cmd_executed', 'command executed', 'command run', 'command'],
    category: ['process'],
    types: ['start'],
    confidence: 'medium',
  },

  // IAM/User management events
  {
    keywords: ['user created', 'user added', 'new user', 'create user', 'add user'],
    category: ['iam'],
    types: ['user', 'creation'],
    confidence: 'high',
  },
  {
    keywords: ['user deleted', 'user removed', 'delete user', 'remove user'],
    category: ['iam'],
    types: ['user', 'deletion'],
    confidence: 'high',
  },
  {
    keywords: ['user modified', 'user updated', 'user changed', 'modify user', 'password changed'],
    category: ['iam'],
    types: ['user', 'change'],
    confidence: 'high',
  },
  {
    keywords: ['group added', 'group created', 'group membership', 'add to group'],
    category: ['iam'],
    types: ['group', 'change'],
    confidence: 'high',
  },
  {
    keywords: ['privilege', 'permission', 'role assigned', 'role changed', 'access granted'],
    category: ['iam'],
    types: ['admin', 'change'],
    confidence: 'medium',
  },

  // Configuration events
  {
    keywords: [
      'config changed',
      'configuration changed',
      'settings changed',
      'policy changed',
      'rule changed',
    ],
    category: ['configuration'],
    types: ['change'],
    confidence: 'high',
  },
  {
    keywords: ['config created', 'policy created', 'rule created', 'rule added'],
    category: ['configuration'],
    types: ['creation'],
    confidence: 'high',
  },

  // Web events
  {
    keywords: ['http', 'https', 'request', 'response', 'get', 'post', 'put', 'delete', 'api'],
    category: ['web'],
    types: ['access'],
    confidence: 'medium',
  },

  // Database events
  {
    keywords: ['query', 'sql', 'select', 'insert', 'update', 'delete', 'database'],
    category: ['database'],
    types: ['access'],
    confidence: 'medium',
  },

  // Malware/Threat events
  {
    keywords: ['malware', 'virus', 'trojan', 'ransomware', 'infected', 'threat detected'],
    category: ['malware'],
    types: ['info'],
    confidence: 'high',
  },

  // Intrusion detection
  {
    keywords: ['intrusion', 'attack', 'exploit', 'vulnerability', 'ids', 'ips', 'alert'],
    category: ['intrusion_detection'],
    types: ['info'],
    confidence: 'high',
  },

  // Email events
  {
    keywords: ['email', 'mail', 'smtp', 'message sent', 'message received'],
    category: ['email'],
    types: ['info'],
    confidence: 'medium',
  },

  // Host events
  {
    keywords: ['boot', 'startup', 'shutdown', 'reboot', 'restart', 'system start'],
    category: ['host'],
    types: ['start'],
    confidence: 'high',
  },

  // Registry events (Windows)
  {
    keywords: ['registry', 'regkey', 'reg value', 'hkey', 'registry modified'],
    category: ['registry'],
    types: ['change'],
    confidence: 'high',
  },
];

/**
 * Valid ECS event.category values.
 */
const VALID_CATEGORIES = [
  'authentication',
  'configuration',
  'database',
  'driver',
  'email',
  'file',
  'host',
  'iam',
  'intrusion_detection',
  'malware',
  'network',
  'package',
  'process',
  'registry',
  'session',
  'threat',
  'vulnerability',
  'web',
];

/**
 * Valid ECS event.type values.
 */
const VALID_TYPES = [
  'access',
  'admin',
  'allowed',
  'change',
  'connection',
  'creation',
  'deletion',
  'denied',
  'end',
  'error',
  'group',
  'indicator',
  'info',
  'installation',
  'protocol',
  'start',
  'user',
];

/**
 * Valid combinations of event.category and event.type.
 */
const VALID_COMBINATIONS: Record<string, string[]> = {
  authentication: ['start', 'end', 'info'],
  configuration: ['access', 'change', 'creation', 'deletion', 'info'],
  database: ['access', 'change', 'creation', 'deletion', 'error', 'info'],
  driver: ['change', 'end', 'info', 'start'],
  email: ['info'],
  file: ['access', 'change', 'creation', 'deletion', 'info'],
  host: ['access', 'change', 'end', 'info', 'start'],
  iam: ['admin', 'change', 'creation', 'deletion', 'group', 'info', 'user'],
  intrusion_detection: ['allowed', 'denied', 'info'],
  malware: ['info'],
  network: ['access', 'allowed', 'connection', 'denied', 'end', 'info', 'protocol', 'start'],
  package: ['access', 'change', 'deletion', 'info', 'installation', 'start'],
  process: ['access', 'change', 'end', 'info', 'start'],
  registry: ['access', 'change', 'creation', 'deletion'],
  session: ['end', 'info', 'start'],
  threat: ['indicator', 'info'],
  vulnerability: ['info'],
  web: ['access', 'error', 'info'],
};

interface ClassificationResult {
  categories: string[];
  types: string[];
  outcome?: 'success' | 'failure' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  matchedKeywords: string[];
  matchedRules: number;
}

/**
 * Classifies a log message based on content keywords.
 */
function classifyMessage(message: string): ClassificationResult {
  const messageLower = message.toLowerCase();
  const matchedCategories = new Set<string>();
  const matchedTypes = new Set<string>();
  const matchedKeywords: string[] = [];
  let outcome: 'success' | 'failure' | 'unknown' | undefined;
  let highestConfidence: 'high' | 'medium' | 'low' = 'low';
  let matchedRules = 0;

  for (const rule of CLASSIFICATION_RULES) {
    for (const keyword of rule.keywords) {
      if (messageLower.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
        matchedRules++;

        for (const cat of rule.category) {
          matchedCategories.add(cat);
        }
        for (const type of rule.types) {
          matchedTypes.add(type);
        }

        if (rule.outcome) {
          outcome = rule.outcome;
        }

        if (
          rule.confidence === 'high' ||
          (rule.confidence === 'medium' && highestConfidence === 'low')
        ) {
          highestConfidence = rule.confidence;
        }

        break; // Only count first matching keyword per rule
      }
    }
  }

  // Validate combinations
  const validatedTypes = new Set<string>();
  for (const cat of matchedCategories) {
    const allowedTypes = VALID_COMBINATIONS[cat];
    if (allowedTypes) {
      for (const type of matchedTypes) {
        if (allowedTypes.includes(type)) {
          validatedTypes.add(type);
        }
      }
    }
  }

  return {
    categories: Array.from(matchedCategories).filter((c) => VALID_CATEGORIES.includes(c)),
    types: Array.from(validatedTypes).filter((t) => VALID_TYPES.includes(t)),
    outcome,
    confidence: highestConfidence,
    matchedKeywords: [...new Set(matchedKeywords)],
    matchedRules,
  };
}

/**
 * Creates a tool for semantically classifying log events based on content.
 */
export function semanticEventClassifierTool(): DynamicStructuredTool {
  const schema = z.object({
    messages: z
      .array(z.string())
      .describe('Array of log messages to classify'),
    includeValidationInfo: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include ECS validation rules in the output'),
  });

  return new DynamicStructuredTool({
    name: 'semantic_event_classifier',
    description:
      'Classifies log events by analyzing message content to determine appropriate event.category, event.type, and event.outcome values. ' +
      'Uses keyword matching against ECS-compliant classification rules.',
    schema,
    func: async (
      input: z.infer<typeof schema>,
      _runManager?: CallbackManagerForToolRun,
      config?: ToolRunnableConfig
    ) => {
      const { messages, includeValidationInfo } = input;

      const results: Array<{
        message: string;
        truncatedMessage: string;
        classification: ClassificationResult;
      }> = [];

      // Classify each message
      for (const message of messages.slice(0, 10)) {
        const classification = classifyMessage(message);
        results.push({
          message,
          truncatedMessage: message.length > 100 ? message.substring(0, 100) + '...' : message,
          classification,
        });
      }

      // Aggregate classifications
      const aggregatedCategories: Record<string, number> = {};
      const aggregatedTypes: Record<string, number> = {};
      const aggregatedOutcomes: Record<string, number> = {};

      for (const result of results) {
        for (const cat of result.classification.categories) {
          aggregatedCategories[cat] = (aggregatedCategories[cat] || 0) + 1;
        }
        for (const type of result.classification.types) {
          aggregatedTypes[type] = (aggregatedTypes[type] || 0) + 1;
        }
        if (result.classification.outcome) {
          aggregatedOutcomes[result.classification.outcome] =
            (aggregatedOutcomes[result.classification.outcome] || 0) + 1;
        }
      }

      // Determine dominant classification
      const dominantCategories = Object.entries(aggregatedCategories)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([cat]) => cat);

      const dominantTypes = Object.entries(aggregatedTypes)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([type]) => type);

      const dominantOutcome = Object.entries(aggregatedOutcomes).sort(
        ([, a], [, b]) => b - a
      )[0]?.[0] as 'success' | 'failure' | 'unknown' | undefined;

      const output: Record<string, unknown> = {
        analyzedMessages: messages.length,
        recommendations: {
          'event.category': dominantCategories.length > 0 ? dominantCategories : ['network'],
          'event.type': dominantTypes.length > 0 ? dominantTypes : ['info'],
          'event.outcome': dominantOutcome || 'unknown',
          confidence:
            results.filter((r) => r.classification.confidence === 'high').length > 0
              ? 'high'
              : 'medium',
        },
        aggregatedResults: {
          categories: aggregatedCategories,
          types: aggregatedTypes,
          outcomes: aggregatedOutcomes,
        },
        sampleClassifications: results.slice(0, 3),
      };

      if (includeValidationInfo) {
        output.validationRules = {
          validCategories: VALID_CATEGORIES,
          validTypes: VALID_TYPES,
          validCombinations: VALID_COMBINATIONS,
        };
      }

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
