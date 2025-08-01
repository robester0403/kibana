/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EventEmitter } from 'events';

import { useExecutionContext, useKibana } from '@kbn/kibana-react-plugin/public';
import {
  useChromeVisibility,
  useSavedVisInstance,
  useVisualizeAppState,
  useEditorUpdates,
  useLinkedSearchUpdates,
  useDataViewUpdates,
} from '../utils';
import { VisualizeServices } from '../types';
import { VisualizeEditorCommon } from './visualize_editor_common';
import { VisualizeAppProps } from '../app';
import { VisualizeConstants } from '../../../common/constants';
import type { VisualizeInput } from '../..';

export const VisualizeEditor = ({ onAppLeave }: VisualizeAppProps) => {
  const { id: visualizationIdFromUrl } = useParams<{ id: string }>();
  const [originatingApp, setOriginatingApp] = useState<string>();
  const [originatingPath, setOriginatingPath] = useState<string>();
  const [embeddableIdValue, setEmbeddableId] = useState<string>();
  const [embeddableInput, setEmbeddableInput] = useState<VisualizeInput>();
  const { services } = useKibana<VisualizeServices>();
  const [eventEmitter] = useState(new EventEmitter());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(!visualizationIdFromUrl);

  const isChromeVisible = useChromeVisibility(services.chrome);
  useEffect(() => {
    const { stateTransferService, data } = services;
    const {
      originatingApp: value,
      searchSessionId,
      embeddableId,
      originatingPath: pathValue,
      valueInput: valueInputValue,
    } = stateTransferService.getIncomingEditorState(VisualizeConstants.APP_ID) || {};

    if (searchSessionId) {
      data.search.session.continue(searchSessionId);
    } else {
      data.search.session.start();
    }
    setEmbeddableInput(valueInputValue as VisualizeInput | undefined);
    setEmbeddableId(embeddableId);
    setOriginatingApp(value);
    setOriginatingPath(pathValue);
  }, [services]);
  const { savedVisInstance, visEditorRef, visEditorController } = useSavedVisInstance(
    services,
    eventEmitter,
    isChromeVisible,
    originatingApp,
    visualizationIdFromUrl,
    embeddableInput
  );

  const editorName = savedVisInstance?.vis.type.title.toLowerCase().replace(' ', '_') || '';
  useExecutionContext(services.executionContext, {
    type: 'application',
    page: `editor${editorName ? `:${editorName}` : ''}`,
    id: visualizationIdFromUrl || 'new',
  });

  const { appState, hasUnappliedChanges } = useVisualizeAppState(
    services,
    eventEmitter,
    savedVisInstance
  );
  const { isEmbeddableRendered, currentAppState } = useEditorUpdates(
    services,
    eventEmitter,
    setHasUnsavedChanges,
    appState,
    savedVisInstance,
    visEditorController
  );
  useLinkedSearchUpdates(services, eventEmitter, appState, savedVisInstance);
  useDataViewUpdates(services, eventEmitter, appState, savedVisInstance);

  useEffect(() => {
    // clean up all registered listeners if any is left
    return () => {
      eventEmitter.removeAllListeners();
    };
  }, [eventEmitter, services]);

  return (
    <VisualizeEditorCommon
      visInstance={savedVisInstance}
      appState={appState}
      currentAppState={currentAppState}
      isChromeVisible={isChromeVisible}
      hasUnsavedChanges={hasUnsavedChanges}
      hasUnappliedChanges={hasUnappliedChanges}
      isEmbeddableRendered={isEmbeddableRendered}
      originatingApp={originatingApp}
      setOriginatingApp={setOriginatingApp}
      originatingPath={originatingPath}
      visualizationIdFromUrl={visualizationIdFromUrl}
      setHasUnsavedChanges={setHasUnsavedChanges}
      visEditorRef={visEditorRef}
      onAppLeave={onAppLeave}
      embeddableId={embeddableIdValue}
      eventEmitter={eventEmitter}
    />
  );
};
