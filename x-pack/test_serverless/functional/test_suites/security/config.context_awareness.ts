/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createTestConfig } from '../../config.base';

export default createTestConfig({
  serverlessProject: 'security',
  testFiles: [require.resolve('./ftr/discover/context_awareness')],
  junit: {
    reportName:
      'Serverless Security Discover Context Awareness Functional Tests - Security Profiles',
  },
  // include settings from project controller
  esServerArgs: [],
});
