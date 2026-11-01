import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  entryPayloadMatchesInput,
  entryToolInputSchemas,
  entryToolSuccessSchemas,
} from '../../../contracts/entry-tools';
import type { EntryIdentity } from '../../auth/entry/identity';
import {
  AgentApiError,
  type AgentApiClient,
} from '../../integrations/agentapi/client';
import { outgoingEvent } from '../../integrations/agentapi/protocol';
import {
  AgentSessionError,
  assertSameAuthority,
  inspectNativeTurn,
  type SessionAuthority,
} from './session-policy';

/** Only these three production DTOs are consumed by this slice. */
export const conversationTools = [
  'submit_material_batch',
  'person_brief',
  'draft_requirement',
] as const;
export type ConversationTool = (typeof conversationTools)[number];
export type ToolSuccess = {
  [N in ConversationTool]: {
    name: N;
    payload: z.output<(typeof entryToolSuccessSchemas)[N]>;
  };
}[ConversationTool];
export interface ConversationRow {
  id: string;
  /** Issuance snapshot from 903, never request-supplied roles/person IDs. */
  authority: SessionAuthority;
  providerSessionId: string;
  state: 'active' | 'invalidated' | 'outcome_unknown' | 'failed' | 'cancelled';
  cleanup: 'none' | 'reserved' | 'verified' | 'unknown';
}
export interface TurnRow {
  operationId: string;
  inputDigest: string;
  state: 'reserved' | 'submitted' | 'complete' | 'outcome_unknown' | 'failed';
  userEventId: string | null;
  answer: string | null;
  polls: number;
}
export interface ToolRow {
  eventId: string;
  operationId: string;
  businessOperationId: string;
  args: unknown;
  success: ToolSuccess;
  state: 'sending' | 'sent' | 'outcome_unknown';
  resultEventId: string | null;
}
/** Normalized persistence projection, NOT a suggestion to store a JSON ledger. */
export interface ConversationLedger {
  conversation: ConversationRow;
  turns: TurnRow[];
  tools: ToolRow[];
}
export interface ConversationPorts<C> {
  /** Serialize by conversation ID. Commit ledger and business changes together;
   * thrown errors roll both back. No implementation may nest an owning tx. */
  transaction<T>(
    id: string,
    run: (tx: C, ledger: ConversationLedger | null) => Promise<T>,
  ): Promise<T>;
  save(tx: C, ledger: ConversationLedger): Promise<void>;
  current(tx: C, identity: EntryIdentity): Promise<SessionAuthority>;
  /** Must authorize current input/output, write business receipt + entry audit
   * in tx; operationId is server-derived, never the model's operationId. */
  execute(
    tx: C,
    identity: EntryIdentity,
    name: ConversationTool,
    args: unknown,
    operationId: string,
  ): Promise<ToolSuccess>;
  /** Re-read ALL prior result sources, including completed earlier turns. False
   * invalidates the whole provider context; never just delete local history. */
  revalidate(tx: C, identity: EntryIdentity, tool: ToolRow): Promise<boolean>;
}
type Result =
  | { status: 'waiting' | 'outcome_unknown' }
  | { status: 'cancelled'; cleanup: ConversationRow['cleanup'] }
  | { status: 'complete'; text: string; nature: 'ai_suggestion' };
