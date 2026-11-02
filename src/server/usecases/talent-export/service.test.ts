import { expect, it } from 'vitest';
import { createTalentExportService } from './service';
import { memoryFixture, openReview } from './test-helpers';
function fixture() {
  const { f, store } = memoryFixture();
  const service = createTalentExportService({
    store,
    businessNow: () => new Date('2026-09-04T00:00:00Z'),
    wallNow: () => new Date('2026-11-01T12:00:00Z'),
  });
  return { f, store, service };
}
const request = { scopeId: 'all', range: 'all' };
it('generates auditable fresh content and keeps actual wall time distinct from demo business day', async () => {
  const { f, service } = fixture();
  const file = await service.generate('account', request);
  expect(file).toMatchObject({
    at: '2026-11-01 20:00',
    projection: { rows: 4, asOf: '2026-09-04' },
  });
  expect(file!.csv).toContain('业务口径截至');
  expect(file!.csv).toContain('演示基线（无人工确认时刻）');
  expect(f.reads).toBe(2);
  expect(f.audits).toEqual([{ phase: 'generate', outcome: 'success' }]);
});
it('download regenerates against current reviews instead of reusing the earlier generated CSV', async () => {
  const { f, service } = fixture();
  const first = await service.generate('account', request);
  openReview(f.data);
  const current = await service.download('account', request);
  expect(first!.projection.rows).toBe(4);
  expect(current!.projection.rows).toBe(3);
  expect(
    current!.projection.data.some(
      (row) => row.confirmationId === 'event-0-prof',
    ),
  ).toBe(false);
  expect(f.audits.at(-1)).toEqual({ phase: 'download', outcome: 'success' });
});
it.each(['review', 'permission', 'withdrawal', 'confirmation'] as const)(
  'rejects %s changes after initial read; no earlier bytes or successful audit survive',
  async (mode) => {
    const { f, service } = fixture();
    f.change = (read) => {
      if (read !== 2) return;
      if (mode === 'review') openReview(f.data);
      if (mode === 'permission')
        f.data.context.grants[0]!.revokedAt = '2026-09-04';
      if (mode === 'withdrawal')
        f.data.events[0]!.withdrawnAt = new Date('2026-09-04');
      if (mode === 'confirmation') f.data.confirmations[0]!.active = false;
    };
    await expect(service.download('account', request)).rejects.toMatchObject({
      code: mode === 'permission' ? 'forbidden' : 'changed',
    });
    expect(f.audits).toEqual([
      {
        phase: 'download',
        outcome: mode === 'permission' ? 'denied' : 'failed',
      },
    ]);
  },
);
it('never provides content when audit is unavailable', async () => {
  const { f, service } = fixture();
  f.failAudit = true;
  await expect(service.download('account', request)).rejects.toMatchObject({
    code: 'audit_unavailable',
  });
  expect(f.audits).toEqual([]);
});
it('proven empty is empty, while a read failure is unavailable and audited', async () => {
  const { f, store, service } = fixture();
  expect(
    await service.generate('account', { ...request, range: 'last3Months' }),
  ).toBeNull();
  expect(f.audits[0]!.outcome).toBe('empty');
  store.readSnapshot = async () => {
    throw new Error('synthetic private diagnostic');
  };
  await expect(service.generate('account', request)).rejects.toMatchObject({
    code: 'unavailable',
  });
  expect(f.audits.at(-1)!.outcome).toBe('failed');
});
it('view contains counts only and cannot hand unfiltered records to the page', async () => {
  const { service } = fixture();
  const view = await service.view('account');
  expect(Object.keys(view.scopes[0]!.previews.all).sort()).toEqual([
    'people',
    'rows',
    'skipped',
  ]);
  expect(JSON.stringify(view)).not.toContain('confirmationId');
  expect(JSON.stringify(view)).not.toContain('Synthetic observation');
});
it('does not trust caller-supplied account or person lists, nor a mismatched server snapshot', async () => {
  const { service } = fixture();
  await expect(
    service.generate('account', {
      ...request,
      accountId: 'other',
      personIds: ['two'],
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(service.generate('other', request)).rejects.toMatchObject({
    code: 'forbidden',
  });
  await expect(service.generate('', request)).rejects.toMatchObject({
    code: 'unauthenticated',
  });
});

it('prepares only verified single-person content and explicitly lists unavailable full-sheet sections', async () => {
  const { f, service } = fixture();
  const content = await service.person('account', { personId: 'one' });
  expect(content).toMatchObject({
    person: { id: 'one' },
    preparedAt: '2026-11-01 20:00',
    projection: { rows: 4 },
  });
  expect(content.unavailableSections).toEqual([
    'adopted_summary',
    'formal_position',
    'job_level_tenure',
    'complete_hidden_content_hint',
  ]);
  expect(content).not.toHaveProperty('formalPosition');
  expect(content).not.toHaveProperty('summary');
  expect(f.audits).toEqual([{ phase: 'print', outcome: 'success' }]);
  openReview(f.data);
  expect(
    (await service.person('account', { personId: 'one' })).projection.rows,
  ).toBe(3);
});
it('single-person preparation rejects newly opened reviews, revoked grants and injected fields before returning content', async () => {
  const { f, service } = fixture();
  await expect(
    service.person('account', { personId: 'one', scopeId: 'all' }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  f.change = (read) => {
    if (read === 2) openReview(f.data);
  };
  await expect(
    service.person('account', { personId: 'one' }),
  ).rejects.toMatchObject({ code: 'changed' });
  expect(f.audits).toEqual([
    { phase: 'print', outcome: 'failed' },
    { phase: 'print', outcome: 'failed' },
  ]);
  f.data.context.grants[0]!.revokedAt = '2026-09-04';
  await expect(
    service.person('account', { personId: 'one' }),
  ).rejects.toMatchObject({ code: 'forbidden' });
});
