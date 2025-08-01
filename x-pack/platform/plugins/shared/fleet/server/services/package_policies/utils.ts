/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObject } from '@kbn/core-saved-objects-common/src/server_types';
import type { SavedObjectsClientContract } from '@kbn/core/server';

import {
  LICENCE_FOR_OUTPUT_PER_INTEGRATION,
  LICENCE_FOR_MULTIPLE_AGENT_POLICIES,
} from '../../../common/constants';
import {
  getAllowedOutputTypesForPackagePolicy,
  getAllowedOutputTypesForIntegration,
} from '../../../common/services/output_helpers';
import type {
  PackagePolicy,
  NewPackagePolicy,
  PackagePolicySOAttributes,
  PackageInfo,
} from '../../types';
import { appContextService } from '..';
import {
  PackagePolicyMultipleAgentPoliciesError,
  PackagePolicyOutputError,
  PackagePolicyContentPackageError,
  CustomPackagePolicyNotAllowedForAgentlessError,
} from '../../errors';
import { licenseService } from '../license';
import { outputService } from '../output';

export const mapPackagePolicySavedObjectToPackagePolicy = ({
  id,
  version,
  attributes,
  namespaces,
}: SavedObject<PackagePolicySOAttributes>): PackagePolicy => {
  const {
    bump_agent_policy_revision: bumpAgentPolicyRevision,
    latest_revision: latestRevision,
    ...restAttributes
  } = attributes;
  return {
    id,
    version,
    ...(namespaces ? { spaceIds: namespaces } : {}),
    ...restAttributes,
  };
};

export async function preflightCheckPackagePolicy(
  soClient: SavedObjectsClientContract,
  packagePolicy: PackagePolicy | NewPackagePolicy,
  packageInfo?: Pick<PackageInfo, 'type'>
) {
  // Package policies cannot be created for content type packages
  if (packageInfo?.type === 'content') {
    throw new PackagePolicyContentPackageError('Cannot create policy for content only packages');
  }

  // If package policy has multiple agent policies IDs, or no agent policies (orphaned integration policy)
  // check if user can use multiple agent policies feature
  const { canUseReusablePolicies, errorMessage: canUseMultipleAgentPoliciesErrorMessage } =
    canUseMultipleAgentPolicies();
  if (!canUseReusablePolicies && packagePolicy.policy_ids.length !== 1) {
    throw new PackagePolicyMultipleAgentPoliciesError(canUseMultipleAgentPoliciesErrorMessage);
  }

  // If package policy has an output_id, check if it can be used
  if (packagePolicy.output_id && packagePolicy.package) {
    const { canUseOutputForIntegrationResult, errorMessage: outputForIntegrationErrorMessage } =
      await canUseOutputForIntegration(soClient, packagePolicy);
    if (!canUseOutputForIntegrationResult && outputForIntegrationErrorMessage) {
      throw new PackagePolicyOutputError(outputForIntegrationErrorMessage);
    }
  }
}

export function canUseMultipleAgentPolicies() {
  const hasEnterpriseLicence = licenseService.hasAtLeast(LICENCE_FOR_MULTIPLE_AGENT_POLICIES);

  return {
    canUseReusablePolicies: hasEnterpriseLicence,
    errorMessage: !hasEnterpriseLicence
      ? 'Reusable integration policies are only available with an Enterprise license'
      : 'Reusable integration policies are not supported',
  };
}

export async function canUseOutputForIntegration(
  soClient: SavedObjectsClientContract,
  packagePolicy: Pick<PackagePolicy, 'output_id' | 'package' | 'supports_agentless'>
) {
  const outputId = packagePolicy.output_id;
  const packageName = packagePolicy.package?.name;

  if (outputId) {
    const hasAllowedLicense = licenseService.hasAtLeast(LICENCE_FOR_OUTPUT_PER_INTEGRATION);
    if (!hasAllowedLicense) {
      return {
        canUseOutputForIntegrationResult: false,
        errorMessage: `Output per integration is only available with an ${LICENCE_FOR_OUTPUT_PER_INTEGRATION} license`,
      };
    }

    const allowedOutputTypesForIntegration = getAllowedOutputTypesForIntegration(packageName);
    const allowedOutputTypesForPackagePolicy = getAllowedOutputTypesForPackagePolicy(packagePolicy);
    const allowedOutputTypes = allowedOutputTypesForIntegration.filter((type) =>
      allowedOutputTypesForPackagePolicy.includes(type)
    );

    const output = await outputService.get(soClient, outputId);

    if (!allowedOutputTypes.includes(output.type)) {
      return {
        canUseOutputForIntegrationResult: false,
        errorMessage: `Output type "${output.type}" is not usable with package "${packageName}"`,
      };
    }
  }

  return {
    canUseOutputForIntegrationResult: true,
    errorMessage: null,
  };
}

export function canDeployCustomPackageAsAgentlessOrThrow(
  packagePolicy: NewPackagePolicy,
  packageInfo: PackageInfo
) {
  const installSource =
    packageInfo &&
    'savedObject' in packageInfo &&
    packageInfo.savedObject?.attributes.install_source;
  const isCustom = installSource === 'custom' || installSource === 'upload';
  const isCustomAgentlessAllowed =
    appContextService.getConfig()?.agentless?.customIntegrations?.enabled;

  if (packagePolicy.supports_agentless && isCustom && !isCustomAgentlessAllowed) {
    throw new CustomPackagePolicyNotAllowedForAgentlessError();
  }

  return true;
}
