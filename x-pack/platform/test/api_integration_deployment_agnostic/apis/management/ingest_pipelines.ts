/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import expect from '@kbn/expect';
import { IngestPutPipelineRequest } from '@elastic/elasticsearch/lib/api/types';
import { DeploymentAgnosticFtrProviderContext } from '../../ftr_provider_context';
import { SupertestWithRoleScopeType } from '../../services';

export default function ({ getService }: DeploymentAgnosticFtrProviderContext) {
  const ingestPipelines = getService('ingestPipelines');
  const roleScopedSupertest = getService('roleScopedSupertest');
  const log = getService('log');
  let supertestWithAdminScope: SupertestWithRoleScopeType;

  describe('Ingest Pipelines', function () {
    before(async () => {
      supertestWithAdminScope = await roleScopedSupertest.getSupertestWithRoleScope('admin', {
        withInternalHeaders: true,
      });
    });

    after(async () => {
      await ingestPipelines.api.deletePipelines();
      await supertestWithAdminScope.destroy();
    });

    describe('Create', () => {
      it('should create a pipeline', async () => {
        const pipelineRequestBody = ingestPipelines.fixtures.createPipelineBody();
        const { body } = await supertestWithAdminScope
          .post(ingestPipelines.fixtures.apiBasePath)
          .send(pipelineRequestBody)
          .expect(200);

        expect(body).to.eql({
          acknowledged: true,
        });
      });

      it('should create a pipeline with only required fields', async () => {
        const pipelineRequestBody = ingestPipelines.fixtures.createPipelineBodyWithRequiredFields(); // Includes name and processors[] only
        const { body } = await supertestWithAdminScope
          .post(ingestPipelines.fixtures.apiBasePath)
          .send(pipelineRequestBody)
          .expect(200);

        expect(body).to.eql({
          acknowledged: true,
        });
      });

      it('should not allow creation of an existing pipeline', async () => {
        const pipelineRequestBody = ingestPipelines.fixtures.createPipelineBodyWithRequiredFields(); // Includes name and processors[] only
        const { name, ...esPipelineRequestBody } = pipelineRequestBody;
        // First, create a pipeline using the ES API
        await ingestPipelines.api.createPipeline({ id: name, ...esPipelineRequestBody });
        // Then, create a pipeline with our internal API
        const { body } = await supertestWithAdminScope
          .post(ingestPipelines.fixtures.apiBasePath)
          .send(pipelineRequestBody)
          .expect(409);

        expect(body).to.eql({
          statusCode: 409,
          error: 'Conflict',
          message: `There is already a pipeline with name '${name}'.`,
        });
      });

      it(`doesn't allow to create a pipeline with a too long name`, async () => {
        const pipelineRequestBody = {
          name: 'testtesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttesttest1',
        };
        await supertestWithAdminScope
          .post(ingestPipelines.fixtures.apiBasePath)
          .send(pipelineRequestBody)
          .expect(400);
      });
    });

    describe('Update', () => {
      let pipeline: Omit<IngestPutPipelineRequest, 'id'>;
      let pipelineName: string;

      before(async () => {
        // Create pipeline that can be used to test PUT request
        try {
          const pipelineRequestBody =
            ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();
          const { name, ...esPipelineRequestBody } = pipelineRequestBody;

          pipeline = esPipelineRequestBody;
          pipelineName = name;
          await ingestPipelines.api.createPipeline({ id: name, ...esPipelineRequestBody });
        } catch (err) {
          log.debug('[Setup error] Error creating ingest pipeline');
          throw err;
        }
      });

      it('should allow an existing pipeline to be updated', async () => {
        const uri = `${ingestPipelines.fixtures.apiBasePath}/${pipelineName}`;
        const { body } = await supertestWithAdminScope
          .put(uri)
          .send({
            ...pipeline,
            description: 'updated test pipeline description',
            _meta: {
              field_1: 'updated',
              new_field: 3,
            },
          })
          .expect(200);

        expect(body).to.eql({
          acknowledged: true,
        });
      });

      it('should allow optional fields to be removed', async () => {
        const uri = `${ingestPipelines.fixtures.apiBasePath}/${pipelineName}`;
        const { body } = await supertestWithAdminScope
          .put(uri)
          .send({
            // removes description, version, on_failure, and _meta
            processors: pipeline.processors,
          })
          .expect(200);

        expect(body).to.eql({
          acknowledged: true,
        });
      });

      it('should not allow a non-existing pipeline to be updated', async () => {
        const uri = `${ingestPipelines.fixtures.apiBasePath}/pipeline_does_not_exist`;
        const { body } = await supertestWithAdminScope
          .put(uri)
          .send({
            ...pipeline,
            description: 'updated test pipeline description',
            _meta: {
              field_1: 'updated',
              new_field: 3,
            },
          })
          .expect(404);

        expect(body).to.eql({
          statusCode: 404,
          error: 'Not Found',
          message: '{}',
          attributes: {},
        });
      });
    });

    describe('Get', () => {
      let pipeline: Omit<IngestPutPipelineRequest, 'id'>;
      let pipelineName: string;

      before(async () => {
        // Create pipeline that can be used to test GET request
        try {
          const pipelineRequestBody =
            ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();
          const { name, ...esPipelineRequestBody } = pipelineRequestBody;

          pipeline = esPipelineRequestBody;
          pipelineName = name;
          await ingestPipelines.api.createPipeline({ id: name, ...esPipelineRequestBody });
        } catch (err) {
          log.debug('[Setup error] Error creating ingest pipeline');
          throw err;
        }
      });

      describe('all pipelines', () => {
        it('should return an array of pipelines', async () => {
          const { body } = await supertestWithAdminScope
            .get(ingestPipelines.fixtures.apiBasePath)
            .expect(200);

          expect(Array.isArray(body)).to.be(true);

          // There are some pipelines created OOTB with ES
          // To not be dependent on these, we only confirm the pipeline we created as part of the test exists
          const testPipeline = body.find(({ name }: { name: string }) => name === pipelineName);

          expect(testPipeline.name).to.eql(pipelineName);
          expect(testPipeline.isManaged).to.eql(false);
          expect(testPipeline.processors).to.eql(pipeline.processors);
        });
      });

      describe('one pipeline', () => {
        it('should return a single pipeline', async () => {
          const uri = `${ingestPipelines.fixtures.apiBasePath}/${pipelineName}`;
          const { body } = await supertestWithAdminScope.get(uri).expect(200);

          expect(body.name).to.eql(pipelineName);
          expect(body.isManaged).to.eql(false);
          expect(body.processors).to.eql(pipeline.processors);
        });
      });
    });

    describe('Delete', () => {
      const pipelineIds: string[] = [];

      before(async () => {
        const pipelineA = ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();
        const pipelineB = ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();
        const pipelineC = ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();
        const pipelineD = ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();

        // Create several pipelines that can be used to test deletion
        await Promise.all(
          [pipelineA, pipelineB, pipelineC, pipelineD].map((pipeline) => {
            const { name, ...pipelineRequestBody } = pipeline;
            pipelineIds.push(pipeline.name);
            return ingestPipelines.api.createPipeline({ id: name, ...pipelineRequestBody });
          })
        ).catch((err) => {
          log.debug(`[Setup error] Error creating pipelines: ${err.message}`);
          throw err;
        });
      });

      it('should delete a pipeline', async () => {
        const pipelineA = pipelineIds[0];
        const uri = `${ingestPipelines.fixtures.apiBasePath}/${pipelineA}`;
        const { body } = await supertestWithAdminScope.delete(uri).expect(200);

        expect(body).to.eql({
          itemsDeleted: [pipelineA],
          errors: [],
        });
      });

      it('should delete multiple pipelines', async () => {
        const pipelineB = pipelineIds[1];
        const pipelineC = pipelineIds[2];
        const uri = `${ingestPipelines.fixtures.apiBasePath}/${pipelineB},${pipelineC}`;
        const {
          body: { itemsDeleted, errors },
        } = await supertestWithAdminScope.delete(uri).expect(200);

        expect(errors).to.eql([]);

        // The itemsDeleted array order isn't guaranteed, so we assert against each pipeline name instead
        [pipelineB, pipelineC].forEach((pipelineName) => {
          expect(itemsDeleted.includes(pipelineName)).to.be(true);
        });
      });

      it('should return an error for any pipelines not sucessfully deleted', async () => {
        const PIPELINE_DOES_NOT_EXIST = 'pipeline_does_not_exist';
        const pipelineD = pipelineIds[3];
        const uri = `${ingestPipelines.fixtures.apiBasePath}/${pipelineD},${PIPELINE_DOES_NOT_EXIST}`;
        const { body } = await supertestWithAdminScope.delete(uri).expect(200);

        expect(body).to.eql({
          itemsDeleted: [pipelineD],
          errors: [
            {
              name: PIPELINE_DOES_NOT_EXIST,
              error: {
                root_cause: [
                  {
                    type: 'resource_not_found_exception',
                    reason: 'pipeline [pipeline_does_not_exist] is missing',
                  },
                ],
                type: 'resource_not_found_exception',
                reason: 'pipeline [pipeline_does_not_exist] is missing',
              },
              status: 404,
            },
          ],
        });
      });
    });

    describe('Simulate', () => {
      it('should successfully simulate a pipeline', async () => {
        const { name, ...pipeline } = ingestPipelines.fixtures.createPipelineBody();
        const documents = ingestPipelines.fixtures.createDocuments();
        const { body } = await supertestWithAdminScope
          .post(`${ingestPipelines.fixtures.apiBasePath}/simulate`)
          .send({
            pipeline,
            documents,
          })
          .expect(200);

        // The simulate ES response is quite long and includes timestamps
        // so for now, we just confirm the docs array is returned with the correct length
        expect(body.docs?.length).to.eql(2);
      });

      it('should successfully simulate a pipeline with only required pipeline fields', async () => {
        const { name, ...pipeline } =
          ingestPipelines.fixtures.createPipelineBodyWithRequiredFields();
        const documents = ingestPipelines.fixtures.createDocuments();
        const { body } = await supertestWithAdminScope
          .post(`${ingestPipelines.fixtures.apiBasePath}/simulate`)
          .send({
            pipeline,
            documents,
          })
          .expect(200);

        // The simulate ES response is quite long and includes timestamps
        // so for now, we just confirm the docs array is returned with the correct length
        expect(body.docs?.length).to.eql(2);
      });
    });

    describe('Fetch documents', () => {
      const INDEX = 'test_index';
      const DOCUMENT_ID = '1';
      const DOCUMENT = {
        name: 'John Doe',
      };

      before(async () => {
        // Create an index with a document that can be used to test GET request
        try {
          await ingestPipelines.api.createIndex({ id: DOCUMENT_ID, index: INDEX, body: DOCUMENT });
        } catch (err) {
          log.debug('[Setup error] Error creating index');
          throw err;
        }
      });

      after(async () => {
        // Clean up index created
        try {
          await ingestPipelines.api.deleteIndex(INDEX);
        } catch (err) {
          log.debug('[Cleanup error] Error deleting index');
          throw err;
        }
      });

      it('should return a document', async () => {
        const uri = `${ingestPipelines.fixtures.apiBasePath}/documents/${INDEX}/${DOCUMENT_ID}`;
        const { body } = await supertestWithAdminScope.get(uri).expect(200);

        expect(body).to.eql({
          _index: INDEX,
          _id: DOCUMENT_ID,
          _source: DOCUMENT,
        });
      });

      it('should return an error if the document does not exist', async () => {
        const uri = `${ingestPipelines.fixtures.apiBasePath}/documents/${INDEX}/2`; // Document 2 does not exist
        const { body } = await supertestWithAdminScope.get(uri).expect(404);

        expect(body).to.eql({
          error: 'Not Found',
          message: '{"_index":"test_index","_id":"2","found":false}',
          statusCode: 404,
          attributes: {},
        });
      });
    });

    describe('Map CSV to pipeline', () => {
      it('should map to a pipeline', async () => {
        const validCsv =
          'source_field,copy_action,format_action,timestamp_format,destination_field,Notes\nsrcip,,,,source.address,Copying srcip to source.address';
        const { body } = await supertestWithAdminScope
          .post(`${ingestPipelines.fixtures.apiBasePath}/parse_csv`)
          .send({
            copyAction: 'copy',
            file: validCsv,
          })
          .expect(200);

        expect(body.processors).to.eql([
          {
            set: {
              field: 'source.address',
              value: '{{srcip}}',
              if: 'ctx.srcip != null',
            },
          },
        ]);
      });
    });
  });
}
