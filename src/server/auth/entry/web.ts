import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { verifyAccessRequest } from '../../access';
import type { Database } from '../../db/client';
import { accountBindings } from '../../modules/directory';
import { getSession } from '../index';
import { session } from '../schema';
import {
  EntryIdentityError,
  type CredentialBinding,
  type EntryAuthenticator,
} from './identity';

const id = z.string().min(1).max(200);
const proofSchema = z.object({
  user: z.object({ id }),
  session: z.object({ id, userId: id, expiresAt: z.date() }),
});
const rowSchema = z.object({
  sessionId: id,
  userId: id,
  expiresAt: z.date(),
  accountId: id,
  personId: id,
  isSystemAdmin: z.boolean(),
});
type BoundSession = z.infer<typeof rowSchema> & { deadline: number };
function reject(): never {
  throw new EntryIdentityError('unauthenticated');
}
function unavailable(): never {
  throw new EntryIdentityError('unavailable');
}

/** One adapter per incoming server request, not a global session registry.
 * Authenticate once with request Headers, then current() re-verifies the SAME
 * captured proof every time. Never serialize, log, or persist these headers.
 * A failed current check retires this request's identity; a new request must
 * authenticate anew. Use the pool Database so source reads do not inherit an
 * older transaction snapshot. This issues no token/account or handler.
 */
export function createWebEntryAuthenticator(
  db: Database,
  wallNow: () => Date = () => new Date(),
): EntryAuthenticator {
  let started = false;
  let invalidated = false;
  let proof: Headers | null = null;
  let issued: BoundSession | null = null;
  function retire(error: unknown): never {
    invalidated = true;
    proof = null;
    throw error instanceof EntryIdentityError
      ? error
      : new EntryIdentityError('unavailable');
  }
  function instant() {
    const value = wallNow().getTime();
    if (!Number.isFinite(value)) unavailable();
    return value;
  }
  async function readCurrent(headers: Headers): Promise<BoundSession> {
    // Keep Access ahead of Better Auth; neither a cookie nor a gateway JWT alone
    // is an application identity. Better Auth has cookieCache disabled.
    await verifyAccessRequest(new Headers(headers));
    const raw = await getSession(new Headers(headers));
    if (!raw) reject();
    const parsed = proofSchema.safeParse(raw);
    if (!parsed.success) unavailable();
    const authenticated = parsed.data;
    if (authenticated.user.id !== authenticated.session.userId) reject();
    // This query occurs AFTER both asynchronous verifiers, catching logout or
    // an account binding change while they were suspended. Never select tokens.
    const [rawRow] = await db
      .select({
        sessionId: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        accountId: accountBindings.accountId,
        personId: accountBindings.personId,
        isSystemAdmin: accountBindings.isSystemAdmin,
      })
      .from(session)
      .innerJoin(accountBindings, eq(accountBindings.accountId, session.userId))
      .where(
        and(
          eq(session.id, authenticated.session.id),
          eq(session.userId, authenticated.user.id),
        ),
      )
      .limit(1);
    if (!rawRow) reject();
    const checked = rowSchema.safeParse(rawRow);
    if (!checked.success) unavailable();
    const row = checked.data;
    if (
      row.sessionId !== authenticated.session.id ||
      row.userId !== authenticated.user.id ||
      row.accountId !== row.userId ||
      row.isSystemAdmin
    )
      reject();
    const deadline = Math.min(
      row.expiresAt.getTime(),
      authenticated.session.expiresAt.getTime(),
    );
    // Read security time after the final awaited operation, not before it.
    if (!Number.isFinite(deadline)) unavailable();
    if (deadline <= instant() || invalidated) reject();
    return { ...row, deadline };
  }
  function descriptor(row: BoundSession): CredentialBinding {
    return {
      credentialId: row.sessionId,
      accountId: row.accountId,
      // This single-use adapter has one request-local generation. It is NOT an
      // auth_session database revision or updatedAt converted into a counter.
      // All revocation/account/person checks use the real source on every call.
      revision: 1,
      expiresAt: new Date(row.deadline).toISOString(),
      revokedAt: null,
    };
  }
  return {
    async verify(presented) {
      if (started || invalidated || !(presented instanceof Headers)) reject();
      started = true;
      try {
        proof = new Headers(presented);
        issued = await readCurrent(proof);
        return descriptor(issued);
      } catch (error) {
        return retire(error);
      }
    },
    async current(credentialId) {
      if (invalidated || !issued || !proof || credentialId !== issued.sessionId)
        reject();
      try {
        const fresh = await readCurrent(proof);
        if (
          fresh.sessionId !== issued.sessionId ||
          fresh.accountId !== issued.accountId ||
          fresh.personId !== issued.personId
        )
          reject();
        // Better Auth renewal cannot extend an already issued entry capability.
        fresh.deadline = Math.min(fresh.deadline, issued.deadline);
        if (fresh.deadline <= instant() || invalidated) reject();
        return descriptor(fresh);
      } catch (error) {
        return retire(error);
      }
    },
  };
}
