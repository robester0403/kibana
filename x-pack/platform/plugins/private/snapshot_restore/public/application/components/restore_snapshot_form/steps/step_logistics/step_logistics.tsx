/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { Fragment, useState, useMemo } from 'react';
import { FormattedMessage } from '@kbn/i18n-react';
import {
  EuiButtonEmpty,
  EuiDescribedFormGroup,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFieldText,
  EuiFormRow,
  EuiLink,
  EuiPanel,
  EuiSelectable,
  EuiSpacer,
  EuiSwitch,
  EuiSwitchEvent,
  EuiTitle,
  EuiCallOut,
  EuiComboBox,
  EuiComboBoxOptionOption,
} from '@elastic/eui';
import { EuiSelectableOption } from '@elastic/eui';

import { FEATURE_STATES_NONE_OPTION } from '../../../../../../common/constants';
import { csvToArray, isDataStreamBackingIndex } from '../../../../../../common/lib';
import { RestoreSettings } from '../../../../../../common/types';

import { useCore, useServices } from '../../../../app_context';

import { orderDataStreamsAndIndices } from '../../../lib';
import { DataStreamBadge } from '../../../data_stream_badge';

import { StepProps } from '..';

import { DataStreamsGlobalStateCallOut } from './data_streams_global_state_call_out';

import { DataStreamsAndIndicesListHelpText } from './data_streams_and_indices_list_help_text';

import { SystemIndicesOverwrittenCallOut } from './system_indices_overwritten_callout';

import { FeatureStatesFormField } from '../../../feature_states_form_field';

export type FeaturesOption = EuiComboBoxOptionOption<string>;

