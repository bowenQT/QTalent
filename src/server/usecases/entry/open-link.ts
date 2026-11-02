import type { Database, Transaction } from '../../db/client';
import { createWebEntryAuthenticator } from '../../auth/entry/web';
import {
  createEntryIdentityService,
  type EntryIdentity,
} from '../../auth/entry/identity';
import { recordEntryAudit } from './audit';
import {
  createEntryContextLoader,
  entryFailure,
  loadEntryAuthorizationContext,
} from './context';
import { createEntryDeepLinkUsecase, type EntryLinkResult } from './deep-links';
import { createEntryLinkReaders } from './link-readers';

/** One Web request opening an ordinary deep link. The Web identity (Access,
 * Better Auth session, current account binding) is verified once on the pool
 * BEFORE the transaction; inside it only the transaction's own connection is
 * used, so a full pool cannot leave an open transaction waiting on a second
 * connection. The 899 context is loaded in the transaction for the frozen
 * account, with the loader's usual shape checks. A logout landing between that
 * check and the redirect still redirects once; the landing page re-verifies
 * its own session before it reads anything.
 */
export async function openEntryLinkRequest(input: {
  db: Database;
  headers: Headers;
  href: string;
  records: Parameters<typeof createEntryLinkReaders>[0]['records'];
  wallNow?: () => Date;
  businessNow?: () => string;
}): Promise<EntryLinkResult> {
  const wallNow = input.wallNow ?? (() => new Date());
  const identities = createEntryIdentityService(
    { web: createWebEntryAuthenticator(input.db, wallNow) },
    wallNow,
  );
  let identity: EntryIdentity | null = null;
  let actor: Awaited<ReturnType<typeof identities.current>> | null = null;
  try {
    identity = await identities.authenticate('web', input.headers);
    actor = await identities.current(identity);
  } catch (error) {
    const failure = entryFailure(error);
    if (failure.status !== 'unauthenticated') return failure;
    identity = null;
  }
  const verified = actor;
  const loadContext = createEntryContextLoader<Transaction>(
    {
      ...identities,
      current: async () => {
        if (!verified) throw new Error('deep link opened without identity');
        return verified;
      },
    },
    { load: loadEntryAuthorizationContext, businessNow: input.businessNow },
  );
  return createEntryDeepLinkUsecase<Transaction>({
    loadContext,
    transactions: {
      transaction: (run) =>
        input.db.transaction(run, { isolationLevel: 'read committed' }),
      audit: recordEntryAudit,
    },
    reader: verified
      ? createEntryLinkReaders({
          accountId: verified.accountId,
          records: input.records,
        })
      : undefined,
  })(identity, input.href);
}
