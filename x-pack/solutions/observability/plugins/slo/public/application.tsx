/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { APP_WRAPPER_CLASS, AppMountParameters, CoreStart } from '@kbn/core/public';
import { PerformanceContextProvider } from '@kbn/ebt-tools';
import { i18n } from '@kbn/i18n';
import { KibanaContextProvider } from '@kbn/kibana-react-plugin/public';
import { Storage } from '@kbn/kibana-utils-plugin/public';
import { ObservabilityRuleTypeRegistry } from '@kbn/observability-plugin/public';
import type { LazyObservabilityPageTemplateProps } from '@kbn/observability-shared-plugin/public';
import { RedirectAppLinks } from '@kbn/shared-ux-link-redirect-app';
import { Route, Router, Routes } from '@kbn/shared-ux-router';
import { UsageCollectionSetup } from '@kbn/usage-collection-plugin/public';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom';
import { ExperimentalFeatures } from '../common/config';
import { PluginContext } from './context/plugin_context';
import { usePluginContext } from './hooks/use_plugin_context';
import { getRoutes } from './routes/routes';
import { SLOPublicPluginsStart, SLORepositoryClient } from './types';

interface Props {
  core: CoreStart;
  plugins: SLOPublicPluginsStart;
  appMountParameters: AppMountParameters;
  observabilityRuleTypeRegistry: ObservabilityRuleTypeRegistry;
  ObservabilityPageTemplate: React.ComponentType<LazyObservabilityPageTemplateProps>;
  usageCollection: UsageCollectionSetup;
  isDev?: boolean;
  kibanaVersion: string;
  isServerless?: boolean;
  experimentalFeatures: ExperimentalFeatures;
  sloClient: SLORepositoryClient;
}

export const renderApp = ({
  core,
  plugins,
  appMountParameters,
  ObservabilityPageTemplate,
  usageCollection,
  isDev,
  kibanaVersion,
  isServerless,
  observabilityRuleTypeRegistry,
  experimentalFeatures,
  sloClient,
}: Props) => {
  const { element, history } = appMountParameters;

  // ensure all divs are .kbnAppWrappers
  element.classList.add(APP_WRAPPER_CLASS);

  const queryClient = new QueryClient();

  const ApplicationUsageTrackingProvider =
    usageCollection?.components.ApplicationUsageTrackingProvider ?? React.Fragment;
  const CloudProvider = plugins.cloud?.CloudContextProvider ?? React.Fragment;

  const unregisterPrompts = plugins.observabilityAIAssistant?.service.setScreenContext({
    starterPrompts: [
      {
        title: i18n.translate('xpack.slo.starterPrompts.whatAreSlos.title', {
          defaultMessage: 'Getting started',
        }),
        prompt: i18n.translate('xpack.slo.starterPrompts.whatAreSlos.prompt', {
          defaultMessage: 'What are Service Level Objectives (SLOs)?',
        }),
        icon: 'bullseye',
      },
      {
        title: i18n.translate('xpack.slo.starterPrompts.canYouCreateAnSlo.title', {
          defaultMessage: 'Getting started',
        }),
        prompt: i18n.translate('xpack.slo.starterPrompts.canYouCreateAnSlo.prompt', {
          defaultMessage: 'Can you create an SLO?',
        }),
        icon: 'question',
      },
    ],
  });

  ReactDOM.render(
    core.rendering.addContext(
      <ApplicationUsageTrackingProvider>
        <CloudProvider>
          <KibanaContextProvider
            services={{
              ...core,
              ...plugins,
              storage: new Storage(localStorage),
              isDev,
              kibanaVersion,
              isServerless,
            }}
          >
            <PluginContext.Provider
              value={{
                isDev,
                isServerless,
                appMountParameters,
                ObservabilityPageTemplate,
                observabilityRuleTypeRegistry,
                experimentalFeatures,
                sloClient,
              }}
            >
              <Router history={history}>
                <RedirectAppLinks coreStart={core} data-test-subj="observabilityMainContainer">
                  <PerformanceContextProvider>
                    <QueryClientProvider client={queryClient}>
                      <App />
                    </QueryClientProvider>
                  </PerformanceContextProvider>
                </RedirectAppLinks>
              </Router>
            </PluginContext.Provider>
          </KibanaContextProvider>
        </CloudProvider>
      </ApplicationUsageTrackingProvider>
    ),
    element
  );

  return () => {
    // This needs to be present to fix https://github.com/elastic/kibana/issues/155704
    // as the Overview page renders the UX Section component. That component renders a Lens embeddable
    // via the ExploratoryView app, which uses search sessions. Therefore on unmounting we need to clear
    // these sessions.
    plugins.data.search.session.clear();
    unregisterPrompts?.();
    ReactDOM.unmountComponentAtNode(element);
  };
};

function App() {
  const { isServerless } = usePluginContext();

  const routes = getRoutes(isServerless);

  return (
    <Routes enableExecutionContextTracking={true}>
      {Object.keys(routes).map((path) => {
        const { handler, exact } = routes[path];
        const Wrapper = () => {
          return handler();
        };
        return <Route key={path} path={path} exact={exact} component={Wrapper} />;
      })}
    </Routes>
  );
}
