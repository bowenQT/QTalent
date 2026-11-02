import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  entryPayloadMatchesInput,
  entryToolInputSchemas,
  entryToolSuccessSchemas,
} from '../../../contracts/entry-tools';
import {
  agentApiConversations,
  agentApiTurns,
  agentApiToolEvents,
} from '../../auth/entry/agentapi/schema';
import { agentApiBindings } from '../../auth/entry/schema';
import { session } from '../../auth/schema';
import { accountBindings } from '../../modules/directory';
import type {
  EntryIdentity,
  EntryIdentityService,
} from '../../auth/entry/identity';
import type { Database, Transaction } from '../../db/client';
import { recordEntryAudit } from '../entry/audit';
import {
  createEntryContextLoader,
  loadEntryAuthorizationContext,
  EntryUsecaseError,
} from '../entry/context';
import { createMcpDomainHandlers } from '../mcp/handlers';
import { AgentSessionError, sessionAuthority } from './session-policy';
import {
  conversationTools,
  type ConversationLedger,
  type ConversationPorts,
  type ToolSuccess,
} from './service';

const fail = (): never => {
  throw new AgentSessionError('unavailable');
};
const key = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const authoritySchema = z.strictObject({
  accountId: key,
  personId: key,
  credentialId: key,
  credentialRevision: z.number().int().positive(),
  authorizationDigest: hash,
});
const turnSchema = z.strictObject({
  operationId: key,
  inputDigest: hash,
  state: z.enum([
    'reserved',
    'submitted',
    'complete',
    'outcome_unknown',
    'failed',
  ]),
  userEventId: key.nullable(),
  answer: z.string().max(65536).nullable(),
  polls: z.number().int().min(0).max(120),
});
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) return fail();
  return result.data;
}
function validate(ledger: ConversationLedger) {
  parse(authoritySchema, ledger.conversation.authority);
  parse(key, ledger.conversation.id);
  parse(key, ledger.conversation.providerSessionId);
  if (ledger.turns.length > 32 || ledger.tools.length > 256) fail();
  const turns = new Map<string, ConversationLedger['turns'][number]>();
  let incomplete = 0;
  for (const raw of ledger.turns) {
    const turn = parse(turnSchema, raw);
    if (turns.has(turn.operationId)) fail();
    turns.set(turn.operationId, turn);
    if (turn.state !== 'complete') incomplete++;
    if ((turn.state === 'complete') !== (turn.answer !== null)) fail();
    if (
      (turn.state === 'submitted' || turn.state === 'complete') &&
      !turn.userEventId
    )
      fail();
    if (turn.state === 'reserved' && turn.userEventId !== null) fail();
  }
  if (incomplete > 1) fail();
  const ids = new Set<string>();
  for (const tool of ledger.tools) {
    parse(key, tool.eventId);
    if (ids.has(tool.eventId) || !turns.has(tool.operationId)) fail();
    ids.add(tool.eventId);
    const name = tool.success.name;
    if (!conversationTools.includes(name)) fail();
    const args = parse(entryToolInputSchemas[name], tool.args);
    const payload = parse(entryToolSuccessSchemas[name], tool.success.payload);
    if (
      !isDeepStrictEqual(args, tool.args) ||
      !isDeepStrictEqual(payload, tool.success.payload) ||
      !entryPayloadMatchesInput(name, args, payload)
    )
      fail();
    const expected = createHash('sha256')
      .update(JSON.stringify([ledger.conversation.id, tool.eventId]))
      .digest('hex');
    if (tool.businessOperationId !== expected) fail();
    if (
      Buffer.byteLength(JSON.stringify({ status: 'success', payload })) > 65536
    )
      fail();
    if ((tool.state === 'sent') !== (tool.resultEventId !== null)) fail();
    if (tool.resultEventId !== null) parse(key, tool.resultEventId);
  }
}
const turnTransitions = {
  reserved: ['reserved', 'submitted', 'outcome_unknown', 'failed'],
  submitted: ['submitted', 'complete', 'outcome_unknown', 'failed'],
  complete: ['complete'],
  outcome_unknown: ['outcome_unknown'],
  failed: ['failed'],
} as const;
function changes(before: ConversationLedger, after: ConversationLedger) {
  validate(after);
  const a = before.conversation,
    b = after.conversation;
  if (
    a.id !== b.id ||
    a.providerSessionId !== b.providerSessionId ||
    !isDeepStrictEqual(a.authority, b.authority)
  )
    fail();
  if (
    a.state !== b.state &&
    a.state !== 'active' &&
    !['cancelled', 'invalidated'].includes(b.state)
  )
    fail();
  const cleanups = {
    none: ['none', 'reserved'],
    reserved: ['reserved', 'verified', 'unknown'],
    verified: ['verified'],
    unknown: ['unknown'],
  };
  if (!cleanups[a.cleanup].includes(b.cleanup)) fail();
  if (b.cleanup !== 'none' && !['cancelled', 'invalidated'].includes(b.state))
    fail();
  if (
    after.turns.length < before.turns.length ||
    after.tools.length < before.tools.length
  )
    fail();
  before.turns.forEach((old, index) => {
    const next = after.turns[index]!;
    if (
      old.operationId !== next.operationId ||
      old.inputDigest !== next.inputDigest ||
      !(turnTransitions[old.state] as readonly string[]).includes(next.state) ||
      next.polls < old.polls ||
      next.polls > old.polls + 1
    )
      fail();
    if (old.userEventId !== null && old.userEventId !== next.userEventId)
      fail();
    if (old.answer !== null && old.answer !== next.answer) fail();
  });
  after.turns.slice(before.turns.length).forEach((turn) => {
    if (turn.state !== 'reserved' || turn.polls !== 0) fail();
  });
  const oldTools = new Map(before.tools.map((row) => [row.eventId, row]));
  for (const next of after.tools) {
    const old = oldTools.get(next.eventId);
    if (!old) {
      if (
        next.state !== 'sending' ||
        after.turns.find((turn) => turn.operationId === next.operationId)
          ?.state !== 'submitted'
      )
        fail();
      continue;
    }
    const { state: oldState, resultEventId: oldResult, ...oldFacts } = old;
    const { state: nextState, resultEventId: nextResult, ...nextFacts } = next;
    if (
      !isDeepStrictEqual(oldFacts, nextFacts) ||
      (oldState !== 'sending' && oldState !== nextState) ||
      (oldResult !== null && oldResult !== nextResult)
    )
      fail();
    oldTools.delete(next.eventId);
  }
  if (oldTools.size) fail();
}

