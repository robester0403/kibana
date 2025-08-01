/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';
import ccrFixture from './fixtures/ccr.json';
import { getLifecycleMethods } from '../data_stream';

export default function ({ getService }) {
  const supertest = getService('supertest');

  describe('ccr - metricbeat and package', () => {
    ['mb', 'package'].forEach((source) => {
      describe(`ccr ${source}`, () => {
        const archive = `x-pack/platform/test/fixtures/es_archives/monitoring/ccr_${source}`;
        const { setup, tearDown } = getLifecycleMethods(getService);
        const timeRange = {
          min: '2018-09-19T00:00:00.000Z',
          max: '2018-09-19T23:59:59.000Z',
        };

        before('load archive', () => {
          return setup(archive);
        });

        after('unload archive', () => {
          return tearDown(archive);
        });

        it('should return all followers and a grouping of stats by follower index', async () => {
          const { body } = await supertest
            .post('/api/monitoring/v1/clusters/vX4lH4C6QmyrJeYrvKr0-A/elasticsearch/ccr')
            .set('kbn-xsrf', 'xxx')
            .send({
              timeRange,
            })
            .expect(200);

          expect(body).to.eql(ccrFixture);
        });

        it('should return an empty list of followers if the cluster_uuid does not have any match', async () => {
          const { body } = await supertest
            .post('/api/monitoring/v1/clusters/random_uuid/elasticsearch/ccr')
            .set('kbn-xsrf', 'xxx')
            .send({
              timeRange,
            })
            .expect(200);

          expect(body).to.eql([]);
        });
      });
    });
  });
}
