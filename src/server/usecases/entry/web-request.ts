import type { Database, DbExecutor } from '../../db/client';
import { createWebEntryAuthenticator } from '../../auth/entry/web';
import { createEntryIdentityService } from '../../auth/entry/identity';
import {
  createEntryContextLoader,
  loadEntryAuthorizationContext,
} from './context';

/** Server request composition. Never cache this result between requests or
 * accept an account/person/role from the caller's payload. Domain handlers still
 * authorize actual resources and use their real transaction before returning.
 */
export async function authenticateWebEntryRequest(
  db: Database,
  headers: Headers,
  clocks: {
    wallNow?: () => Date;
    businessNow?: () => string;
  } = {},
) {
  const wallNow = clocks.wallNow ?? (() => new Date());
  const identities = createEntryIdentityService(
    { web: createWebEntryAuthenticator(db, wallNow) },
    wallNow,
  );
  const identity = await identities.authenticate('web', headers);
  const loadContext = createEntryContextLoader<DbExecutor>(identities, {
    load: loadEntryAuthorizationContext,
    businessNow: clocks.businessNow,
  });
  return Object.freeze({ identity, loadContext });
}