export const RestoreSnapshotStepLogistics: React.FunctionComponent<StepProps> = ({
  snapshotDetails,
  restoreSettings,
  updateRestoreSettings,
  errors,
}) => {
  const { i18n } = useServices();
  const { docLinks } = useCore();
  const {
    indices: unfilteredSnapshotIndices,
    dataStreams: snapshotDataStreams = [],
    includeGlobalState: snapshotIncludeGlobalState,
    versionId,
    featureStates: snapshotIncludeFeatureStates,
  } = snapshotDetails;

  const snapshotIndices = unfilteredSnapshotIndices.filter(
    (index) => !isDataStreamBackingIndex(index)
  );
  const snapshotIndicesAndDataStreams = snapshotIndices.concat(snapshotDataStreams);

  const comboBoxOptions = orderDataStreamsAndIndices<{
    label: string;
    value: { isDataStream: boolean; name: string };
  }>({
    dataStreams: snapshotDataStreams.map((dataStream) => ({
      label: dataStream,
      value: { isDataStream: true, name: dataStream },
    })),
    indices: snapshotIndices.map((index) => ({
      label: index,
      value: { isDataStream: false, name: index },
    })),
  });

  const {
    indices: restoreIndices,
    renamePattern,
    renameReplacement,
    partial,
    includeGlobalState,
    featureStates,
    includeAliases,
  } = restoreSettings;

  // States for choosing all indices, or a subset, including caching previously chosen subset list
  const [isAllIndicesAndDataStreams, setIsAllIndicesAndDataStreams] = useState<boolean>(
    !Boolean(restoreIndices)
  );
  const [indicesAndDataStreamsOptions, setIndicesAndDataStreamsOptions] = useState<
    EuiSelectableOption[]
  >(() =>
    orderDataStreamsAndIndices({
      dataStreams: snapshotDataStreams.map(
        (dataStream): EuiSelectableOption => ({
          label: dataStream,
          append: <DataStreamBadge />,
          checked:
            isAllIndicesAndDataStreams ||
            // If indices is a string, we default to custom input mode, so we mark individual indices
            // as selected if user goes back to list mode
            typeof restoreIndices === 'string' ||
            (Array.isArray(restoreIndices) && restoreIndices.includes(dataStream))
              ? 'on'
              : undefined,
        })
      ),
      indices: snapshotIndices.map(
        (index): EuiSelectableOption => ({
          label: index,
          checked:
            isAllIndicesAndDataStreams ||
            // If indices is a string, we default to custom input mode, so we mark individual indices
            // as selected if user goes back to list mode
            typeof restoreIndices === 'string' ||
            (Array.isArray(restoreIndices) && restoreIndices.includes(index))
              ? 'on'
              : undefined,
        })
      ),
    })
  );

  // State for using selectable indices list or custom patterns
  // Users with more than 100 indices will probably want to use an index pattern to select
  // them instead, so we'll default to showing them the index pattern input.
  const [selectIndicesMode, setSelectIndicesMode] = useState<'list' | 'custom'>(
    typeof restoreIndices === 'string' || snapshotIndicesAndDataStreams.length > 100
      ? 'custom'
      : 'list'
  );

  // State for custom patterns
  const [restoreIndexPatterns, setRestoreIndexPatterns] = useState<string[]>(
    typeof restoreIndices === 'string' ? restoreIndices.split(',') : []
  );

  // State for setting renaming indices patterns
  const [isRenamingIndices, setIsRenamingIndices] = useState<boolean>(
    Boolean(renamePattern || renameReplacement)
  );

  // Caching state for togglable settings
  const [cachedRestoreSettings, setCachedRestoreSettings] = useState<RestoreSettings>({
    indices: [...snapshotIndicesAndDataStreams],
    renamePattern: '',
    renameReplacement: '',
  });

  const selectedFeatureStateOptions = useMemo(() => {
    return featureStates?.map((feature) => ({ label: feature })) as FeaturesOption[];
  }, [featureStates]);

  const isFeatureStatesToggleEnabled =
    featureStates !== undefined && !featureStates?.includes(FEATURE_STATES_NONE_OPTION);

  const onFeatureStatesToggleChange = (event: EuiSwitchEvent) => {
    const { checked } = event.target;

    updateRestoreSettings({
      featureStates: checked ? [] : [FEATURE_STATES_NONE_OPTION],
    });
  };

  return (
    <div
      data-test-subj="snapshotRestoreStepLogistics"
      className="snapshotRestore__restoreForm__stepLogistics"
    >
      {/* Step title and doc link */}
      <EuiFlexGroup justifyContent="spaceBetween">
        <EuiFlexItem grow={false}>
          <EuiTitle>
            <h2>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogisticsTitle"
                defaultMessage="Restore details"
              />
            </h2>
          </EuiTitle>
        </EuiFlexItem>

        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            size="s"
            flush="right"
            href={docLinks.links.snapshotRestore.restoreSnapshot}
            target="_blank"
            iconType="question"
          >
            <FormattedMessage
              id="xpack.snapshotRestore.restoreForm.stepLogistics.docsButtonLabel"
              defaultMessage="Snapshot and Restore docs"
            />
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>

      {snapshotDataStreams.length ? (
        <>
          <EuiSpacer size="m" />
          <DataStreamsGlobalStateCallOut dataStreamsCount={snapshotDataStreams.length} />
        </>
      ) : undefined}

      <EuiSpacer size="l" />

      {/* Indices */}
      <EuiDescribedFormGroup
        title={
          <EuiTitle size="s">
            <h3>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.dataStreamsAndIndicesTitle"
                defaultMessage="Data streams and indices"
              />
            </h3>
          </EuiTitle>
        }
        description={
          <FormattedMessage
            id="xpack.snapshotRestore.restoreForm.stepLogistics.dataStreamsAndIndicesDescription"
            defaultMessage="Creates new data streams and indices if they don’t exist. Opens existing indices, including backing indices for a data stream,
              if they are closed and have the same number of shards as the snapshot index."
          />
        }
        fullWidth
      >
        <EuiFormRow fullWidth>
          <Fragment>
            <EuiSwitch
              label={
                <FormattedMessage
                  id="xpack.snapshotRestore.restoreForm.stepLogistics.allDataStreamsAndIndicesLabel"
                  defaultMessage="All data streams and indices"
                />
              }
              checked={isAllIndicesAndDataStreams}
              onChange={(e) => {
                const isChecked = e.target.checked;
                setIsAllIndicesAndDataStreams(isChecked);
                if (isChecked) {
                  updateRestoreSettings({ indices: undefined });
                } else {
                  updateRestoreSettings({
                    indices:
                      selectIndicesMode === 'custom'
                        ? restoreIndexPatterns.join(',')
                        : [...(cachedRestoreSettings.indices || [])],
                  });
                }
              }}
              data-test-subj="allDsAndIndicesToggle"
            />
            {isAllIndicesAndDataStreams ? null : (
              <Fragment>
                <EuiSpacer size="m" />
                <EuiFormRow
                  className="snapshotRestore__restoreForm__stepLogistics__indicesFieldWrapper"
                  label={
                    selectIndicesMode === 'list' ? (
                      <EuiFlexGroup justifyContent="spaceBetween">
                        <EuiFlexItem grow={false}>
                          <FormattedMessage
                            id="xpack.snapshotRestore.restoreForm.stepLogistics.selectDataStreamsAndIndicesLabel"
                            defaultMessage="Select data streams and indices"
                          />
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                          <EuiLink
                            onClick={() => {
                              setSelectIndicesMode('custom');
                              updateRestoreSettings({ indices: restoreIndexPatterns.join(',') });
                            }}
                            data-test-subj="restoreIndexPatternsButton"
                          >
                            <FormattedMessage
                              id="xpack.snapshotRestore.restoreForm.stepLogistics.indicesToggleCustomLink"
                              defaultMessage="Use index patterns"
                            />
                          </EuiLink>
                        </EuiFlexItem>
                      </EuiFlexGroup>
                    ) : (
                      <EuiFlexGroup justifyContent="spaceBetween">
                        <EuiFlexItem grow={false}>
                          <FormattedMessage
                            id="xpack.snapshotRestore.restoreForm.stepLogistics.indicesPatternLabel"
                            defaultMessage="Index patterns"
                          />
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                          <EuiLink
                            onClick={() => {
                              setSelectIndicesMode('list');
                              updateRestoreSettings({ indices: cachedRestoreSettings.indices });
                            }}
                          >
                            <FormattedMessage
                              id="xpack.snapshotRestore.restoreForm.stepLogistics.dataStreamsAndIndicesToggleListLink"
                              defaultMessage="Select data streams and indices"
                            />
                          </EuiLink>
                        </EuiFlexItem>
                      </EuiFlexGroup>
                    )
                  }
                  helpText={
                    selectIndicesMode === 'list' ? (
                      <DataStreamsAndIndicesListHelpText
                        onSelectionChange={(selection) => {
                          if (selection === 'all') {
                            // TODO: Change this to setIndicesOptions() when https://github.com/elastic/eui/issues/2071 is fixed
                            indicesAndDataStreamsOptions.forEach((option: EuiSelectableOption) => {
                              option.checked = 'on';
                            });
                            updateRestoreSettings({
                              indices: [...snapshotIndicesAndDataStreams],
                            });
                            setCachedRestoreSettings({
                              ...cachedRestoreSettings,
                              indices: [...snapshotIndicesAndDataStreams],
                            });
                          } else {
                            // TODO: Change this to setIndicesOptions() when https://github.com/elastic/eui/issues/2071 is fixed
                            indicesAndDataStreamsOptions.forEach((option: EuiSelectableOption) => {
                              option.checked = undefined;
                            });
                            updateRestoreSettings({ indices: [] });
                            setCachedRestoreSettings({
                              ...cachedRestoreSettings,
                              indices: [],
                            });
                          }
                        }}
                        selectedIndicesAndDataStreams={csvToArray(restoreIndices) ?? []}
                        indices={snapshotIndices}
                        dataStreams={snapshotDataStreams}
                      />
                    ) : null
                  }
                  isInvalid={Boolean(errors.indices)}
                  error={errors.indices}
                >
                  {selectIndicesMode === 'list' ? (
                    <EuiSelectable
                      allowExclusions={false}
                      options={indicesAndDataStreamsOptions}
                      onChange={(options) => {
                        const newSelectedIndices: string[] = [];
                        options.forEach(({ label, checked }) => {
                          if (checked === 'on') {
                            newSelectedIndices.push(label);
                          }
                        });
                        setIndicesAndDataStreamsOptions(options);
                        updateRestoreSettings({ indices: [...newSelectedIndices] });
                        setCachedRestoreSettings({
                          ...cachedRestoreSettings,
                          indices: [...newSelectedIndices],
                        });
                      }}
                      searchable
                      height={300}
                    >
                      {(list, search) => (
                        <EuiPanel paddingSize="s" hasShadow={false}>
                          {search}
                          {list}
                        </EuiPanel>
                      )}
                    </EuiSelectable>
                  ) : (
                    <EuiComboBox
                      options={comboBoxOptions}
                      renderOption={({ value }) => {
                        return value?.isDataStream ? (
                          <EuiFlexGroup
                            responsive={false}
                            justifyContent="spaceBetween"
                            alignItems="center"
                            gutterSize="none"
                          >
                            <EuiFlexItem>{value.name}</EuiFlexItem>
                            <EuiFlexItem grow={false}>
                              <DataStreamBadge />
                            </EuiFlexItem>
                          </EuiFlexGroup>
                        ) : (
                          value?.name
                        );
                      }}
                      placeholder={i18n.translate(
                        'xpack.snapshotRestore.restoreForm.stepLogistics.indicesPatternPlaceholder',
                        {
                          defaultMessage: 'Enter index patterns, i.e. logstash-*',
                        }
                      )}
                      selectedOptions={restoreIndexPatterns.map((pattern) => ({ label: pattern }))}
                      onCreateOption={(pattern: string) => {
                        if (!pattern.trim().length) {
                          return;
                        }
                        const newPatterns = [...restoreIndexPatterns, pattern];
                        setRestoreIndexPatterns(newPatterns);
                        updateRestoreSettings({
                          indices: newPatterns.join(','),
                        });
                      }}
                      onChange={(patterns: Array<{ label: string }>) => {
                        const newPatterns = patterns.map(({ label }) => label);
                        setRestoreIndexPatterns(newPatterns);
                        updateRestoreSettings({
                          indices: newPatterns.join(','),
                        });
                      }}
                    />
                  )}
                </EuiFormRow>
              </Fragment>
            )}
          </Fragment>
        </EuiFormRow>
      </EuiDescribedFormGroup>

      {/* Rename data streams and indices */}
      <EuiDescribedFormGroup
        title={
          <EuiTitle size="s">
            <h3>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.renameDataStreamsAndIndicesTitle"
                defaultMessage="Rename data streams and indices"
              />
            </h3>
          </EuiTitle>
        }
        description={
          <FormattedMessage
            id="xpack.snapshotRestore.restoreForm.stepLogistics.renameDataStreamsAndIndicesDescription"
            defaultMessage="Renames data streams and indices on restore. Ensure that a matching index template exists for renamed data streams."
          />
        }
        fullWidth
      >
        <EuiFormRow fullWidth>
          <Fragment>
            <EuiSwitch
              label={
                <FormattedMessage
                  id="xpack.snapshotRestore.restoreForm.stepLogistics.renameDataStreamsAndIndicesLabel"
                  defaultMessage="Rename data streams and indices"
                />
              }
              checked={isRenamingIndices}
              onChange={(e) => {
                const isChecked = e.target.checked;
                setIsRenamingIndices(isChecked);
                if (isChecked) {
                  updateRestoreSettings({
                    renamePattern: cachedRestoreSettings.renamePattern,
                    renameReplacement: cachedRestoreSettings.renameReplacement,
                  });
                } else {
                  updateRestoreSettings({
                    renamePattern: undefined,
                    renameReplacement: undefined,
                  });
                }
              }}
              data-test-subj="restoreRenameToggle"
            />
            {!isRenamingIndices ? null : (
              <Fragment>
                <EuiSpacer size="m" />
                <EuiFlexGroup>
                  <EuiFlexItem>
                    <EuiFormRow
                      label={
                        <FormattedMessage
                          id="xpack.snapshotRestore.restoreForm.stepLogistics.renamePatternLabel"
                          defaultMessage="Capture pattern"
                        />
                      }
                      helpText={
                        <FormattedMessage
                          id="xpack.snapshotRestore.restoreForm.stepLogistics.renamePatternHelpText"
                          defaultMessage="Use regular expressions"
                        />
                      }
                      isInvalid={Boolean(errors.renamePattern)}
                      error={errors.renamePattern}
                    >
                      <EuiFieldText
                        isInvalid={Boolean(errors.renamePattern)}
                        value={renamePattern}
                        placeholder="data_(.+)"
                        onChange={(e) => {
                          setCachedRestoreSettings({
                            ...cachedRestoreSettings,
                            renamePattern: e.target.value,
                          });
                          updateRestoreSettings({
                            renamePattern: e.target.value,
                          });
                        }}
                        data-test-subj="capturePattern"
                      />
                    </EuiFormRow>
                  </EuiFlexItem>
                  <EuiFlexItem>
                    <EuiFormRow
                      label={
                        <FormattedMessage
                          id="xpack.snapshotRestore.restoreForm.stepLogistics.renameReplacementLabel"
                          defaultMessage="Replacement pattern"
                        />
                      }
                      isInvalid={Boolean(errors.renameReplacement)}
                      error={errors.renameReplacement}
                    >
                      <EuiFieldText
                        isInvalid={Boolean(errors.renameReplacement)}
                        value={renameReplacement}
                        placeholder="restored_data_$1"
                        onChange={(e) => {
                          setCachedRestoreSettings({
                            ...cachedRestoreSettings,
                            renameReplacement: e.target.value,
                          });
                          updateRestoreSettings({
                            renameReplacement: e.target.value,
                          });
                        }}
                        data-test-subj="replacementPattern"
                      />
                    </EuiFormRow>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </Fragment>
            )}
          </Fragment>
        </EuiFormRow>
      </EuiDescribedFormGroup>

      {/* Partial restore */}
      <EuiDescribedFormGroup
        title={
          <EuiTitle size="s">
            <h3>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.partialTitle"
                defaultMessage="Partial restore"
              />
            </h3>
          </EuiTitle>
        }
        description={
          <FormattedMessage
            id="xpack.snapshotRestore.restoreForm.stepLogistics.partialDescription"
            defaultMessage="Allows restore of indices that don’t have snapshots of all shards."
          />
        }
        fullWidth
      >
        <EuiFormRow fullWidth>
          <EuiSwitch
            label={
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.partialLabel"
                defaultMessage="Partial restore"
              />
            }
            checked={partial === undefined ? false : partial}
            onChange={(e) => updateRestoreSettings({ partial: e.target.checked })}
          />
        </EuiFormRow>
      </EuiDescribedFormGroup>

      {/* Include global state */}
      <EuiDescribedFormGroup
        title={
          <EuiTitle size="s">
            <h3>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeGlobalStateTitle"
                defaultMessage="Restore global state"
              />
            </h3>
          </EuiTitle>
        }
        description={
          <FormattedMessage
            id="xpack.snapshotRestore.restoreForm.stepLogistics.includeGlobalStateDescription"
            defaultMessage="Restores the global cluster state as part of the snapshot."
          />
        }
        fullWidth
      >
        <EuiFormRow
          fullWidth
          helpText={
            snapshotIncludeGlobalState ? null : (
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeGlobalStateDisabledDescription"
                defaultMessage="Not available for this snapshot."
              />
            )
          }
        >
          <EuiSwitch
            label={
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeGlobalStateLabel"
                defaultMessage="Restore global state"
              />
            }
            checked={includeGlobalState === undefined ? false : includeGlobalState}
            onChange={(e) => updateRestoreSettings({ includeGlobalState: e.target.checked })}
            disabled={!snapshotIncludeGlobalState}
            data-test-subj="includeGlobalStateSwitch"
          />
        </EuiFormRow>
      </EuiDescribedFormGroup>

      {/* Include feature states */}
      <EuiDescribedFormGroup
        title={
          <EuiTitle size="s">
            <h3>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeFeatureStatesTitle"
                defaultMessage="Restore feature state"
              />
            </h3>
          </EuiTitle>
        }
        description={
          <>
            <FormattedMessage
              id="xpack.snapshotRestore.restoreForm.stepLogistics.includeFeatureStatesDescription"
              defaultMessage="Restores the configuration, history, and other data stored in Elasticsearch by a feature such as Elasticsearch security."
            />

            {/* Only display callout if includeFeatureState is enabled and the snapshot was created by ES 7.12+
            The versionId field represents the build id of the ES version. We check if the current ES version is >7.12
            by comparing its build id with the build id of ES 7.12, which is 7120099. */}
            {versionId > 7120099 && isFeatureStatesToggleEnabled && (
              <>
                <EuiSpacer size="s" />
                <SystemIndicesOverwrittenCallOut featureStates={restoreSettings?.featureStates} />
              </>
            )}
          </>
        }
        fullWidth
      >
        <EuiFormRow
          fullWidth
          helpText={
            snapshotIncludeFeatureStates ? null : (
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeFeatureStatesDisabledDescription"
                defaultMessage="Not available for this snapshot."
              />
            )
          }
        >
          <EuiSwitch
            label={
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.restoreFeatureStatesLabel"
                defaultMessage="Restore feature state from"
              />
            }
            checked={isFeatureStatesToggleEnabled}
            onChange={onFeatureStatesToggleChange}
            disabled={snapshotIncludeFeatureStates?.length === 0}
            data-test-subj="includeFeatureStatesSwitch"
          />
        </EuiFormRow>

        {isFeatureStatesToggleEnabled && (
          <>
            <EuiSpacer size="m" />
            <FeatureStatesFormField
              featuresOptions={snapshotIncludeFeatureStates}
              selectedOptions={selectedFeatureStateOptions}
              onUpdateFormSettings={updateRestoreSettings}
            />
          </>
        )}
        {snapshotIncludeFeatureStates?.length === 0 && (
          <>
            <EuiSpacer size="m" />
            <EuiCallOut
              size="s"
              iconType="question"
              color="warning"
              data-test-subj="noFeatureStatesCallout"
              title={i18n.translate(
                'xpack.snapshotRestore.restoreForm.stepLogistics.noFeatureStates',
                { defaultMessage: 'No feature states are included in this snapshot.' }
              )}
            />
          </>
        )}
      </EuiDescribedFormGroup>

      {/* Include aliases */}
      <EuiDescribedFormGroup
        title={
          <EuiTitle size="s">
            <h3>
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeAliasesTitle"
                defaultMessage="Restore aliases"
              />
            </h3>
          </EuiTitle>
        }
        description={
          <FormattedMessage
            id="xpack.snapshotRestore.restoreForm.stepLogistics.includeAliasesDescription"
            defaultMessage="Restores index aliases along with their associated indices."
          />
        }
        fullWidth
      >
        <EuiFormRow fullWidth>
          <EuiSwitch
            label={
              <FormattedMessage
                id="xpack.snapshotRestore.restoreForm.stepLogistics.includeAliasesLabel"
                defaultMessage="Restore aliases"
              />
            }
            checked={includeAliases === undefined ? true : includeAliases}
            onChange={(e) => updateRestoreSettings({ includeAliases: e.target.checked })}
            data-test-subj="includeAliasesSwitch"
          />
        </EuiFormRow>
      </EuiDescribedFormGroup>
    </div>
  );
};
