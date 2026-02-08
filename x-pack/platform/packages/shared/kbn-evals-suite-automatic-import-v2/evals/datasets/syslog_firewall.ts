/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalDataset } from '../../src/types';
import { loadSamples } from './load_samples';

/**
 * Syslog firewall logs (key-value pairs in syslog wrapper).
 * Tests: syslog positional parsing, KV extraction, deep IP extraction,
 * network event categorization, observer fields.
 */

/** Inline fallback — used when golden_data/syslog_firewall/samples.log is absent */
const FALLBACK_SAMPLES = [
  '<134>Jan 10 12:00:00 fw-edge-01 action=accept src=10.0.0.1 dst=8.8.8.8 dport=443 sport=52341 proto=TCP user=jsmith bytes_sent=1024 bytes_recv=4096',
  '<134>Jan 10 12:00:01 fw-edge-01 action=accept src=10.0.0.2 dst=8.8.4.4 dport=80 sport=49152 proto=TCP user=admin bytes_sent=512 bytes_recv=2048',
  '<134>Jan 10 12:00:02 fw-edge-01 action=deny src=192.168.1.100 dst=10.10.10.1 dport=22 sport=60001 proto=TCP bytes_sent=0 bytes_recv=0',
  '<134>Jan 10 12:00:03 fw-edge-01 action=accept src=172.16.0.5 dst=93.184.216.34 dport=443 sport=55555 proto=TCP user=svc_account bytes_sent=2048 bytes_recv=8192',
  '<134>Jan 10 12:00:04 fw-edge-01 action=drop src=10.0.0.99 dst=203.0.113.50 dport=3389 sport=61234 proto=TCP bytes_sent=0 bytes_recv=0',
  '<134>Jan 10 12:00:05 fw-edge-01 action=accept src=10.0.0.1 dst=1.1.1.1 dport=53 sport=45678 proto=UDP user=jsmith bytes_sent=64 bytes_recv=512',
  '<134>Jan 10 12:00:06 fw-edge-01 action=deny src=192.168.1.200 dst=10.20.30.40 dport=445 sport=59876 proto=TCP bytes_sent=0 bytes_recv=0',
  '<134>Jan 10 12:00:07 fw-edge-01 action=accept src=10.0.0.3 dst=142.250.80.46 dport=443 sport=51111 proto=TCP user=admin bytes_sent=4096 bytes_recv=16384',
];

export const SYSLOG_FIREWALL_DATASET: AutoImportEvalDataset = {
  name: 'Syslog Firewall Logs',
  description: 'Firewall syslog logs with key-value action/src/dst fields',
  examples: [
    {
      input: {
        integration_id: 'eval-firewall',
        datastream_id: 'traffic',
        samples: loadSamples('syslog_firewall', FALLBACK_SAMPLES),
      },
      output: {
        expected_ecs_fields: [
          '@timestamp',
          'event.original',
          'event.category',
          'event.type',
          'event.action',
          'source.ip',
          'source.port',
          'destination.ip',
          'destination.port',
          'network.transport',
          'user.name',
          'observer.hostname',
          'related.ip',
          'related.user',
        ],
        expected_vendor_namespace_pattern: 'fw_edge\\..*',
        expected_event_categories: ['network'],
        expected_event_types: ['allowed', 'denied', 'connection'],
        expected_related_fields: {
          ip: ['10.0.0.1', '8.8.8.8'],
          user: ['jsmith'],
        },
        expected_processor_types: ['dissect', 'kv', 'date', 'set', 'rename', 'append'],
        min_pipeline_success_rate: 0.9,
      },
      metadata: {
        difficulty: 'medium',
        log_format: 'syslog',
        notes: 'Syslog header with positional hostname + key-value body',
      },
    },
  ],
};
