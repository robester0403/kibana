/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FtrProviderContext } from '../../ftr_provider_context';

export default function ({ getPageObjects, getService }: FtrProviderContext) {
  const esArchiver = getService('esArchiver');
  const { common, visualize, visChart } = getPageObjects(['common', 'visualize', 'visChart']);
  const inspector = getService('inspector');
  const kibanaServer = getService('kibanaServer');

  describe('hybrid index pattern', () => {
    before(async () => {
      await kibanaServer.savedObjects.cleanStandardList();
      await kibanaServer.importExport.load(
        'x-pack/test/functional/fixtures/kbn_archiver/hybrid_dataview.json'
      );
      await esArchiver.load('x-pack/platform/test/fixtures/es_archives/hybrid/logstash');
      await esArchiver.load('x-pack/platform/test/fixtures/es_archives/hybrid/rollup');
    });

    after(async () => {
      await kibanaServer.importExport.unload(
        'x-pack/test/functional/fixtures/kbn_archiver/hybrid_dataview.json'
      );
      await esArchiver.unload('x-pack/platform/test/fixtures/es_archives/hybrid/logstash');
      await esArchiver.unload('x-pack/platform/test/fixtures/es_archives/hybrid/rollup');
      await kibanaServer.savedObjects.cleanStandardList();
      await common.unsetTime();
    });

    it('should render histogram line chart', async () => {
      const expectedData = [
        ['2019-08-19 00:00', 'gif', '2'],
        ['2019-08-19 00:00', 'jpg', '2'],
        ['2019-08-19 00:00', 'css', '1'],
        ['2019-08-19 08:00', 'jpg', '599'],
        ['2019-08-19 08:00', 'css', '116'],
        ['2019-08-19 08:00', 'png', '95'],
        ['2019-08-19 08:00', 'gif', '68'],
        ['2019-08-19 08:00', 'php', '38'],
        ['2019-08-19 16:00', 'jpg', '2,143'],
        ['2019-08-19 16:00', 'css', '551'],
        ['2019-08-19 16:00', 'png', '362'],
        ['2019-08-19 16:00', 'gif', '209'],
        ['2019-08-19 16:00', 'php', '112'],
        ['2019-08-20 00:00', 'jpg', '232'],
        ['2019-08-20 00:00', 'css', '62'],
        ['2019-08-20 00:00', 'png', '46'],
        ['2019-08-20 00:00', 'gif', '27'],
        ['2019-08-20 00:00', 'php', '11'],
        ['2019-08-20 08:00', 'jpg', '547'],
        ['2019-08-20 08:00', 'css', '167'],
        ['2019-08-20 08:00', 'png', '87'],
        ['2019-08-20 08:00', 'gif', '58'],
        ['2019-08-20 08:00', 'php', '25'],
        ['2019-08-20 16:00', 'jpg', '1,719'],
        ['2019-08-20 16:00', 'css', '458'],
        ['2019-08-20 16:00', 'png', '246'],
        ['2019-08-20 16:00', 'gif', '180'],
        ['2019-08-20 16:00', 'php', '89'],
        ['2019-08-21 00:00', 'jpg', '252'],
        ['2019-08-21 00:00', 'css', '72'],
        ['2019-08-21 00:00', 'png', '40'],
        ['2019-08-21 00:00', 'gif', '29'],
        ['2019-08-21 00:00', 'php', '12'],
        ['2019-08-21 08:00', 'jpg', '624'],
        ['2019-08-21 08:00', 'css', '145'],
        ['2019-08-21 08:00', 'png', '91'],
        ['2019-08-21 08:00', 'gif', '66'],
        ['2019-08-21 08:00', 'php', '23'],
        ['2019-08-21 16:00', 'jpg', '2,167'],
        ['2019-08-21 16:00', 'css', '504'],
        ['2019-08-21 16:00', 'png', '342'],
        ['2019-08-21 16:00', 'gif', '219'],
        ['2019-08-21 16:00', 'php', '103'],
        ['2019-08-22 00:00', 'jpg', '237'],
        ['2019-08-22 00:00', 'css', '64'],
        ['2019-08-22 00:00', 'png', '38'],
        ['2019-08-22 00:00', 'gif', '29'],
        ['2019-08-22 00:00', 'php', '11'],
        ['2019-08-22 16:00', 'jpg', '3'],
      ];
      const from = 'Aug 19, 2019 @ 01:55:07.240';
      const to = 'Aug 22, 2019 @ 23:09:36.205';

      await common.setTime({ from, to });
      await common.navigateToApp('visualize');
      await visualize.openSavedVisualization('hybrid_histogram_line_chart');
      await visChart.waitForVisualizationRenderingStabilized();
      await inspector.open();
      await inspector.setTablePageSize(50);
      await inspector.expectTableData(expectedData);
    });
  });
}
