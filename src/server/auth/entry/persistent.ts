import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { accountBindings } from '../../modules/directory';
import { session } from '../schema';
import { agentApiBindings, mcpCredentials, wecomBindings } from './schema';
import {
  EntryIdentityError,
  type CredentialBinding,
  type EntryAuthenticator,
} from './identity';

const key = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u);
const senderSchema = z.strictObject({ scope: key, botId: key, senderId: key });
const agentSchema = z.strictObject({
  accountId: key,
  agentId: key,
  sessionId: key,
});
export type VerifiedWecomSender = z.infer<typeof senderSchema>;
export type VerifiedAgentOwner = z.infer<typeof agentSchema>;
const tokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u);
function digest(domain: string, values: string[]) {
  return createHash('sha256')
    .update(JSON.stringify([domain, ...values]))
    .digest('hex');
}
/** Only high-entropy bearer tokens may be provisioned. This hashes, never issues
 * tokens. Provisioning/revocation is a separate trusted operation, not an API here.
 */
export function mcpTokenDigest(token: string): string {
  if (!tokenSchema.safeParse(token).success)
    throw new EntryIdentityError('unauthenticated');
  return digest('qtalent:entry:mcp-token:v1', [token]);
}
/** Binds a credential to the account, person and binding generation at issue
 * time. A rebind advances the generation, so A→B→A does not revive it. */
export function entryAccountBindingDigest(
  accountId: string,
  personId: string,
  generation: number,
): string {
  if (
    !key.safeParse(accountId).success ||
    !key.safeParse(personId).success ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  )
    throw new EntryIdentityError('unauthenticated');
  return digest('qtalent:entry:directory-binding:v2', [
    accountId,
    personId,
    String(generation),
  ]);
}
function reject(): never {
  throw new EntryIdentityError('unauthenticated');
}
const common = {
  accountId: accountBindings.accountId,
  personId: accountBindings.personId,
  isSystemAdmin: accountBindings.isSystemAdmin,
  generation: accountBindings.generation,
};
type BoundRow = {
  id: string;
  accountId: string;
  personId: string;
  isSystemAdmin: boolean;
  generation: number;
  accountBindingDigest: string;
  revision: number;
  expiresAt: Date;
  revokedAt: Date | null;
};
function descriptor(
  row: BoundRow | undefined,
  now: () => Date,
  deadline?: Date,
): CredentialBinding {
  if (!row) reject();
  const at = now().getTime();
  if (!Number.isFinite(at)) throw new EntryIdentityError('unavailable');
  const expiry = Math.min(
    row.expiresAt.getTime(),
    deadline?.getTime() ?? Infinity,
  );
  if (
    row.isSystemAdmin ||
    !Number.isFinite(expiry) ||
    expiry <= at ||
    (row.revokedAt !== null && row.revokedAt.getTime() <= at) ||
    row.accountBindingDigest !==
      entryAccountBindingDigest(row.accountId, row.personId, row.generation)
  )
    reject();
  return {
    credentialId: row.id,
    accountId: row.accountId,
    personId: row.personId,
    revision: row.revision,
    expiresAt: new Date(expiry).toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
/** Use the pool Database: a stale caller transaction must not authenticate a
 * revoked credential. Domain writes still lock/recheck authorization in their tx.
 */
export function createMcpEntryAuthenticator(
  db: Database,
  now: () => Date = () => new Date(),
): EntryAuthenticator {
  async function read(condition: ReturnType<typeof eq>) {
    const [row] = await db
      .select({
        ...common,
        id: mcpCredentials.id,
        accountBindingDigest: mcpCredentials.accountBindingDigest,
        revision: mcpCredentials.revision,
        expiresAt: mcpCredentials.expiresAt,
        revokedAt: mcpCredentials.revokedAt,
      })
      .from(mcpCredentials)
      .innerJoin(
        accountBindings,
        eq(accountBindings.accountId, mcpCredentials.accountId),
      )
      .where(condition)
      .limit(1);
    return descriptor(row, now);
  }
  return {
    async verify(presented) {
      if (typeof presented !== 'string') reject();
      return read(eq(mcpCredentials.tokenDigest, mcpTokenDigest(presented)));
    },
    current: (id) => read(eq(mcpCredentials.id, id)),
  };
}
/** One reader per verified transport context. The callback must be installed by
 * server composition AFTER WS signature/connection validation. Request JSON is
 * never a sender proof. Revalidate the same connection on every current read.
 */
export function createWecomEntryAuthenticator(
  db: Database,
  verifiedSender: () => Promise<VerifiedWecomSender | null>,
  now: () => Date = () => new Date(),
): EntryAuthenticator {
  async function read(id?: string) {
    const parsed = senderSchema.safeParse(await verifiedSender());
    if (!parsed.success) reject();
    const proof = parsed.data;
    const [row] = await db
      .select({
        ...common,
        id: wecomBindings.id,
        accountBindingDigest: wecomBindings.accountBindingDigest,
        revision: wecomBindings.revision,
        expiresAt: wecomBindings.expiresAt,
        revokedAt: wecomBindings.revokedAt,
      })
      .from(wecomBindings)
      .innerJoin(
        accountBindings,
        eq(accountBindings.accountId, wecomBindings.accountId),
      )
      .where(
        and(
          eq(wecomBindings.scope, proof.scope),
          eq(wecomBindings.botId, proof.botId),
          eq(wecomBindings.senderId, proof.senderId),
          id === undefined ? undefined : eq(wecomBindings.id, id),
        ),
      )
      .limit(1);
    return descriptor(row, now);
  }
  return { verify: () => read(), current: (id) => read(id) };
}
/** Proof must come from authenticated Web/Access verification, not a userId or
 * sessionId supplied by the agent. The real Better Auth session is re-read AFTER
 * that proof, selecting no cookie, token, header or OAuth private column.
 */
export function createAgentApiEntryAuthenticator(
  db: Database,
  verifiedOwner: () => Promise<VerifiedAgentOwner | null>,
  now: () => Date = () => new Date(),
): EntryAuthenticator {
  async function read(id?: string) {
    const parsed = agentSchema.safeParse(await verifiedOwner());
    if (!parsed.success) reject();
    const proof = parsed.data;
    const [row] = await db
      .select({
        ...common,
        id: agentApiBindings.id,
        accountBindingDigest: agentApiBindings.accountBindingDigest,
        revision: agentApiBindings.revision,
        expiresAt: agentApiBindings.expiresAt,
        revokedAt: agentApiBindings.revokedAt,
        sessionExpiresAt: session.expiresAt,
      })
      .from(agentApiBindings)
      .innerJoin(
        accountBindings,
        eq(accountBindings.accountId, agentApiBindings.accountId),
      )
      .innerJoin(
        session,
        and(
          eq(session.id, agentApiBindings.sessionId),
          eq(session.userId, agentApiBindings.accountId),
        ),
      )
      .where(
        and(
          eq(agentApiBindings.agentId, proof.agentId),
          eq(agentApiBindings.sessionId, proof.sessionId),
          eq(agentApiBindings.accountId, proof.accountId),
          id === undefined ? undefined : eq(agentApiBindings.id, id),
        ),
      )
      .limit(1);
    return descriptor(row, now, row?.sessionExpiresAt);
  }
  return { verify: () => read(), current: (id) => read(id) };
}
