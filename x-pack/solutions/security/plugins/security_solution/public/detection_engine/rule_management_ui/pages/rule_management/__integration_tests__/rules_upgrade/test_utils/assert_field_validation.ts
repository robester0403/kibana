/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  ThreeWayDiffConflict,
  ThreeWayDiffOutcome,
} from '../../../../../../../../common/api/detection_engine';
import {
  getSaveFieldValueButton,
  switchToFieldEdit,
  toggleFieldAccordion,
} from './rule_upgrade_helpers';
import { mockRuleUpgradeReviewData, renderRuleUpgradeFlyout } from './rule_upgrade_flyout';
import { inputFieldValue } from './set_field_value';

interface AssertFieldValidationParams {
  ruleType: string;
  fieldName: string;
  fieldVersions: {
    initial: unknown;
    upgrade: unknown;
    invalidValue: unknown;
  };
}

export function assertFieldValidation({
  ruleType,
  fieldName: rawFieldName,
  fieldVersions: { initial, upgrade, invalidValue: rawInvalidValue },
}: AssertFieldValidationParams) {
  // TS isn't able to infer the type of the field name for inputFieldValue()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invalidValue = rawInvalidValue as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldName = rawFieldName as any;

  describe('field value validation', () => {
    it('blocks saving field value when value is invalid', async () => {
      mockRuleUpgradeReviewData({
        ruleType,
        fieldName,
        fieldVersions: {
          base: initial,
          current: initial,
          target: upgrade,
          merged: upgrade,
        },
        diffOutcome: ThreeWayDiffOutcome.StockValueCanUpdate,
        conflict: ThreeWayDiffConflict.NONE,
      });

      const { getByTestId } = await renderRuleUpgradeFlyout();

      const fieldUpgradeWrapper = getByTestId(`${fieldName}-upgradeWrapper`);

      toggleFieldAccordion(fieldUpgradeWrapper);
      switchToFieldEdit(fieldUpgradeWrapper);
      await inputFieldValue(fieldUpgradeWrapper, { fieldName, value: invalidValue });

      const saveButton = getSaveFieldValueButton(fieldUpgradeWrapper);

      expect(saveButton).toBeDisabled();
    });
  });
}
