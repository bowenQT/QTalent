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
}
export type EntryLinkResult =
  | { status: 'authentication_required'; returnTo: string }
  | { status: 'ready'; target: EntryLinkTarget }
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
        if (raw === null) throw new EntryUsecaseError('not_found');
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
        return resource.revision === target.expectedRevision
          ? { status: 'ready' as const, target: actual }
          : {
              status: 'stale' as const,
              refreshHref: buildEntryDeepLink(actual),
            };
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
