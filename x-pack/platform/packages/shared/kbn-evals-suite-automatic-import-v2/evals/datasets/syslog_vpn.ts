/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalDataset } from '../../src/types';
import { loadSamples } from './load_samples';

/**
 * Syslog VPN/SSLVPN logs (Citrix NetScaler-style).
 * Tests: complex syslog positional parsing, deep extraction from message body,
 * authentication categorization for VPN, observer fields, event ID extraction.
 * This is a HARD example — the prompt examples in prompts.ts are based on this format.
 */

/** Inline fallback — used when golden_data/syslog_vpn/samples.log is absent */
const FALLBACK_SAMPLES = [
  '<135> 09/09/2024:14:13:39 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30461998 0 : "SSLVPN session started for user jsmith from 81.2.69.142:5019"',
  '<135> 09/09/2024:14:13:40 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30461999 0 : "SSLVPN session ended for user jsmith from 81.2.69.142:5019"',
  '<135> 09/09/2024:14:14:01 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30462000 0 : "SSLVPN login failed for user admin from 203.0.113.50:8080 - invalid credentials"',
  '<135> 09/09/2024:14:14:15 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30462001 0 : "SSLVPN session started for user ops_team from 10.0.0.100:4433"',
  '<135> 09/09/2024:14:14:30 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30462002 0 : "[Remote ip = 172.16.0.50:6789] freeing sta resource for user svc_account"',
  '<135> 09/09/2024:14:14:45 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30462003 0 : "SSLVPN session started for user admin from 192.168.1.200:9443"',
  '<135> 09/09/2024:14:15:00 PRODSY3VPX01 0-PPE-0 : default SSLVPN CMD_EXECUTED 30462004 0 : "User jsmith : Group sslvpn_users : Vserver 10.0.1.1:443 - Connected"',
  '<135> 09/09/2024:14:15:15 PRODSY3VPX01 0-PPE-0 : default SSLVPN Message 30462005 0 : "SSLVPN login failed for user root from 198.51.100.25:7777 - account locked"',
];

export const SYSLOG_VPN_DATASET: AutoImportEvalDataset = {
  name: 'Syslog SSLVPN Logs',
  description: 'NetScaler-style SSLVPN syslog logs with embedded IPs and event metadata',
  examples: [
    {
      input: {
        integration_id: 'eval-vpn-gateway',
        datastream_id: 'sslvpn',
        samples: loadSamples('syslog_vpn', FALLBACK_SAMPLES),
      },
      output: {
        expected_ecs_fields: [
          '@timestamp',
          'event.original',
          'event.id',
          'event.category',
          'event.type',
          'event.severity',
          'source.ip',
          'source.port',
          'user.name',
          'observer.hostname',
          'observer.type',
          'related.ip',
          'related.user',
        ],
        expected_vendor_namespace_pattern: '(netscaler|vpx_gateway|vpn_gateway)\\.sslvpn\\..*',
        expected_event_categories: ['authentication'],
        expected_event_types: ['start', 'end', 'info'],
        expected_related_fields: {
          ip: ['81.2.69.142'],
          user: ['jsmith'],
        },
        expected_processor_types: ['dissect', 'grok', 'date', 'set', 'rename', 'append'],
        min_pipeline_success_rate: 0.85,
      },
      metadata: {
        difficulty: 'hard',
        log_format: 'syslog',
        notes:
          'Complex syslog with positional fields, embedded IP:port in message body, multiple event types (session start/end/failure)',
      },
    },
  ],
};