/** Real normalized storage. No provider call, identity minting or migration.
 * inTransaction permits an existing outer transaction; transaction owns one.
 * save is accepted only for the exact locked conversation in that transaction. */
export function createAgentConversationStore(db: Database) {
  const scopes = new WeakMap<
    Transaction,
    { before: ConversationLedger; bindingId: string | null }
  >();
  async function inTransaction<T>(
    tx: Transaction,
    id: string,
    run: (tx: Transaction, ledger: ConversationLedger | null) => Promise<T>,
  ): Promise<T> {
    if (scopes.has(tx)) fail();
    // Logout deletes the auth session, cascading to the AgentAPI binding and
    // then nulling this row's binding. The same-transaction 903 re-read locks
    // session -> account -> binding, so take that chain BEFORE the conversation
    // lock: a racing logout then waits for us instead of deadlocking.
    const [link] = await tx
      .select({
        bindingId: agentApiBindings.id,
        accountId: agentApiBindings.accountId,
        sessionId: agentApiBindings.sessionId,
      })
      .from(agentApiConversations)
      .innerJoin(
        agentApiBindings,
        eq(agentApiBindings.id, agentApiConversations.bindingId),
      )
      .where(eq(agentApiConversations.id, id));
    if (link) {
      await tx
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, link.sessionId))
        .for('update');
      await tx
        .select({ id: accountBindings.accountId })
        .from(accountBindings)
        .where(eq(accountBindings.accountId, link.accountId))
        .for('update');
      await tx
        .select({ id: agentApiBindings.id })
        .from(agentApiBindings)
        .where(eq(agentApiBindings.id, link.bindingId))
        .for('update');
    }
    const [row] = await tx
      .select()
      .from(agentApiConversations)
      .where(eq(agentApiConversations.id, id))
      .for('update');
    if (!row) return run(tx, null);
    // At RC, all following facts are loaded AFTER the lock wait, not before it.
    if (row.state === 'creating' || row.providerSessionId === null)
      return fail();
    const turns = await tx
      .select()
      .from(agentApiTurns)
      .where(eq(agentApiTurns.conversationId, id))
      .orderBy(asc(agentApiTurns.ordinal));
    const tools = await tx
      .select()
      .from(agentApiToolEvents)
      .where(eq(agentApiToolEvents.conversationId, id))
      .orderBy(asc(agentApiToolEvents.eventId));
    if (
      turns.some(
        (turn, i) => turn.ordinal !== i + 1 || turn.nature !== 'ai_suggestion',
      )
    )
      fail();
    const ledger: ConversationLedger = {
      conversation: {
        id,
        authority: {
          accountId: row.accountId,
          personId: row.personId,
          credentialId: row.credentialId,
          credentialRevision: row.credentialRevision,
          authorizationDigest: row.authorizationDigest,
        },
        providerSessionId: row.providerSessionId,
        state: row.state,
        cleanup: row.cleanup,
      },
      turns: turns.map(
        ({ operationId, inputDigest, state, userEventId, answer, polls }) => ({
          operationId,
          inputDigest,
          state,
          userEventId,
          answer,
          polls,
        }),
      ),
      tools: tools.map(
        ({
          eventId,
          operationId,
          businessOperationId,
          args,
          name,
          successPayload,
          state,
          resultEventId,
        }) => ({
          eventId,
          operationId,
          businessOperationId,
          args,
          success: { name, payload: successPayload } as ToolSuccess,
          state,
          resultEventId,
        }),
      ),
    };
    validate(ledger);
    scopes.set(tx, {
      before: structuredClone(ledger),
      bindingId: row.bindingId,
    });
    try {
      return await run(tx, ledger);
    } finally {
      scopes.delete(tx);
    }
  }
  return {
    inTransaction,
    transaction<T>(
      id: string,
      run: (tx: Transaction, ledger: ConversationLedger | null) => Promise<T>,
    ) {
      return db.transaction((tx) => inTransaction(tx, id, run), {
        isolationLevel: 'read committed',
      });
    },
    bindingId(tx: Transaction) {
      const scope = scopes.get(tx);
      if (!scope) return fail();
      return scope.bindingId;
    },
    async save(tx: Transaction, ledger: ConversationLedger) {
      const scope = scopes.get(tx);
      if (!scope) return fail();
      changes(scope.before, ledger);
      const id = ledger.conversation.id,
        updatedAt = new Date();
      // Complete the prior turn before inserting a new one (partial unique index).
      for (const [index, turn] of ledger.turns.entries()) {
        if (index < scope.before.turns.length)
          await tx
            .update(agentApiTurns)
            .set({
              state: turn.state,
              userEventId: turn.userEventId,
              answer: turn.answer,
              polls: turn.polls,
              updatedAt,
            })
            .where(
              and(
                eq(agentApiTurns.conversationId, id),
                eq(agentApiTurns.operationId, turn.operationId),
              ),
            );
        else
          await tx.insert(agentApiTurns).values({
            conversationId: id,
            ordinal: index + 1,
            ...turn,
            updatedAt,
          });
      }
      const existing = new Set(scope.before.tools.map((row) => row.eventId));
      for (const tool of ledger.tools) {
        if (existing.has(tool.eventId))
          await tx
            .update(agentApiToolEvents)
            .set({
              state: tool.state,
              resultEventId: tool.resultEventId,
              updatedAt,
            })
            .where(
              and(
                eq(agentApiToolEvents.conversationId, id),
                eq(agentApiToolEvents.eventId, tool.eventId),
              ),
            );
        else
          await tx.insert(agentApiToolEvents).values({
            conversationId: id,
            eventId: tool.eventId,
            operationId: tool.operationId,
            businessOperationId: tool.businessOperationId,
            name: tool.success.name,
            args: parse(entryToolInputSchemas[tool.success.name], tool.args),
            successPayload: tool.success.payload,
            state: tool.state,
            resultEventId: tool.resultEventId,
            updatedAt,
          });
      }
      await tx
        .update(agentApiConversations)
        .set({
          state: ledger.conversation.state,
          cleanup: ledger.conversation.cleanup,
          updatedAt,
        })
        .where(eq(agentApiConversations.id, id));
      scope.before = structuredClone(ledger);
    },
  };
}

