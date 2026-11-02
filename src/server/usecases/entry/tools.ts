import { z } from 'zod';
import {
  ENTRY_TOOL_CHANNELS,
  entryToolCallSchema,
  entryToolInputSchemas,
  entryToolSuccessSchemas,
  entryPayloadMatchesInput,
  type EntryToolName,
  type EntryToolPayload,
  type EntryToolResult,
} from '../../../contracts/entry-tools';
import { parseEntryDeepLink } from '../../../contracts/entry-links';
import type { EntryIdentity } from '../../auth/entry/identity';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import {
  EntryUsecaseError,
  entryFailure,
  type EntryContextLoader,
  type EntryTransactionPorts,
} from './context';

/** Trusted domain adapters only. Every emitted object/source needs authorization.
 * execute may write/enqueue in this transaction, never invoke an external model.
 * At Read Committed it must lock the affected domain rows before loadCurrent().
 */
export interface EntryToolHandler<C> {
  authorize(
    transaction: C,
    current: EvaluationAuthzContext,
    args: unknown,
  ): Promise<boolean>;
  execute(
    transaction: C,
    args: unknown,
    loadCurrent: () => Promise<EvaluationAuthzContext>,
  ): Promise<unknown>;
  authorizeOutput(
    transaction: C,
    current: EvaluationAuthzContext,
    args: unknown,
    payload: EntryToolPayload,
  ): Promise<boolean>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function resourceOf(payload: EntryToolPayload): {
  resourceId: string | null;
  revision: number | null;
} {
  if ('batchId' in payload)
    return { resourceId: payload.batchId, revision: payload.revision };
  if ('person' in payload)
    return { resourceId: payload.person.id, revision: null };
  if ('jobId' in payload)
    return { resourceId: payload.jobId, revision: payload.revision };
  if ('demandId' in payload)
    return { resourceId: payload.demandId, revision: payload.revision };
  if ('demand' in payload)
    return { resourceId: payload.demand.id, revision: payload.demand.revision };
  const target = parseEntryDeepLink(payload.href)!;
  return { resourceId: target.id, revision: target.expectedRevision };
}
/** No default handlers or service/admin identity. Unwired capabilities fail closed. */
export function createEntryToolUsecase<C>(ports: {
  loadContext: EntryContextLoader<C>;
  transactions: EntryTransactionPorts<C>;
  handlers: Partial<Record<EntryToolName, EntryToolHandler<C>>>;
}) {
  return async (
    identity: EntryIdentity,
    call: unknown,
  ): Promise<EntryToolResult> => {
    try {
      const envelope = entryToolCallSchema.safeParse(call);
      if (!envelope.success) throw new EntryUsecaseError('validation_error');
      const { name } = envelope.data;
      const input = entryToolInputSchemas[name].safeParse(envelope.data.args);
      if (!input.success) throw new EntryUsecaseError('validation_error');
      const args = freeze(input.data);
      // Some declared third-act names deliberately have no frozen success DTO.
      const schema: z.ZodType | undefined = (
        entryToolSuccessSchemas as Partial<Record<EntryToolName, z.ZodType>>
      )[name];
      const handler = ports.handlers[name];
      if (
        !schema ||
        !handler?.authorize ||
        !handler.execute ||
        !handler.authorizeOutput
      )
        throw new EntryUsecaseError('unavailable');
      return await ports.transactions.transaction(async (tx) => {
        const current = await ports.loadContext(tx, identity);
        const channels: readonly string[] =
          ENTRY_TOOL_CHANNELS[identity.channel];
        if (
          !channels.includes(name) ||
          (await handler.authorize(tx, current, args)) !== true
        )
          throw new EntryUsecaseError('forbidden');
        const raw = await handler.execute(tx, args, () =>
          ports.loadContext(tx, identity),
        );
        const latest = await ports.loadContext(tx, identity);
        if ((await handler.authorize(tx, latest, args)) !== true)
          throw new EntryUsecaseError('forbidden');
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new EntryUsecaseError('unavailable');
        const payload = freeze(parsed.data as EntryToolPayload);
        if (
          !entryPayloadMatchesInput(name, args, payload) ||
          (await handler.authorizeOutput(tx, latest, args, payload)) !== true
        )
          throw new EntryUsecaseError('forbidden');
        await ports.transactions.audit(tx, {
          actorId: latest.account.id,
          channel: identity.channel,
          action: `entry.tool.${name}`,
          ...resourceOf(payload),
        });
        return { status: 'success' as const, payload };
      });
    } catch (error) {
      // This catch is OUTSIDE the transaction: post-effect refusal must roll back.
      return entryFailure(error);
    }
  };
}
