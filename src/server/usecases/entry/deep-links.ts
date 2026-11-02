import { z } from 'zod';
import {
  buildEntryDeepLink,
  entryLinkTargetSchema,
  parseEntryDeepLink,
  type EntryLinkTarget,
} from '../../../contracts/entry-links';
import type { EntryIdentity } from '../../auth/entry/identity';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import {
  EntryUsecaseError,
  entryFailure,
  type EntryContextLoader,
  type EntryFailureKind,
  type EntryTransactionPorts,
} from './context';
const resourceSchema = z.strictObject({
  kind: entryLinkTargetSchema.shape.kind,
  id: entryLinkTargetSchema.shape.id,
  revision: entryLinkTargetSchema.shape.expectedRevision,
});
export type EntryLinkResource = z.infer<typeof resourceSchema>;
export interface EntryLinkReader<C> {
  load(transaction: C, target: EntryLinkTarget): Promise<unknown>;
  authorize(
    transaction: C,
    current: EvaluationAuthzContext,
    resource: EntryLinkResource,
  ): Promise<boolean>;
  /** Site page that opens this object, read in the same transaction after both
   * authorizations. A same-origin path only, never a URL from the link. */
  landing(transaction: C, resource: EntryLinkResource): Promise<string>;
}
/** Same-origin absolute path: one leading slash, no scheme, host, backslash,
 * control character or fragment. */
export function isSitePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 1000 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\x00-\x20\x7f#]/.test(value)
  );
}
export type EntryLinkResult =
  | { status: 'authentication_required'; returnTo: string }
  | { status: 'ready'; target: EntryLinkTarget; href: string }
  | { status: 'stale'; refreshHref: string }
  | { status: EntryFailureKind };
export function createEntryDeepLinkUsecase<C>(ports: {
  loadContext: EntryContextLoader<C>;
  transactions: EntryTransactionPorts<C>;
  reader?: EntryLinkReader<C>;
}) {
  return async (
    identity: EntryIdentity | null,
    href: unknown,
  ): Promise<EntryLinkResult> => {
    try {
      const target = parseEntryDeepLink(href);
      if (!target) throw new EntryUsecaseError('validation_error');
      if (identity === null)
        return {
          status: 'authentication_required',
          returnTo: buildEntryDeepLink(target),
        };
      if (!ports.reader) throw new EntryUsecaseError('unavailable');
      const reader = ports.reader;
      return await ports.transactions.transaction(async (tx) => {
        const current = await ports.loadContext(tx, identity);
        const raw = await reader.load(tx, target);
        // Match the denied-object outcome so a link cannot probe existence.
        if (raw === null) throw new EntryUsecaseError('forbidden');
        const result = resourceSchema.safeParse(raw);
        if (!result.success) throw new EntryUsecaseError('unavailable');
        const resource = Object.freeze(result.data);
        if (
          resource.kind !== target.kind ||
          resource.id !== target.id ||
          (await reader.authorize(tx, current, resource)) !== true
        )
          throw new EntryUsecaseError('forbidden');
        // Do not disclose current revision before current authorization succeeds.
        const latest = await ports.loadContext(tx, identity);
        if ((await reader.authorize(tx, latest, resource)) !== true)
          throw new EntryUsecaseError('forbidden');
        await ports.transactions.audit(tx, {
          actorId: latest.account.id,
          channel: identity.channel,
          action: 'entry.link.open',
          resourceId: resource.id,
          revision: resource.revision,
        });
        const actual: EntryLinkTarget = {
          kind: resource.kind,
          id: resource.id,
          expectedRevision: resource.revision,
        };
        if (resource.revision !== target.expectedRevision)
          return {
            status: 'stale' as const,
            refreshHref: buildEntryDeepLink(actual),
          };
        const landing = await reader.landing(tx, resource);
        if (!isSitePath(landing)) throw new EntryUsecaseError('unavailable');
        return { status: 'ready' as const, target: actual, href: landing };
      });
    } catch (error) {
      if (entryFailure(error).status === 'unauthenticated') {
        const target = parseEntryDeepLink(href)!;
        return {
          status: 'authentication_required',
          returnTo: buildEntryDeepLink(target),
        };
      }
      return entryFailure(error);
    }
  };
}
