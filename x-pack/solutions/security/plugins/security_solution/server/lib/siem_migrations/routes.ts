/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { registerSiemRuleMigrationsRoutes } from './rules/api';
import { registerSiemDashboardMigrationsRoutes } from './dashboards/api';
import type { SecuritySolutionPluginRouter } from '../../types';
import type { ConfigType } from '../../config';

export const registerSiemMigrationsRoutes = (
  router: SecuritySolutionPluginRouter,
  config: ConfigType,
  logger: Logger
) => {
  if (!config.experimentalFeatures.siemMigrationsDisabled) {
    registerSiemRuleMigrationsRoutes(router, config, logger);
  }

  if (config.experimentalFeatures.automaticDashboardsMigration) {
    registerSiemDashboardMigrationsRoutes(router, logger);
  }
};
