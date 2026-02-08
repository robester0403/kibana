/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalDataset } from '../../src/types';
import { loadSamples } from './load_samples';

/**
 * Key-value format network access logs.
 * Tests: KV parsing, network categorization, IP pair extraction,
 * event outcome mapping, observer fields for network device.
 */

/** Inline fallback — used when golden_data/key_value/samples.log is absent */
const FALLBACK_SAMPLES = [
  'timestamp=2024-01-10T12:00:00Z type=access action=permit src=10.0.0.1 dst=10.0.0.2 port=443 proto=TCP user=svc_account rule="allow-https" bytes=4096',
  'timestamp=2024-01-10T12:00:01Z type=access action=deny src=192.168.1.100 dst=10.0.0.2 port=22 proto=TCP rule="block-ssh-external" bytes=0',
  'timestamp=2024-01-10T12:00:02Z type=access action=permit src=10.0.0.5 dst=172.16.0.1 port=80 proto=TCP user=webadmin rule="allow-http" bytes=2048',
  'timestamp=2024-01-10T12:00:03Z type=access action=deny src=203.0.113.50 dst=10.0.0.1 port=3389 proto=TCP rule="block-rdp" bytes=0',
  'timestamp=2024-01-10T12:00:04Z type=access action=permit src=10.0.0.10 dst=8.8.8.8 port=53 proto=UDP user=dns_svc rule="allow-dns" bytes=128',
  'timestamp=2024-01-10T12:00:05Z type=access action=permit src=10.0.0.3 dst=93.184.216.34 port=443 proto=TCP user=admin rule="allow-https" bytes=8192',
];

export const KEY_VALUE_DATASET: AutoImportEvalDataset = {
  name: 'Key-Value Network Access Logs',
  description: 'Key-value formatted access control logs from a network appliance',
  examples: [
    {
      input: {
        integration_id: 'eval-network-appliance',
        datastream_id: 'access',
        samples: loadSamples('key_value', FALLBACK_SAMPLES),
      },
      output: {
        expected_ecs_fields: [
          '@timestamp',
          'event.original',
          'event.action',
          'event.category',
          'event.type',
          'event.outcome',
          'source.ip',
          'destination.ip',
          'destination.port',
          'network.transport',
          'user.name',
          'rule.name',
          'related.ip',
          'related.user',
        ],
        expected_vendor_namespace_pattern: '(network_appliance|access_control)\\..*',
        expected_event_categories: ['network'],
        expected_event_types: ['allowed', 'denied', 'connection'],
        expected_related_fields: {
          ip: ['10.0.0.1', '10.0.0.2'],
          user: ['svc_account'],
        },
        expected_processor_types: ['kv', 'date', 'set', 'rename', 'append'],
        min_pipeline_success_rate: 0.95,
      },
      metadata: {
        difficulty: 'easy',
        log_format: 'kv',
        notes: 'Pure key-value format, straightforward parsing',
      },
    },
  ],
};