/** Private concrete composition, not an HTTP registration. Caller supplies the
 * real domain factories already used by MCP, never alternate allow-all handlers.
 * Material/demand historical readers are not yet available: refuse BEFORE writes.
 */
export function createAgentConversationPostgresPorts(options: {
  db: Database;
  identities: EntryIdentityService;
  domains: Parameters<typeof createMcpDomainHandlers>[0];
  now?: () => string;
}): ConversationPorts<Transaction> {
  const store = createAgentConversationStore(options.db);
  const handlers = createMcpDomainHandlers(options.domains);
  // Both the explicit identity check and the 899 context loader re-read the
  // 903 credential on this conversation's transaction, never on the pool.
  const inTransaction = (tx: Transaction): EntryIdentityService => ({
    ...options.identities,
    current: (identity) =>
      options.identities.currentInTransaction(tx, identity),
  });
  const context = (tx: Transaction, identity: EntryIdentity) =>
    createEntryContextLoader<Transaction>(inTransaction(tx), {
      load: loadEntryAuthorizationContext,
      businessNow: options.now,
    })(tx, identity);
  async function current(tx: Transaction, identity: EntryIdentity) {
    const actor = await options.identities.currentInTransaction(tx, identity);
    if (
      actor.channel !== 'agentapi' ||
      store.bindingId(tx) !== actor.credentialId
    )
      throw new EntryUsecaseError('unauthenticated');
    return sessionAuthority(actor, await context(tx, identity));
  }
  return {
    transaction: store.transaction,
    save: store.save,
    current,
    async execute(tx, identity, name, args) {
      // Native create/replay is not a read-only historical source reader. Do not
      // call it to bless old context; missing operation rows could create anew.
      if (name !== 'person_brief') throw new EntryUsecaseError('unavailable');
      await current(tx, identity);
      const handler = handlers.person_brief;
      let ctx = await context(tx, identity);
      if (!(await handler.authorize(tx, ctx, args)))
        throw new EntryUsecaseError('forbidden');
      const raw = await handler.execute(tx, args, () => context(tx, identity));
      await current(tx, identity);
      ctx = await context(tx, identity);
      const payload = parse(entryToolSuccessSchemas.person_brief, raw);
      if (
        !(await handler.authorize(tx, ctx, args)) ||
        !(await handler.authorizeOutput(tx, ctx, args, payload))
      )
        throw new EntryUsecaseError('forbidden');
      await recordEntryAudit(tx, {
        actorId: ctx.account.id,
        channel: 'agentapi',
        action: 'entry.tool.person_brief',
        resourceId: payload.person.id,
        revision: null,
      });
      return { name, payload };
    },
    async revalidate(tx, identity, tool) {
      if (tool.success.name !== 'person_brief')
        throw new EntryUsecaseError('unavailable');
      await current(tx, identity);
      const ctx = await context(tx, identity),
        handler = handlers.person_brief;
      return (
        (await handler.authorize(tx, ctx, tool.args)) &&
        (await handler.authorizeOutput(
          tx,
          ctx,
          tool.args,
          tool.success.payload,
        ))
      );
    },
  };
}
