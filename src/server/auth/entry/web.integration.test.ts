import { randomUUID } from 'node:crypto';
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../db/client';
import { user, session } from '../schema';
import {
  people,
  organizations,
  accountBindings,
  grants,
} from '../../modules/directory';
import { createWebEntryAuthenticator } from './web';
import { createEntryIdentityService } from './identity';
import { authenticateWebEntryRequest } from '../../usecases/entry/web-request';
import { activeGrants } from '../../authz';
const mocks = vi.hoisted(() => ({ access: vi.fn(), session: vi.fn() }));
// Control only existing authentication interfaces; all adapter SQL is real.
// This is not a live user, cookie cryptography or JWKS acceptance test.
vi.mock('../../access', () => ({ verifyAccessRequest: mocks.access }));
vi.mock('../../env', () => ({ getEnv: () => ({ ACCESS_ENFORCED: false }) }));
vi.mock('../index', () => ({ getSession: mocks.session }));
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName = `qtalent_entry_web_${randomUUID().replaceAll('-', '')}_test`;
const now = Date.parse('2026-11-01T01:00:00.000Z');
const expiry = new Date(now + 60_000);
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'Real PostgreSQL TEST_DATABASE_URL required; no skip/fake fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Loopback _test database required');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(undefined);
});
async function fixture() {
  const db = connection!.db;
  const prefix = randomUUID();
  const accountId = prefix + '-account',
    sessionId = prefix + '-session';
  const personId = prefix + '-person',
    otherPerson = prefix + '-other-person',
    organizationId = prefix + '-organization';
  await db.insert(user).values({
    id: accountId,
    name: '合成账号（演示）',
    email: prefix + '@example.invalid',
  });
  await db.insert(organizations).values({
    id: organizationId,
    name: '合成组织（演示）',
    shortName: '演示',
  });
  await db.insert(people).values([
    { id: personId, name: '合成甲（演示）', organizationId },
    { id: otherPerson, name: '合成乙（演示）', organizationId },
  ]);
  await db.insert(accountBindings).values({ accountId, personId });
  // Disposable fixture rows; no real login or credential-issuance API is used.
  await db.insert(session).values({
    id: sessionId,
    userId: accountId,
    token: 'synthetic-only-' + prefix,
    expiresAt: expiry,
  });
  const authenticated = {
    user: { id: accountId },
    session: { id: sessionId, userId: accountId, expiresAt: expiry },
  };
  mocks.session.mockImplementation(async () => structuredClone(authenticated));
  const reader = createWebEntryAuthenticator(db, () => new Date(now));
  const identities = createEntryIdentityService(
    { web: reader },
    () => new Date(now),
  );
  return {
    db,
    reader,
    identities,
    headers: new Headers({ cookie: 'synthetic-request-only' }),
    authenticated,
    accountId,
    sessionId,
    personId,
    otherPerson,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('Web current authentication sources in real PostgreSQL', () => {
  it('authenticates and rechecks the actual session and directory binding', async () => {
    const f = await fixture();
    const cap = await f.identities.authenticate('web', f.headers);
    expect(await f.identities.current(cap)).toEqual({
      channel: 'web',
      accountId: f.accountId,
      personId: f.personId,
      credentialId: f.sessionId,
    });
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });
  it('logout deletion defeats stale Better Auth proof after an asynchronous wait', async () => {
    const f = await fixture();
    await f.reader.verify(f.headers);
    const entered = deferred(),
      release = deferred();
    const captured = structuredClone(f.authenticated);
    mocks.session.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return captured;
    });
    const pending = f.reader.current(f.sessionId);
    await entered.promise;
    try {
      await f.db.delete(session).where(eq(session.id, f.sessionId));
    } finally {
      release.resolve();
    }
    await expect(pending).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
  it('person reassignment rejects the old identity and restoring data cannot revive it', async () => {
    const f = await fixture();
    const cap = await f.identities.authenticate('web', f.headers);
    await f.db
      .update(accountBindings)
      .set({ personId: f.otherPerson })
      .where(eq(accountBindings.accountId, f.accountId));
    await expect(f.identities.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    await f.db
      .update(accountBindings)
      .set({ personId: f.personId })
      .where(eq(accountBindings.accountId, f.accountId));
    await expect(f.identities.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });
  it.each(['expiry', 'binding_deleted', 'system_admin'] as const)(
    'rechecks current %s after issuance',
    async (change) => {
      const f = await fixture();
      const cap = await f.identities.authenticate('web', f.headers);
      if (change === 'expiry')
        await f.db
          .update(session)
          .set({ expiresAt: new Date(now) })
          .where(eq(session.id, f.sessionId));
      if (change === 'binding_deleted')
        await f.db
          .delete(accountBindings)
          .where(eq(accountBindings.accountId, f.accountId));
      if (change === 'system_admin')
        await f.db
          .update(accountBindings)
          .set({ isSystemAdmin: true })
          .where(eq(accountBindings.accountId, f.accountId));
      await expect(f.identities.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    },
  );
  it('does not accept the same session row when it belongs to another account', async () => {
    const f = await fixture();
    const otherId = randomUUID();
    await f.db.insert(user).values({
      id: otherId,
      name: '其他合成账号（演示）',
      email: otherId + '@example.invalid',
    });
    await f.db
      .update(session)
      .set({ userId: otherId })
      .where(eq(session.id, f.sessionId));
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });
  it('a present DB row cannot bypass current cookie verification failure', async () => {
    const f = await fixture();
    await f.reader.verify(f.headers);
    mocks.session.mockResolvedValue(null);
    await expect(f.reader.current(f.sessionId)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });
});

it('composes independent requests with current database authority and revoked account bindings', async () => {
  const f = await fixture();
  const grantId = randomUUID();
  await f.db.insert(grants).values({
    id: grantId,
    accountId: f.accountId,
    role: 'hr',
    scope: 'cohort',
    cohortId: 'synthetic-entry-cohort',
    validFrom: '2026-01-01',
    validTo: null,
    revokedAt: null,
  });
  const clocks = {
    wallNow: () => new Date(now),
    businessNow: () => new Date(now).toISOString(),
  };
  const first = await authenticateWebEntryRequest(f.db, f.headers, clocks);
  const second = await authenticateWebEntryRequest(f.db, f.headers, clocks);
  expect(first.identity).not.toBe(second.identity);
  expect(
    activeGrants(await first.loadContext(f.db, first.identity)),
  ).toHaveLength(1);
  await f.db
    .update(grants)
    .set({ revokedAt: '2026-11-01' })
    .where(eq(grants.id, grantId));
  expect(activeGrants(await first.loadContext(f.db, first.identity))).toEqual(
    [],
  );
  expect(activeGrants(await second.loadContext(f.db, second.identity))).toEqual(
    [],
  );
  await f.db
    .delete(accountBindings)
    .where(eq(accountBindings.accountId, f.accountId));
  await expect(first.loadContext(f.db, first.identity)).rejects.toMatchObject({
    kind: 'unauthenticated',
  });
  await expect(second.loadContext(f.db, second.identity)).rejects.toMatchObject(
    { kind: 'unauthenticated' },
  );
});
