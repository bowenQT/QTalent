import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { z } from 'zod';
import {
  materialSourceSchema,
  type MaterialSourceLocation,
} from '../../../../contracts/sources';
import { createDatabase } from '../../../db/client';
import { commitJobUpdate } from '../../../jobs/repository';
import { newJob } from '../../../jobs/state';
import { jobSnapshots } from '../../../jobs/schema';
import {
  originals,
  originalVersions,
  fragments,
  materialParses,
  materialPdfPages,
} from '../schema';
import {
  MaterialStoreError,
  prepareMaterialParse,
  readMaterialParse,
  readMaterialFragment,
  writeMaterialParse,
} from './store';

const now = '2026-11-01T00:00:00.000Z';
const databaseName = `qtalent_material_${randomUUID().replaceAll('-', '')}_test`;
const queue = 'material-arrange-validation';
const contentDigest = createHash('sha256')
  .update('synthetic original bytes')
  .digest('hex');
let admin: Pool;
let connection: ReturnType<typeof createDatabase>;
let connectionUrl: string;
let boss: PgBoss;
const legacy = [
  { kind: 'document', page: 2, paragraph: 'legacy paragraph' },
  { kind: 'spreadsheet', sheet: '演示', cell: 'B2' },
  { kind: 'recording', startMs: 0, endMs: 50 },
  {
    kind: 'snapshot_field',
    fieldPath: 'demo.field',
    originalLocation: '演示来源',
  },
];
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'Real TEST_DATABASE_URL is required; no skip or fake database',
    );
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Only the authorized isolated test database is allowed');
  admin = new Pool({ connectionString: raw, max: 2 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connectionUrl = url.toString();
  connection = createDatabase(connectionUrl);
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  await connection.db
    .insert(originals)
    .values({
      id: 'demo-legacy-original',
      title: '演示旧来源',
      kind: 'original',
    });
  await connection.db
    .insert(originalVersions)
    .values({
      id: 'demo-legacy-version',
      originalId: 'demo-legacy-original',
      version: 1,
      contentDigest: 'legacy-non-sha-digest',
    });
  for (const [i, location] of legacy.entries())
    await connection.pool.query(
      'INSERT INTO records_fragments (id, original_version_id, location, excerpt) VALUES ($1,$2,$3,$4)',
      [
        `demo-legacy-${i}`,
        'demo-legacy-version',
        JSON.stringify(location),
        '演示旧原文',
      ],
    );
  // Default CI uses published migrations. The override is only X1's explicitly
  // supplied, unmodified native validation directory until final migration order.
  await migrate(connection.db, {
    migrationsFolder:
      process.env.QTALENT_926_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  boss = new PgBoss({ connectionString: connectionUrl });
  await boss.start();
  await boss.createQueue(queue);
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}, 30000);
const locations: MaterialSourceLocation[] = [
  { kind: 'pdf', page: 1, textRange: { start: 1, end: 3 } },
  { kind: 'presentation', slide: 2 },
  { kind: 'video', startMs: 0, endMs: 25 },
  { kind: 'image', region: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 } },
  {
    kind: 'code',
    repository: 'demo/repository',
    commit: 'a'.repeat(40),
    path: 'src/demo.ts',
    startLine: 1,
    endLine: 2,
  },
];
async function setup(location = locations[0]) {
  const key = randomUUID();
  const versionId = `demo-version-${key}`;
  const publication = {
    binding: {
      parseVersionId: `demo-parse-${key}`,
      originalVersionId: versionId,
      contentDigest,
      parserVersion: 'synthetic-test-parser-v1',
      projectionVersion: 'synthetic-test-location-v1',
    },
    fragments: [
      materialSourceSchema.parse({
        fragmentId: `demo-fragment-${key}`,
        originalVersionId: versionId,
        location,
        excerpt: location.kind === 'pdf' ? '😀' : '演示原文',
        demo: true,
        sourceCategory:
          location.kind === 'code' ? 'submitted_code_snapshot' : 'original',
        ...(location.kind === 'code'
          ? { displayNotice: '提交的代码快照' }
          : {}),
      }),
    ],
    pages:
      location.kind === 'pdf'
        ? [
            { page: 1, text: '演😀示' },
            { page: 2, text: '' },
          ]
        : [],
  };
  await connection.db
    .insert(originals)
    .values({
      id: `demo-original-${key}`,
      title: '演示原件',
      kind: 'original',
    });
  await connection.db
    .insert(originalVersions)
    .values({
      id: versionId,
      originalId: `demo-original-${key}`,
      version: 1,
      contentDigest,
    });
  const job = {
    ...newJob(
      {
        jobId: `demo-job-${key}`,
        kind: 'synthetic-parse-validation',
        resourceId: versionId,
        inputVersion: versionId,
      },
      now,
    ),
    status: 'running' as const,
  };
  await connection.db.insert(jobSnapshots).values(job);
  const fence = {
    jobId: job.jobId,
    attempt: 1,
    expectedRevision: 1,
    inputVersion: versionId,
  };
  return { publication, fence, job };
}
async function publish(input: Awaited<ReturnType<typeof setup>>) {
  return connection.db.transaction((tx) =>
    writeMaterialParse(tx, input.publication, input.fence),
  );
}

it('preserves all four old locations and original digest across the actual schema upgrade', async () => {
  const rows = await connection.db
    .select()
    .from(fragments)
    .where(eq(fragments.originalVersionId, 'demo-legacy-version'))
    .orderBy(fragments.id);
  expect(rows.map((row) => row.location)).toEqual(legacy);
  for (const row of rows)
    expect(row).toMatchObject({
      originalVersionId: 'demo-legacy-version',
      excerpt: '演示旧原文',
      parseVersionId: null,
      sourceCategory: null,
      evaluationKind: null,
      demo: null,
    });
  expect(
    (
      await connection.db
        .select()
        .from(originalVersions)
        .where(eq(originalVersions.id, 'demo-legacy-version'))
    )[0].contentDigest,
  ).toBe('legacy-non-sha-digest');
  await expect(
    connection.db.transaction((tx) =>
      readMaterialFragment(tx, 'demo-legacy-0', 'demo-legacy-version'),
    ),
  ).rejects.toBeInstanceOf(MaterialStoreError);
});

it.each(locations)(
  'round-trips $kind canonical facts through a fresh PG connection',
  async (location) => {
    const input = await setup(location);
    expect(await publish(input)).toBe('created');
    const fresh = createDatabase(connectionUrl);
    try {
      const read = await fresh.db.transaction(
        (tx) =>
          readMaterialFragment(
            tx,
            input.publication.fragments[0].fragmentId,
            input.publication.binding.originalVersionId,
          ),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      expect(read?.source).toEqual(input.publication.fragments[0]);
      expect(materialSourceSchema.parse(read?.source)).toEqual(
        input.publication.fragments[0],
      );
      expect(read?.binding).toEqual(input.publication.binding);
      const parse = await fresh.db.transaction((tx) =>
        readMaterialParse(tx, input.publication.binding.parseVersionId),
      );
      expect(parse).toEqual({
        ...prepareMaterialParse(input.publication),
        jobId: input.job.jobId,
        attempt: 1,
      });
    } finally {
      await fresh.pool.end();
    }
  },
);

it('serializes concurrent replay and persists/enqueues only once', async () => {
  const input = await setup();
  const ids: string[] = [];
  const commit = () =>
    connection.db.transaction(async (tx) => {
      const state = await writeMaterialParse(
        tx,
        input.publication,
        input.fence,
      );
      if (state === 'created') {
        const id = await boss.send(
          queue,
          { parseVersionId: input.publication.binding.parseVersionId },
          { db: fromDrizzle(tx, sql) },
        );
        if (!id) throw new Error('queue did not return an ID');
        ids.push(id);
      }
      return state;
    });
  expect((await Promise.all([commit(), commit()])).sort()).toEqual([
    'created',
    'existing',
  ]);
  expect(ids).toHaveLength(1);
  expect(await boss.getJobById(queue, ids[0])).toMatchObject({
    data: { parseVersionId: input.publication.binding.parseVersionId },
  });
  expect(
    await connection.db
      .select()
      .from(materialParses)
      .where(eq(materialParses.id, input.publication.binding.parseVersionId)),
  ).toHaveLength(1);
});

it('rolls back native fragments, pages, parse facts, job completion and real pg-boss enqueue together', async () => {
  const input = await setup();
  let queueId: string | null = null;
  await expect(
    commitJobUpdate(
      connection.db,
      input.job.jobId,
      {
        attempt: 1,
        expectedRevision: 1,
        status: 'completed',
        result: { done: true },
      },
      now,
      z.strictObject({ done: z.boolean() }),
      async (tx) => {
        await writeMaterialParse(tx, input.publication, input.fence);
        queueId = await boss.send(
          queue,
          { parseVersionId: input.publication.binding.parseVersionId },
          { db: fromDrizzle(tx, sql) },
        );
        throw new Error('synthetic failure after actual enqueue');
      },
    ),
  ).rejects.toThrow('synthetic failure');
  expect(queueId).not.toBeNull();
  expect(await boss.getJobById(queue, queueId!)).toBeNull();
  expect(
    await readMaterialParse(
      connection.db,
      input.publication.binding.parseVersionId,
    ),
  ).toBeNull();
  expect(
    await connection.db
      .select()
      .from(fragments)
      .where(
        eq(
          fragments.originalVersionId,
          input.publication.binding.originalVersionId,
        ),
      ),
  ).toEqual([]);
  expect(
    await connection.db
      .select()
      .from(materialPdfPages)
      .where(
        eq(
          materialPdfPages.parseVersionId,
          input.publication.binding.parseVersionId,
        ),
      ),
  ).toEqual([]);
  expect(
    (
      await connection.db
        .select()
        .from(jobSnapshots)
        .where(eq(jobSnapshots.jobId, input.job.jobId))
    )[0],
  ).toMatchObject({ status: 'running', revision: 1 });
  await commitJobUpdate(
    connection.db,
    input.job.jobId,
    {
      attempt: 1,
      expectedRevision: 1,
      status: 'completed',
      result: { done: true },
    },
    now,
    z.strictObject({ done: z.boolean() }),
    async (tx) => {
      expect(await writeMaterialParse(tx, input.publication, input.fence)).toBe(
        'created',
      );
      await boss.send(
        queue,
        { parseVersionId: input.publication.binding.parseVersionId },
        { db: fromDrizzle(tx, sql) },
      );
    },
  );
  expect(
    (
      await connection.db
        .select()
        .from(jobSnapshots)
        .where(eq(jobSnapshots.jobId, input.job.jobId))
    )[0],
  ).toMatchObject({ status: 'completed', revision: 2 });
  expect(
    await connection.db.transaction((tx) =>
      writeMaterialParse(tx, input.publication, {
        ...input.fence,
        expectedRevision: 2,
      }),
    ),
  ).toBe('existing');
});

it.each(['attempt', 'revision', 'input', 'cancel', 'completed-without-facts'])(
  'rejects a stale %s publication before writes',
  async (kind) => {
    const input = await setup();
    if (kind === 'attempt') input.fence.attempt = 2;
    if (kind === 'revision') input.fence.expectedRevision = 2;
    if (kind === 'input') input.fence.inputVersion = 'changed';
    if (kind === 'cancel')
      await connection.db
        .update(jobSnapshots)
        .set({ cancelRequestedAt: now })
        .where(eq(jobSnapshots.jobId, input.job.jobId));
    if (kind === 'completed-without-facts')
      await connection.db
        .update(jobSnapshots)
        .set({ status: 'completed' })
        .where(eq(jobSnapshots.jobId, input.job.jobId));
    await expect(publish(input)).rejects.toMatchObject({
      code: 'material_conflict',
    });
    expect(
      await readMaterialParse(
        connection.db,
        input.publication.binding.parseVersionId,
      ),
    ).toBeNull();
  },
);

it.each([
  'same-id-content',
  'original-digest',
  'fragment-version',
  'duplicate-fragment',
  'page-range',
])('fails closed for %s mismatch', async (kind) => {
  const input = await setup(locations[1]);
  if (kind === 'same-id-content') {
    await publish(input);
    input.publication.fragments[0].excerpt = 'changed private excerpt';
  }
  if (kind === 'original-digest')
    input.publication.binding.contentDigest = 'a'.repeat(64);
  if (kind === 'fragment-version')
    input.publication.fragments[0].originalVersionId = 'other-version';
  if (kind === 'duplicate-fragment')
    input.publication.fragments.push({ ...input.publication.fragments[0] });
  if (kind === 'page-range')
    input.publication.fragments[0].location = {
      kind: 'pdf',
      page: 1,
      textRange: { start: 0, end: 9 },
    };
  await expect(publish(input)).rejects.toBeInstanceOf(MaterialStoreError);
});

it.each(['page-digest', 'quote', 'original', 'result-digest'])(
  'rejects read-back %s corruption',
  async (kind) => {
    const input = await setup();
    await publish(input);
    if (kind === 'page-digest')
      await connection.db
        .update(materialPdfPages)
        .set({ textDigest: 'b'.repeat(64) })
        .where(
          eq(
            materialPdfPages.parseVersionId,
            input.publication.binding.parseVersionId,
          ),
        );
    if (kind === 'quote')
      await connection.db
        .update(fragments)
        .set({ excerpt: 'changed' })
        .where(eq(fragments.id, input.publication.fragments[0].fragmentId));
    if (kind === 'original')
      await connection.db
        .update(originalVersions)
        .set({ contentDigest: 'b'.repeat(64) })
        .where(
          eq(originalVersions.id, input.publication.binding.originalVersionId),
        );
    if (kind === 'result-digest')
      await connection.db
        .update(materialParses)
        .set({ resultDigest: 'b'.repeat(64) })
        .where(eq(materialParses.id, input.publication.binding.parseVersionId));
    await expect(
      connection.db.transaction((tx) =>
        readMaterialFragment(
          tx,
          input.publication.fragments[0].fragmentId,
          input.publication.binding.originalVersionId,
        ),
      ),
    ).rejects.toBeInstanceOf(MaterialStoreError);
  },
);

it('does not resolve a valid fragment using another original version or expose SQL details', async () => {
  const input = await setup();
  await publish(input);
  expect(
    await readMaterialFragment(
      connection.db,
      input.publication.fragments[0].fragmentId,
      'other-version',
    ),
  ).toBeNull();
  expect(await readMaterialParse(connection.db, 'missing-parse')).toBeNull();
  const conflicting = await setup(locations[1]);
  conflicting.publication.fragments[0].fragmentId =
    input.publication.fragments[0].fragmentId;
  try {
    await publish(conflicting);
    throw new Error('expected conflict');
  } catch (error) {
    expect(error).toBeInstanceOf(MaterialStoreError);
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('query');
    expect(String(error)).not.toContain('演示原文');
  }
  expect(
    await readMaterialParse(
      connection.db,
      conflicting.publication.binding.parseVersionId,
    ),
  ).toBeNull();
});
