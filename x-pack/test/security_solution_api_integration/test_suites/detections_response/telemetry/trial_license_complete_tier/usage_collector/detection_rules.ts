/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';

import type {
  ThreatMatchRuleCreateProps,
  ThresholdRuleCreateProps,
} from '@kbn/security-solution-plugin/common/api/detection_engine';
import { getInitialDetectionMetrics } from '@kbn/security-solution-plugin/server/usage/detections/get_initial_usage';
import { ELASTIC_SECURITY_RULE_ID } from '@kbn/security-solution-plugin/common';
import { RulesTypeUsage } from '@kbn/security-solution-plugin/server/usage/detections/rules/types';
import { DETECTION_ENGINE_RULES_URL } from '@kbn/security-solution-plugin/common/constants';
import { CreateRuleExceptionListItemSchema } from '@kbn/securitysolution-io-ts-list-types';
import {
  createLegacyRuleAction,
  createWebHookRuleAction,
  getEqlRuleForAlertTesting,
  fetchRule,
  getRuleWithWebHookAction,
  getSimpleMlRule,
  getSimpleRule,
  getSimpleThreatMatch,
  getStats,
  getThresholdRuleForAlertTesting,
  installMockPrebuiltRules,
  updateRule,
  deleteAllEventLogExecutionEvents,
  getRuleSavedObjectWithLegacyInvestigationFields,
  getRuleSavedObjectWithLegacyInvestigationFieldsEmptyArray,
  createRuleThroughAlertingEndpoint,
  getCustomQueryRuleParams,
} from '../../../utils';
import {
  createRule,
  createAlertsIndex,
  deleteAllRules,
  deleteAllAlerts,
  waitForRuleSuccess,
  waitForAlertsToBePresent,
  getRuleForAlertTesting,
} from '../../../../../../common/utils/security_solution';
import { deleteAllExceptions } from '../../../../lists_and_exception_lists/utils';

import { FtrProviderContext } from '../../../../../ftr_provider_context';
import {
  checkRuleTypeUsageCustomizationInvariant,
  checkRuleTypeUsageFields,
} from '../../../utils/telemetry';

const getRuleExceptionItemMock = (): CreateRuleExceptionListItemSchema => ({
  description: 'Exception item for rule default exception list',
  entries: [
    {
      field: 'some.not.nested.field',
      operator: 'included',
      type: 'match',
      value: 'some value',
    },
  ],
  name: 'Sample exception item',
  type: 'simple',
});

