import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizedModelInput,
  readTalentCollection,
  readTalentRecord,
  readTalentSource,
} from '@/server/authz/talent';
import {
  allowedReference,
  evidenceFixture,
  mixedReference,
  type DemoRole,
} from './fixtures';

describe('BOW-871 baseline C1/C3: current public evidence boundaries', () => {
  it.each([
    [
      'manager',
      ['demo-record', 'demo-outside-record', 'demo-personnel-record'],
    ],
    ['hr', ['demo-record', 'demo-personnel-record']],
    ['mentor', ['demo-record']],
    ['admin', []],
  ] satisfies [DemoRole, string[]][])(
    'filters items and counts for %s before returning them',
    async (role, ids) => {
      const snapshot = evidenceFixture(role);
      const result = await readTalentCollection(
        async () => snapshot,
        'person-profile',
      );
      expect(result.items.map((item) => item.id)).toEqual(ids);
      expect(result.total).toBe(ids.length);
      if (role === 'admin') {
        // Even a stale company-wide business grant cannot turn admin into HR.
        expect(snapshot.context.grants[0].role).toBe('manager');
        expect(result).toEqual({ items: [], total: 0 });
      }
    },
  );

  it.each(['hr', 'mentor'] as const)(
    '%s cannot distinguish an out-of-scope object ID from a missing ID',
    async (role) => {
      const snapshot = evidenceFixture(role);
      const load = async () => snapshot;
      const own = await readTalentRecord(load, 'demo-record', 'person-preview');
      expect(own?.fields.fact).toBe('演示：独立复现了失败片段。');
      expect(
        await readTalentRecord(load, 'demo-outside-record', 'person-preview'),
      ).toBeNull();
      expect(
        await readTalentRecord(load, 'demo-missing-record', 'person-preview'),
      ).toBeNull();
    },
  );

  it.each(['hr', 'mentor'] as const)(
    '%s receives neither a mixed fragment nor fields inferred from it',
    async (role) => {
      const snapshot = evidenceFixture(role);
      const load = async () => snapshot;
      // Positive control: this is not a blanket denial or broken fixture.
      expect(await readTalentSource(load, allowedReference)).toEqual({
        ...allowedReference,
        excerpt: '演示：记录一次片段重试行为。',
        location: { kind: 'spreadsheet', sheet: '演示评审表', cell: 'A2:D2' },
      });
      expect(await readTalentSource(load, mixedReference)).toBeNull();
      const record = await readTalentRecord(
        load,
        'demo-record',
        'person-profile',
      );
      expect(record?.fields).toEqual({ fact: '演示：独立复现了失败片段。' });
      expect(record?.fieldKinds).toEqual({ fact: 'evaluation' });
      expect(record?.sources.map((source) => source.fragmentId)).toEqual([
        'demo-allowed',
      ]);
      expect(JSON.stringify(record)).not.toMatch(/DEMO_MIXED|demo-mixed/);
    },
  );

  it('requires the fragment and original version to match as one citation', async () => {
    const snapshot = evidenceFixture('manager');
    const load = async () => snapshot;
    expect(await readTalentSource(load, allowedReference)).not.toBeNull();
    expect(
      await readTalentSource(load, {
        ...allowedReference,
        originalVersionId: 'demo-unrelated-v2',
      }),
    ).toBeNull();
    snapshot.records[0].fields[0].sources[0].originalVersionId =
      'demo-unrelated-v2';
    const result = await readTalentRecord(
      load,
      'demo-record',
      'person-profile',
    );
    expect(result?.fields).not.toHaveProperty('fact');
  });

  it.each(['hr', 'mentor'] as const)(
    '%s has no evidence access at the grant expiry boundary',
    async (role) => {
      const snapshot = evidenceFixture(role);
      snapshot.context.grants[0].validTo = '2026-10-31T10:00:01Z';
      const load = vi.fn(async () => snapshot);
      expect(
        (await readTalentCollection(load, 'workbench')).total,
      ).toBeGreaterThan(0);
      snapshot.context.now = '2026-10-31T10:00:01Z';
      expect(await readTalentCollection(load, 'workbench')).toEqual({
        items: [],
        total: 0,
      });
      expect(await readTalentSource(load, allowedReference)).toBeNull();
      expect(await buildAuthorizedModelInput(load)).toEqual({ items: [] });
      expect(load).toHaveBeenCalledTimes(4);
    },
  );

  it('reloads the current identity rather than reusing an earlier visible ID list', async () => {
    const snapshot = evidenceFixture('manager');
    const load = vi.fn(async () => snapshot);
    expect(
      await readTalentRecord(load, 'demo-record', 'person-profile'),
    ).not.toBeNull();
    snapshot.context.account = {
      id: 'demo-switched-account',
      personId: 'demo-other-actor',
      isSystemAdmin: false,
    };
    expect(
      await readTalentRecord(load, 'demo-record', 'person-profile'),
    ).toBeNull();
    expect(await readTalentSource(load, allowedReference)).toBeNull();
    expect(await buildAuthorizedModelInput(load)).toEqual({ items: [] });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('expires the mentor relationship independently of a still-current role grant', async () => {
    const snapshot = evidenceFixture('mentor');
    const load = async () => snapshot;
    expect(await readTalentSource(load, allowedReference)).not.toBeNull();
    snapshot.context.assignments[0].revokedAt = snapshot.context.now;
    expect(await readTalentSource(load, allowedReference)).toBeNull();
    expect(await readTalentCollection(load, 'person-profile')).toEqual({
      items: [],
      total: 0,
    });
  });
});

describe('BOW-871 baseline C3: actual model-input projection', () => {
  it.each([
    ['manager', ['demo-record', 'demo-outside-record']],
    ['hr', ['demo-record']],
    ['mentor', ['demo-record']],
    ['admin', []],
  ] satisfies [DemoRole, string[]][])(
    'projects the currently permitted input for %s without personnel history',
    async (role, ids) => {
      const snapshot = evidenceFixture(role);
      const result = await buildAuthorizedModelInput(async () => snapshot);
      expect(result.items.map((item) => item.id)).toEqual(ids);
      expect(JSON.stringify(result)).not.toMatch(
        /DEMO_PERSONNEL|demo-personnel/,
      );
      if (role === 'hr' || role === 'mentor') {
        expect(JSON.stringify(result)).not.toMatch(
          /DEMO_MIXED|demo-mixed|DEMO_OUTSIDE/,
        );
      }
    },
  );

  it('fails closed when the complete subject set of a contributing source is unknown', async () => {
    const snapshot = evidenceFixture('manager');
    snapshot.sources.forEach((source) => {
      source.subjects = [];
    });
    expect(await buildAuthorizedModelInput(async () => snapshot)).toEqual({
      items: [],
    });
  });

  it('does not forward raw source access metadata as model input', async () => {
    const snapshot = evidenceFixture('mentor');
    const result = await buildAuthorizedModelInput(async () => snapshot);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sources[0]).not.toHaveProperty('subjects');
    expect(result.items[0].sources[0]).not.toHaveProperty('requiredKinds');
    expect(result.items[0].sources[0].location).toEqual({
      kind: 'spreadsheet',
      sheet: '演示评审表',
      cell: 'A2:D2',
    });
  });
});
