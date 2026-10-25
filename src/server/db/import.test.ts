import { beforeEach, expect, it, vi } from 'vitest';
import type { Database } from './client';
import { importDemo, runImport } from './import';
import { mapPrototypeSeed, readPrototypeSeed } from './seed';
import { people, organizations } from '../modules/directory';
import { projects } from '../modules/staffing';
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
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) => ({
      onConflictDoNothing: async () => {
        records.push({ table, row });
      },
    }),
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
it('persists rules and isolated evidence snapshots in the existing transaction, reporting IDs only', async () => {
  const { importSnapshots, events } = await import('../modules/records');
  const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  const report = await importDemo(db, seed, 'Test-password-123');
  expect(records.filter((r) => r.table === importSnapshots)).toHaveLength(
    seed.evidence.snapshots.length,
  );
  expect(records.filter((r) => r.table === events)).toHaveLength(
    seed.evidence.events.length,
  );
  expect(report).toEqual({ gaps: seed.evidence.gaps });
});
