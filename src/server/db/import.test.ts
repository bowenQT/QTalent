import { beforeEach, expect, it, vi } from 'vitest';
import type { Database } from './client';
import { importDemo, importEvidence, runImport } from './import';
import { mapPrototypeSeed, readPrototypeSeed } from './seed';
import { people, organizations } from '../modules/directory';
import { projects } from '../modules/staffing';
import { originals } from '../modules/records';
const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  env: vi.fn(),
  connection: vi.fn(),
}));
vi.mock('better-auth/crypto', () => ({ hashPassword: mocks.hash }));
vi.mock('../env', () => ({ getEnv: mocks.env }));
vi.mock('./client', () => ({ createDatabase: mocks.connection }));
const records: { table: unknown; row: Record<string, unknown> }[] = [];
const tx = {
  select: () => ({
    from: (table: unknown) => ({
      where: async () =>
        records.filter((row) => row.table === table).map((row) => row.row),
    }),
  }),
  execute: vi.fn(async () => ({ rows: [] })),
  insert: (table: unknown) => ({
    values: (input: Record<string, unknown> | Record<string, unknown>[]) => {
      const rows = Array.isArray(input) ? input : [input];
      const save = async () => {
        records.push(...rows.map((row) => ({ table, row })));
        return rows;
      };
      return { onConflictDoNothing: () => ({ returning: save }) };
    },
  }),
};
const transaction = vi.fn(async (cb: (db: typeof tx) => Promise<void>) =>
  cb(tx),
);
const db = { transaction } as unknown as Database;
beforeEach(() => {
  records.length = 0;
  vi.clearAllMocks();
  mocks.hash.mockResolvedValue('opaque-hash');
  mocks.env.mockReturnValue({ APP_ENV: 'test' });
});
it('direct demo import refuses production before hashing or opening a transaction', async () => {
  mocks.env.mockReturnValue({ APP_ENV: 'production' });
  await expect(
    importDemo(
      db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
      'Test-password-123',
    ),
  ).rejects.toThrow(/production/);
  expect(mocks.hash).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});
it.each(['quote', 'owner'])(
  'rejects a changed raw %s before assigning fixed snapshot provenance',
  async (change) => {
    const raw = readPrototypeSeed(process.cwd());
    if (change === 'quote')
      raw.EVENTS[0].srcs[0].quote += ' Synthetic forged addition';
    else {
      const key = 'events[' + raw.EVENTS[0].id + '].srcs[0]';
      raw.SNAPSHOT_FIELD_SOURCES[key] =
        raw.SNAPSHOT_FIELD_SOURCES[key] === 'data.js'
          ? 'data-xe6.js'
          : 'data.js';
    }
    await expect(
      importDemo(db, mapPrototypeSeed(raw), 'Test-password-123'),
    ).rejects.toThrow(/verified snapshot/);
    expect(transaction).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
  },
);
it.each([
  {
    originals: [
      { id: 'test-original', title: 'Synthetic', kind: 'prototype_snapshot' },
    ],
  },
  { demo: true, originals: [{ id: 'test-original', title: 'Synthetic' }] },
  { mode: 'demo' },
  {
    events: [
      {
        id: 'test-event',
        personId: 'test-person',
        recorderId: 'test-recorder',
        occurredOn: '2026-07-24',
        title: 'Synthetic',
        situation: 'Synthetic',
        behavior: 'Synthetic',
        impact: '',
        ruleVersionId: 'test-rule',
        demo: true,
      },
    ],
  },
  {
    confirmations: [{ id: 'test-score', sourceCategory: 'prototype_baseline' }],
  },
])(
  'formal entry rejects client demo/baseline controls before any transaction',
  async (input) => {
    await expect(importEvidence(db, input)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  },
);
it('formal entry performs actual insertion for an ordinary original batch', async () => {
  await importEvidence(db, {
    originals: [{ id: 'test-original', title: 'Synthetic original' }],
  });
  expect(
    records.filter((r) => r.table === originals).map((r) => r.row),
  ).toEqual([
    {
      id: 'test-original',
      title: 'Synthetic original',
      kind: 'original',
      displayNotice: null,
    },
  ]);
});
it('rejects weak/missing seed passwords before hashing or database access', async () => {
  await expect(
    importDemo(db, mapPrototypeSeed(readPrototypeSeed(process.cwd())), 'weak'),
  ).rejects.toThrow('12 characters');
  expect(transaction).not.toHaveBeenCalled();
  expect(mocks.hash).not.toHaveBeenCalled();
});
it('imports validated prototype facts deterministically in one transaction without overwriting user changes', async () => {
  const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  await importDemo(db, seed, 'Test-password-123');
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(records.filter((r) => r.table === people)).toHaveLength(
    seed.people.length,
  );
  expect(records.filter((r) => r.table === organizations)[0].row).toEqual({
    id: seed.organizations[0].id,
    name: seed.organizations[0].name,
    shortName: seed.organizations[0].name,
  });
  expect(records.find((r) => r.table === projects)?.row).toMatchObject({
    id: seed.projects[0].id,
    isTopic: seed.projects[0].isTopic,
    cohortId: seed.projects[0].cohortId,
  });
  const first = structuredClone(records.map((r) => r.row));
  records.length = 0;
  await importDemo(db, seed, 'Test-password-123');
  expect(records.map((r) => r.row)).toEqual(first);
  expect(JSON.stringify(records.map((r) => r.row))).not.toContain(
    'Test-password-123',
  );
});
it('preserves historical prototype project type labels independently of create input enum', async () => {
  const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  await importDemo(db, seed, 'Test-password-123');
  expect(
    records.filter((r) => r.table === projects).map((r) => r.row.type),
  ).toContain('XEngineer 课题');
});
it('CLI import refuses production and missing password before opening database', async () => {
  mocks.env.mockReturnValue({ APP_ENV: 'production' });
  await expect(runImport()).rejects.toThrow('forbidden');
  mocks.env.mockReturnValue({ APP_ENV: 'test' });
  await expect(runImport()).rejects.toThrow('DEMO_PASSWORD');
  expect(mocks.connection).not.toHaveBeenCalled();
});
it('CLI closes its pool even when import fails', async () => {
  const end = vi.fn();
  mocks.env.mockReturnValue({
    APP_ENV: 'test',
    DEMO_PASSWORD: 'Test-password-123',
    DATABASE_URL: 'postgres://localhost/test',
  });
  mocks.connection.mockReturnValue({
    db: {
      transaction: async () => {
        throw new Error('db failure');
      },
    },
    pool: { end },
  });
  await expect(runImport()).rejects.toThrow('db failure');
  expect(end).toHaveBeenCalledOnce();
});
