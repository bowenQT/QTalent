import { expect, it } from 'vitest';
import {
  projectTalentExport,
  projectPersonExport,
  viewTalentExport,
  exportFromDay,
} from './policy';
import { snapshot, openReview } from './test-helpers';
const input = { scopeId: 'all', range: 'all' as const };
it('only manager/HR can export; a mentor or system administrator cannot reuse the same scope', async () => {
  for (const role of ['mentor', 'admin'] as const)
    await expect(
      projectTalentExport(snapshot(role), input),
    ).rejects.toMatchObject({ code: 'forbidden' });
  expect((await projectTalentExport(snapshot('manager'), input)).rows).toBe(4);
  expect((await projectTalentExport(snapshot('hr'), input)).rows).toBe(4);
});
it.each([
  'score_gap',
  'ai_changed_without_reason',
  'post_freeze_position_change',
])(
  'excludes every current open %s review before computing visible export and skipped counts',
  async (reason) => {
    const data = snapshot();
    openReview(data, reason);
    const result = await projectTalentExport(data, input);
    expect(result.rows).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.data.map((r) => r.confirmationId)).not.toContain(
      'event-0-prof',
    );
  },
);
it('does not treat a withdrawn review or an unrelated confirmation as blocking a new current confirmation', async () => {
  const data = snapshot();
  openReview(data);
  data.reviews[0]!.withdrawnAt = new Date('2026-09-03T00:00:00Z');
  expect((await projectTalentExport(data, input)).rows).toBe(4);
  data.reviews[0]!.withdrawnAt = null;
  data.reviews[0]!.confirmationId = 'older-inactive-confirmation';
  expect((await projectTalentExport(data, input)).rows).toBe(4);
  data.reviews[0]!.counterpartConfirmationId = 'event-0-prof';
  expect((await projectTalentExport(data, input)).rows).toBe(3);
});
it('keeps all real locations on a multi-source event rather than silently choosing its first quote', async () => {
  const data = snapshot();
  data.fragments.push({
    id: 'second-source',
    originalVersionId: 'version',
    excerpt: '演示第二段',
    location: { kind: 'document', page: 3, paragraph: '2' },
  });
  data.eventSources.push({
    eventId: 'event-0',
    fragmentId: 'second-source',
    originalVersionId: 'version',
  });
  const result = await projectTalentExport(data, input);
  const row = result.data.find((r) => r.eventId === 'event-0')!;
  expect(row.sources).toHaveLength(2);
  expect(row.sources[1]).toMatchObject({
    fragmentId: 'second-source',
    location: { kind: 'document', page: 3, paragraph: '2' },
  });
  expect(row.quote).toContain('演示第二段');
});
it('does not count hidden shared-source content as a skipped review', async () => {
  const data = snapshot('hr');
  openReview(data);
  data.participants.push({ eventId: 'event-0', personId: 'two' });
  data.context.evaluationNodeSubjects.push({
    evaluationNodeId: 'node-current',
    personId: 'two',
  });
  const result = await projectTalentExport(data, input);
  expect(result.rows).toBe(2);
  expect(result.skipped).toBe(0);
  expect(JSON.stringify(result)).not.toContain('event-0-prof');
});
it('unknown withdrawal/review facts fail closed rather than inventing false or ready', async () => {
  const data = snapshot();
  openReview(data);
  Reflect.deleteProperty(data.reviews[0]!, 'withdrawnAt');
  await expect(projectTalentExport(data, input)).rejects.toMatchObject({
    code: 'unavailable',
  });
});
it('filters date ranges by the business day and returns true empty scope previews', async () => {
  const data = snapshot();
  const recent = await projectTalentExport(data, {
    ...input,
    range: 'last3Months',
  });
  expect(recent.rows).toBe(0);
  const view = await viewTalentExport(data);
  expect(
    view.scopes.find((s) => s.id === 'all')?.previews.last12Months,
  ).toMatchObject({ people: 1, rows: 4 });
  expect(
    view.scopes.find((s) => s.id === 'all')?.previews.last3Months,
  ).toMatchObject({ people: 0, rows: 0 });
});
it('revoked HR grants and arbitrary scope IDs do not disclose a scope or any counts', async () => {
  const data = snapshot('hr');
  data.context.grants[0]!.revokedAt = '2026-09-04';
  await expect(projectTalentExport(data, input)).rejects.toMatchObject({
    code: 'forbidden',
  });
  await expect(
    projectTalentExport(snapshot(), {
      ...input,
      scopeId: 'cohort:not-visible',
    }),
  ).rejects.toMatchObject({ code: 'forbidden' });
});

