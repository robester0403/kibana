/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { map, memoize, pick } from 'lodash';
import type { Client, estypes } from '@elastic/elasticsearch';
import type {
  Agent,
  AgentPolicy,
  AgentStatus,
  CopyAgentPolicyResponse,
  CreateAgentPolicyRequest,
  CreateAgentPolicyResponse,
  CreatePackagePolicyRequest,
  CreatePackagePolicyResponse,
  GetAgentPoliciesRequest,
  GetAgentPoliciesResponse,
  GetAgentsResponse,
  GetInfoResponse,
  GetOneAgentPolicyResponse,
  GetOnePackagePolicyResponse,
  GetPackagePoliciesRequest,
  GetPackagePoliciesResponse,
  PackagePolicy,
  PostFleetSetupResponse,
  UpdatePackagePolicyResponse,
} from '@kbn/fleet-plugin/common';
import {
  AGENT_API_ROUTES,
  AGENT_POLICY_API_ROUTES,
  LEGACY_AGENT_POLICY_SAVED_OBJECT_TYPE,
  agentPolicyRouteService,
  agentRouteService,
  AGENTS_INDEX,
  API_VERSIONS,
  APP_API_ROUTES,
  epmRouteService,
  PACKAGE_POLICY_API_ROUTES,
  PACKAGE_POLICY_SAVED_OBJECT_TYPE,
  SETUP_API_ROUTE,
  packagePolicyRouteService,
} from '@kbn/fleet-plugin/common';
import type { ToolingLog } from '@kbn/tooling-log';
import type { KbnClient } from '@kbn/test';
import type { GetFleetServerHostsResponse } from '@kbn/fleet-plugin/common/types/rest_spec/fleet_server_hosts';
import {
  enrollmentAPIKeyRouteService,
  fleetServerHostsRoutesService,
  outputRoutesService,
} from '@kbn/fleet-plugin/common/services';
import type {
  CopyAgentPolicyRequest,
  DeleteAgentPolicyResponse,
  EnrollmentAPIKey,
  GenerateServiceTokenResponse,
  GetActionStatusResponse,
  GetAgentsRequest,
  GetEnrollmentAPIKeysResponse,
  GetOutputsResponse,
  PostAgentUnenrollResponse,
  UpdateAgentPolicyRequest,
  UpdateAgentPolicyResponse,
  PostNewAgentActionResponse,
  InstallPackageResponse,
  FleetServerAgent,
} from '@kbn/fleet-plugin/common/types';
import semver from 'semver';
import axios from 'axios';
import { userInfo } from 'os';
import pRetry from 'p-retry';
import { getPolicyDataForUpdate } from '../../../common/endpoint/service/policy';
import { fetchActiveSpace } from './spaces';
import { fetchKibanaStatus } from '../../../common/endpoint/utils/kibana_status';
import { isFleetServerRunning } from './fleet_server/fleet_server_services';
import { getEndpointPackageInfo } from '../../../common/endpoint/utils/package';
import type { DownloadAndStoreAgentResponse } from './agent_downloads_service';
import { downloadAndStoreAgent } from './agent_downloads_service';
import type { HostVm } from './types';
import {
  createToolingLogger,
  RETRYABLE_TRANSIENT_ERRORS,
  retryOnError,
} from '../../../common/endpoint/data_loaders/utils';
import { catchAxiosErrorFormatAndThrow } from '../../../common/endpoint/format_axios_error';
import { FleetAgentGenerator } from '../../../common/endpoint/data_generators/fleet_agent_generator';
import type { PolicyData } from '../../../common/endpoint/types';

const fleetGenerator = new FleetAgentGenerator();
const CURRENT_USERNAME = userInfo().username.toLowerCase();
const DEFAULT_AGENT_POLICY_NAME = `${CURRENT_USERNAME} test policy`;

/** A Fleet agent policy that includes integrations that don't actually require an agent to run on a host. Example: SenttinelOne */
export const DEFAULT_AGENTLESS_INTEGRATIONS_AGENT_POLICY_NAME = `${CURRENT_USERNAME} - agentless integrations`;

/**
 * Generate a random policy name
 */
export const randomAgentPolicyName = (() => {
  let counter = fleetGenerator.randomN(100);

  return (prefix: string = 'agent policy'): string => {
    return `${prefix} - ${fleetGenerator.randomString(10)}_${counter++}`;
  };
})();

/**
 * Check if the given version string is a valid artifact version
 * @param version Version string
 */
const isValidArtifactVersion = (version: string) => !!version.match(/^\d+\.\d+\.\d+(-SNAPSHOT)?$/);

const getAgentPolicyDataForUpdate = (
  agentPolicy: AgentPolicy
): UpdateAgentPolicyRequest['body'] => {
  return pick(agentPolicy, [
    'advanced_settings',
    'agent_features',
    'data_output_id',
    'description',
    'download_source_id',
    'fleet_server_host_id',
    'global_data_tags',
    'agentless',
    'has_fleet_server',
    'id',
    'inactivity_timeout',
    'is_default',
    'is_default_fleet_server',
    'is_managed',
    'is_protected',
    'keep_monitoring_alive',
    'monitoring_diagnostics',
    'monitoring_enabled',
    'monitoring_http',
    'monitoring_output_id',
    'monitoring_pprof_enabled',
    'name',
    'namespace',
    'overrides',
    'space_ids',
    'supports_agentless',
    'unenroll_timeout',
  ]) as UpdateAgentPolicyRequest['body'];
};

/**
 * Assigns an existing Fleet agent to a new policy.
 * NOTE: should only be used on mocked data.
 */
export const assignFleetAgentToNewPolicy = async ({
  esClient,
  kbnClient,
  agentId,
  newAgentPolicyId,
  logger = createToolingLogger(),
}: {
  esClient: Client;
  kbnClient: KbnClient;
  agentId: string;
  newAgentPolicyId: string;
  logger?: ToolingLog;
}): Promise<void> => {
  const agentPolicy = await fetchAgentPolicy(kbnClient, newAgentPolicyId);
  const update: Partial<FleetServerAgent> = {
    ...buildFleetAgentCheckInUpdate(),
    policy_id: newAgentPolicyId,
    namespaces: agentPolicy.space_ids ?? [],
  };

  logger.verbose(
    `update to agent id [${agentId}] showing assignment to new policy ID [${newAgentPolicyId}]:\n${JSON.stringify(
      update,
      null,
      2
    )}`
  );

  await esClient
    .update({
      index: AGENTS_INDEX,
      id: agentId,
      refresh: 'wait_for',
      retry_on_conflict: 5,
      doc: update,
    })
    .catch(catchAxiosErrorFormatAndThrow);
};

type FleetAgentCheckInUpdateDoc = Pick<
  FleetServerAgent,
  | 'last_checkin_status'
  | 'last_checkin'
  | 'active'
  | 'unenrollment_started_at'
  | 'unenrolled_at'
  | 'upgrade_started_at'
  | 'upgraded_at'
>;
const buildFleetAgentCheckInUpdate = (
  agentStatus: AgentStatus | 'random' = 'online'
): FleetAgentCheckInUpdateDoc => {
  const fleetAgentStatus =
    agentStatus === 'random' ? fleetGenerator.randomAgentStatus() : agentStatus;

  const update = pick(fleetGenerator.generateEsHitWithStatus(fleetAgentStatus)._source, [
    'last_checkin_status',
    'last_checkin',
    'active',
    'unenrollment_started_at',
    'unenrolled_at',
    'upgrade_started_at',
    'upgraded_at',
  ]) as FleetAgentCheckInUpdateDoc;

  // WORKAROUND: Endpoint API will exclude metadata for any fleet agent whose status is `inactive`,
  // which means once we update the Fleet agent with that status, the metadata api will no longer
  // return the endpoint host info.'s. So - we avoid that here.
  update.active = true;

  // Ensure any `undefined` value is set to `null` for the update
  Object.entries(update).forEach(([key, value]) => {
    if (value === undefined) {
      // @ts-expect-error TS7053 Element implicitly has an 'any' type
      update[key] = null;
    }
  });

  return update;
};

