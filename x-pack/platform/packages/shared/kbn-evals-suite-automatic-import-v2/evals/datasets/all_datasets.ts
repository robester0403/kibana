/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AutoImportEvalDataset } from '../../src/types';
import { SYSLOG_FIREWALL_DATASET } from './syslog_firewall';
import { JSON_AUTH_DATASET } from './json_auth';
import { KEY_VALUE_DATASET } from './key_value';
import { CSV_WEBSERVER_DATASET } from './csv_webserver';
import { SYSLOG_VPN_DATASET } from './syslog_vpn';

/**
 * All evaluation datasets combined into a single array.
 */
export const ALL_DATASETS: AutoImportEvalDataset[] = [
  SYSLOG_FIREWALL_DATASET,
  JSON_AUTH_DATASET,
  KEY_VALUE_DATASET,
  CSV_WEBSERVER_DATASET,
  SYSLOG_VPN_DATASET,
];