class ConversationError extends Error {
  constructor(readonly kind: 'not_found' | 'forbidden' | 'conflict') {
    super(kind);
  }
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const idSchema = z.string().min(1).max(200);
const maxPolls = 120;
const maxTurns = 32;
function view(turn: TurnRow): Result {
  if (turn.state === 'complete')
    return { status: 'complete', text: turn.answer!, nature: 'ai_suggestion' };
  return {
    status:
      turn.state === 'reserved' || turn.state === 'outcome_unknown'
        ? 'outcome_unknown'
        : 'waiting',
  };
}
function safe(error: unknown): Error {
  return error instanceof AgentSessionError ||
    error instanceof ConversationError
    ? error
    : new AgentSessionError('unavailable');
}

/** No production factory until X1 supplies native store + same-tx readers.
 * Provider I/O is deliberately outside transaction callbacks. A persisted intent
 * with no ack is never automatically resubmitted, even after process restart. */
export function createAgentConversationService<C>(
  ports: ConversationPorts<C>,
  provider: Pick<AgentApiClient, 'send' | 'events' | 'archive'>,
) {
  async function guarded<T>(
    identity: EntryIdentity,
    id: string,
    run: (tx: C, ledger: ConversationLedger) => Promise<T>,
    allowStopped = false,
  ): Promise<T> {
    if (!idSchema.safeParse(id).success)
      throw new AgentSessionError('protocol');
    const result = await ports
      .transaction(
        id,
        async (tx, ledger): Promise<{ value: T } | { error: Error }> => {
          if (!ledger) return { error: new ConversationError('not_found') };
          const current = await ports.current(tx, identity);
          // Another account cannot invalidate or archive the owner's conversation.
          if (current.accountId !== ledger.conversation.authority.accountId)
            return { error: new ConversationError('forbidden') };
          try {
            assertSameAuthority(ledger.conversation.authority, current);
            for (const tool of ledger.tools)
              if (!(await ports.revalidate(tx, identity, tool)))
                throw new AgentSessionError('permission_changed');
          } catch {
            ledger.conversation.state = 'invalidated';
            await ports.save(tx, ledger);
            return { error: new AgentSessionError('permission_changed') };
          }
          if (!allowStopped && ledger.conversation.state !== 'active')
            return {
              error: new AgentSessionError(
                ledger.conversation.state === 'invalidated'
                  ? 'permission_changed'
                  : ledger.conversation.state === 'cancelled'
                    ? 'cancelled'
                    : 'unavailable',
              ),
            };
          return { value: await run(tx, ledger) };
        },
      )
      .catch((error: unknown) => {
        throw safe(error);
      });
    if ('error' in result) throw result.error;
    return result.value;
  }
  // Ack/error bookkeeping has no user-visible payload and must survive revocation
  // between a POST and its response. It never reactivates a stopped conversation.
  async function record(id: string, run: (ledger: ConversationLedger) => void) {
    await ports
      .transaction(id, async (tx, ledger) => {
        if (!ledger) throw new ConversationError('not_found');
        run(ledger);
        await ports.save(tx, ledger);
      })
      .catch((error: unknown) => {
        throw safe(error);
      });
  }
  async function postFailure(
    id: string,
    operationId: string,
    error: unknown,
    toolId?: string,
  ) {
    const uncertain = !(error instanceof AgentApiError) || error.uncertain;
    await record(id, (ledger) => {
      const turn = ledger.turns.find((row) => row.operationId === operationId)!;
      turn.state = uncertain ? 'outcome_unknown' : 'failed';
      if (toolId)
        ledger.tools.find((row) => row.eventId === toolId)!.state =
          'outcome_unknown';
      if (ledger.conversation.state === 'active')
        ledger.conversation.state = uncertain ? 'outcome_unknown' : 'failed';
    });
    if (!uncertain) throw new AgentSessionError('model_failed');
    return { status: 'outcome_unknown' } as const;
  }
  return {
    async submit(
      identity: EntryIdentity,
      id: string,
      operationId: string,
      text: string,
    ): Promise<Result> {
      if (!idSchema.safeParse(operationId).success)
        throw new AgentSessionError('protocol');
      const parsedEvent = outgoingEvent.safeParse({
        type: 'user.message',
        input: { parts: [{ type: 'text', text }] },
      });
      if (!parsedEvent.success) throw new AgentSessionError('protocol');
      const event = parsedEvent.data;
      const inputDigest = digest(JSON.stringify(event));
      const prepared = await guarded(identity, id, async (tx, ledger) => {
        const old = ledger.turns.find((row) => row.operationId === operationId);
        if (old) {
          if (old.inputDigest !== inputDigest)
            throw new ConversationError('conflict');
          return { result: view(old) };
        }
        if (ledger.turns.length >= maxTurns)
          throw new AgentSessionError('budget');
        if (ledger.turns.some((row) => row.state !== 'complete'))
          throw new ConversationError('conflict');
        ledger.turns.push({
          operationId,
          inputDigest,
          state: 'reserved',
          userEventId: null,
          answer: null,
          polls: 0,
        });
        await ports.save(tx, ledger);
        return { session: ledger.conversation.providerSessionId };
      });
      if (prepared.result !== undefined) return prepared.result;
      let ack: string;
      try {
        ack = await provider.send(prepared.session, event);
      } catch (error) {
        return postFailure(id, operationId, error);
      }
      await record(id, (ledger) => {
        const turn = ledger.turns.find(
          (row) => row.operationId === operationId,
        )!;
        turn.userEventId = ack;
        turn.state = 'submitted';
      });
      return guarded(identity, id, async () => ({ status: 'waiting' }));
    },
    async advance(
      identity: EntryIdentity,
      id: string,
      operationId: string,
    ): Promise<Result> {
      const snapshot = await guarded(identity, id, async (tx, ledger) => {
        const turn = ledger.turns.find(
          (row) => row.operationId === operationId,
        );
        if (!turn) throw new ConversationError('not_found');
        if (turn.state !== 'submitted') return { result: view(turn) };
        if (++turn.polls > maxPolls) throw new AgentSessionError('budget');
        await ports.save(tx, ledger);
        return {
          session: ledger.conversation.providerSessionId,
          userEventId: turn.userEventId!,
          completed: ledger.tools
            .filter(
              (row) => row.operationId === operationId && row.state === 'sent',
            )
            .map((row) => row.eventId),
        };
      });
      if (snapshot.result !== undefined) return snapshot.result;
      // GET may be retried by a later explicit advance; POST never is.
      const events = await provider
        .events(snapshot.session)
        .catch((error: unknown) => {
          throw error instanceof AgentApiError ? error : safe(error);
        });
      try {
        await guarded(identity, id, async (_tx, ledger) => {
          for (const tool of ledger.tools.filter(
            (row) => row.operationId === operationId,
          )) {
            const event = events.find((row) => row.id === tool.eventId);
            if (
              !event ||
              event.type !== 'agent.custom_tool_use' ||
              event.name !== tool.success.name ||
              !isDeepStrictEqual(
                entryToolInputSchemas[tool.success.name].parse(event.input),
                tool.args,
              )
            )
              throw new AgentSessionError('protocol');
          }
        });
        const observed = inspectNativeTurn(
          events,
          snapshot.userEventId,
          new Set(snapshot.completed),
        );
        if (observed.status === 'waiting')
          return guarded(identity, id, async () => ({ status: 'waiting' }));
        if (observed.status === 'complete')
          return guarded(identity, id, async (tx, ledger) => {
            const turn = ledger.turns.find(
              (row) => row.operationId === operationId,
            )!;
            if (turn.state === 'complete') return view(turn);
            if (turn.state !== 'submitted')
              throw new ConversationError('conflict');
            turn.state = 'complete';
            turn.answer = observed.text;
            await ports.save(tx, ledger);
            return observed;
          });
        for (const call of observed.calls) {
          if (!conversationTools.some((name) => name === call.name))
            throw new AgentSessionError('unavailable');
          const name = call.name as ConversationTool;
          const send = await guarded(identity, id, async (tx, ledger) => {
            const turn = ledger.turns.find(
              (row) => row.operationId === operationId,
            )!;
            if (turn.state !== 'submitted')
              throw new ConversationError('conflict');
            let tool = ledger.tools.find((row) => row.eventId === call.id);
            if (tool) {
              if (
                tool.operationId !== operationId ||
                tool.success.name !== name ||
                !isDeepStrictEqual(tool.args, call.args)
              )
                throw new AgentSessionError('protocol');
              return tool.state === 'sent' ? null : false;
            } else {
              const businessOperationId = digest(JSON.stringify([id, call.id]));
              const args = entryToolInputSchemas[name].parse(call.args);
              const result = await ports.execute(
                tx,
                identity,
                name,
                name === 'person_brief'
                  ? args
                  : { ...args, operationId: businessOperationId },
                businessOperationId,
              );
              if (result.name !== name) throw new AgentSessionError('protocol');
              const payload = entryToolSuccessSchemas[name].safeParse(
                result.payload,
              );
              if (
                !payload.success ||
                !entryPayloadMatchesInput(name, args, payload.data)
              )
                throw new AgentSessionError('protocol');
              // All domain changes roll back if authority changes during execution.
              assertSameAuthority(
                ledger.conversation.authority,
                await ports.current(tx, identity),
              );
              const success = { name, payload: payload.data } as ToolSuccess;
              tool = {
                eventId: call.id,
                operationId,
                businessOperationId,
                args,
                success,
                state: 'sending',
                resultEventId: null,
              };
              if (!(await ports.revalidate(tx, identity, tool)))
                throw new AgentSessionError('permission_changed');
              ledger.tools.push(tool);
            }
            const content = JSON.stringify({
              status: 'success',
              payload: tool.success.payload,
            });
            if (Buffer.byteLength(content) > 65536)
              throw new AgentSessionError('budget');
            tool.state = 'sending';
            await ports.save(tx, ledger);
            return content;
          });
          if (send === null) continue;
          if (send === false) return { status: 'outcome_unknown' };
          let ack: string;
          try {
            ack = await provider.send(snapshot.session, {
              type: 'user.custom_tool_result',
              custom_tool_use_id: call.id,
              content: [{ type: 'text', text: send }],
            });
          } catch (error) {
            return postFailure(id, operationId, error, call.id);
          }
          await record(id, (ledger) => {
            const tool = ledger.tools.find((row) => row.eventId === call.id)!;
            tool.state = 'sent';
            tool.resultEventId = ack;
          });
        }
        return guarded(identity, id, async () => ({ status: 'waiting' }));
      } catch (error) {
        await record(id, (ledger) => {
          if (ledger.conversation.state === 'active')
            ledger.conversation.state =
              error instanceof AgentSessionError &&
              error.kind === 'permission_changed'
                ? 'invalidated'
                : 'failed';
        });
        throw safe(error);
      }
    },
    async cancel(identity: EntryIdentity, id: string): Promise<Result> {
      const session = await guarded(
        identity,
        id,
        async (tx, ledger) => {
          ledger.conversation.state = 'cancelled';
          if (ledger.conversation.cleanup !== 'none') return null;
          ledger.conversation.cleanup = 'reserved';
          await ports.save(tx, ledger);
          return ledger.conversation.providerSessionId;
        },
        true,
      );
      if (session !== null) {
        let cleanup: 'verified' | 'unknown' = 'unknown';
        try {
          await provider.archive(session);
          cleanup = 'verified';
        } catch {
          /* no blind retry */
        }
        await record(id, (ledger) => {
          ledger.conversation.cleanup = cleanup;
        });
      }
      return guarded(
        identity,
        id,
        async (_tx, ledger) => ({
          status: 'cancelled',
          cleanup: ledger.conversation.cleanup,
        }),
        true,
      );
    },
  };
}
