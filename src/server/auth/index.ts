import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { recordAudit } from '../platform/audit';
import * as schema from './schema';
function createAuth() {
  const env = getEnv();
  return betterAuth({
    database: drizzleAdapter(getDatabase(), {
      provider: 'pg',
      schema,
      transaction: true,
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true, disableSignUp: true },
    session: { cookieCache: { enabled: false } },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await recordAudit(getDatabase(), {
              actorId: session.userId,
              action: 'auth.login',
              resourceId: session.id,
            });
          },
        },
      },
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth());
}
export async function getSession(headers: Headers) {
  return getAuth().api.getSession({ headers });
}

export type AuthSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;
