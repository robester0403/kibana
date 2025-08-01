/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { DataView } from '@kbn/data-views-plugin/public';
import type { AggregateQuery, Query } from '@kbn/es-query';
import type { DataTableRecord, DataTableColumnsMeta } from '@kbn/discover-utils/types';
import { DocViewsRegistry } from './doc_views_registry';

export interface FieldMapping {
  filterable?: boolean;
  scripted?: boolean;
  rowCount?: number;
  type: string;
  name: string;
  displayName?: string;
}

export type DocViewFilterFn = (
  mapping: FieldMapping | string | undefined,
  value: unknown,
  mode: '+' | '-'
) => void;

export interface DocViewRenderProps {
  hit: DataTableRecord;
  dataView: DataView;
  columns?: string[];
  /**
   * If not provided, types will be derived by default from the dataView field types.
   * For displaying text-based search results, define column types (which are available separately in the fetch request) here.
   */
  columnsMeta?: DataTableColumnsMeta;
  query?: Query | AggregateQuery;
  textBasedHits?: DataTableRecord[];
  hideActionsColumn?: boolean;
  filter?: DocViewFilterFn;
  onAddColumn?: (columnName: string) => void;
  onRemoveColumn?: (columnName: string) => void;
  docViewsRegistry?: DocViewsRegistry | ((prevRegistry: DocViewsRegistry) => DocViewsRegistry);
  decreaseAvailableHeightBy?: number;
  initialTabId?: string;
}

export type DocViewerComponent = React.FC<DocViewRenderProps>;

export interface DocView {
  id: string;
  order: number;
  title: string;
  component: DocViewerComponent;
  enabled?: boolean;
}

export type DocViewFactory = () => DocView;
