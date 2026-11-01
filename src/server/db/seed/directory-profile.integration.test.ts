import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '../client';
import {
  people,
  organizations,
  accountBindings,
  grants,
} from '../../modules/directory';
import { cohorts, enrollments } from '../../modules/programs';
import {
  importDirectoryProfileSeed,
  importDirectoryProfileDemo,
  readDirectoryProfileSeed,
  DIRECTORY_PROFILE_DEMO_SOURCE,
} from './directory-profile';
import { importDemo } from '../import';
import { readPrototypeSeed, mapPrototypeSeed } from './index';
import { projectDirectoryProfile } from '../../modules/directory/profile';
import { loadPersonData } from '../../queries/person-data';
import { profileGate, personFromData } from '../../queries/person-projection';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let root: string;
const databaseName =
  'qtalent_directory_' + randomUUID().replaceAll('-', '') + '_test';
const db = () => connection!.db;
const input = () => ({
  kind: 'directory_demo_profile',
  peopleProvenance: 'synthetic_demo',
  version: 1,
  people: [
    {
      id: 'p',
      name: '合成化名（演示）',
      organizationId: 'leaf',
      demo: true,
      jobTitle: '合成开发工程师（演示）',
      jobLevel: '合成 N3（演示）',
    },
  ],
  organizations: [
    { id: 'leaf', name: '合成团队', parentId: 'root' },
    { id: 'root', name: '合成组织', parentId: null },
  ],
});
function source(value: unknown = input()) {
  const bytes = JSON.stringify(value);
  const relativeFile = randomUUID() + '.json';
  writeFileSync(join(root, relativeFile), bytes);
  return {
    relativeFile,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL required');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Loopback isolated _test database required');
  admin = new Pool({ connectionString: raw });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.DIRECTORY_PROFILE_TEST_MIGRATIONS ??
      'src/server/db/migrations',
  });
  root = mkdtempSync(join(tmpdir(), 'qtalent-directory-native-'));
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://synthetic:synthetic@localhost/synthetic_test',
  );
  vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-directory-test-secret-only');
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv('ACCESS_ENFORCED', 'false');
}, 30_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});
beforeEach(async () => {
  await db().execute(
    sql`TRUNCATE directory_organizations, programs_cohorts CASCADE`,
  );
  await db()
    .insert(organizations)
    .values([
      { id: 'root', name: '合成组织', shortName: '根' },
      { id: 'leaf', name: '合成团队', shortName: '组' },
    ]);
  await db()
    .insert(people)
    .values([
      { id: 'p', name: '合成化名（演示）', organizationId: 'leaf', demo: true },
      {
        id: 'outside',
        name: '范围外合成化名（演示）',
        organizationId: 'leaf',
        demo: true,
      },
      {
        id: 'actor',
        name: '合成操作者（演示）',
        organizationId: 'root',
        demo: true,
      },
    ]);
});
it('retains nullable legacy shape and adds only explicit facts; exact replay writes nothing', async () => {
  const [before] = await db().select().from(people).where(eq(people.id, 'p'));
  expect(before).toMatchObject({ jobTitle: null, jobLevel: null });
  expect(
    (await db().select().from(organizations)).every(
      (row) => !row.hierarchyKnown && row.parentId === null,
    ),
  ).toBe(true);
  const file = source();
  expect(await importDirectoryProfileSeed(db(), root, file)).toEqual({
    peopleUpdated: 1,
    organizationsUpdated: 2,
  });
  const [after] = await db().select().from(people).where(eq(people.id, 'p'));
  expect(after).toEqual({
    ...before,
    jobTitle: input().people[0].jobTitle,
    jobLevel: input().people[0].jobLevel,
  });
  expect(
    projectDirectoryProfile(after, await db().select().from(organizations)),
  ).toEqual({
    jobTitle: after.jobTitle,
    level: after.jobLevel,
    demo: true,
    organizationPath: ['合成组织', '合成团队'],
  });
  expect(await importDirectoryProfileSeed(db(), root, file)).toEqual({
    peopleUpdated: 0,
    organizationsUpdated: 0,
  });
});
it('serializes two real connections and updates the same missing facts only once', async () => {
  const file = source();
  const results = await Promise.all([
    importDirectoryProfileSeed(db(), root, file),
    importDirectoryProfileSeed(db(), root, file),
  ]);
  expect(results.map((row) => row.peopleUpdated).sort()).toEqual([0, 1]);
  expect(results.map((row) => row.organizationsUpdated).sort()).toEqual([0, 2]);
});
it('a people-only supplement leaves organization hierarchy explicitly unknown', async () => {
  await importDirectoryProfileSeed(
    db(),
    root,
    source({ ...input(), organizations: [] }),
  );
  const [person] = await db().select().from(people).where(eq(people.id, 'p'));
  expect(
    projectDirectoryProfile(person, await db().select().from(organizations)),
  ).toMatchObject({
    jobTitle: input().people[0].jobTitle,
    organizationPath: null,
  });
});
it.each(['real', 'name', 'organization', 'value', 'known-parent'])(
  'rejects %s collisions without partial updates',
  async (kind) => {
    if (kind === 'real')
      await db().update(people).set({ demo: false }).where(eq(people.id, 'p'));
    if (kind === 'name')
      await db()
        .update(people)
        .set({ name: '另一化名' })
        .where(eq(people.id, 'p'));
    if (kind === 'organization')
      await db()
        .update(people)
        .set({ organizationId: 'root' })
        .where(eq(people.id, 'p'));
    if (kind === 'value')
      await db()
        .update(people)
        .set({ jobLevel: '既有确认职级' })
        .where(eq(people.id, 'p'));
    if (kind === 'known-parent')
      await db()
        .update(organizations)
        .set({ hierarchyKnown: true })
        .where(eq(organizations.id, 'leaf'));
    const beforePeople = await db().select().from(people);
    const beforeOrganizations = await db().select().from(organizations);
    await expect(
      importDirectoryProfileSeed(db(), root, source()),
    ).rejects.toThrow();
    expect(await db().select().from(people)).toEqual(beforePeople);
    expect(await db().select().from(organizations)).toEqual(
      beforeOrganizations,
    );
  },
);
it('rolls back actual completed updates when the surrounding transaction fails before commit', async () => {
  const wrapper: Database = Object.create(db());
  wrapper.transaction = (run, options) =>
    db().transaction(async (tx) => {
      await run(tx);
      expect(
        (await tx.select().from(people).where(eq(people.id, 'p')))[0].jobTitle,
      ).not.toBeNull();
      throw new Error('synthetic late rollback');
    }, options);
  await expect(
    importDirectoryProfileSeed(wrapper, root, source()),
  ).rejects.toThrow('synthetic late rollback');
  expect(
    (await db().select().from(people)).every(
      (row) => row.jobTitle === null && row.jobLevel === null,
    ),
  ).toBe(true);
  expect(
    (await db().select().from(organizations)).every(
      (row) => !row.hierarchyKnown,
    ),
  ).toBe(true);
});
it('new facts remain behind current HR scope and revocation instead of widening person access', async () => {
  await importDirectoryProfileSeed(db(), root, source());
  await db().insert(cohorts).values({ id: 'cohort', name: '合成期次' });
  await db().insert(enrollments).values({
    id: 'enrollment',
    cohortId: 'cohort',
    personId: 'p',
    confirmed: true,
    validFrom: '2026-01-01',
  });
  await db()
    .insert(accountBindings)
    .values({ accountId: 'hr', personId: 'actor' });
  await db().insert(grants).values({
    id: 'hr-grant',
    accountId: 'hr',
    role: 'hr',
    scope: 'cohort',
    cohortId: 'cohort',
    validFrom: '2026-01-01',
  });
  const data = await loadPersonData(db(), 'hr', '2026-11-01');
  const allowed = profileGate(data, 'p');
  expect(allowed).not.toBeNull();
  expect(
    projectDirectoryProfile(allowed!.row, data.directory.organizations).level,
  ).toBe(input().people[0].jobLevel);
  expect(profileGate(data, 'outside')).toBeNull();
  expect((await personFromData(data, 'p'))?.person).toMatchObject({
    jobTitle: input().people[0].jobTitle,
    level: input().people[0].jobLevel,
    teamPath: '合成组织 / 合成团队',
    demo: true,
  });
  await db()
    .update(grants)
    .set({ revokedAt: '2026-10-31' })
    .where(eq(grants.id, 'hr-grant'));
  expect(
    profileGate(await loadPersonData(db(), 'hr', '2026-11-01'), 'p'),
  ).toBeNull();
});
it('production cannot enable the demo writer with a forged source or demo flag', async () => {
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('ACCESS_ENFORCED', 'true');
  vi.stubEnv('ACCESS_ISSUER', 'https://synthetic.cloudflareaccess.com');
  vi.stubEnv('ACCESS_AUDIENCE', 'synthetic-audience');
  try {
    await expect(
      importDirectoryProfileSeed(db(), root, source()),
    ).rejects.toThrow('forbidden in production');
    expect(
      (await db().select().from(people)).every((row) => row.jobTitle === null),
    ).toBe(true);
  } finally {
    vi.stubEnv('APP_ENV', 'test');
    vi.stubEnv('ACCESS_ENFORCED', 'false');
  }
});

it('imports all 93 fixed synthetic profiles against the real approved demo identities and replays unchanged', async () => {
  const mapped = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  await importDemo(db(), mapped, 'Synthetic-password-for-tests-only');
  const before = await db().select().from(people);
  const facts = readDirectoryProfileSeed(
    process.cwd(),
    DIRECTORY_PROFILE_DEMO_SOURCE,
  );
  expect(await importDirectoryProfileDemo(db(), process.cwd())).toEqual({
    peopleUpdated: 93,
    organizationsUpdated: 0,
  });
  for (const row of await db().select().from(people)) {
    const original = before.find((person) => person.id === row.id)!;
    const fact = facts.people.find((person) => person.id === row.id);
    expect(row).toEqual(
      fact
        ? { ...original, jobTitle: fact.jobTitle, jobLevel: fact.jobLevel }
        : original,
    );
  }
  expect(await importDirectoryProfileDemo(db(), process.cwd())).toEqual({
    peopleUpdated: 0,
    organizationsUpdated: 0,
  });
  expect(
    (await db().select().from(organizations)).every(
      (row) => !row.hierarchyKnown && row.parentId === null,
    ),
  ).toBe(true);
}, 30_000);
