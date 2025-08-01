/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';
import { USER } from '../../../../functional/services/ml/security_common';
import { FtrProviderContext } from '../../../ftr_provider_context';

export default function ({ getService }: FtrProviderContext) {
  const esArchiver = getService('esArchiver');
  const ml = getService('ml');
  const browser = getService('browser');

  const testUsers = [
    { user: USER.ML_VIEWER, discoverAvailable: true },
    { user: USER.ML_VIEWER_SPACES, discoverAvailable: false },
  ];

  describe('for user with read ML access', function () {
    this.tags('skipFIPS');
    for (const testUser of testUsers) {
      describe(`(${testUser.user})`, function () {
        const ecIndexPattern = 'ft_module_sample_ecommerce';
        const ecExpectedTotalCount = '287';

        const uploadFilePath = require.resolve(
          '../../../../functional/apps/ml/data_visualizer/files_to_import/artificial_server_log'
        );
        const expectedUploadFileTitle = 'artificial_server_log';

        before(async () => {
          await esArchiver.loadIfNeeded(
            'x-pack/platform/test/fixtures/es_archives/ml/module_sample_ecommerce'
          );
          await ml.testResources.createDataViewIfNeeded(ecIndexPattern, 'order_date');

          await ml.securityUI.loginAs(testUser.user);
        });

        after(async () => {
          // NOTE: Logout needs to happen before anything else to avoid flaky behavior
          await ml.securityUI.logout();
        });

        it('should display the ML entry in Kibana app menu', async () => {
          await ml.testExecution.logTestStep('should open the Kibana app menu');
          await ml.navigation.openKibanaNav();

          await ml.testExecution.logTestStep('should display the ML nav link');
          await ml.navigation.assertKibanaNavMLEntryExists();
        });

        it('should display tabs in the ML app correctly', async () => {
          await ml.testExecution.logTestStep('should load the ML app');
          await ml.navigation.navigateToMl();

          await ml.testExecution.logTestStep('should redirect to the "Data Visualizer" page');
          const browserURl = await browser.getCurrentUrl();
          expect(browserURl).to.contain('/ml/datavisualizer');

          await ml.testExecution.logTestStep('should display the disabled "Overview" tab');
          await ml.navigation.assertOverviewTabEnabled(false);

          await ml.testExecution.logTestStep(
            'should display the disabled "Anomaly Detection" tabs'
          );
          await ml.navigation.assertAnomalyDetectionTabsEnabled(false);

          await ml.testExecution.logTestStep(
            'should display the disabled "Data Frame Analytics" tabs'
          );
          await ml.navigation.assertDataFrameAnalyticsTabsEnabled(false);

          await ml.testExecution.logTestStep('should display the enabled "Data Visualizer" tab');
          await ml.navigation.assertDataVisualizerTabEnabled(true);
        });

        it('should display elements on Data Visualizer home page correctly', async () => {
          await ml.testExecution.logTestStep('should load the data visualizer page');
          await ml.navigation.navigateToDataVisualizer();

          await ml.testExecution.logTestStep(
            'should display the "import data" card with enabled button'
          );
          await ml.dataVisualizer.assertDataVisualizerImportDataCardExists();
          await ml.dataVisualizer.assertUploadFileButtonEnabled(true);

          await ml.testExecution.logTestStep(
            'should display the "select index pattern" card with enabled button'
          );
          await ml.dataVisualizer.assertDataVisualizerIndexDataCardExists();
          await ml.dataVisualizer.assertSelectIndexButtonEnabled(true);

          await ml.testExecution.logTestStep(
            'should display the "start trial" card with enabled button'
          );
          await ml.dataVisualizer.assertDataVisualizerStartTrialCardExists();
          await ml.dataVisualizer.assertStartTrialButtonEnabled(true);
        });

        it('should display elements on Index Data Visualizer page correctly', async () => {
          await ml.testExecution.logTestStep('should load an index into the data visualizer page');
          await ml.dataVisualizer.navigateToDataViewSelection();
          await ml.jobSourceSelection.selectSourceForIndexBasedDataVisualizer(ecIndexPattern);

          await ml.testExecution.logTestStep('should display the time range step');
          await ml.dataVisualizerIndexBased.assertTimeRangeSelectorSectionExists();

          await ml.testExecution.logTestStep('should load data for full time range');
          await ml.dataVisualizerIndexBased.clickUseFullDataButton(ecExpectedTotalCount);

          await ml.testExecution.logTestStep('should display the data visualizer table');
          await ml.dataVisualizerIndexBased.assertDataVisualizerTableExist();

          await ml.testExecution.logTestStep(
            `should display the actions panel ${
              testUser.discoverAvailable ? 'with' : 'without'
            } Discover card`
          );
          if (testUser.discoverAvailable) {
            await ml.dataVisualizerIndexBased.assertActionsPanelExists();
          }
          await ml.dataVisualizerIndexBased.assertViewInDiscoverCard(testUser.discoverAvailable);

          await ml.testExecution.logTestStep('should not display job cards');
          await ml.dataVisualizerIndexBased.assertCreateAdvancedJobCardNotExists();
          await ml.dataVisualizerIndexBased.assertCreateDataFrameAnalyticsCardNotExists();
        });

        it('should display elements on File Data Visualizer page correctly', async () => {
          await ml.testExecution.logTestStep('should load the file data visualizer file selection');
          await ml.navigation.navigateToDataVisualizer();
          await ml.dataVisualizer.navigateToFileUpload();

          await ml.testExecution.logTestStep(
            'should select a file and load visualizer result page'
          );
          await ml.dataVisualizerFileBased.selectFile(uploadFilePath);

          await ml.testExecution.logTestStep('should display components of the file details page');
          await ml.dataVisualizerFileBased.assertFileTitle(expectedUploadFileTitle);
          await ml.dataVisualizerFileBased.assertFileContentPanelExists();
          await ml.dataVisualizerFileBased.assertSummaryPanelExists();
          await ml.dataVisualizerFileBased.assertFileStatsPanelExists();
          await ml.dataVisualizerFileBased.assertImportButtonEnabled(false);
        });

        it('should not allow access to the Stack Management ML page', async () => {
          await ml.testExecution.logTestStep(
            'should load the stack management with the ML menu item being absent'
          );
          await ml.navigation.navigateToStackManagement({ expectMlLink: false });
        });
      });
    }
  });
}
