/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from 'expect';
import { SupertestWithRoleScopeType } from '../../services';
import { FtrProviderContext } from '../../ftr_provider_context';

const INTERNAL_API_BASE_PATH = '/internal/index_management';

export default function ({ getService }: FtrProviderContext) {
  const svlCommonApi = getService('svlCommonApi');
  const roleScopedSupertest = getService('roleScopedSupertest');
  let supertestAdminWithCookieCredentials: SupertestWithRoleScopeType;
  const es = getService('es');
  const log = getService('log');

  describe('Create enrich policy', function () {
    const INDEX_A_NAME = `index-${Math.random()}`;
    const INDEX_B_NAME = `index-${Math.random()}`;
    const POLICY_NAME = `policy-${Math.random()}`;

    before(async () => {
      supertestAdminWithCookieCredentials = await roleScopedSupertest.getSupertestWithRoleScope(
        'admin',
        {
          useCookieHeader: true,
          withInternalHeaders: true,
        }
      );

      try {
        await es.indices.create({
          index: INDEX_A_NAME,
          mappings: {
            properties: {
              email: {
                type: 'text',
              },
              firstName: {
                type: 'text',
              },
            },
          },
        });
        await es.indices.create({
          index: INDEX_B_NAME,
          mappings: {
            properties: {
              email: {
                type: 'text',
              },
              age: {
                type: 'long',
              },
            },
          },
        });
      } catch (err) {
        log.debug('[Setup error] Error creating test index');
        throw err;
      }
    });

    after(async () => {
      try {
        await es.indices.delete({ index: INDEX_A_NAME });
        await es.indices.delete({ index: INDEX_B_NAME });
      } catch (err) {
        log.debug('[Cleanup error] Error deleting test index');
        throw err;
      }
    });

    it('Allows to create an enrich policy', async () => {
      const { body } = await supertestAdminWithCookieCredentials
        .post(`${INTERNAL_API_BASE_PATH}/enrich_policies`)
        .send({
          policy: {
            name: POLICY_NAME,
            type: 'match',
            matchField: 'email',
            enrichFields: ['firstName'],
            sourceIndices: [INDEX_A_NAME],
          },
        })
        .expect(200);

      expect(body).toStrictEqual({ acknowledged: true });
    });

    it('Can retrieve fields from indices', async () => {
      const { body } = await supertestAdminWithCookieCredentials
        .post(`${INTERNAL_API_BASE_PATH}/enrich_policies/get_fields_from_indices`)
        .send({ indices: [INDEX_A_NAME, INDEX_B_NAME] })
        .expect(200);

      expect(body).toStrictEqual({
        commonFields: [{ name: 'email', type: 'text', normalizedType: 'text' }],
        indices: [
          {
            index: INDEX_A_NAME,
            fields: [
              { name: 'email', type: 'text', normalizedType: 'text' },
              { name: 'firstName', type: 'text', normalizedType: 'text' },
            ],
          },
          {
            index: INDEX_B_NAME,
            fields: [
              { name: 'age', type: 'long', normalizedType: 'number' },
              { name: 'email', type: 'text', normalizedType: 'text' },
            ],
          },
        ],
      });
    });

    it('Can retrieve matching indices', async () => {
      const { body, status } = await supertestAdminWithCookieCredentials
        .post(`${INTERNAL_API_BASE_PATH}/enrich_policies/get_matching_indices`)
        .send({ pattern: 'index-' });
      svlCommonApi.assertResponseStatusCode(200, status, body);

      expect(
        body.indices.every((value: string) => [INDEX_A_NAME, INDEX_B_NAME].includes(value))
      ).toBe(true);
    });
  });
}
