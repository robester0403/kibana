/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalDataset } from '../../src/types';
import { loadSamples } from './load_samples';

/**
 * JSON authentication logs.
 * Tests: JSON parsing, timestamp extraction, authentication categorization,
 * user field mapping, host vs observer determination.
 */

/** Inline fallback — used when golden_data/json_auth/samples.log is absent */
const FALLBACK_SAMPLES = [
  '{"ts":"2024-01-10T12:00:00Z","event":"login_success","user":"admin","client_ip":"192.168.1.50","server":"auth01","method":"password","session_id":"sess-001"}',
  '{"ts":"2024-01-10T12:00:05Z","event":"login_failure","user":"root","client_ip":"10.0.0.99","server":"auth01","method":"password","session_id":"sess-002","reason":"invalid_password"}',
  '{"ts":"2024-01-10T12:00:10Z","event":"login_success","user":"jdoe","client_ip":"172.16.0.10","server":"auth02","method":"sso","session_id":"sess-003"}',
  '{"ts":"2024-01-10T12:00:15Z","event":"logout","user":"admin","client_ip":"192.168.1.50","server":"auth01","session_id":"sess-001"}',
  '{"ts":"2024-01-10T12:00:20Z","event":"login_success","user":"svc_deploy","client_ip":"10.10.10.5","server":"auth01","method":"api_key","session_id":"sess-004"}',
  '{"ts":"2024-01-10T12:00:25Z","event":"login_failure","user":"admin","client_ip":"203.0.113.100","server":"auth02","method":"password","session_id":"sess-005","reason":"account_locked"}',
  '{"ts":"2024-01-10T12:00:30Z","event":"mfa_challenge","user":"jdoe","client_ip":"172.16.0.10","server":"auth02","method":"totp","session_id":"sess-003"}',
  '{"ts":"2024-01-10T12:00:35Z","event":"login_success","user":"ops_team","client_ip":"10.0.0.50","server":"auth01","method":"certificate","session_id":"sess-006"}',
];

export const JSON_AUTH_DATASET: AutoImportEvalDataset = {
  name: 'JSON Authentication Logs',
  description: 'JSON-formatted authentication/login event logs',
  examples: [
    {
      input: {
        integration_id: 'eval-auth-service',
        datastream_id: 'auth-events',
        samples: loadSamples('json_auth', FALLBACK_SAMPLES),
      },
      output: {
        expected_ecs_fields: [
          '@timestamp',
          'event.original',
          'event.category',
          'event.type',
          'event.action',
          'event.outcome',
          'user.name',
          'source.ip',
          'host.name',
          'related.ip',
          'related.user',
          'related.hosts',
        ],
        expected_vendor_namespace_pattern: 'auth.*\\..*',
        expected_event_categories: ['authentication'],
        expected_event_types: ['start', 'end', 'info'],
        expected_related_fields: {
          ip: ['192.168.1.50'],
          user: ['admin'],
          hosts: ['auth01'],
        },
        expected_processor_types: ['json', 'date', 'set', 'rename', 'append'],
        min_pipeline_success_rate: 0.95,
      },
      metadata: {
        difficulty: 'easy',
        log_format: 'json',
        notes: 'Simple JSON with clear authentication semantics',
      },
    },
  ],
};
