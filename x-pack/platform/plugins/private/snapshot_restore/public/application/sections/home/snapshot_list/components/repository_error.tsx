/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { useHistory } from 'react-router-dom';
import { FormattedMessage } from '@kbn/i18n-react';
import { EuiLink, EuiPageTemplate, EuiSpacer } from '@elastic/eui';
import { reactRouterNavigate } from '../../../../../shared_imports';
import { linkToRepositories } from '../../../../services/navigation';

interface RepositoryErrorProps {
  errorMessage?: string;
}

export const RepositoryError = ({ errorMessage }: RepositoryErrorProps) => {
  const history = useHistory();
  return (
    <EuiPageTemplate.EmptyPrompt
      color="danger"
      iconType="warning"
      data-test-subj="repositoryErrorsPrompt"
      title={
        <h1 data-test-subj="title">
          <FormattedMessage
            id="xpack.snapshotRestore.snapshotList.emptyPrompt.errorRepositoriesTitle"
            defaultMessage="Some repositories contain errors"
          />
        </h1>
      }
      body={
        <p>
          {errorMessage}
          <EuiSpacer size="xs" />
          <FormattedMessage
            id="xpack.snapshotRestore.snapshotList.emptyPrompt.repositoryWarningDescription"
            defaultMessage="Go to {repositoryLink} to fix the errors or select another repository."
            values={{
              repositoryLink: (
                <EuiLink {...reactRouterNavigate(history, linkToRepositories())}>
                  <FormattedMessage
                    id="xpack.snapshotRestore.repositoryWarningLinkText"
                    defaultMessage="Repositories"
                  />
                </EuiLink>
              ),
            }}
          />
        </p>
      }
    />
  );
};