/**
 * Checks a Fleet agent in by updating the agent record directly in the `.fleet-agent` index.
 * @param esClient
 * @param agentId
 * @param agentStatus
 * @param log
 */
export const checkInFleetAgent = async (
  esClient: Client,
  agentId: string,
  {
    agentStatus = 'online',
    log = createToolingLogger(),
  }: Partial<{
    /** The agent status to be sent. If set to `random`, then one will be randomly generated */
    agentStatus: AgentStatus | 'random';
    log: ToolingLog;
  }> = {}
): Promise<estypes.UpdateResponse> => {
  const update = buildFleetAgentCheckInUpdate(agentStatus);

  log.verbose(
    `update to fleet agent [${agentId}][${agentStatus} / ${update.last_checkin_status}]: `,
    update
  );

  return esClient
    .update({
      index: AGENTS_INDEX,
      id: agentId,
      refresh: 'wait_for',
      retry_on_conflict: 5,
      doc: update,
    })
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Query Fleet Agents API
 *
 * @param kbnClient
 * @param options
 */
export const fetchFleetAgents = async (
  kbnClient: KbnClient,
  options: GetAgentsRequest['query']
): Promise<GetAgentsResponse> => {
  return kbnClient
    .request<GetAgentsResponse>({
      method: 'GET',
      path: AGENT_API_ROUTES.LIST_PATTERN,
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
      query: options,
    })
    .catch(catchAxiosErrorFormatAndThrow)
    .then((response) => response.data);
};

/**
 * Will keep querying Fleet list of agents until the given `hostname` shows up as healthy
 *
 * @param kbnClient
 * @param log
 * @param hostname
 * @param timeoutMs
 * @param esClient
 */
export const waitForHostToEnroll = async (
  kbnClient: KbnClient,
  log: ToolingLog,
  hostname: string,
  timeoutMs: number = 30000,
  esClient: Client | undefined = undefined
): Promise<Agent> => {
  log.info(`Waiting for host [${hostname}] to enroll with fleet`);

  const started = new Date();
  const hasTimedOut = (): boolean => {
    const elapsedTime = Date.now() - started.getTime();
    return elapsedTime > timeoutMs;
  };
  let found: Agent | undefined;
  let agentId: string | undefined;

  while (!found && !hasTimedOut()) {
    found = await retryOnError(
      async () =>
        fetchFleetAgents(kbnClient, {
          perPage: 1,
          kuery: `(local_metadata.host.hostname.keyword : "${hostname}")`,
          showInactive: false,
        }).then((response) => {
          agentId = response.items[0]?.id;
          return response.items.filter((agent) => agent.status === 'online')[0];
        }),
      RETRYABLE_TRANSIENT_ERRORS
    );

    if (!found) {
      // sleep and check again
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (!found) {
    throw Object.assign(
      new Error(
        `Timed out waiting for host [${hostname}] to show up in Fleet. Waited ${
          timeoutMs / 1000
        } seconds`
      ),
      { agentId, hostname }
    );
  }

  log.debug(`Host [${hostname}] has been enrolled with fleet`);
  log.verbose(found);

  // Workaround for united metadata sometimes being unable to find docs in .fleet-agents index. This
  // seems to be a timing issue with the index refresh.
  await esClient?.search({
    index: AGENTS_INDEX,
  });

  return found;
};

export const fetchFleetServerHostList = async (
  kbnClient: KbnClient
): Promise<GetFleetServerHostsResponse> => {
  return kbnClient
    .request<GetFleetServerHostsResponse>({
      method: 'GET',
      path: fleetServerHostsRoutesService.getListPath(),
      headers: {
        'elastic-api-version': '2023-10-31',
      },
    })
    .then((response) => response.data)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Returns the URL for the default Fleet Server connected to the stack
 * @param kbnClient
 */
export const fetchFleetServerUrl = async (kbnClient: KbnClient): Promise<string | undefined> => {
  const fleetServerListResponse = await fetchFleetServerHostList(kbnClient);

  // TODO:PT need to also pull in the Proxies and use that instead if defined for url?

  let url: string | undefined;

  for (const fleetServer of fleetServerListResponse.items) {
    if (!url || fleetServer.is_default) {
      url = fleetServer.host_urls[0];

      if (fleetServer.is_default) {
        break;
      }
    }
  }

  return url;
};

/**
 * Retrieve the API enrollment key for a given FLeet Agent Policy
 * @param kbnClient
 * @param agentPolicyId
 */
export const fetchAgentPolicyEnrollmentKey = async (
  kbnClient: KbnClient,
  agentPolicyId: string
): Promise<string | undefined> => {
  const apiKey: EnrollmentAPIKey | undefined = await kbnClient
    .request<GetEnrollmentAPIKeysResponse>({
      method: 'GET',
      path: enrollmentAPIKeyRouteService.getListPath(),
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
      query: { kuery: `policy_id: "${agentPolicyId}"` },
    })
    .catch(catchAxiosErrorFormatAndThrow)
    .then((response) => response.data.items[0]);

  if (!apiKey) {
    return;
  }

  return apiKey.api_key;
};

/**
 * Retrieves a list of Fleet Agent policies
 * @param kbnClient
 * @param options
 */
export const fetchAgentPolicyList = async (
  kbnClient: KbnClient,
  options: GetAgentPoliciesRequest['query'] = {}
) => {
  return kbnClient
    .request<GetAgentPoliciesResponse>({
      method: 'GET',
      path: agentPolicyRouteService.getListPath(),
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
      query: options,
    })
    .then((response) => response.data)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Fetch a single Fleet Agent Policy
 * @param kbnClient
 * @param agentPolicyId
 */
export const fetchAgentPolicy = async (
  kbnClient: KbnClient,
  agentPolicyId: string
): Promise<AgentPolicy> => {
  return kbnClient
    .request<GetOneAgentPolicyResponse>({
      method: 'GET',
      path: agentPolicyRouteService.getInfoPath(agentPolicyId),
      headers: { 'elastic-api-version': '2023-10-31' },
    })
    .then((response) => response.data.item)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Delete a single Fleet Agent Policy
 * @param kbnClient
 * @param agentPolicyId
 */
export const deleteAgentPolicy = async (
  kbnClient: KbnClient,
  agentPolicyId: string
): Promise<DeleteAgentPolicyResponse> => {
  return kbnClient
    .request<DeleteAgentPolicyResponse>({
      method: 'POST',
      path: agentPolicyRouteService.getDeletePath(),
      body: {
        agentPolicyId,
      },
      headers: { 'elastic-api-version': '2023-10-31' },
    })
    .then((response) => response.data)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Retrieves a list of Fleet Integration policies
 * @param kbnClient
 * @param options
 */
export const fetchIntegrationPolicyList = async (
  kbnClient: KbnClient,
  options: GetPackagePoliciesRequest['query'] = {}
): Promise<GetPackagePoliciesResponse> => {
  return kbnClient
    .request<GetPackagePoliciesResponse>({
      method: 'GET',
      path: PACKAGE_POLICY_API_ROUTES.LIST_PATTERN,
      headers: {
        'elastic-api-version': '2023-10-31',
      },
      query: options,
    })
    .then((response) => response.data)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Returns the Agent Version that matches the current stack version. Will use `SNAPSHOT` if
 * appropriate too.
 * @param kbnClient
 * @param log
 */
export const getAgentVersionMatchingCurrentStack = async (
  kbnClient: KbnClient,
  log: ToolingLog = createToolingLogger()
): Promise<string> => {
  const kbnStatus = await fetchKibanaStatus(kbnClient);

  log.debug(`Kibana status:\n`, kbnStatus);

  if (!kbnStatus.version) {
    throw new Error(
      `Kibana status api response did not include 'version' information - possibly due to invalid credentials`
    );
  }

  const agentVersions = await pRetry<string[]>(
    async () => {
      return axios
        .get('https://artifacts-api.elastic.co/v1/versions')
        .catch(catchAxiosErrorFormatAndThrow)
        .then((response) =>
          map(
            response.data.versions.filter(isValidArtifactVersion),
            (version) => version.split('-SNAPSHOT')[0]
          )
        );
    },
    { maxTimeout: 10000 }
  );

  let version =
    semver.maxSatisfying(agentVersions, `<=${kbnStatus.version.number}`) ??
    kbnStatus.version.number;

  // Add `-SNAPSHOT` if version indicates it was from a snapshot or the build hash starts
  // with `xxxxxxxxx` (value that seems to be present when running kibana from source)
  if (
    kbnStatus.version.build_snapshot ||
    kbnStatus.version.build_hash.startsWith('XXXXXXXXXXXXXXX')
  ) {
    version += '-SNAPSHOT';
  }

  return version;
};

// Generates a file name using system arch and an agent version.
export const getAgentFileName = (agentVersion: string): string => {
  const downloadArch =
    { arm64: 'arm64', x64: 'x86_64' }[process.arch as string] ??
    `UNSUPPORTED_ARCHITECTURE_${process.arch}`;
  return `elastic-agent-${agentVersion}-linux-${downloadArch}`;
};

interface ElasticArtifactSearchResponse {
  manifest: {
    'last-update-time': string;
    'seconds-since-last-update': number;
  };
  packages: {
    [packageFileName: string]: {
      architecture: string;
      os: string[];
      type: string;
      asc_url: string;
      sha_url: string;
      url: string;
    };
  };
}

interface GetAgentDownloadUrlResponse {
  url: string;
  /** The file name (ex. the `*.tar.gz` file) */
  fileName: string;
  /** The directory name that the download archive will be extracted to (same as `fileName` but no file extensions) */
  dirName: string;
}

/**
 * Retrieves the download URL to the Linux installation package for a given version of the Elastic Agent
 * @param version
 * @param closestMatch
 * @param log
 */
export const getAgentDownloadUrl = async (
  version: string,
  /**
   * When set to true a check will be done to determine the latest version of the agent that
   * is less than or equal to the `version` provided
   */
  closestMatch: boolean = false,
  log?: ToolingLog
): Promise<GetAgentDownloadUrlResponse> => {
  const agentVersion = closestMatch ? await getLatestAgentDownloadVersion(version, log) : version;

  const fileNameWithoutExtension = getAgentFileName(agentVersion);
  const agentFile = `${fileNameWithoutExtension}.tar.gz`;
  const artifactSearchUrl = `https://artifacts-api.elastic.co/v1/search/${agentVersion}/${agentFile}`;

  log?.verbose(`Retrieving elastic agent download URL from:\n    ${artifactSearchUrl}`);

  const searchResult: ElasticArtifactSearchResponse = await pRetry(
    async () => {
      return axios
        .get<ElasticArtifactSearchResponse>(artifactSearchUrl)
        .catch(catchAxiosErrorFormatAndThrow)
        .then((response) => {
          return response.data;
        });
    },
    { maxTimeout: 10000 }
  );

  log?.verbose(searchResult);

  if (!searchResult.packages[agentFile]) {
    throw new Error(`Unable to find an Agent download URL for version [${agentVersion}]`);
  }

  return {
    url: searchResult.packages[agentFile].url,
    fileName: agentFile,
    dirName: fileNameWithoutExtension,
  };
};

/**
 * Given a stack version number, function will return the closest Agent download version available
 * for download. THis could be the actual version passed in or lower.
 * @param version
 * @param log
 */
export const getLatestAgentDownloadVersion = async (
  version: string,
  log?: ToolingLog
): Promise<string> => {
  const artifactsUrl = 'https://artifacts-api.elastic.co/v1/versions';
  const semverMatch = `<=${version.replace(`-SNAPSHOT`, '')}`;
  const artifactVersionsResponse: { versions: string[] } = await pRetry(
    async () => {
      return axios
        .get<{ versions: string[] }>(artifactsUrl)
        .catch(catchAxiosErrorFormatAndThrow)
        .then((response) => {
          return response.data;
        });
    },
    { maxTimeout: 10000 }
  );

  const stackVersionToArtifactVersion: Record<string, string> = artifactVersionsResponse.versions
    .filter(isValidArtifactVersion)
    .reduce((acc, artifactVersion) => {
      const stackVersion = artifactVersion.split('-SNAPSHOT')[0];
      acc[stackVersion] = artifactVersion;
      return acc;
    }, {} as Record<string, string>);

  log?.verbose(
    `Versions found from [${artifactsUrl}]:\n${JSON.stringify(
      stackVersionToArtifactVersion,
      null,
      2
    )}`
  );

  const matchedVersion = semver.maxSatisfying(
    Object.keys(stackVersionToArtifactVersion),
    semverMatch
  );

  log?.verbose(`Matched [${matchedVersion}] for .maxStatisfying(${semverMatch})`);

  if (!matchedVersion) {
    throw new Error(`Unable to find a semver version that meets ${semverMatch}`);
  }

  return stackVersionToArtifactVersion[matchedVersion];
};

/**
 * Un-enrolls a Fleet agent
 *
 * @param kbnClient
 * @param agentId
 * @param force
 */
export const unEnrollFleetAgent = async (
  kbnClient: KbnClient,
  agentId: string,
  force = false
): Promise<PostAgentUnenrollResponse> => {
  const { data } = await kbnClient
    .request<PostAgentUnenrollResponse>({
      method: 'POST',
      path: agentRouteService.getUnenrollPath(agentId),
      body: { revoke: force },
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
    })
    .catch(catchAxiosErrorFormatAndThrow);

  return data;
};

/**
 * Un-enrolls a Fleet agent
 *
 * @param kbnClient
 * @param policyId
 */
export const getAgentPolicyEnrollmentKey = async (
  kbnClient: KbnClient,
  policyId: string
): Promise<string> => {
  const { data } = await kbnClient
    .request<GetEnrollmentAPIKeysResponse>({
      method: 'GET',
      path: enrollmentAPIKeyRouteService.getListPath(),
      query: {
        policy_id: policyId,
      },
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
    })
    .catch(catchAxiosErrorFormatAndThrow);

  return data.items?.[0]?.api_key;
};

export const generateFleetServiceToken = async (
  kbnClient: KbnClient,
  logger: ToolingLog
): Promise<string> => {
  logger.info(`Generating new Fleet Service Token`);

  const serviceToken: string = await kbnClient
    .request<GenerateServiceTokenResponse>({
      method: 'POST',
      path: APP_API_ROUTES.GENERATE_SERVICE_TOKEN_PATTERN,
      headers: { 'elastic-api-version': '2023-10-31' },
      body: {},
    })
    .then((response) => response.data.value)
    .catch(catchAxiosErrorFormatAndThrow);

  logger.verbose(`New service token created: ${serviceToken}`);

  return serviceToken;
};

export const fetchFleetOutputs = async (kbnClient: KbnClient): Promise<GetOutputsResponse> => {
  return kbnClient
    .request<GetOutputsResponse>({
      method: 'GET',
      path: outputRoutesService.getListPath(),
      headers: { 'elastic-api-version': '2023-10-31' },
    })
    .then((response) => response.data)
    .catch(catchAxiosErrorFormatAndThrow);
};

export const getFleetElasticsearchOutputHost = async (
  kbnClient: KbnClient,
  log: ToolingLog = createToolingLogger()
): Promise<string> => {
  const outputs = await fetchFleetOutputs(kbnClient);
  let host: string = '';

  for (const output of outputs.items) {
    if (output.type === 'elasticsearch') {
      host = output?.hosts?.[0] ?? '';
    }
  }

  if (!host) {
    log.error(`Outputs returned from Fleet:\n${JSON.stringify(outputs, null, 2)}`);
    throw new Error(`An output for Elasticsearch was not found in Fleet settings`);
  }

  return host;
};

interface EnrollHostVmWithFleetOptions {
  hostVm: HostVm;
  kbnClient: KbnClient;
  log: ToolingLog;
  /**
   * The Fleet Agent Policy ID that should be used to enroll the agent.
   * If undefined, then a default agent policy wil be created and used to enroll the host
   */
  agentPolicyId?: string;
  /** Agent version. Defaults to the version that the stack is running with */
  version?: string;
  closestVersionMatch?: boolean;
  useAgentCache?: boolean;
  timeoutMs?: number;
}

/**
 * Installs the Elastic agent on the provided Host VM and enrolls with it Fleet.
 *
 * NOTE: this method assumes that Fleet-Server is already setup and running.
 *
 * @param hostVm
 * @param kbnClient
 * @param log
 * @param agentPolicyId
 * @param version
 * @param closestVersionMatch
 * @param useAgentCache
 * @param timeoutMs
 */
export const enrollHostVmWithFleet = async ({
  hostVm,
  kbnClient,
  log,
  agentPolicyId,
  version,
  closestVersionMatch = true,
  useAgentCache = true,
  timeoutMs = 240000,
}: EnrollHostVmWithFleetOptions): Promise<Agent> => {
  log.info(`Enrolling host VM [${hostVm.name}] with Fleet`);

  if (!(await isFleetServerRunning(kbnClient))) {
    throw new Error(`Fleet server does not seem to be running on this instance of kibana!`);
  }

  const agentVersion = version || (await getAgentVersionMatchingCurrentStack(kbnClient));
  const agentUrlInfo = await getAgentDownloadUrl(agentVersion, closestVersionMatch, log);

  const agentDownload: DownloadAndStoreAgentResponse = useAgentCache
    ? await downloadAndStoreAgent(agentUrlInfo.url)
    : { url: agentUrlInfo.url, directory: '', filename: agentUrlInfo.fileName, fullFilePath: '' };

  log.info(`Installing Elastic Agent`);

  // For multipass, we need to place the Agent archive in the VM - either mounting local cache
  // directory or downloading it directly from inside of the VM.
  // For Vagrant, the archive is already in the VM - it was done during VM creation.
  if (hostVm.type === 'multipass') {
    if (useAgentCache) {
      const hostVmDownloadsDir = '/home/ubuntu/_agent_downloads';

      log.debug(
        `Mounting agents download cache directory [${agentDownload.directory}] to Host VM at [${hostVmDownloadsDir}]`
      );
      const downloadsMount = await hostVm.mount(agentDownload.directory, hostVmDownloadsDir);

      log.debug(`Extracting download archive on host VM`);
      await hostVm.exec(`tar -zxf ${downloadsMount.hostDir}/${agentDownload.filename}`);

      await downloadsMount.unmount();
    } else {
      log.debug(`Downloading Elastic Agent to host VM`);
      await hostVm.exec(`curl -L ${agentDownload.url} -o ${agentDownload.filename}`);

      log.debug(`Extracting download archive on host VM`);
      await hostVm.exec(`tar -zxf ${agentDownload.filename}`);
      await hostVm.exec(`rm -f ${agentDownload.filename}`);
    }
  }

  const policyId = agentPolicyId || (await getOrCreateDefaultAgentPolicy({ kbnClient, log })).id;
  const [fleetServerUrl, enrollmentToken] = await Promise.all([
    fetchFleetServerUrl(kbnClient),
    fetchAgentPolicyEnrollmentKey(kbnClient, policyId),
  ]);

  const agentEnrollCommand = [
    'sudo',

    `./${agentUrlInfo.dirName}/elastic-agent`,

    'install',

    '--insecure',

    '--force',

    '--url',
    fleetServerUrl,

    '--enrollment-token',
    enrollmentToken,
  ].join(' ');

  log.info(`Enrolling Elastic Agent with Fleet`);
  log.verbose('Enrollment command:', agentEnrollCommand);

  await hostVm.exec(agentEnrollCommand);

  return waitForHostToEnroll(kbnClient, log, hostVm.name, timeoutMs);
};

interface CreateAgentPolicyOptions {
  kbnClient: KbnClient;
  policy?: CreateAgentPolicyRequest['body'];
}

/**
 * Create a new Agent Policy in fleet
 * @param kbnClient
 * @param log
 * @param policy
 */
export const createAgentPolicy = async ({
  kbnClient,
  policy,
}: CreateAgentPolicyOptions): Promise<AgentPolicy> => {
  const body: CreateAgentPolicyRequest['body'] = policy ?? {
    name: randomAgentPolicyName(),
    description: `Policy created by security solution tooling: ${__filename}`,
    namespace: (await fetchActiveSpace(kbnClient)).id,
    monitoring_enabled: ['logs', 'metrics'],
  };

  return kbnClient
    .request<CreateAgentPolicyResponse>({
      path: AGENT_POLICY_API_ROUTES.CREATE_PATTERN,
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
      method: 'POST',
      body,
    })
    .then((response) => response.data.item)
    .catch(catchAxiosErrorFormatAndThrow);
};

interface GetOrCreateDefaultAgentPolicyOptions {
  kbnClient: KbnClient;
  log: ToolingLog;
  policyName?: string;
  overrides?: Partial<Omit<CreateAgentPolicyRequest['body'], 'name'>>;
}

/**
 * Creates a default Fleet Agent policy (if it does not yet exist) for testing. If
 * policy already exists, then it will be reused. It uses the policy name to find an
 * existing match.
 * @param kbnClient
 * @param log
 * @param policyName
 * @param overrides
 */
export const getOrCreateDefaultAgentPolicy = async ({
  kbnClient,
  log,
  policyName = DEFAULT_AGENT_POLICY_NAME,
  overrides = {},
}: GetOrCreateDefaultAgentPolicyOptions): Promise<AgentPolicy> => {
  const existingPolicy = await fetchAgentPolicyList(kbnClient, {
    kuery: `${LEGACY_AGENT_POLICY_SAVED_OBJECT_TYPE}.name: "${policyName}"`,
    withAgentCount: true,
  });

  if (existingPolicy.items[0]) {
    log.info(`Re-using existing Fleet test agent policy: [${existingPolicy.items[0].name}]`);
    log.verbose(existingPolicy.items[0]);

    return existingPolicy.items[0];
  }

  log.info(`Creating default test/dev Fleet agent policy with name: [${policyName}]`);

  const spaceId = (await fetchActiveSpace(kbnClient)).id;
  const newAgentPolicy = await createAgentPolicy({
    kbnClient,
    policy: {
      name: policyName,
      description: `Policy created by security solution tooling: ${__filename}`,
      namespace: spaceId.replace(/-/g, '_'),
      monitoring_enabled: ['logs', 'metrics'],
      ...overrides,
    },
  });

  log.verbose(newAgentPolicy);

  return newAgentPolicy;
};

/**
 * Creates a Fleet Integration Policy using the API
 * @param kbnClient
 * @param policyData
 */
export const createIntegrationPolicy = async (
  kbnClient: KbnClient,
  policyData: CreatePackagePolicyRequest['body']
): Promise<PackagePolicy> => {
  return kbnClient
    .request<CreatePackagePolicyResponse>({
      path: PACKAGE_POLICY_API_ROUTES.CREATE_PATTERN,
      method: 'POST',
      body: policyData,
      headers: {
        'elastic-api-version': '2023-10-31',
      },
    })
    .then((response) => response.data.item)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Gets package information from fleet
 * @param kbnClient
 * @param packageName
 */
export const fetchPackageInfo = async (
  kbnClient: KbnClient,
  packageName: string
): Promise<GetInfoResponse['item']> => {
  return kbnClient
    .request<GetInfoResponse>({
      path: epmRouteService.getInfoPath(packageName),
      headers: { 'Elastic-Api-Version': '2023-10-31' },
      method: 'GET',
    })
    .then((response) => response.data.item)
    .catch(catchAxiosErrorFormatAndThrow);
};

interface AddMicrosoftDefenderForEndpointToAgentPolicyOptions {
  kbnClient: KbnClient;
  log: ToolingLog;
  agentPolicyId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  integrationPolicyName?: string;
  /** Set to `true` if wanting to add the integration to the agent policy even if that agent policy already has one  */
  force?: boolean;
}

export const addMicrosoftDefenderForEndpointIntegrationToAgentPolicy = async ({
  kbnClient,
  log,
  agentPolicyId,
  tenantId,
  clientId,
  clientSecret,
  integrationPolicyName = `MS Defender for Endpoint policy (${Math.random()
    .toString()
    .substring(2, 6)})`,
  force,
}: AddMicrosoftDefenderForEndpointToAgentPolicyOptions): Promise<PackagePolicy> => {
  const msPackageName = 'microsoft_defender_endpoint';

  // If `force` is `false and agent policy already has a MS integration, exit here
  if (!force) {
    log.debug(
      `Checking to see if agent policy [${agentPolicyId}] already includes a Microsoft Defender for Endpoint integration policy`
    );

    const agentPolicy = await fetchAgentPolicy(kbnClient, agentPolicyId);

    log.verbose(agentPolicy);

    const integrationPolicies = agentPolicy.package_policies ?? [];

    for (const integrationPolicy of integrationPolicies) {
      if (integrationPolicy.package?.name === msPackageName) {
        log.debug(
          `Returning existing Microsoft Defender for Endpoint Integration Policy included in agent policy [${agentPolicyId}]`
        );
        return integrationPolicy;
      }
    }
  }

  const {
    version: packageVersion,
    name: packageName,
    title: packageTitle,
  } = await fetchPackageInfo(kbnClient, msPackageName);

  log.debug(
    `Creating new Microsoft Defender for Endpoint integration policy [package v${packageVersion}] and adding it to agent policy [${agentPolicyId}]`
  );

  return createIntegrationPolicy(kbnClient, {
    name: integrationPolicyName,
    description: `Created by script: ${__filename}`,
    policy_ids: [agentPolicyId],
    enabled: true,
    inputs: [
      {
        type: 'httpjson',
        policy_template: 'microsoft_defender_endpoint',
        enabled: true,
        streams: [
          {
            enabled: true,
            data_stream: {
              type: 'logs',
              dataset: 'microsoft_defender_endpoint.log',
            },
            vars: {
              client_id: {
                type: 'text',
                value: clientId,
              },
              enable_request_tracer: {
                value: false,
                type: 'bool',
              },
              client_secret: {
                type: 'password',
                value: clientSecret,
              },
              tenant_id: {
                type: 'text',
                value: tenantId,
              },
              initial_interval: {
                value: '5m',
                type: 'text',
              },
              interval: {
                value: '5m',
                type: 'text',
              },
              scopes: {
                value: [],
                type: 'text',
              },
              azure_resource: {
                value: 'https://api.securitycenter.windows.com/',
                type: 'text',
              },
              proxy_url: {
                type: 'text',
              },
              login_url: {
                value: 'https://login.microsoftonline.com/',
                type: 'text',
              },
              token_url: {
                value: 'oauth2/token',
                type: 'text',
              },
              request_url: {
                value: 'https://api.securitycenter.windows.com/api/alerts',
                type: 'text',
              },
              tags: {
                value: ['microsoft-defender-endpoint', 'forwarded'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
        ],
      },
      {
        type: 'logfile',
        policy_template: 'microsoft_defender_endpoint',
        enabled: false,
        streams: [
          {
            enabled: false,
            data_stream: {
              type: 'logs',
              dataset: 'microsoft_defender_endpoint.log',
            },
            vars: {
              paths: {
                value: [],
                type: 'text',
              },
              tags: {
                value: ['microsoft-defender-endpoint', 'forwarded'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
        ],
      },
      {
        type: 'cel',
        policy_template: 'microsoft_defender_endpoint',
        enabled: false,
        streams: [
          {
            enabled: false,
            data_stream: {
              type: 'logs',
              dataset: 'microsoft_defender_endpoint.machine',
            },
            vars: {
              interval: {
                value: '24h',
                type: 'text',
              },
              batch_size: {
                value: 1000,
                type: 'text',
              },
              http_client_timeout: {
                value: '30s',
                type: 'text',
              },
              enable_request_tracer: {
                value: false,
                type: 'bool',
              },
              tags: {
                value: ['forwarded', 'microsoft_defender_endpoint-machine'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              preserve_duplicate_custom_fields: {
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
          {
            enabled: false,
            data_stream: {
              type: 'logs',
              dataset: 'microsoft_defender_endpoint.machine_action',
            },
            vars: {
              initial_interval: {
                value: '24h',
                type: 'text',
              },
              interval: {
                value: '5m',
                type: 'text',
              },
              batch_size: {
                value: 1000,
                type: 'text',
              },
              http_client_timeout: {
                value: '30s',
                type: 'text',
              },
              enable_request_tracer: {
                value: false,
                type: 'bool',
              },
              tags: {
                value: ['forwarded', 'microsoft_defender_endpoint-machine_action'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              preserve_duplicate_custom_fields: {
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
          {
            enabled: false,
            data_stream: {
              type: 'logs',
              dataset: 'microsoft_defender_endpoint.vulnerability',
            },
            vars: {
              interval: {
                value: '4h',
                type: 'text',
              },
              batch_size: {
                value: 8000,
                type: 'integer',
              },
              affected_machines_only: {
                value: true,
                type: 'bool',
              },
              enable_request_tracer: {
                value: false,
                type: 'bool',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              tags: {
                value: ['forwarded', 'microsoft_defender_endpoint-vulnerability'],
                type: 'text',
              },
              http_client_timeout: {
                value: '30s',
                type: 'text',
              },
              preserve_duplicate_custom_fields: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
        ],
        vars: {
          client_id: {
            type: 'text',
          },
          client_secret: {
            type: 'password',
          },
          login_url: {
            value: 'https://login.microsoftonline.com',
            type: 'text',
          },
          url: {
            value: 'https://api.security.microsoft.com',
            type: 'text',
          },
          tenant_id: {
            type: 'text',
          },
          token_scopes: {
            value: ['https://securitycenter.onmicrosoft.com/windowsatpservice/.default'],
            type: 'text',
          },
          proxy_url: {
            type: 'text',
          },
          ssl: {
            value:
              '#certificate_authorities:\n#  - |\n#    -----BEGIN CERTIFICATE-----\n#    MIIDCjCCAfKgAwIBAgITJ706Mu2wJlKckpIvkWxEHvEyijANBgkqhkiG9w0BAQsF\n#    ADAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwIBcNMTkwNzIyMTkyOTA0WhgPMjExOTA2\n#    MjgxOTI5MDRaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEB\n#    BQADggEPADCCAQoCggEBANce58Y/JykI58iyOXpxGfw0/gMvF0hUQAcUrSMxEO6n\n#    fZRA49b4OV4SwWmA3395uL2eB2NB8y8qdQ9muXUdPBWE4l9rMZ6gmfu90N5B5uEl\n#    94NcfBfYOKi1fJQ9i7WKhTjlRkMCgBkWPkUokvBZFRt8RtF7zI77BSEorHGQCk9t\n#    /D7BS0GJyfVEhftbWcFEAG3VRcoMhF7kUzYwp+qESoriFRYLeDWv68ZOvG7eoWnP\n#    PsvZStEVEimjvK5NSESEQa9xWyJOmlOKXhkdymtcUd/nXnx6UTCFgnkgzSdTWV41\n#    CI6B6aJ9svCTI2QuoIq2HxX/ix7OvW1huVmcyHVxyUECAwEAAaNTMFEwHQYDVR0O\n#    BBYEFPwN1OceFGm9v6ux8G+DZ3TUDYxqMB8GA1UdIwQYMBaAFPwN1OceFGm9v6ux\n#    8G+DZ3TUDYxqMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAG5D\n#    874A4YI7YUwOVsVAdbWtgp1d0zKcPRR+r2OdSbTAV5/gcS3jgBJ3i1BN34JuDVFw\n#    3DeJSYT3nxy2Y56lLnxDeF8CUTUtVQx3CuGkRg1ouGAHpO/6OqOhwLLorEmxi7tA\n#    H2O8mtT0poX5AnOAhzVy7QW0D/k4WaoLyckM5hUa6RtvgvLxOwA0U+VGurCDoctu\n#    8F4QOgTAWyh8EZIwaKCliFRSynDpv3JTUwtfZkxo6K6nce1RhCWFAsMvDZL8Dgc0\n#    yvgJ38BRsFOtkRuAGSf6ZUwTO8JJRRIFnpUzXflAnGivK9M13D5GEQMmIl6U9Pvk\n#    sxSmbIUfc2SGJGCJD4I=\n#    -----END CERTIFICATE-----\n',
            type: 'yaml',
          },
        },
      },
    ],
    package: {
      name: packageName,
      title: packageTitle,
      version: packageVersion,
    },
  });
};

interface AddSentinelOneIntegrationToAgentPolicyOptions {
  kbnClient: KbnClient;
  log: ToolingLog;
  agentPolicyId: string;
  /** The URL to the SentinelOne Management console */
  consoleUrl: string;
  /** The SentinelOne API token */
  apiToken: string;
  integrationPolicyName?: string;
  /** Set to `true` if wanting to add the integration to the agent policy even if that agent policy already has one  */
  force?: boolean;
}

/**
 * Creates a Fleet SentinelOne Integration Policy and adds it to the provided Fleet Agent Policy.
 *
 * NOTE: by default, a new SentinelOne integration policy will only be created if one is not already
 * part of the provided Agent policy. Use `force` if wanting to still add it.
 *
 * @param kbnClient
 * @param log
 * @param agentPolicyId
 * @param consoleUrl
 * @param apiToken
 * @param integrationPolicyName
 * @param force
 */
export const addSentinelOneIntegrationToAgentPolicy = async ({
  kbnClient,
  log,
  agentPolicyId,
  consoleUrl,
  apiToken,
  integrationPolicyName = `SentinelOne policy (${Math.random().toString().substring(2, 6)})`,
  force = false,
}: AddSentinelOneIntegrationToAgentPolicyOptions): Promise<PackagePolicy> => {
  // If `force` is `false and agent policy already has a SentinelOne integration, exit here
  if (!force) {
    log.debug(
      `Checking to see if agent policy [] already includes a SentinelOne integration policy`
    );

    const agentPolicy = await fetchAgentPolicy(kbnClient, agentPolicyId);

    log.verbose(agentPolicy);

    const integrationPolicies = agentPolicy.package_policies ?? [];

    for (const integrationPolicy of integrationPolicies) {
      if (integrationPolicy.package?.name === 'sentinel_one') {
        log.debug(
          `Returning existing SentinelOne Integration Policy included in agent policy [${agentPolicyId}]`
        );
        return integrationPolicy;
      }
    }
  }

  const {
    version: packageVersion,
    name: packageName,
    title: packageTitle,
  } = await fetchPackageInfo(kbnClient, 'sentinel_one');

  log.debug(
    `Creating new SentinelOne integration policy [package v${packageVersion}] and adding it to agent policy [${agentPolicyId}]`
  );

  return createIntegrationPolicy(kbnClient, {
    name: integrationPolicyName,
    description: `Created by script: ${__filename}`,
    policy_id: agentPolicyId,
    policy_ids: [agentPolicyId],
    enabled: true,
    inputs: [
      {
        type: 'httpjson',
        policy_template: 'sentinel_one',
        enabled: true,
        streams: [
          {
            enabled: true,
            data_stream: {
              type: 'logs',
              dataset: 'sentinel_one.activity',
            },
            vars: {
              initial_interval: {
                value: '24h',
                type: 'text',
              },
              interval: {
                value: '30s',
                type: 'text',
              },
              tags: {
                value: ['forwarded', 'sentinel_one-activity'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
          {
            enabled: true,
            data_stream: {
              type: 'logs',
              dataset: 'sentinel_one.agent',
            },
            vars: {
              initial_interval: {
                value: '24h',
                type: 'text',
              },
              interval: {
                value: '30s',
                type: 'text',
              },
              tags: {
                value: ['forwarded', 'sentinel_one-agent'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
          {
            enabled: true,
            data_stream: {
              type: 'logs',
              dataset: 'sentinel_one.alert',
            },
            vars: {
              initial_interval: {
                value: '24h',
                type: 'text',
              },
              interval: {
                value: '30s',
                type: 'text',
              },
              tags: {
                value: ['forwarded', 'sentinel_one-alert'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
          {
            enabled: true,
            data_stream: {
              type: 'logs',
              dataset: 'sentinel_one.group',
            },
            vars: {
              initial_interval: {
                value: '24h',
                type: 'text',
              },
              interval: {
                value: '30s',
                type: 'text',
              },
              tags: {
                value: ['forwarded', 'sentinel_one-group'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
          {
            enabled: true,
            data_stream: {
              type: 'logs',
              dataset: 'sentinel_one.threat',
            },
            vars: {
              initial_interval: {
                value: '24h',
                type: 'text',
              },
              interval: {
                value: '30s',
                type: 'text',
              },
              tags: {
                value: ['forwarded', 'sentinel_one-threat'],
                type: 'text',
              },
              preserve_original_event: {
                value: false,
                type: 'bool',
              },
              processors: {
                type: 'yaml',
              },
            },
          },
        ],
        vars: {
          url: {
            type: 'text',
            value: consoleUrl,
          },
          enable_request_tracer: {
            type: 'bool',
          },
          api_token: {
            type: 'password',
            value: apiToken,
          },
          proxy_url: {
            type: 'text',
          },
          ssl: {
            value:
              '#certificate_authorities:\n#  - |\n#    -----BEGIN CERTIFICATE-----\n#    MIIDCjCCAfKgAwIBAgITJ706Mu2wJlKckpIvkWxEHvEyijANBgkqhkiG9w0BAQsF\n#    ADAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwIBcNMTkwNzIyMTkyOTA0WhgPMjExOTA2\n#    MjgxOTI5MDRaMBQxEjAQBgNVBAMMCWxvY2FsaG9zdDCCASIwDQYJKoZIhvcNAQEB\n#    BQADggEPADCCAQoCggEBANce58Y/JykI58iyOXpxGfw0/gMvF0hUQAcUrSMxEO6n\n#    fZRA49b4OV4SwWmA3395uL2eB2NB8y8qdQ9muXUdPBWE4l9rMZ6gmfu90N5B5uEl\n#    94NcfBfYOKi1fJQ9i7WKhTjlRkMCgBkWPkUokvBZFRt8RtF7zI77BSEorHGQCk9t\n#    /D7BS0GJyfVEhftbWcFEAG3VRcoMhF7kUzYwp+qESoriFRYLeDWv68ZOvG7eoWnP\n#    PsvZStEVEimjvK5NSESEQa9xWyJOmlOKXhkdymtcUd/nXnx6UTCFgnkgzSdTWV41\n#    CI6B6aJ9svCTI2QuoIq2HxX/ix7OvW1huVmcyHVxyUECAwEAAaNTMFEwHQYDVR0O\n#    BBYEFPwN1OceFGm9v6ux8G+DZ3TUDYxqMB8GA1UdIwQYMBaAFPwN1OceFGm9v6ux\n#    8G+DZ3TUDYxqMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAG5D\n#    874A4YI7YUwOVsVAdbWtgp1d0zKcPRR+r2OdSbTAV5/gcS3jgBJ3i1BN34JuDVFw\n#    3DeJSYT3nxy2Y56lLnxDeF8CUTUtVQx3CuGkRg1ouGAHpO/6OqOhwLLorEmxi7tA\n#    H2O8mtT0poX5AnOAhzVy7QW0D/k4WaoLyckM5hUa6RtvgvLxOwA0U+VGurCDoctu\n#    8F4QOgTAWyh8EZIwaKCliFRSynDpv3JTUwtfZkxo6K6nce1RhCWFAsMvDZL8Dgc0\n#    yvgJ38BRsFOtkRuAGSf6ZUwTO8JJRRIFnpUzXflAnGivK9M13D5GEQMmIl6U9Pvk\n#    sxSmbIUfc2SGJGCJD4I=\n#    -----END CERTIFICATE-----\n',
            type: 'yaml',
          },
        },
      },
    ],
    package: {
      name: packageName,
      title: packageTitle,
      version: packageVersion,
    },
  });
};

interface AddEndpointIntegrationToAgentPolicyOptions {
  kbnClient: KbnClient;
  log: ToolingLog;
  agentPolicyId: string;
  name?: string;
}

/**
 * Adds Endpoint integration to the Fleet agent policy provided on input
 * @param kbnClient
 * @param log
 * @param agentPolicyId
 * @param name
 */
export const addEndpointIntegrationToAgentPolicy = async ({
  kbnClient,
  log,
  agentPolicyId,
  name = `${CURRENT_USERNAME} test policy`,
}: AddEndpointIntegrationToAgentPolicyOptions): Promise<PackagePolicy> => {
  const agentPolicy = await fetchAgentPolicy(kbnClient, agentPolicyId);

  log.verbose('Agent policy', agentPolicy);

  const integrationPolicies = agentPolicy.package_policies ?? [];

  for (const integrationPolicy of integrationPolicies) {
    if (integrationPolicy.package?.name === 'endpoint') {
      log.debug(
        `Returning existing Endpoint Integration Policy included in agent policy [${agentPolicyId}]`
      );
      log.verbose(integrationPolicy);

      return integrationPolicy;
    }
  }

  const {
    version: packageVersion,
    name: packageName,
    title: packageTitle,
  } = await getEndpointPackageInfo(kbnClient);

  const newIntegrationPolicy = await createIntegrationPolicy(kbnClient, {
    name,
    description: `Created by: ${__filename}`,
    policy_id: agentPolicyId,
    policy_ids: [agentPolicyId],
    enabled: true,
    inputs: [
      {
        enabled: true,
        streams: [],
        type: 'ENDPOINT_INTEGRATION_CONFIG',
        config: {
          _config: {
            value: {
              type: 'endpoint',
              endpointConfig: {
                preset: 'EDRComplete',
              },
            },
          },
        },
      },
    ],
    package: {
      name: packageName,
      title: packageTitle,
      version: packageVersion,
    },
  });

  log.verbose(
    `New Endpoint integration policy created: Name[${name}], Id[${newIntegrationPolicy.id}]`
  );
  log.debug(newIntegrationPolicy);

  return newIntegrationPolicy;
};

type CopyAgentPolicyOptions = Partial<CopyAgentPolicyRequest['body']> & {
  kbnClient: KbnClient;
  agentPolicyId: string;
};

/**
 * Copy (clone) a Fleet Agent Policy
 * @param kbnClient
 * @param agentPolicyId
 * @param name
 * @param description
 */
export const copyAgentPolicy = async ({
  kbnClient,
  agentPolicyId,
  name = randomAgentPolicyName(),
  description,
}: CopyAgentPolicyOptions) => {
  return kbnClient
    .request<CopyAgentPolicyResponse>({
      path: agentPolicyRouteService.getCopyPath(agentPolicyId),
      headers: {
        'elastic-api-version': API_VERSIONS.public.v1,
      },
      method: 'POST',
      body: {
        name,
        description,
      },
    })
    .then((response) => response.data.item)
    .catch(catchAxiosErrorFormatAndThrow);
};

/**
 * Calls the fleet setup API to ensure fleet configured with default settings
 * @param kbnClient
 * @param log
 */
export const ensureFleetSetup = memoize(
  async (kbnClient: KbnClient, log: ToolingLog): Promise<PostFleetSetupResponse> => {
    const setupResponse = await kbnClient
      .request<PostFleetSetupResponse>({
        path: SETUP_API_ROUTE,
        headers: { 'Elastic-Api-Version': API_VERSIONS.public.v1 },
        method: 'POST',
      })
      .catch(catchAxiosErrorFormatAndThrow);

    if (!setupResponse.data.isInitialized) {
      log.verbose(`Fleet setup response:`, setupResponse);
      throw new Error(`Call to initialize Fleet [${SETUP_API_ROUTE}] failed`);
    }

    return setupResponse.data;
  }
);

/**
 * Fetches a list of Endpoint Integration policies from fleet
 * @param kbnClient
 * @param kuery
 * @param options
 */
export const fetchEndpointIntegrationPolicyList = async (
  kbnClient: KbnClient,
  { kuery, ...options }: GetPackagePoliciesRequest['query'] = {}
) => {
  const endpointPackageMatchValue = `${PACKAGE_POLICY_SAVED_OBJECT_TYPE}.package.name: endpoint`;

  return fetchIntegrationPolicyList(kbnClient, {
    ...options,
    kuery: kuery ? `${kuery} AND ${endpointPackageMatchValue}` : endpointPackageMatchValue,
  });
};

/**
 * Retrieves all Endpoint Integration policy IDs - but only up to 10k
 * @param kbnClient
 */
export const fetchAllEndpointIntegrationPolicyListIds = async (
  kbnClient: KbnClient
): Promise<string[]> => {
  const perPage = 1000;
  const policyIds = [];
  let hasMoreData = true;

  do {
    const result = await fetchEndpointIntegrationPolicyList(kbnClient, { perPage });
    policyIds.push(...result.items.map((policy) => policy.id));

    // If no more results or the next page of content goes over 10k, then end loop here.
    if (!result.items.length || policyIds.length + perPage < 10000) {
      hasMoreData = false;
    }
  } while (hasMoreData);

  return policyIds;
};

/**
 * Calls the Fleet internal API to enable space awareness
 * @param kbnClient
 */
export const enableFleetSpaceAwareness = memoize(async (kbnClient: KbnClient): Promise<void> => {
  await kbnClient
    .request({
      path: '/internal/fleet/enable_space_awareness',
      headers: { 'Elastic-Api-Version': '1' },
      method: 'POST',
    })
    .catch(catchAxiosErrorFormatAndThrow);
});

/**
 * Fetches a single integratino policy by id
 * @param kbnClient
 * @param policyId
 */
export const fetchIntegrationPolicy = async (
  kbnClient: KbnClient,
  policyId: string
): Promise<GetOnePackagePolicyResponse['item']> => {
  return kbnClient
    .request<GetOnePackagePolicyResponse>({
      path: packagePolicyRouteService.getInfoPath(policyId),
      method: 'GET',
      headers: { 'elastic-api-version': '2023-10-31' },
    })
    .catch(catchAxiosErrorFormatAndThrow)
    .then((response) => response.data.item);
};

/**
 * Update a fleet integration policy (aka: package policy)
 * @param kbnClient
 */
export const updateIntegrationPolicy = async (
  kbnClient: KbnClient,
  /** The Integration policy id */
  id: string,
  policyData: Partial<CreatePackagePolicyRequest['body']>,
  /** If set to `true`, then `policyData` can be a partial set of updates and not the full policy data */
  patch: boolean = false
): Promise<UpdatePackagePolicyResponse['item']> => {
  let fullPolicyData = policyData;

  if (patch) {
    const currentSavedPolicy = await fetchIntegrationPolicy(kbnClient, id);
    fullPolicyData = getPolicyDataForUpdate(currentSavedPolicy as PolicyData);
    Object.assign(fullPolicyData, policyData);
  }

  return kbnClient
    .request<UpdatePackagePolicyResponse>({
      path: packagePolicyRouteService.getUpdatePath(id),
      method: 'PUT',
      body: fullPolicyData,
      headers: { 'elastic-api-version': '2023-10-31' },
    })
    .catch(catchAxiosErrorFormatAndThrow)
    .then((response) => response.data.item);
};

/**
 * Updates a Fleet agent policy
 * @param kbnClient
 * @param id
 * @param policyData
 * @param patch
 */
export const updateAgentPolicy = async (
  kbnClient: KbnClient,
  /** Fleet Agent Policy ID */
  id: string,
  /** The updated agent policy data. Could be a `partial` update if `patch` arguments below is true */
  policyData: Partial<UpdateAgentPolicyRequest['body']>,
  /**
   * If set to `true`, the `policyData` provided on input will first be merged with the latest version
   * of the policy and then the updated applied
   */
  patch: boolean = false
): Promise<UpdateAgentPolicyResponse['item']> => {
  let fullPolicyData = policyData;

  if (patch) {
    const currentSavedPolicy = await fetchAgentPolicy(kbnClient, id);

    fullPolicyData = getAgentPolicyDataForUpdate(currentSavedPolicy);
    delete fullPolicyData.id;
    Object.assign(fullPolicyData, policyData);
  }

  return kbnClient
    .request<UpdateAgentPolicyResponse>({
      path: agentPolicyRouteService.getUpdatePath(id),
      method: 'PUT',
      body: fullPolicyData,
      headers: { 'elastic-api-version': '2023-10-31' },
    })
    .catch(catchAxiosErrorFormatAndThrow)
    .then((response) => response.data.item);
};

/**
 * Sets the log level on a Fleet agent and waits a bit of time to allow it for to
 * complete (but does not error if it does not complete)
 *
 * @param kbnClient
 * @param agentId
 * @param logLevel
 * @param log
 */
export const setAgentLoggingLevel = async (
  kbnClient: KbnClient,
  agentId: string,
  logLevel: 'debug' | 'info' | 'warning' | 'error',
  log: ToolingLog = createToolingLogger()
): Promise<PostNewAgentActionResponse> => {
  log.debug(`Setting fleet agent [${agentId}] logging level to [${logLevel}]`);

  const response = await kbnClient
    .request<PostNewAgentActionResponse>({
      method: 'POST',
      path: `/api/fleet/agents/${agentId}/actions`,
      body: { action: { type: 'SETTINGS', data: { log_level: logLevel } } },
      headers: { 'Elastic-Api-Version': API_VERSIONS.public.v1 },
    })
    .then((res) => res.data);

  // Wait to see if the action completes, but don't `throw` if it does not
  await waitForFleetAgentActionToComplete(kbnClient, response.item.id)
    .then(() => {
      log.debug(`Fleet action to set agent [${agentId}] logging level to [${logLevel}] completed!`);
    })
    .catch((err) => {
      log.debug(err.message);
    });

  return response;
};

/**
 * Retrieve fleet agent action statuses
 * @param kbnClient
 */
export const fetchFleetAgentActionStatus = async (
  kbnClient: KbnClient
): Promise<GetActionStatusResponse> => {
  return kbnClient
    .request<GetActionStatusResponse>({
      method: 'GET',
      path: agentRouteService.getActionStatusPath(),
      query: { perPage: 1000 },
      headers: { 'Elastic-Api-Version': API_VERSIONS.public.v1 },
    })
    .then((response) => response.data);
};

/**
 * Check and wait until a Fleet Agent action is complete.
 * @param kbnClient
 * @param actionId
 * @param timeout
 *
 * @throws
 */
export const waitForFleetAgentActionToComplete = async (
  kbnClient: KbnClient,
  actionId: string,
  timeout: number = 20_000
): Promise<void> => {
  await pRetry(
    async (attempts) => {
      const { items: actionList } = await fetchFleetAgentActionStatus(kbnClient);
      const actionInfo = actionList.find((action) => action.actionId === actionId);

      if (!actionInfo) {
        throw new Error(
          `Fleet Agent action id [${actionId}] was not found in list of actions retrieved from fleet!`
        );
      }

      if (actionInfo.status === 'IN_PROGRESS') {
        throw new Error(
          `Fleet agent action id [${actionId}] remains in progress after [${attempts}] attempts to check its status`
        );
      }
    },
    { maxTimeout: 2_000, maxRetryTime: timeout }
  );
};

/**
 * Installs an Integration in fleet, which ensures that all of its assets are configured
 * @param kbnClient
 * @param integrationName
 * @param version
 */
export const installIntegration = async (
  kbnClient: KbnClient,
  integrationName: string,
  version?: string
): Promise<InstallPackageResponse> => {
  return kbnClient
    .request<InstallPackageResponse>({
      method: 'POST',
      path: epmRouteService.getInstallPath(integrationName, version),
    })
    .catch(catchAxiosErrorFormatAndThrow)
    .then((response) => response.data);
};
