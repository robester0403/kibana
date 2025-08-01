/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { legacyExperimentalFieldMap } from '@kbn/alerts-as-data-utils';
import type { AlertingServerSetup } from '@kbn/alerting-plugin/server';
import { type IRuleTypeAlerts } from '@kbn/alerting-plugin/server';
import { ALERT_GROUPING } from '@kbn/rule-data-utils';
import type { MappingDynamicTemplate } from '@elastic/elasticsearch/lib/api/types';
import { registerMetricThresholdRuleType } from './metric_threshold/register_metric_threshold_rule_type';
import { registerInventoryThresholdRuleType } from './inventory_metric_threshold/register_inventory_metric_threshold_rule_type';
import { registerLogThresholdRuleType } from './log_threshold/register_log_threshold_rule_type';
import type { InfraBackendLibs, InfraLocators } from '../infra_types';
import type { InfraConfig } from '../../types';
import type { MetricThresholdAlert } from './metric_threshold/metric_threshold_executor';
import type { LogThresholdAlert } from './log_threshold/log_threshold_executor';

const stringAsKeywords: MappingDynamicTemplate = {
  path_match: `${ALERT_GROUPING}.*`,
  match_mapping_type: 'string',
  mapping: { type: 'keyword', ignore_above: 1024 },
};
const dynamicTemplates = [
  {
    strings_as_keywords: stringAsKeywords,
  },
];

export const LOGS_RULES_ALERT_CONTEXT = 'observability.logs';
// Defines which alerts-as-data index logs rules will use
export const LogsRulesTypeAlertDefinition: IRuleTypeAlerts<LogThresholdAlert> = {
  context: LOGS_RULES_ALERT_CONTEXT,
  mappings: {
    fieldMap: legacyExperimentalFieldMap,
    dynamicTemplates,
  },
  useEcs: true,
  useLegacyAlerts: true,
  shouldWrite: true,
};

export const METRICS_RULES_ALERT_CONTEXT = 'observability.metrics';
// Defines which alerts-as-data index metrics rules will use
export const MetricsRulesTypeAlertDefinition: IRuleTypeAlerts<MetricThresholdAlert> = {
  context: METRICS_RULES_ALERT_CONTEXT,
  mappings: {
    fieldMap: legacyExperimentalFieldMap,
    dynamicTemplates,
  },
  useEcs: true,
  useLegacyAlerts: true,
  shouldWrite: true,
};

const registerRuleTypes = (
  alertingPlugin: AlertingServerSetup,
  libs: InfraBackendLibs,
  config: InfraConfig,
  locators: InfraLocators
) => {
  if (alertingPlugin) {
    const registerFns = [
      registerLogThresholdRuleType,
      registerInventoryThresholdRuleType,
      registerMetricThresholdRuleType,
    ];
    registerFns.forEach((fn) => {
      fn(alertingPlugin, libs, config, locators);
    });
  }
};

export { registerRuleTypes };
