import { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { loadProjectContext, ForbiddenError } from '../project-context';
import { readEvaluationAuthorizationFacts } from '../../modules/programs';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import {
  EntryIdentityError,
  type EntryIdentity,
  type EntryIdentityService,
  type EntryChannel,
} from '../../auth/entry/identity';
export type EntryFailureKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'unavailable'
  | 'validation_error'
  | 'not_found'
  | 'conflict';
export class EntryUsecaseError extends Error {
  constructor(readonly kind: EntryFailureKind) {
    super(kind);
    this.name = 'EntryUsecaseError';
  }
}
export function entryFailure(error: unknown): { status: EntryFailureKind } {
  return {
    status:
      error instanceof EntryUsecaseError || error instanceof EntryIdentityError
        ? error.kind
        : 'unavailable',
  };
}
export type EntryContextLoader<C> = (
  context: C,
  identity: EntryIdentity,
) => Promise<EvaluationAuthzContext>;
export type EntryAudit = {
  actorId: string;
  channel: EntryChannel;
  action: string;
  resourceId: string | null;
  revision: number | null;
};
export interface EntryTransactionPorts<C> {
  transaction<T>(run: (context: C) => Promise<T>): Promise<T>;
  audit(context: C, event: EntryAudit): Promise<void>;
}
/** Optional production composition: only existing public 899/directory reads. */
export async function loadEntryAuthorizationContext(
  db: DbExecutor,
  accountId: string,
  now: string,
): Promise<EvaluationAuthzContext> {
  try {
    const base = await loadProjectContext(db, accountId, now);
    return { ...base.context, ...(await readEvaluationAuthorizationFacts(db)) };
  } catch (error) {
    throw new EntryUsecaseError(
      error instanceof ForbiddenError ? 'forbidden' : 'unavailable',
    );
  }
}
export function createEntryContextLoader<C>(
  identities: EntryIdentityService,
  ports: {
    load?: (
      context: C,
      accountId: string,
      now: string,
    ) => Promise<EvaluationAuthzContext>;
    businessNow?: () => string;
  },
): EntryContextLoader<C> {
  return async (transaction, identity) => {
    try {
      const actor = await identities.current(identity);
      if (!ports.load) throw new EntryUsecaseError('unavailable');
      const now = (ports.businessNow ?? (() => new Date().toISOString()))();
      if (!z.iso.datetime().safeParse(now).success)
        throw new EntryUsecaseError('unavailable');
      const context = await ports.load(transaction, actor.accountId, now);
      if (
        !context?.account ||
        context.account.id !== actor.accountId ||
        context.account.isSystemAdmin !== false ||
        !context.account.personId?.trim()
      )
        throw new EntryUsecaseError('forbidden');
      const arrays = [
        'grants',
        'enrollments',
        'assignments',
        'projects',
        'members',
        'people',
        'evaluationNodes',
        'evaluationNodeSubjects',
        'evaluationRelations',
      ] as const;
      if (!arrays.every((key) => Array.isArray(context[key])))
        throw new EntryUsecaseError('unavailable');
      return { ...context, account: { ...context.account }, now };
    } catch (error) {
      if (
        error instanceof EntryIdentityError ||
        error instanceof EntryUsecaseError
      )
        throw error;
      throw new EntryUsecaseError('unavailable');
    }
  };
}
