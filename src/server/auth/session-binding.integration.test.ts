import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../tests/fixtures/bow-845/native';
import {
  accountBindings,
  organizations,
  people,
  rebindDirectoryAccount,
} from '../modules/directory';
import * as schema from './schema';
import {
  sessionBindingFields,
  stampSessionBindingGeneration,
} from './session-binding';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
}, 30000);
afterAll(async () => {
  await c?.close();
});
// The same session options and hook as auth/index.ts, on an isolated database.
function auth() {
  return betterAuth({
    database: drizzleAdapter(c.db, {
      provider: 'pg',
      schema,
      transaction: true,
    }),
    secret: 'synthetic-test-only-secret-'.repeat(2),
    baseURL: 'http://localhost',
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: {
      cookieCache: { enabled: false },
      additionalFields: sessionBindingFields,
    },
    databaseHooks: {
      session: {
        create: {
          before: (session) => stampSessionBindingGeneration(c.db, session),
        },
      },
    },
  });
}
async function signIn(email: string, password: string) {
  const { token } = await auth().api.signInEmail({ body: { email, password } });
  const [row] = await c.db
    .select({ bindingGeneration: schema.session.bindingGeneration })
    .from(schema.session)
    .where(eq(schema.session.token, token));
  return row.bindingGeneration;
}
it('records the current directory binding generation on every real Better Auth sign-in', async () => {
  const id = randomUUID();
  const accountId = 'demo-account-' + id;
  const [a, b] = ['demo-a-' + id, 'demo-b-' + id];
  const email = id + '@example.invalid';
  const password = 'Synthetic-test-password-only';
  await c.db
    .insert(organizations)
    .values({ id, name: '演示组织', shortName: '演示' });
  await c.db.insert(people).values(
    [a, b].map((person) => ({
      id: person,
      name: '演示化名',
      organizationId: id,
    })),
  );
  await c.db
    .insert(schema.user)
    .values({ id: accountId, name: '演示', email, emailVerified: true });
  await c.db.insert(schema.account).values({
    id: 'credential-' + accountId,
    accountId,
    providerId: 'credential',
    userId: accountId,
    password: await hashPassword(password),
  });
  // An unbound account gets no generation, which the entry adapter rejects.
  expect(await signIn(email, password)).toBeNull();
  await c.db.insert(accountBindings).values({ accountId, personId: a });
  expect(await signIn(email, password)).toBe(1);
  await rebindDirectoryAccount(c.db, { accountId, personId: b });
  await rebindDirectoryAccount(c.db, { accountId, personId: a });
  expect(await signIn(email, password)).toBe(3);
  // The field is server-only: a client cannot submit it at sign-in.
  expect(sessionBindingFields.bindingGeneration.input).toBe(false);
});
