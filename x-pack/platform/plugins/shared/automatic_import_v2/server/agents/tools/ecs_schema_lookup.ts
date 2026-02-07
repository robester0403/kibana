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
 * ECS field definitions for common fields used in log parsing.
 * This is a subset of the full ECS schema focused on fields commonly needed
 * during ingest pipeline generation.
 */
const ECS_SCHEMA: Record<
  string,
  {
    type: string;
    description: string;
    example?: string;
    allowedValues?: string[];
  }
> = {
  // Event fields
  'event.kind': {
    type: 'keyword',
    description:
      'High-level event classification. One of: alert, enrichment, event, metric, state, pipeline_error, signal.',
    allowedValues: ['alert', 'enrichment', 'event', 'metric', 'state', 'pipeline_error', 'signal'],
    example: 'event',
  },
  'event.category': {
    type: 'keyword',
    description:
      'Event category representing the type of activity. Array field - can have multiple values.',
    allowedValues: [
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
    ],
    example: 'authentication',
  },
  'event.type': {
    type: 'keyword',
    description:
      'Event type representing what happened. Array field - can have multiple values. Must be used with event.category.',
    allowedValues: [
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
    ],
    example: 'start',
  },
  'event.outcome': {
    type: 'keyword',
    description: 'Outcome of the event: success, failure, or unknown.',
    allowedValues: ['success', 'failure', 'unknown'],
    example: 'success',
  },
  'event.action': {
    type: 'keyword',
    description: 'The action captured by the event (e.g., user-login, file-created).',
    example: 'user-login',
  },
  'event.id': {
    type: 'keyword',
    description: 'Unique ID to describe the event.',
    example: '8a4f500d',
  },
  'event.original': {
    type: 'keyword',
    description:
      'Raw text message of entire event. Used to demonstrate log integrity or provide full context.',
    example: '<134>Feb 23 12:45:09 myhost sshd[1234]: User root logged in',
  },
  'event.severity': {
    type: 'long',
    description: 'Numeric severity of the event (0-7 for syslog, or custom scale).',
    example: '3',
  },
  'event.timezone': {
    type: 'keyword',
    description: 'Timezone where the event was created.',
    example: 'UTC',
  },
  'event.dataset': {
    type: 'keyword',
    description: 'Name of the dataset (e.g., apache.access, aws.cloudtrail).',
    example: 'nginx.access',
  },
  'event.module': {
    type: 'keyword',
    description: 'Name of the module this data is coming from.',
    example: 'nginx',
  },

  // Source fields
  'source.ip': {
    type: 'ip',
    description: 'IP address of the source (initiator of network activity).',
    example: '192.168.1.100',
  },
  'source.port': {
    type: 'long',
    description: 'Port of the source.',
    example: '54321',
  },
  'source.address': {
    type: 'keyword',
    description: 'Source address (IP or hostname).',
    example: 'client.example.com',
  },
  'source.user.name': {
    type: 'keyword',
    description: 'Short name or login of the source user.',
    example: 'john.doe',
  },

  // Destination fields
  'destination.ip': {
    type: 'ip',
    description: 'IP address of the destination (target of network activity).',
    example: '10.0.0.50',
  },
  'destination.port': {
    type: 'long',
    description: 'Port of the destination.',
    example: '443',
  },
  'destination.address': {
    type: 'keyword',
    description: 'Destination address (IP or hostname).',
    example: 'server.example.com',
  },

  // Client fields
  'client.ip': {
    type: 'ip',
    description: 'IP address of the client.',
    example: '192.168.1.100',
  },
  'client.port': {
    type: 'long',
    description: 'Port of the client.',
    example: '54321',
  },

  // Server fields
  'server.ip': {
    type: 'ip',
    description: 'IP address of the server.',
    example: '10.0.0.50',
  },
  'server.port': {
    type: 'long',
    description: 'Port of the server.',
    example: '443',
  },

  // Observer fields (for network/security devices)
  'observer.vendor': {
    type: 'keyword',
    description: 'Vendor name of the observer (e.g., Cisco, Palo Alto, Fortinet, Check Point).',
    example: 'Cisco',
  },
  'observer.product': {
    type: 'keyword',
    description: 'Product name of the observer.',
    example: 'ASA',
  },
  'observer.type': {
    type: 'keyword',
    description:
      'Type of observer: firewall, ids, ips, proxy, router, switch, sensor, load_balancer.',
    allowedValues: [
      'firewall',
      'ids',
      'ips',
      'proxy',
      'router',
      'switch',
      'sensor',
      'load_balancer',
    ],
    example: 'firewall',
  },
  'observer.hostname': {
    type: 'keyword',
    description: 'Hostname of the observer.',
    example: 'fw-prod-01',
  },

  // Host fields (for endpoint logs)
  'host.name': {
    type: 'keyword',
    description: 'Name of the host.',
    example: 'web-server-01',
  },
  'host.hostname': {
    type: 'keyword',
    description: 'Hostname of the host.',
    example: 'web-server-01.example.com',
  },
  'host.ip': {
    type: 'ip',
    description: 'Host IP addresses.',
    example: '192.168.1.10',
  },

  // User fields
  'user.name': {
    type: 'keyword',
    description: 'Short name or login of the user.',
    example: 'john.doe',
  },
  'user.domain': {
    type: 'keyword',
    description: 'Domain of the user.',
    example: 'CORP',
  },
  'user.email': {
    type: 'keyword',
    description: 'Email address of the user.',
    example: 'john.doe@example.com',
  },
  'user.id': {
    type: 'keyword',
    description: 'Unique identifier of the user.',
    example: '12345',
  },

  // Related fields (aggregation fields)
  'related.ip': {
    type: 'ip',
    description: 'Array of all IP addresses seen in the event.',
    example: '["192.168.1.100", "10.0.0.50"]',
  },
  'related.user': {
    type: 'keyword',
    description: 'Array of all usernames seen in the event.',
    example: '["john.doe", "admin"]',
  },
  'related.hosts': {
    type: 'keyword',
    description: 'Array of all hostnames seen in the event.',
    example: '["server01", "client01"]',
  },
  'related.hash': {
    type: 'keyword',
    description: 'Array of all hashes seen in the event.',
    example: '["d41d8cd98f00b204e9800998ecf8427e"]',
  },

  // Network fields
  'network.transport': {
    type: 'keyword',
    description: 'Protocol name (tcp, udp, icmp, etc.).',
    allowedValues: ['tcp', 'udp', 'icmp', 'ipv6-icmp'],
    example: 'tcp',
  },
  'network.protocol': {
    type: 'keyword',
    description: 'Application protocol name (http, ssh, dns, etc.).',
    example: 'https',
  },
  'network.direction': {
    type: 'keyword',
    description: 'Direction of network traffic: inbound, outbound, internal, external, unknown.',
    allowedValues: ['inbound', 'outbound', 'internal', 'external', 'unknown'],
    example: 'inbound',
  },
  'network.type': {
    type: 'keyword',
    description: 'Network type: ipv4 or ipv6.',
    allowedValues: ['ipv4', 'ipv6'],
    example: 'ipv4',
  },
  'network.bytes': {
    type: 'long',
    description: 'Total bytes transferred.',
    example: '1024',
  },
  'network.packets': {
    type: 'long',
    description: 'Total packets transferred.',
    example: '10',
  },

  // URL fields
  'url.original': {
    type: 'keyword',
    description: 'Unmodified original URL as seen in the event source.',
    example: '/api/v1/users?id=123',
  },
  'url.path': {
    type: 'keyword',
    description: 'Path of the URL.',
    example: '/api/v1/users',
  },
  'url.query': {
    type: 'keyword',
    description: 'Query string portion of the URL.',
    example: 'id=123',
  },
  'url.domain': {
    type: 'keyword',
    description: 'Domain of the URL.',
    example: 'api.example.com',
  },

  // HTTP fields
  'http.request.method': {
    type: 'keyword',
    description: 'HTTP request method (GET, POST, etc.).',
    example: 'GET',
  },
  'http.response.status_code': {
    type: 'long',
    description: 'HTTP response status code.',
    example: '200',
  },
  'http.request.body.content': {
    type: 'keyword',
    description: 'The full HTTP request body.',
    example: '{"user": "test"}',
  },
  'http.response.body.content': {
    type: 'keyword',
    description: 'The full HTTP response body.',
    example: '{"status": "ok"}',
  },

  // File fields
  'file.name': {
    type: 'keyword',
    description: 'Name of the file including the extension.',
    example: 'document.pdf',
  },
  'file.path': {
    type: 'keyword',
    description: 'Full path to the file.',
    example: '/home/user/documents/document.pdf',
  },
  'file.size': {
    type: 'long',
    description: 'File size in bytes.',
    example: '1048576',
  },
  'file.hash.md5': {
    type: 'keyword',
    description: 'MD5 hash of the file.',
    example: 'd41d8cd98f00b204e9800998ecf8427e',
  },
  'file.hash.sha256': {
    type: 'keyword',
    description: 'SHA256 hash of the file.',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },

  // Process fields
  'process.name': {
    type: 'keyword',
    description: 'Process name.',
    example: 'sshd',
  },
  'process.pid': {
    type: 'long',
    description: 'Process ID.',
    example: '12345',
  },
  'process.executable': {
    type: 'keyword',
    description: 'Absolute path to the process executable.',
    example: '/usr/sbin/sshd',
  },
  'process.command_line': {
    type: 'keyword',
    description: 'Full command line that started the process.',
    example: '/usr/sbin/sshd -D',
  },

  // Error fields
  'error.message': {
    type: 'text',
    description: 'Error message.',
    example: 'Connection refused',
  },
  'error.code': {
    type: 'keyword',
    description: 'Error code.',
    example: 'ECONNREFUSED',
  },

  // ECS metadata
  'ecs.version': {
    type: 'keyword',
    description: 'ECS version this event conforms to.',
    example: '8.11.0',
  },

  // Tags
  tags: {
    type: 'keyword',
    description: 'List of tags associated with the event.',
    example: '["preserve_original_event"]',
  },

  // Message
  message: {
    type: 'text',
    description:
      'Human-readable message associated with the event. For log events, this is the original log message.',
    example: 'User john.doe logged in successfully',
  },
};

