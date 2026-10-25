import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  historicalEvaluations,
  historicalParticipants,
  originals,
  originalVersions,
  fragments,
  events,
  eventParticipants,
  eventSources,
  statements,
  importSnapshots,
} from './schema';
import { dimensions, ruleVersions, anchors } from '../evaluation-system';
import { aiSuggestions, confirmations, scoreReviews } from '../talent';
it('declares required historical FKs with no destructive cascades', () => {
  const tables = [
    historicalEvaluations,
    historicalParticipants,
    originals,
    originalVersions,
    fragments,
    events,
    eventParticipants,
    eventSources,
    statements,
    importSnapshots,
    dimensions,
    ruleVersions,
    anchors,
    aiSuggestions,
    confirmations,
    scoreReviews,
  ];
  for (const table of tables) {
    const config = getTableConfig(table);
    for (const fk of config.foreignKeys)
      expect(fk.onDelete ?? 'no action').toBe('no action');
    expect(
      config.columns.find((c) => c.name === 'id')?.primary ??
        config.primaryKeys.length > 0,
    ).toBe(true);
  }
  expect(
    getTableConfig(eventSources).foreignKeys.map((f) =>
      f.reference().columns.map((c) => c.name),
    ),
  ).toContainEqual(['fragment_id', 'original_version_id']);
  expect(
    getTableConfig(confirmations).foreignKeys.map((f) =>
      f.reference().columns.map((c) => c.name),
    ),
  ).toContainEqual(['event_id', 'fragment_id', 'original_version_id']);
  expect(
    getTableConfig(confirmations).foreignKeys.map((f) =>
      f.reference().columns.map((c) => c.name),
    ),
  ).toContainEqual(['anchor_id', 'dimension_id', 'rule_version_id', 'value']);
});
it('makes active confirmation identity event + dimension + evaluator, not person or source', () => {
  const config = getTableConfig(confirmations);
  const active = config.indexes.find(
    (i) => i.config.name === 'talent_one_active_confirmation',
  )!;
  expect(active.config.unique).toBe(true);
  expect(active.config.where).toBeDefined();
  expect(
    active.config.columns.map((c) => ('name' in c ? c.name : null)),
  ).toEqual(['event_id', 'dimension_id', 'evaluator_id']);
  expect(
    config.uniqueConstraints
      .find((c) => c.name === 'talent_confirmation_revision')
      ?.columns.map((c) => c.name),
  ).toEqual(['event_id', 'dimension_id', 'evaluator_id', 'revision']);
});
it('separates snapshots, source versions, AI suggestions and manual confirmations', () => {
  expect(getTableConfig(importSnapshots).foreignKeys).toHaveLength(0);
  expect(
    getTableConfig(originalVersions).uniqueConstraints[0].columns.map(
      (c) => c.name,
    ),
  ).toEqual(['original_id', 'version']);
  expect(getTableConfig(aiSuggestions).checks.map((c) => c.name)).toContain(
    'talent_ai_status_value',
  );
  expect(getTableConfig(confirmations).checks.map((c) => c.name)).toContain(
    'talent_confirmation_revision_chain',
  );
  expect(getTableConfig(statements).checks.map((c) => c.name)).toContain(
    'records_statement_attribution',
  );
});
it('requires actual quoted text instead of an empty source fragment', () => {
  expect(getTableConfig(fragments).checks.map((c) => c.name)).toContain(
    'records_excerpt_nonblank',
  );
});
it('models prototype provenance without inventing human confirmation metadata', () => {
  const columns = (table: Parameters<typeof getTableConfig>[0]) =>
    getTableConfig(table).columns;
  expect(columns(originals).map((c) => c.name)).toContain('kind');
  expect(columns(originalVersions).map((c) => c.name)).toContain(
    'source_commit',
  );
  expect(columns(originalVersions).map((c) => c.name)).toContain('source_blob');
  expect(columns(confirmations).map((c) => c.name)).toContain(
    'source_category',
  );
  expect(
    columns(confirmations).find((c) => c.name === 'confirmed_at')?.notNull,
  ).toBe(false);
  expect(
    columns(confirmations).find((c) => c.name === 'modified_by')?.notNull,
  ).toBe(false);
  expect(getTableConfig(confirmations).checks.map((c) => c.name)).toContain(
    'talent_confirmation_provenance',
  );
});