it('supports actual human confirmations without converting their time or nature into demo baseline', async () => {
  const data = snapshot();
  data.originals[0]!.kind = 'original';
  data.originals[0]!.displayNotice = null;
  data.ruleVersions[0]!.provenance = 'published';
  data.ruleVersions[0]!.sourceCommit = null;
  for (const c of data.confirmations) {
    c.sourceCategory = 'original';
    c.modifiedBy = 'actor';
    c.confirmedAt = new Date('2026-09-03T10:00:00Z');
  }
  const result = await projectTalentExport(data, input);
  expect(result.rows).toBe(4);
  expect(
    result.data.every(
      (c) =>
        c.sourceCategory === 'original' &&
        c.confirmedAt === '2026-09-03T10:00:00.000Z',
    ),
  ).toBe(true);
});
it('counts an authorized unconfirmed AI score only as skipped, never as a human export row', async () => {
  const data = snapshot(),
    c = data.confirmations[0]!;
  c.active = false;
  data.suggestions.push({
    id: 'suggestion',
    eventId: c.eventId,
    dimensionId: c.dimensionId,
    ruleVersionId: c.ruleVersionId,
    modelVersion: 'synthetic',
    sourceCategory: c.sourceCategory,
    status: 'scored',
    value: 4,
    anchorId: c.anchorId,
    fragmentId: c.fragmentId,
    originalVersionId: c.originalVersionId,
    rationale: 'synthetic AI rationale that must not be exported',
  });
  const result = await projectTalentExport(data, input);
  expect(result).toMatchObject({ rows: 3, skipped: 1 });
  expect(JSON.stringify(result)).not.toContain('AI rationale');
  expect(result.data.some((row) => row.confirmationId === 'suggestion')).toBe(
    false,
  );
});
it.each([
  'anchor',
  'dimension',
  'rule',
  'actor',
  'version',
  'withdrawal',
  'value',
  'source-category',
] as const)(
  'fails unavailable for missing or inconsistent authorized %s facts',
  async (field) => {
    const data = snapshot();
    if (field === 'anchor') data.anchors = [];
    if (field === 'dimension') data.dimensions = [];
    if (field === 'rule') data.ruleVersions = [];
    if (field === 'actor')
      data.directory.people.find((p) => p.id === 'actor')!.name = '';
    if (field === 'version') data.versions = [];
    if (field === 'withdrawal')
      Reflect.deleteProperty(data.events[0]!, 'withdrawnAt');
    if (field === 'value') data.confirmations[0]!.value = 6;
    if (field === 'source-category')
      data.confirmations[0]!.sourceCategory = 'original';
    await expect(projectTalentExport(data, input)).rejects.toMatchObject({
      code: 'unavailable',
    });
  },
);
it('a mixed HR/evaluator account cannot use its evaluator relationship to expand the export grant', async () => {
  const data = snapshot('hr');
  data.context.evaluationNodes.push({
    id: 'node-hidden',
    kind: 'defense',
    cohortId: 'other-cohort',
  });
  data.nodes.push({
    id: 'node-hidden',
    kind: 'defense',
    cohortId: 'other-cohort',
    name: '演示·其他节点',
  });
  data.context.evaluationNodeSubjects.push({
    evaluationNodeId: 'node-hidden',
    personId: 'two',
  });
  data.context.evaluationRelations.push({
    id: 'other-relation',
    evaluationNodeId: 'node-hidden',
    personId: 'two',
    evaluatorId: 'actor',
    kind: 'judge',
    validFrom: '2026-01-01',
    validTo: null,
    revokedAt: null,
  });
  const event = {
    ...data.events[0]!,
    id: 'event-hidden',
    personId: 'two',
    evaluationNodeId: 'node-hidden',
  };
  data.events.push(event);
  data.fragments.push({ ...data.fragments[0]!, id: 'fragment-hidden' });
  data.eventSources.push({
    eventId: event.id,
    fragmentId: 'fragment-hidden',
    originalVersionId: 'version',
  });
  data.confirmations.push({
    ...data.confirmations[0]!,
    id: 'confirmation-hidden',
    eventId: event.id,
    fragmentId: 'fragment-hidden',
  });
  data.reviews.push({
    id: 'review-hidden',
    eventId: event.id,
    dimensionId: 'prof',
    reason: 'score_gap',
    status: 'open',
    saveId: null,
    confirmationId: null,
    counterpartConfirmationId: null,
    withdrawnAt: null,
  });
  const result = await projectTalentExport(data, input);
  expect(result).toMatchObject({ rows: 4, skipped: 0 });
  expect(JSON.stringify(result)).not.toContain('event-hidden');
  expect(
    (await viewTalentExport(data)).scopes.some(
      (s) => s.id === 'node:node-hidden',
    ),
  ).toBe(false);
});
it('uses full event provenance explicitly when a row has no unique direct source association', async () => {
  const data = snapshot();
  data.confirmations[0]!.fragmentId = 'association-unavailable';
  const row = (await projectTalentExport(data, input)).data.find(
    (r) => r.confirmationId === 'event-0-prof',
  )!;
  expect(row.exactSource).toBeNull();
  expect(row.sources).toHaveLength(1);
  expect(row.quote).toBe('Synthetic observation');
});

it('calendar-month windows clamp at month end instead of drifting into the next month', () => {
  expect(exportFromDay('2024-05-31', 'last3Months')).toBe('2024-02-29');
  expect(exportFromDay('2025-02-28', 'last12Months')).toBe('2024-02-28');
  expect(exportFromDay('2026-09-04', 'all')).toBeNull();
});

it('single-person content is filtered by current role and selected subject, not by a forwarded person ID', async () => {
  const data = snapshot();
  const selected = await projectPersonExport(data, 'one');
  expect(selected.person).toMatchObject({ id: 'one', name: '演示·one' });
  expect(selected.projection.rows).toBe(4);
  expect(selected.projection.data.every((row) => row.personId === 'one')).toBe(
    true,
  );
  expect((await projectPersonExport(data, 'actor')).projection.rows).toBe(0);
  await expect(
    projectPersonExport(snapshot('hr'), 'two'),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await expect(projectPersonExport(data, 'missing')).rejects.toMatchObject({
    code: 'forbidden',
  });
});
