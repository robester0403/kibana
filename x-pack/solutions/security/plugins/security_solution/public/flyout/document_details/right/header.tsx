/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EuiFlyoutHeader } from '@elastic/eui';
import { EuiSpacer, EuiTab } from '@elastic/eui';
import type { FC } from 'react';
import React, { memo } from 'react';
import type { RightPanelPaths } from '.';
import type { RightPanelTabType } from './tabs';
import { FlyoutHeader } from '../../shared/components/flyout_header';
import { FlyoutHeaderTabs } from '../../shared/components/flyout_header_tabs';
import { AlertHeaderTitle } from './components/alert_header_title';
import { EventHeaderTitle } from './components/event_header_title';
import { useDocumentDetailsContext } from '../shared/context';
import { useBasicDataFromDetailsData } from '../shared/hooks/use_basic_data_from_details_data';

export interface PanelHeaderProps extends React.ComponentProps<typeof EuiFlyoutHeader> {
  /**
   * Id of the tab selected in the parent component to display its content
   */
  selectedTabId: RightPanelPaths;
  /**
   * Callback to set the selected tab id in the parent component
   * @param selected
   */
  setSelectedTabId: (selected: RightPanelPaths) => void;
  /**
   * Tabs to display in the header
   */
  tabs: RightPanelTabType[];
}

export const PanelHeader: FC<PanelHeaderProps> = memo(
  ({ selectedTabId, setSelectedTabId, tabs, ...flyoutHeaderProps }) => {
    const { dataFormattedForFieldBrowser } = useDocumentDetailsContext();
    const { isAlert } = useBasicDataFromDetailsData(dataFormattedForFieldBrowser);
    const onSelectedTabChanged = (id: RightPanelPaths) => setSelectedTabId(id);

    const renderTabs = tabs.map((tab, index) =>
      isAlert && tab.id === 'overview' ? (
        <EuiTab
          onClick={() => onSelectedTabChanged(tab.id)}
          isSelected={tab.id === selectedTabId}
          key={index}
          data-test-subj={tab['data-test-subj']}
        >
          {tab.name}
        </EuiTab>
      ) : (
        <EuiTab
          onClick={() => onSelectedTabChanged(tab.id)}
          isSelected={tab.id === selectedTabId}
          key={index}
          data-test-subj={tab['data-test-subj']}
        >
          {tab.name}
        </EuiTab>
      )
    );

    return (
      <FlyoutHeader {...flyoutHeaderProps}>
        {isAlert ? <AlertHeaderTitle /> : <EventHeaderTitle />}
        <EuiSpacer size="m" />
        <FlyoutHeaderTabs>{renderTabs}</FlyoutHeaderTabs>
      </FlyoutHeader>
    );
  }
);

PanelHeader.displayName = 'PanelHeader';
