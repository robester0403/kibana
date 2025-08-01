/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { i18n } from '@kbn/i18n';

const declarationLabel = i18n.translate('kbn-esql-ast.esql.autocomplete.declarationLabel', {
  defaultMessage: 'Declaration:',
});

const examplesLabel = i18n.translate('kbn-esql-ast.esql.autocomplete.examplesLabel', {
  defaultMessage: 'Examples:',
});

/** @internal */
export const buildFunctionDocumentation = (
  signatures: Array<{
    declaration: string;
    license?: string;
  }>,
  examples: string[] | undefined
) => `
---
\
***${declarationLabel}***
${signatures
  .map(
    ({ declaration, license }) => `
\
  - \`\`${declaration}\`\`${license || ''}\
\
`
  )
  .join('\n\n')}
  ${
    examples?.length
      ? `\
---
***${examplesLabel}***
\
  ${examples
    .map(
      (i) => `
  - \`\`${i}\`\`
`
    )
    .join('')}

`
      : ''
  }`;

/** @internal **/
export const buildDocumentation = (declaration: string, examples?: string[]) => `
---
\
***${declarationLabel}***
\
  - \`\`${declaration}\`\`
\
---
${
  examples
    ? `\
***${examplesLabel}***
\
${examples.map(
  (i) => `
  - \`\`${i}\`\`
`
)}`
    : ''
}`;
