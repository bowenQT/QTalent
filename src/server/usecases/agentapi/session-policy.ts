import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AGENTAPI_ENTRY_TOOLS,
  entryToolInputSchemas,
  entryToolSuccessSchemas,
  type EntryToolName,
} from '../../../contracts/entry-tools';
import { isCurrent } from '../../authz';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import type { NativeEvent } from '../../integrations/agentapi/protocol';
import type { EntryIdentityService } from '../../auth/entry/identity';

export class AgentSessionError extends Error {
  constructor(
    readonly kind:
      | 'permission_changed'
      | 'protocol'
      | 'budget'
      | 'model_failed'
      | 'cancelled'
      | 'unavailable',
  ) {
    super(kind);
    this.name = 'AgentSessionError';
  }
}
type Actor = Awaited<ReturnType<EntryIdentityService['current']>>;
export interface SessionAuthority {
  accountId: string;
  personId: string;
  credentialId: string;
  credentialRevision: number;
  authorizationDigest: string;
}
function stable(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map(stable).sort().join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
/** Only authoritative current context, never a client-provided role/revision.
 * Validity booleans make boundary crossings invalidate a session even without a
 * database update. Global context changes conservatively invalidate as well.
 * This digest does not replace revalidating every previously sent tool result.
 */
export function sessionAuthority(
  actor: Actor,
  context: EvaluationAuthzContext,
): SessionAuthority {
  if (
    actor.channel !== 'agentapi' ||
    context.account.isSystemAdmin ||
    actor.accountId !== context.account.id ||
    actor.personId !== context.account.personId ||
    !Number.isFinite(Date.parse(context.now))
  )
    throw new AgentSessionError('permission_changed');
  const timed = [
    context.grants,
    context.enrollments,
    context.assignments,
    context.members,
    context.evaluationRelations,
  ];
  const { now, ...facts } = context;
  const authorizationDigest = createHash('sha256')
    .update(
      stable({
        facts,
        validity: timed.map((rows) =>
          rows.map((row) => ({ row, current: isCurrent(row, now) })),
        ),
      }),
    )
    .digest('hex');
  return {
    accountId: actor.accountId,
    personId: actor.personId,
    credentialId: actor.credentialId,
    credentialRevision: actor.credentialRevision,
    authorizationDigest,
  };
}
export function assertSameAuthority(
  expected: SessionAuthority,
  current: SessionAuthority,
) {
  if (!isDeepStrictEqual(expected, current))
    throw new AgentSessionError('permission_changed');
}
export const availableAgentTools = AGENTAPI_ENTRY_TOOLS.filter(
  (name) => name in entryToolSuccessSchemas,
);
export type PendingCall = { id: string; name: EntryToolName; args: unknown };
export type TurnObservation =
  | { status: 'waiting' }
  | { status: 'tools'; calls: PendingCall[] }
  | { status: 'complete'; text: string; nature: 'ai_suggestion' };
/** Fold one complete bounded provider history. It performs no domain writes and
 * never treats an old idle, interrupt or merely accepted input as success.
 * Callers persist tool execution/result-send progress before external actions.
 */
export function inspectNativeTurn(
  events: readonly NativeEvent[],
  acceptedInputId: string,
  completedToolIds: ReadonlySet<string>,
): TurnObservation {
  if (events.length > 500 || completedToolIds.size > 8)
    throw new AgentSessionError('budget');
  const unique = new Map<string, NativeEvent>();
  for (const event of events) {
    const old = unique.get(event.id);
    if (old && !isDeepStrictEqual(old, event))
      throw new AgentSessionError('protocol');
    unique.set(event.id, event);
  }
  let active = false,
    text = '';
  const calls = new Map<string, PendingCall>();
  let observation: TurnObservation = { status: 'waiting' };
  for (const event of unique.values()) {
    if (event.id === acceptedInputId) {
      if (event.type !== 'user.message')
        throw new AgentSessionError('protocol');
      active = true;
      continue;
    }
    if (!active) continue;
    if (event.type === 'user.message') throw new AgentSessionError('protocol');
    if (event.type === 'user.interrupt')
      throw new AgentSessionError('cancelled');
    if (
      event.type === 'session.error' ||
      event.type === 'session.status_terminated'
    )
      throw new AgentSessionError('model_failed');
    if (event.type === 'unsafe_tool') throw new AgentSessionError('protocol');
    if (event.type === 'agent.message') {
      observation = { status: 'waiting' };
      text += event.content.map((part) => part.text).join('');
      if (text.length > 65536) throw new AgentSessionError('budget');
    }
    if (event.type === 'agent.custom_tool_use') {
      observation = { status: 'waiting' };
      if (!availableAgentTools.some((name) => name === event.name))
        throw new AgentSessionError('unavailable');
      const name = event.name as EntryToolName;
      const args = entryToolInputSchemas[name].safeParse(event.input);
      if (!args.success) throw new AgentSessionError('protocol');
      calls.set(event.id, { id: event.id, name, args: args.data });
      if (calls.size > 8) throw new AgentSessionError('budget');
    }
    if (event.type !== 'session.status_idle') continue;
    const reason = event.stop_reason;
    if (reason.type === 'interrupted') throw new AgentSessionError('cancelled');
    if (reason.type === 'budget_reached') throw new AgentSessionError('budget');
    if (reason.type === 'retries_exhausted')
      throw new AgentSessionError('model_failed');
    if (reason.type === 'requires_action') {
      const ids = reason.event_ids;
      if (
        !ids?.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !calls.has(id))
      )
        throw new AgentSessionError('protocol');
      const pending = ids
        .filter((id) => !completedToolIds.has(id))
        .map((id) => calls.get(id)!);
      observation = pending.length
        ? { status: 'tools', calls: pending }
        : { status: 'waiting' };
    } else {
      if ([...calls.keys()].some((id) => !completedToolIds.has(id)))
        throw new AgentSessionError('protocol');
      observation = { status: 'complete', text, nature: 'ai_suggestion' };
    }
  }
  return observation;
}
