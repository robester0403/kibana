/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { schema, TypeOf } from '@kbn/config-schema';

export type Query = TypeOf<typeof routeValidationConfig.query>;
export type Body = TypeOf<typeof routeValidationConfig.body>;

export const acceptedHttpVerb = schema.string({
  validate: (method) => {
    return ['HEAD', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'].some(
      (verb) => verb.toLowerCase() === method.toLowerCase()
    )
      ? undefined
      : `Method must be one of, case insensitive ['HEAD', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH']. Received '${method}'.`;
  },
});

export const nonEmptyString = schema.string({
  validate: (s) => (s === '' ? 'Expected non-empty string' : undefined),
});

export const routeValidationConfig = {
  query: schema.object({
    method: acceptedHttpVerb,
    path: nonEmptyString,
    withProductOrigin: schema.maybe(schema.boolean()),
    host: schema.maybe(schema.string()),
  }),
  body: schema.stream(),
};