/**
 * Creates a tool for looking up ECS field definitions.
 * Agents can use this to understand field types, allowed values, and usage examples.
 */
export function ecsSchemaLookupTool(): DynamicStructuredTool {
  const schema = z.object({
    query: z
      .string()
      .describe(
        'Field name or pattern to search for (e.g., "event.category", "source.*", "related")'
      ),
    category: z
      .enum([
        'event',
        'source',
        'destination',
        'client',
        'server',
        'observer',
        'host',
        'user',
        'related',
        'network',
        'url',
        'http',
        'file',
        'process',
        'error',
        'all',
      ])
      .optional()
      .describe('Filter by ECS field category'),
  });

  return new DynamicStructuredTool({
    name: 'ecs_schema_lookup',
    description:
      'Looks up ECS (Elastic Common Schema) field definitions including type, description, allowed values, and examples. ' +
      'Use this to ensure correct field usage, find appropriate fields for extracted data, or check allowed values for constrained fields like event.category.',
    schema,
    func: async (
      input: z.infer<typeof schema>,
      _runManager?: CallbackManagerForToolRun,
      config?: ToolRunnableConfig
    ) => {
      const { query, category } = input;
      const results: Record<
        string,
        { type: string; description: string; example?: string; allowedValues?: string[] }
      > = {};

      // Normalize query for matching
      const queryLower = query.toLowerCase();
      const isWildcard = queryLower.endsWith('*') || queryLower.endsWith('.*');
      const queryPrefix = isWildcard ? queryLower.replace(/\.\*$/, '').replace(/\*$/, '') : null;

      for (const [fieldName, fieldDef] of Object.entries(ECS_SCHEMA)) {
        // Filter by category if specified
        if (category && category !== 'all') {
          const fieldCategory = fieldName.split('.')[0];
          if (fieldCategory !== category) {
            continue;
          }
        }

        // Match by query
        const fieldNameLower = fieldName.toLowerCase();
        const matches = isWildcard
          ? fieldNameLower.startsWith(queryPrefix!)
          : fieldNameLower.includes(queryLower);

        if (matches) {
          results[fieldName] = fieldDef;
        }
      }

      const resultContent =
        Object.keys(results).length > 0
          ? JSON.stringify(results, null, 2)
          : `No ECS fields found matching "${query}"${category ? ` in category "${category}"` : ''}. Try a broader search or different category.`;

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: resultContent,
              tool_call_id: config?.toolCall?.id as string,
            }),
          ],
        },
      });
    },
  });
}
