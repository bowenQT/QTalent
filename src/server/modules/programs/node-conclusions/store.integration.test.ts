import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, type Transaction } from '../../../db/client';
import { accountBindings, organizations, people } from '../../directory';
import { cohorts, evaluationNodes, evaluationNodeSubjects } from '..';
import { auditEvents } from '../../../platform/audit/schema';
import { type NodeConclusionVersion } from '../node-conclusion';
import {
  nodeConclusions,
  nodeConclusionVersions,
  nodeConclusionOperations,
} from './schema';
import { createPostgresNodeConclusionStore } from './store';

const databaseName = `qtalent_b902_store_${randomUUID().replaceAll('-', '')}_test`;
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const db = () => connection!.db;
const identity = { evaluationNodeId: 'demo-defense', personId: 'demo-person' };
const accountId = 'demo-hr-account';
const fingerprint = 'a'.repeat(64);
// These signed synthetic rows test persistence, not the upstream score selector.
// The native usecase suite must build actual human confirmations through 846.
function version(number = 1): NodeConclusionVersion {
  return {
    id: 'demo-conclusion',
    ...identity,
    version: number,
    conclusionType: 'defense',
    origin: 'human_conclusion',
    conclusion: `演示：第${number}版人工答辩结论`,
    confirmedBy: { id: 'demo-hr', name: '演示HR' },
    confirmedAt: '2026-11-01T01:00:00.000Z',
    basis: {
      scoreConfirmationRevision: 'demo-score-snapshot',
      confirmations: [
        {
          confirmationId: 'demo-confirmation',
          evaluatorId: 'demo-judge',
          version: 1,
          confirmedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      references: [
        {
          fragmentId: 'demo-fragment',
          originalVersionId: 'demo-original-v1',
          location: { kind: 'presentation', slide: 2 },
        },
      ],
    },
  };
}
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error('TEST_DATABASE_URL required; no fake/skip fallback');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback _test database allowed');
  admin = new Pool({
    connectionString: source,
    max: 2,
    connectionTimeoutMillis: 3000,
  });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.BOW902_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  // No CREATE TABLE fallback: missing controlled migrations must fail loudly.
  await db().select().from(nodeConclusions).limit(1);
}, 30000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        if (created)
          await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      } finally {
        await admin.end();
      }
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql`TRUNCATE directory_organizations, programs_cohorts, audit_events CASCADE`,
  );
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      ['demo-person', 'demo-other', 'demo-hr'].map((id) => ({
        id,
        name: '演示·' + id,
        organizationId: 'demo-org',
      })),
    );
  await db().insert(accountBindings).values({ accountId, personId: 'demo-hr' });
  await db().insert(cohorts).values({ id: 'demo-cohort', name: '演示期次' });
  await db().insert(evaluationNodes).values({
    id: identity.evaluationNodeId,
    name: '演示答辩',
    kind: 'defense',
    cohortId: 'demo-cohort',
  });
  await db()
    .insert(evaluationNodeSubjects)
    .values([identity, { ...identity, personId: 'demo-other' }]);
});
function store() {
  return createPostgresNodeConclusionStore(db());
}
async function append(
  tx: Transaction,
  number: number,
  operationId = 'demo-op-' + number,
) {
  const adapter = store();
  const record = version(number);
  await adapter.appendVersion(tx, record, number - 1);
  await adapter.appendAudit(tx, {
    accountId,
    action: 'node_conclusion.confirm',
    conclusionId: record.id,
  });
  await adapter.saveOperation(tx, accountId, operationId, {
    fingerprint,
    conclusion: record,
  });
  return record;
}
async function counts() {
  return {
    roots: (await db().select().from(nodeConclusions)).length,
    versions: (await db().select().from(nodeConclusionVersions)).length,
    operations: (await db().select().from(nodeConclusionOperations)).length,
    audits: (await db().select().from(auditEvents)).length,
  };
}
it('appends immutable versions and reads the exact successful operation after a new adapter instance', async () => {
  await db().transaction((tx) => append(tx, 1));
  await db().transaction((tx) => append(tx, 2));
  const restored = store();
  await db().transaction(async (tx) => {
    expect(await restored.readCurrent(tx, identity)).toEqual(version(2));
    expect(await restored.readVersion(tx, identity, 1)).toEqual(version(1));
    expect(await restored.readOperation(tx, accountId, 'demo-op-1')).toEqual({
      fingerprint,
      conclusion: version(1),
    });
    expect(await restored.readOperation(tx, accountId, 'demo-op-2')).toEqual({
      fingerprint,
      conclusion: version(2),
    });
    expect(
      await restored.readOperation(tx, 'demo-other-account', 'demo-op-1'),
    ).toBeNull();
    expect(await restored.readVersion(tx, identity, 3)).toBeNull();
    expect(
      await restored.readCurrent(tx, { ...identity, personId: 'demo-other' }),
    ).toBeNull();
  });
  expect(await counts()).toEqual({
    roots: 1,
    versions: 2,
    operations: 2,
    audits: 2,
  });
  expect(
    await db()
      .select({
        actorId: auditEvents.actorId,
        action: auditEvents.action,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents),
  ).toEqual([
    {
      actorId: accountId,
      action: 'node_conclusion.confirm',
      resourceId: 'demo-conclusion',
    },
    {
      actorId: accountId,
      action: 'node_conclusion.confirm',
      resourceId: 'demo-conclusion',
    },
  ]);
});
it.each([0, 1])(
  'serializes two expected-version %i writers with one winner, preserving earlier history',
  async (expected) => {
    if (expected === 1) await db().transaction((tx) => append(tx, 1));
    const attempt = (suffix: string) =>
      db().transaction((tx) => append(tx, expected + 1, 'demo-race-' + suffix));
    const results = await Promise.allSettled([attempt('a'), attempt('b')]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'conflict' },
    });
    expect(await counts()).toEqual({
      roots: 1,
      versions: expected + 1,
      operations: expected + 1,
      audits: expected + 1,
    });
    await db().transaction(async (tx) =>
      expect(await store().readVersion(tx, identity, 1)).toEqual(version(1)),
    );
  },
);
it.each([-1, 0.5, 2])(
  'rejects wrong expected version %s without leaving an identity',
  async (expected) => {
    await expect(
      db().transaction((tx) => store().appendVersion(tx, version(1), expected)),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await counts()).toEqual({
      roots: 0,
      versions: 0,
      operations: 0,
      audits: 0,
    });
  },
);
it('rejects a missing predecessor rather than creating version two', async () => {
  await expect(
    db().transaction((tx) => store().appendVersion(tx, version(2), 1)),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await counts()).toEqual({
    roots: 0,
    versions: 0,
    operations: 0,
    audits: 0,
  });
});
it('does not move an established conclusion id to another subject', async () => {
  await db().transaction((tx) => append(tx, 1));
  await expect(
    db().transaction((tx) =>
      store().appendVersion(tx, { ...version(1), personId: 'demo-other' }, 0),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    db().transaction((tx) =>
      store().appendVersion(
        tx,
        { ...version(2), id: 'demo-new-conclusion' },
        1,
      ),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await counts()).toEqual({
    roots: 1,
    versions: 1,
    operations: 1,
    audits: 1,
  });
});
it('a duplicate operation with a new version rolls back that version and audit', async () => {
  await db().transaction((tx) => append(tx, 1, 'demo-one-operation'));
  await expect(
    db().transaction((tx) => append(tx, 2, 'demo-one-operation')),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await counts()).toEqual({
    roots: 1,
    versions: 1,
    operations: 1,
    audits: 1,
  });
  await db().transaction(async (tx) =>
    expect(
      await store().readOperation(tx, accountId, 'demo-one-operation'),
    ).toEqual({ fingerprint, conclusion: version(1) }),
  );
});
it('never stores a replay payload that differs from its immutable target', async () => {
  await db().transaction((tx) => append(tx, 1));
  await expect(
    db().transaction((tx) =>
      store().saveOperation(tx, accountId, 'demo-forged-replay', {
        fingerprint,
        conclusion: { ...version(1), conclusion: '演示：试图改写旧结论' },
      }),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    db().transaction((tx) =>
      store().saveOperation(tx, accountId, 'demo-invalid-fingerprint', {
        fingerprint: 'private-invalid-fingerprint',
        conclusion: version(1),
      }),
    ),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await counts()).toEqual({
    roots: 1,
    versions: 1,
    operations: 1,
    audits: 1,
  });
});
it('late transaction failure rolls back the root, signed version, audit and operation together', async () => {
  await expect(
    db().transaction(async (tx) => {
      await append(tx, 1);
      throw new Error('synthetic late failure');
    }),
  ).rejects.toThrow('synthetic late failure');
  expect(await counts()).toEqual({
    roots: 0,
    versions: 0,
    operations: 0,
    audits: 0,
  });
});
it('an actual operation foreign-key failure rolls back its preceding version and audit', async () => {
  await expect(
    db().transaction(async (tx) => {
      const adapter = store();
      const record = version(1);
      await adapter.appendVersion(tx, record, 0);
      await adapter.appendAudit(tx, {
        accountId,
        action: 'node_conclusion.confirm',
        conclusionId: record.id,
      });
      await adapter.saveOperation(tx, 'demo-missing-account', 'demo-op', {
        fingerprint,
        conclusion: record,
      });
    }),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await counts()).toEqual({
    roots: 0,
    versions: 0,
    operations: 0,
    audits: 0,
  });
});
it('does not persist caller mutations after a successful append', async () => {
  const record = version(1);
  await db().transaction((tx) => store().appendVersion(tx, record, 0));
  record.conclusion = '演示：客户端本地变化';
  record.basis.references[0].fragmentId = 'demo-changed';
  const [row] = await db()
    .select()
    .from(nodeConclusionVersions)
    .where(eq(nodeConclusionVersions.version, 1));
  expect(row.payload).toEqual(version(1));
});
