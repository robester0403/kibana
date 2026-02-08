/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalDataset } from '../../src/types';
import { loadSamples } from './load_samples';

/**
 * CSV-formatted web server access logs.
 * Tests: CSV/delimiter parsing, HTTP field mapping, URL extraction,
 * response code to event outcome mapping.
 */

/** Inline fallback — used when golden_data/csv_webserver/samples.log is absent */
const FALLBACK_SAMPLES = [
  '2024-01-10T12:00:00Z,192.168.1.50,GET,/api/users,200,1234,15,Mozilla/5.0',
  '2024-01-10T12:00:01Z,10.0.0.99,POST,/api/login,401,56,8,curl/7.68.0',
  '2024-01-10T12:00:02Z,172.16.0.10,GET,/api/products?page=1&limit=20,200,5678,22,Mozilla/5.0',
  '2024-01-10T12:00:03Z,192.168.1.50,DELETE,/api/users/123,204,0,5,Mozilla/5.0',
  '2024-01-10T12:00:04Z,203.0.113.100,GET,/admin/config,403,89,3,python-requests/2.28',
  '2024-01-10T12:00:05Z,10.0.0.50,PUT,/api/settings,200,2048,45,Mozilla/5.0',
  '2024-01-10T12:00:06Z,172.16.0.20,GET,/health,200,12,1,ELB-HealthChecker/2.0',
  '2024-01-10T12:00:07Z,192.168.1.75,POST,/api/upload,500,0,120,Mozilla/5.0',
];

export const CSV_WEBSERVER_DATASET: AutoImportEvalDataset = {
  name: 'CSV Web Server Access Logs',
  description: 'Comma-separated web server access logs with HTTP fields',
  examples: [
    {
      input: {
        integration_id: 'eval-webserver',
        datastream_id: 'access',
        samples: loadSamples('csv_webserver', FALLBACK_SAMPLES),
      },
      output: {
        expected_ecs_fields: [
          '@timestamp',
          'event.original',
          'event.category',
          'source.ip',
          'http.request.method',
          'url.path',
          'http.response.status_code',
          'http.response.bytes',
          'user_agent.original',
          'related.ip',
        ],
        expected_vendor_namespace_pattern: 'web_?server\\..*',
        expected_event_categories: ['web'],
        expected_event_types: ['access'],
        expected_related_fields: {
          ip: ['192.168.1.50'],
        },
        expected_processor_types: ['csv', 'date', 'set', 'rename', 'convert'],
        min_pipeline_success_rate: 0.9,
      },
      metadata: {
        difficulty: 'medium',
        log_format: 'csv',
        notes: 'CSV with no header row - agent must infer column meanings from content',
      },
    },
  ],
};