export default ({ getService }: FtrProviderContext) => {
  const supertest = getService('supertest');
  const esArchiver = getService('esArchiver');
  const log = getService('log');
  const retry = getService('retry');
  const es = getService('es');

  describe('@ess @serverless Detection rule telemetry', () => {
    before(async () => {
      // Just in case other tests do not clean up the event logs, let us clear them now and here only once.
      await deleteAllEventLogExecutionEvents(es, log);
      await esArchiver.load(
        'x-pack/solutions/security/test/fixtures/es_archives/security_solution/telemetry'
      );
    });

    after(async () => {
      await esArchiver.unload(
        'x-pack/solutions/security/test/fixtures/es_archives/security_solution/telemetry'
      );
    });

    beforeEach(async () => {
      await createAlertsIndex(supertest, log);
      await deleteAllExceptions(supertest, log);
    });

    afterEach(async () => {
      await deleteAllAlerts(supertest, log, es);
      await deleteAllExceptions(supertest, log);
      await deleteAllRules(supertest, log);
      await deleteAllEventLogExecutionEvents(es, log);
    });

    describe('"kql" rule type', () => {
      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "disabled"/"in-active" rule that does not have any actions', async () => {
        const rule = getRuleForAlertTesting(['telemetry'], 'rule-1', false);
        await createRule(supertest, log, rule);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "enabled"/"active" rule that does not have any actions', async () => {
        const rule = getRuleForAlertTesting(['telemetry']);
        const { id } = await createRule(supertest, log, rule);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_disabled" to be "1" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getRuleForAlertTesting(['telemetry']);
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, false, rule);
        await createRule(supertest, log, ruleToCreate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              notifications_disabled: 1,
              disabled: 1,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              notifications_disabled: 1,
              disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              notifications_disabled: 1,
              disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "notifications_enabled" to be "1" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        const rule = getRuleForAlertTesting(['telemetry']);
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, true, rule);
        const { id } = await createRule(supertest, log, ruleToCreate);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_disabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getRuleForAlertTesting(['telemetry'], 'rule-1', false);
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);

          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_enabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "enabled"/"active"', async () => {
        const rule = getRuleForAlertTesting(['telemetry']);
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      describe('@skipInServerless legacy investigation fields', () => {
        beforeEach(async () => {
          await deleteAllRules(supertest, log);
          await createRuleThroughAlertingEndpoint(
            supertest,
            getRuleSavedObjectWithLegacyInvestigationFields()
          );
          await createRuleThroughAlertingEndpoint(
            supertest,
            getRuleSavedObjectWithLegacyInvestigationFieldsEmptyArray()
          );
          await createRule(supertest, log, {
            ...getSimpleRule('rule-with-investigation-field'),
            name: 'Test investigation fields object',
            investigation_fields: { field_names: ['host.name'] },
          });
        });

        afterEach(async () => {
          await deleteAllRules(supertest, log);
        });

        it('should show "legacy_investigation_fields" to be greater than 0 when a rule has "investigation_fields" set to array or empty array', async () => {
          await retry.try(async () => {
            const stats = await getStats(supertest, log);
            const expected: RulesTypeUsage = {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
              query: {
                ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
                alerts: 0,
                enabled: 0,
                disabled: 3,
                legacy_investigation_fields: 2,
              },
              query_custom: {
                ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
                alerts: 0,
                enabled: 0,
                disabled: 3,
                legacy_investigation_fields: 2,
              },
              custom_total: {
                ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
                alerts: 0,
                enabled: 0,
                disabled: 3,
                legacy_investigation_fields: 2,
              },
            };
            expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
          });
        });
      });

      it('should show "has_exceptions" greater than 1 when rule has attached exceptions', async () => {
        const rule = await createRule(supertest, log, getCustomQueryRuleParams());
        // Add an exception to the rule
        await supertest
          .post(`${DETECTION_ENGINE_RULES_URL}/${rule.id}/exceptions`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2023-10-31')
          .send({
            items: [getRuleExceptionItemMock()],
          })
          .expect(200);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            query: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query,
              disabled: 1,
              has_exceptions: 1,
            },
            query_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.query_custom,
              disabled: 1,
              has_exceptions: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              has_exceptions: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });
    });

    describe('"eql" rule type', () => {
      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "disabled"/"in-active" rule that does not have any actions', async () => {
        const rule = getEqlRuleForAlertTesting(['telemetry'], 'rule-1', false);
        await createRule(supertest, log, rule);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "enabled"/"active" rule that does not have any actions', async () => {
        const rule = getEqlRuleForAlertTesting(['telemetry']);
        const { id } = await createRule(supertest, log, rule);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_disabled" to be "1" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getEqlRuleForAlertTesting(['telemetry']);
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, false, rule);
        await createRule(supertest, log, ruleToCreate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              notifications_disabled: 1,
              disabled: 1,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              notifications_disabled: 1,
              disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              notifications_disabled: 1,
              disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled" to be "1" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        const rule = getEqlRuleForAlertTesting(['telemetry']);
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, true, rule);
        const { id } = await createRule(supertest, log, ruleToCreate);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_disabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getEqlRuleForAlertTesting(['telemetry'], 'rule-1', false);
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_enabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "enabled"/"active"', async () => {
        const rule = getEqlRuleForAlertTesting(['telemetry']);
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "has_exceptions" greater than 1 when rule has attached exceptions', async () => {
        const rule = await createRule(
          supertest,
          log,
          getEqlRuleForAlertTesting(['non-existent-index'], 'rule-1', false)
        );
        // Add an exception to the rule
        await supertest
          .post(`${DETECTION_ENGINE_RULES_URL}/${rule.id}/exceptions`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2023-10-31')
          .send({
            items: [getRuleExceptionItemMock()],
          })
          .expect(200);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            eql: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql,
              disabled: 1,
              has_exceptions: 1,
            },
            eql_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.eql_custom,
              disabled: 1,
              has_exceptions: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              has_exceptions: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });
    });

    describe('"threshold" rule type', () => {
      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "disabled"/"in-active" rule that does not have any actions', async () => {
        const rule: ThresholdRuleCreateProps = {
          ...getThresholdRuleForAlertTesting(['telemetry'], 'rule-1', false),
          threshold: {
            field: 'keyword',
            value: 1,
          },
        };
        await createRule(supertest, log, rule);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "enabled"/"active" rule that does not have any actions', async () => {
        const rule: ThresholdRuleCreateProps = {
          ...getThresholdRuleForAlertTesting(['telemetry']),
          threshold: {
            field: 'keyword',
            value: 1,
          },
        };
        const { id } = await createRule(supertest, log, rule);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_disabled" to be "1" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule: ThresholdRuleCreateProps = {
          ...getThresholdRuleForAlertTesting(['telemetry'], 'rule-1', false),
          threshold: {
            field: 'keyword',
            value: 1,
          },
        };
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, false, rule);
        await createRule(supertest, log, ruleToCreate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              notifications_disabled: 1,
              disabled: 1,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              notifications_disabled: 1,
              disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              notifications_disabled: 1,
              disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled" to be "1" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        const rule: ThresholdRuleCreateProps = {
          ...getThresholdRuleForAlertTesting(['telemetry']),
          threshold: {
            field: 'keyword',
            value: 1,
          },
        };
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, true, rule);
        const { id } = await createRule(supertest, log, ruleToCreate);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_disabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule: ThresholdRuleCreateProps = {
          ...getThresholdRuleForAlertTesting(['telemetry'], 'rule-1', false),
          threshold: {
            field: 'keyword',
            value: 1,
          },
        };
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_enabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "enabled"/"active"', async () => {
        const rule: ThresholdRuleCreateProps = {
          ...getThresholdRuleForAlertTesting(['telemetry']),
          threshold: {
            field: 'keyword',
            value: 1,
          },
        };
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "has_exceptions" greater than 1 when rule has attached exceptions', async () => {
        const rule = await createRule(
          supertest,
          log,
          getThresholdRuleForAlertTesting(['non-existent-index'])
        );
        // Add an exception to the rule
        await supertest
          .post(`${DETECTION_ENGINE_RULES_URL}/${rule.id}/exceptions`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2023-10-31')
          .send({
            items: [getRuleExceptionItemMock()],
          })
          .expect(200);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threshold: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold,
              enabled: 1,
              has_exceptions: 1,
            },
            threshold_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threshold_custom,
              enabled: 1,
              has_exceptions: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              has_exceptions: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });
    });

    // Note: We don't actually find signals with these tests as we don't have a good way of signal finding with ML rules.
    describe('"ml" rule type', () => {
      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "disabled"/"in-active" rule that does not have any actions', async () => {
        const rule = getSimpleMlRule();
        await createRule(supertest, log, rule);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "enabled"/"active" rule that does not have any actions', async () => {
        const rule = getSimpleMlRule('rule-1', true);
        await createRule(supertest, log, rule);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              enabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              enabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_disabled" to be "1" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getSimpleMlRule();
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, false, rule);
        await createRule(supertest, log, ruleToCreate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              notifications_disabled: 1,
              disabled: 1,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              notifications_disabled: 1,
              disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              notifications_disabled: 1,
              disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled" to be "1" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        const rule = getSimpleMlRule('rule-1', true);
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, true, rule);
        await createRule(supertest, log, ruleToCreate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              enabled: 1,
              notifications_enabled: 1,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              enabled: 1,
              notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_disabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getSimpleMlRule();
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_enabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "enabled"/"active"', async () => {
        const rule = getSimpleMlRule('rule-1', true);
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "has_exceptions" greater than 1 when rule has attached exceptions', async () => {
        const rule = await createRule(supertest, log, getSimpleMlRule('rule-1', false));
        // Add an exception to the rule
        await supertest
          .post(`${DETECTION_ENGINE_RULES_URL}/${rule.id}/exceptions`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2023-10-31')
          .send({
            items: [getRuleExceptionItemMock()],
          })
          .expect(200);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            machine_learning: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.machine_learning,
              disabled: 1,
              has_exceptions: 1,
            },
            machine_learning_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .machine_learning_custom,
              disabled: 1,
              has_exceptions: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              has_exceptions: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });
    });

    describe('"indicator_match/threat_match" rule type', () => {
      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "disabled"/"in-active" rule that does not have any actions', async () => {
        const rule = getSimpleThreatMatch();
        await createRule(supertest, log, rule);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled", "notifications_disabled" "legacy_notifications_enabled", "legacy_notifications_disabled", all to be "0" for "enabled"/"active" rule that does not have any actions', async () => {
        const rule: ThreatMatchRuleCreateProps = {
          ...getSimpleThreatMatch('rule-1', true),
          index: ['telemetry'],
          threat_index: ['telemetry'],
          threat_mapping: [
            {
              entries: [
                {
                  field: 'keyword',
                  value: 'keyword',
                  type: 'mapping',
                },
              ],
            },
          ],
        };
        const { id } = await createRule(supertest, log, rule);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 0,
              notifications_disabled: 0,
              legacy_notifications_disabled: 0,
              legacy_notifications_enabled: 0,
              legacy_investigation_fields: 0,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_disabled" to be "1" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getSimpleThreatMatch();
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, false, rule);
        await createRule(supertest, log, ruleToCreate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              notifications_disabled: 1,
              disabled: 1,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              notifications_disabled: 1,
              disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              notifications_disabled: 1,
              disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "notifications_enabled" to be "1" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        const rule: ThreatMatchRuleCreateProps = {
          ...getSimpleThreatMatch('rule-1', true),
          index: ['telemetry'],
          threat_index: ['telemetry'],
          threat_mapping: [
            {
              entries: [
                {
                  field: 'keyword',
                  value: 'keyword',
                  type: 'mapping',
                },
              ],
            },
          ],
        };
        const hookAction = await createWebHookRuleAction(supertest);
        const ruleToCreate = getRuleWithWebHookAction(hookAction.id, true, rule);
        const { id } = await createRule(supertest, log, ruleToCreate);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              enabled: 1,
              alerts: 4,
              notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_disabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "disabled"/"in-active"', async () => {
        const rule = getSimpleThreatMatch();
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              legacy_notifications_disabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('@skipInServerless should show "legacy_notifications_enabled" to be "1" for rule that has at least "1" legacy action(s) and the alert is "enabled"/"active"', async () => {
        const rule: ThreatMatchRuleCreateProps = {
          ...getSimpleThreatMatch('rule-1', true),
          index: ['telemetry'],
          threat_index: ['telemetry'],
          threat_mapping: [
            {
              entries: [
                {
                  field: 'keyword',
                  value: 'keyword',
                  type: 'mapping',
                },
              ],
            },
          ],
        };
        const { id } = await createRule(supertest, log, rule);
        const hookAction = await createWebHookRuleAction(supertest);
        await createLegacyRuleAction(supertest, id, hookAction.id);
        await waitForRuleSuccess({ supertest, log, id });
        await waitForAlertsToBePresent(supertest, log, 4, [id]);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              alerts: 4,
              enabled: 1,
              legacy_notifications_enabled: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });

      it('should show "has_exceptions" greater than 1 when rule has attached exceptions', async () => {
        const rule = await createRule(supertest, log, getSimpleThreatMatch('rule-1', false));
        // Add an exception to the rule
        await supertest
          .post(`${DETECTION_ENGINE_RULES_URL}/${rule.id}/exceptions`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2023-10-31')
          .send({
            items: [getRuleExceptionItemMock()],
          })
          .expect(200);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const expected: RulesTypeUsage = {
            ...getInitialDetectionMetrics().detection_rules.detection_rule_usage,
            threat_match: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.threat_match,
              disabled: 1,
              has_exceptions: 1,
            },
            threat_match_custom: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage
                .threat_match_custom,
              disabled: 1,
              has_exceptions: 1,
            },
            custom_total: {
              ...getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total,
              disabled: 1,
              has_exceptions: 1,
            },
          };
          expect(stats.detection_rules.detection_rule_usage).to.eql(expected);
        });
      });
    });

    describe('"pre-packaged"/"immutable" rules', () => {
      it('@skipInServerless should show stats for totals for in-active pre-packaged rules', async () => {
        await installMockPrebuiltRules(supertest, es);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          expect(stats.detection_rules.detection_rule_usage.elastic_total.enabled).above(0);
          expect(stats.detection_rules.detection_rule_usage.elastic_total.disabled).above(0);
          checkRuleTypeUsageCustomizationInvariant(stats.detection_rules.detection_rule_usage);
          expect(stats.detection_rules.detection_rule_detail.length).above(0);
          expect(stats.detection_rules.detection_rule_usage.custom_total).to.eql({
            enabled: 0,
            disabled: 0,
            alerts: 0,
            cases: 0,
            legacy_notifications_enabled: 0,
            legacy_notifications_disabled: 0,
            notifications_enabled: 0,
            notifications_disabled: 0,
            legacy_investigation_fields: 0,
            alert_suppression: {
              enabled: 0,
              disabled: 0,
              suppressed_per_time_period: 0,
              suppressed_per_rule_execution: 0,
              suppressed_fields_count: { one: 0, two: 0, three: 0 },
              suppresses_missing_fields: 0,
              does_not_suppress_missing_fields: 0,
            },
            has_exceptions: 0,
            response_actions: {
              enabled: 0,
              disabled: 0,
              response_actions: {
                endpoint: 0,
                osquery: 0,
              },
            },
          });
        });
      });

      it('@skipInServerlessMKI should show stats for the detection_rule_details for a specific pre-packaged rule', async () => {
        await installMockPrebuiltRules(supertest, es);
        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          const foundRule = stats.detection_rules.detection_rule_detail.find(
            (rule) => rule.rule_id === ELASTIC_SECURITY_RULE_ID
          );
          if (foundRule == null) {
            throw new Error('Found rule should not be null. Please change this end to end test.');
          }
          const {
            created_on: createdOn,
            updated_on: updatedOn,
            rule_id: ruleId,
            rule_version: ruleVersion,
            ...omittedFields
          } = foundRule;
          expect(omittedFields).to.eql({
            rule_name: 'A rule with an exception list',
            rule_type: 'query',
            enabled: true,
            is_customized: false,
            elastic_rule: true,
            alert_count_daily: 0,
            cases_count_total: 0,
            has_legacy_notification: false,
            has_notification: false,
            has_legacy_investigation_field: false,
            has_alert_suppression_per_rule_execution: false,
            has_alert_suppression_per_time_period: false,
            has_alert_suppression_missing_fields_strategy_do_not_suppress: false,
            alert_suppression_fields_count: 0,
            has_exceptions: true,
            has_response_actions: false,
            has_response_actions_endpoint: false,
            has_response_actions_osquery: false,
          });
        });
      });

      it('@skipInServerlessMKI should show "notifications_disabled" to be "1", "has_notification" to be "true, "has_legacy_notification" to be "false" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        await installMockPrebuiltRules(supertest, es);
        const immutableRule = await fetchRule(supertest, { ruleId: ELASTIC_SECURITY_RULE_ID });
        const hookAction = await createWebHookRuleAction(supertest);
        const newRuleToUpdate = getCustomQueryRuleParams({ rule_id: immutableRule.rule_id });
        const ruleToUpdate = getRuleWithWebHookAction(hookAction.id, false, newRuleToUpdate);
        await updateRule(supertest, ruleToUpdate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          // We have to search by "rule_name" since the "rule_id" it is storing is the Saved Object ID and not the rule_id
          const foundRule = stats.detection_rules.detection_rule_detail.find(
            (rule) => rule.rule_id === ELASTIC_SECURITY_RULE_ID
          );
          if (foundRule == null) {
            throw new Error('Found rule should not be null. Please change this end to end test.');
          }
          const {
            created_on: createdOn,
            updated_on: updatedOn,
            rule_id: ruleId,
            rule_version: ruleVersion,
            ...omittedFields
          } = foundRule;
          expect(omittedFields).to.eql({
            rule_name: 'Custom query rule',
            rule_type: 'query',
            enabled: false,
            elastic_rule: true,
            is_customized: true,
            alert_count_daily: 0,
            cases_count_total: 0,
            has_notification: true,
            has_legacy_notification: false,
            has_legacy_investigation_field: false,
            has_alert_suppression_per_rule_execution: false,
            has_alert_suppression_per_time_period: false,
            has_alert_suppression_missing_fields_strategy_do_not_suppress: false,
            alert_suppression_fields_count: 0,
            has_exceptions: false,
            has_response_actions: false,
            has_response_actions_endpoint: false,
            has_response_actions_osquery: false,
          });

          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'notifications_disabled',
            {
              total: 1,
              customized: 1,
              noncustomized: 0,
            }
          );
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'legacy_notifications_enabled',
            {
              total: 0,
              customized: 0,
              noncustomized: 0,
            }
          );
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'legacy_notifications_disabled',
            {
              total: 0,
              customized: 0,
              noncustomized: 0,
            }
          );
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'notifications_enabled',
            {
              total: 0,
              customized: 0,
              noncustomized: 0,
            }
          );
          checkRuleTypeUsageCustomizationInvariant(stats.detection_rules.detection_rule_usage);

          expect(stats.detection_rules.detection_rule_usage.custom_total).to.eql(
            getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total
          );
        });
      });

      it('@skipInServerlessMKI should show "notifications_enabled" to be "1", "has_notification" to be "true, "has_legacy_notification" to be "false" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        await installMockPrebuiltRules(supertest, es);
        const immutableRule = await fetchRule(supertest, { ruleId: ELASTIC_SECURITY_RULE_ID });
        const hookAction = await createWebHookRuleAction(supertest);
        const newRuleToUpdate = getCustomQueryRuleParams({ rule_id: immutableRule.rule_id });
        const ruleToUpdate = getRuleWithWebHookAction(hookAction.id, true, newRuleToUpdate);
        await updateRule(supertest, ruleToUpdate);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          // We have to search by "rule_name" since the "rule_id" it is storing is the Saved Object ID and not the rule_id
          const foundRule = stats.detection_rules.detection_rule_detail.find(
            (rule) => rule.rule_id === ELASTIC_SECURITY_RULE_ID
          );
          if (foundRule == null) {
            throw new Error('Found rule should not be null. Please change this end to end test.');
          }
          const {
            created_on: createdOn,
            updated_on: updatedOn,
            rule_id: ruleId,
            rule_version: ruleVersion,
            ...omittedFields
          } = foundRule;
          expect(omittedFields).to.eql({
            rule_name: 'Custom query rule',
            rule_type: 'query',
            enabled: true,
            is_customized: true,
            elastic_rule: true,
            alert_count_daily: 0,
            cases_count_total: 0,
            has_notification: true,
            has_legacy_notification: false,
            has_legacy_investigation_field: false,
            has_alert_suppression_per_rule_execution: false,
            has_alert_suppression_per_time_period: false,
            has_alert_suppression_missing_fields_strategy_do_not_suppress: false,
            alert_suppression_fields_count: 0,
            has_exceptions: false,
            has_response_actions: false,
            has_response_actions_endpoint: false,
            has_response_actions_osquery: false,
          });
          checkRuleTypeUsageCustomizationInvariant(stats.detection_rules.detection_rule_usage);
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'notifications_disabled',
            {
              total: 0,
              customized: 0,
              noncustomized: 0,
            }
          );
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'notifications_enabled',
            {
              total: 1,
              customized: 1,
              noncustomized: 0,
            }
          );
          expect(stats.detection_rules.detection_rule_usage.custom_total).to.eql(
            getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total
          );
        });
      });

      it('@skipInServerless should show "legacy_notifications_disabled" to be "1", "has_notification" to be "false, "has_legacy_notification" to be "true" for rule that has at least "1" action(s) and the alert is "disabled"/"in-active"', async () => {
        await installMockPrebuiltRules(supertest, es);
        const immutableRule = await fetchRule(supertest, { ruleId: ELASTIC_SECURITY_RULE_ID });
        const hookAction = await createWebHookRuleAction(supertest);
        const newRuleToUpdate = getCustomQueryRuleParams({ rule_id: immutableRule.rule_id });
        await updateRule(supertest, newRuleToUpdate);
        await createLegacyRuleAction(supertest, immutableRule.id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          // We have to search by "rule_name" since the "rule_id" it is storing is the Saved Object ID and not the rule_id
          const foundRule = stats.detection_rules.detection_rule_detail.find(
            (rule) => rule.rule_id === ELASTIC_SECURITY_RULE_ID
          );
          if (foundRule == null) {
            throw new Error('Found rule should not be null. Please change this end to end test.');
          }
          const {
            created_on: createdOn,
            updated_on: updatedOn,
            rule_id: ruleId,
            rule_version: ruleVersion,
            ...omittedFields
          } = foundRule;
          expect(omittedFields).to.eql({
            rule_name: 'Custom query rule',
            rule_type: 'query',
            enabled: false,
            is_customized: true,
            elastic_rule: true,
            alert_count_daily: 0,
            cases_count_total: 0,
            has_notification: false,
            has_legacy_notification: true,
            has_legacy_investigation_field: false,
            has_alert_suppression_per_rule_execution: false,
            has_alert_suppression_per_time_period: false,
            has_alert_suppression_missing_fields_strategy_do_not_suppress: false,
            alert_suppression_fields_count: 0,
            has_exceptions: false,
            has_response_actions: false,
            has_response_actions_endpoint: false,
            has_response_actions_osquery: false,
          });
          checkRuleTypeUsageCustomizationInvariant(stats.detection_rules.detection_rule_usage);
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'legacy_notifications_disabled',
            {
              total: 1,
              customized: 1,
              noncustomized: 0,
            }
          );
          expect(stats.detection_rules.detection_rule_usage.custom_total).to.eql(
            getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total
          );
        });
      });

      it('@skipInServerless should show "legacy_notifications_enabled" to be "1", "has_notification" to be "false, "has_legacy_notification" to be "true" for rule that has at least "1" action(s) and the alert is "enabled"/"active"', async () => {
        await installMockPrebuiltRules(supertest, es);
        const immutableRule = await fetchRule(supertest, { ruleId: ELASTIC_SECURITY_RULE_ID });
        const hookAction = await createWebHookRuleAction(supertest);
        const newRuleToUpdate = getCustomQueryRuleParams({
          rule_id: immutableRule.rule_id,
          enabled: true,
        });
        await updateRule(supertest, newRuleToUpdate);
        await createLegacyRuleAction(supertest, immutableRule.id, hookAction.id);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          // We have to search by "rule_name" since the "rule_id" it is storing is the Saved Object ID and not the rule_id
          const foundRule = stats.detection_rules.detection_rule_detail.find(
            (rule) => rule.rule_id === ELASTIC_SECURITY_RULE_ID
          );
          if (foundRule == null) {
            throw new Error('Found rule should not be null. Please change this end to end test.');
          }
          const {
            created_on: createdOn,
            updated_on: updatedOn,
            rule_id: ruleId,
            rule_version: ruleVersion,
            ...omittedFields
          } = foundRule;
          expect(omittedFields).to.eql({
            rule_name: 'Custom query rule',
            rule_type: 'query',
            enabled: true,
            is_customized: true,
            elastic_rule: true,
            alert_count_daily: 0,
            cases_count_total: 0,
            has_notification: false,
            has_legacy_notification: true,
            has_legacy_investigation_field: false,
            has_alert_suppression_per_rule_execution: false,
            has_alert_suppression_per_time_period: false,
            has_alert_suppression_missing_fields_strategy_do_not_suppress: false,
            alert_suppression_fields_count: 0,
            has_exceptions: false,
            has_response_actions: false,
            has_response_actions_endpoint: false,
            has_response_actions_osquery: false,
          });
          checkRuleTypeUsageCustomizationInvariant(stats.detection_rules.detection_rule_usage);
          checkRuleTypeUsageFields(
            stats.detection_rules.detection_rule_usage,
            'legacy_notifications_enabled',
            {
              total: 1,
              customized: 1,
              noncustomized: 0,
            }
          );
          expect(stats.detection_rules.detection_rule_usage.custom_total).to.eql(
            getInitialDetectionMetrics().detection_rules.detection_rule_usage.custom_total
          );
        });
      });

      // installMockPrebuiltRules and then fetching rule seems to not work in MKI
      it('@skipInServerlessMKI should show "has_exceptions" greater than 1 when rule has attached exceptions', async () => {
        await installMockPrebuiltRules(supertest, es);
        const immutableRule = await fetchRule(supertest, { ruleId: ELASTIC_SECURITY_RULE_ID });

        // Add an exception to the rule
        await supertest
          .post(`${DETECTION_ENGINE_RULES_URL}/${immutableRule.id}/exceptions`)
          .set('kbn-xsrf', 'true')
          .set('elastic-api-version', '2023-10-31')
          .send({
            items: [getRuleExceptionItemMock()],
          })
          .expect(200);

        await retry.try(async () => {
          const stats = await getStats(supertest, log);
          expect(
            stats.detection_rules.detection_rule_usage.elastic_total.has_exceptions
          ).to.be.greaterThan(0);
          expect(
            stats.detection_rules.detection_rule_usage.elastic_noncustomized_total.has_exceptions
          ).to.be.greaterThan(0);
          checkRuleTypeUsageCustomizationInvariant(stats.detection_rules.detection_rule_usage);
        });
      });
    });
  });
};
