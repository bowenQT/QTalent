import type { MaterialSourceReference } from '../../contracts/sources';
import { z } from 'zod';
import { createClock } from '../../lib/clock';
import type { EvaluationAuthzContext } from '../authz/evaluation-node';
import {
  confirmNodeConclusionInputSchema,
  readNodeConclusionInputSchema,
  canConfirmNodeConclusion,
  canReadNodeConclusion,
  NodeConclusionError,
  nodeConclusionFingerprint,
  nodeConclusionVersionSchema,
  immutableNodeConclusion,
  requireNodeConclusionSources,
  planNodeConclusion,
  type ConfirmNodeConclusionInput,
  type NodeConclusionIdentity,
  type NodeConclusionOperation,
  type NodeConclusionVersion,
  type NodeScoreAuthority,
  type ResolvedNodeConclusionSource,
} from '../modules/programs/node-conclusion';

export interface NodeConclusionAudit extends NodeConclusionIdentity {
  action: 'node_conclusion.confirm';
  accountId: string;
  actorId: string;
  conclusionId: string;
  version: number;
  at: string;
}
export interface NodeConclusionDependencies<C> {
  environment: string;
  transaction<T>(run: (tx: C) => Promise<T>): Promise<T>;
  lockOperation(tx: C, accountId: string, operationId: string): Promise<void>;
  lockConclusion(tx: C, identity: NodeConclusionIdentity): Promise<void>;
  loadAuthorization(
    tx: C,
    accountId: string,
    businessNow: string,
  ): Promise<{
    context: EvaluationAuthzContext;
    actor: { id: string; name: string };
  }>;
  readCurrent(
    tx: C,
    identity: NodeConclusionIdentity,
  ): Promise<NodeConclusionVersion | null>;
  readVersion(
    tx: C,
    identity: NodeConclusionIdentity,
    version: number,
  ): Promise<NodeConclusionVersion | null>;
  readOperation(
    tx: C,
    accountId: string,
    operationId: string,
  ): Promise<NodeConclusionOperation | null>;
  readScoreConfirmations(
    tx: C,
    identity: NodeConclusionIdentity,
  ): Promise<NodeScoreAuthority | null>;
  resolveSources(
    tx: C,
    accountId: string,
    identity: NodeConclusionIdentity,
    references: MaterialSourceReference[],
  ): Promise<ResolvedNodeConclusionSource[] | null>;
  /** Adapter must append only and enforce this CAS inside the same transaction. */
  appendVersion(
    tx: C,
    record: NodeConclusionVersion,
    expectedVersion: number,
  ): Promise<void>;
  appendAudit(tx: C, audit: NodeConclusionAudit): Promise<void>;
  saveOperation(
    tx: C,
    accountId: string,
    operationId: string,
    operation: NodeConclusionOperation,
  ): Promise<void>;
  newId(): string;
  wallNow(): Date;
}
export type ConfirmNodeConclusionResult =
  | { status: 'success'; conclusion: NodeConclusionVersion; replayed: boolean }
  | {
      status: 'validation_error';
      input: unknown;
      fieldErrors: Record<string, string[] | undefined>;
    }
  | { status: 'conflict'; input: unknown; message: string }
  | { status: 'forbidden' | 'not_found'; message: string };
export type ReadNodeConclusionResult =
  | { status: 'success'; conclusion: NodeConclusionVersion }
  | {
      status: 'validation_error';
      input: unknown;
      fieldErrors: Record<string, string[] | undefined>;
    }
  | { status: 'conflict' | 'forbidden' | 'not_found'; message: string };
export function createNodeConclusionUsecase<C>(
  deps: NodeConclusionDependencies<C>,
) {
  const required = [
    'transaction',
    'lockOperation',
    'lockConclusion',
    'loadAuthorization',
    'readCurrent',
    'readVersion',
    'readOperation',
    'readScoreConfirmations',
    'resolveSources',
    'appendVersion',
    'appendAudit',
    'saveOperation',
    'newId',
    'wallNow',
  ] as const;
  for (const name of required)
    if (typeof deps[name] !== 'function')
      throw new Error('NodeConclusionDependencies.' + name + ' required');
  const clock = createClock(deps.environment, deps.wallNow);
  async function authorization(tx: C, accountId: string) {
    const now = clock.now().toISOString();
    const loaded = await deps.loadAuthorization(tx, accountId, now);
    if (
      loaded.context.account.id !== accountId ||
      loaded.context.account.personId !== loaded.actor.id ||
      !loaded.actor.name.trim() ||
      loaded.context.now !== now ||
      !Array.isArray(loaded.context.evaluationNodes) ||
      !Array.isArray(loaded.context.evaluationNodeSubjects) ||
      !Array.isArray(loaded.context.evaluationRelations)
    )
      throw new NodeConclusionError('forbidden', '当前身份或节点授权不可用');
    return loaded;
  }
  function saved(raw: NodeConclusionVersion, identity: NodeConclusionIdentity) {
    const parsed = nodeConclusionVersionSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.evaluationNodeId !== identity.evaluationNodeId ||
      parsed.data.personId !== identity.personId
    )
      throw new NodeConclusionError('conflict', '结论记录或身份已变化');
    return parsed.data;
  }
  async function visible(
    tx: C,
    accountId: string,
    identity: NodeConclusionIdentity,
    record: NodeConclusionVersion,
    permission: 'read' | 'confirm',
  ) {
    const sources = await deps.resolveSources(
      tx,
      accountId,
      identity,
      structuredClone(record.basis.references),
    );
    const loaded = await authorization(tx, accountId);
    const permitted =
      permission === 'confirm'
        ? canConfirmNodeConclusion(loaded.context, identity)
        : canReadNodeConclusion(loaded.context, identity);
    if (!permitted)
      throw new NodeConclusionError('forbidden', '结论不存在或不可见');
    // An operation replay belongs to the human who signed that version. A
    // newly bound HR may read history or create a new operation, not inherit it.
    if (permission === 'confirm' && loaded.actor.id !== record.confirmedBy.id)
      throw new NodeConclusionError('forbidden', '原确认操作的身份绑定已变化');
    requireNodeConclusionSources(
      loaded.context,
      identity,
      record.basis.references,
      sources,
    );
    return immutableNodeConclusion(record);
  }
  return {
    async confirm(
      accountId: string,
      raw: unknown,
    ): Promise<ConfirmNodeConclusionResult> {
      const checked = confirmNodeConclusionInputSchema.safeParse(raw);
      if (!checked.success)
        return {
          status: 'validation_error',
          input: raw,
          fieldErrors: z.flattenError(checked.error).fieldErrors,
        };
      const input = checked.data;
      const identity = {
        evaluationNodeId: input.evaluationNodeId,
        personId: input.personId,
      };
      try {
        return await deps.transaction(async (tx) => {
          await deps.lockOperation(tx, accountId, input.operationId);
          await deps.lockConclusion(tx, identity);
          const loaded = await authorization(tx, accountId);
          if (!canConfirmNodeConclusion(loaded.context, identity))
            throw new NodeConclusionError(
              'forbidden',
              '仅范围内HR可确认节点结论',
            );
          const fingerprint = nodeConclusionFingerprint(input);
          const operation = await deps.readOperation(
            tx,
            accountId,
            input.operationId,
          );
          if (operation !== null) {
            if (operation.fingerprint !== fingerprint)
              throw new NodeConclusionError(
                'conflict',
                '同一请求不能确认不同内容',
              );
            const record = saved(operation.conclusion, identity);
            return {
              status: 'success',
              conclusion: await visible(
                tx,
                accountId,
                identity,
                record,
                'confirm',
              ),
              replayed: true,
            };
          }
          const current = await deps.readCurrent(tx, identity);
          const scores = await deps.readScoreConfirmations(tx, identity);
          const sources = await deps.resolveSources(
            tx,
            accountId,
            identity,
            structuredClone(input.basisReferences),
          );
          const fresh = await authorization(tx, accountId);
          if (fresh.actor.id !== loaded.actor.id)
            throw new NodeConclusionError('forbidden', '当前身份绑定已变化');
          const record = planNodeConclusion({
            command: input,
            current,
            context: fresh.context,
            actor: fresh.actor,
            now: deps.wallNow().toISOString(),
            newId: current?.id ?? deps.newId(),
            scores,
            sources,
          });
          await deps.appendVersion(
            tx,
            structuredClone(record),
            input.expectedVersion,
          );
          await deps.appendAudit(tx, {
            ...identity,
            action: 'node_conclusion.confirm',
            accountId,
            actorId: fresh.actor.id,
            conclusionId: record.id,
            version: record.version,
            at: record.confirmedAt,
          });
          await deps.saveOperation(tx, accountId, input.operationId, {
            fingerprint,
            conclusion: structuredClone(record),
          });
          return { status: 'success', conclusion: record, replayed: false };
        });
      } catch (error) {
        if (!(error instanceof NodeConclusionError)) throw error;
        if (error.code === 'conflict')
          return { status: 'conflict', input: raw, message: error.message };
        return { status: error.code, message: error.message };
      }
    },
    async read(
      accountId: string,
      raw: unknown,
    ): Promise<ReadNodeConclusionResult> {
      const checked = readNodeConclusionInputSchema.safeParse(raw);
      if (!checked.success)
        return {
          status: 'validation_error',
          input: raw,
          fieldErrors: z.flattenError(checked.error).fieldErrors,
        };
      const input = checked.data,
        identity = {
          evaluationNodeId: input.evaluationNodeId,
          personId: input.personId,
        };
      try {
        return await deps.transaction(async (tx) => {
          await deps.lockConclusion(tx, identity);
          const loaded = await authorization(tx, accountId);
          if (!canReadNodeConclusion(loaded.context, identity))
            throw new NodeConclusionError('forbidden', '结论不存在或不可见');
          const rawRecord =
            input.version === undefined
              ? await deps.readCurrent(tx, identity)
              : await deps.readVersion(tx, identity, input.version);
          if (rawRecord === null)
            throw new NodeConclusionError('not_found', '结论不存在或不可见');
          const record = saved(rawRecord, identity);
          if (input.version !== undefined && record.version !== input.version)
            throw new NodeConclusionError('conflict', '结论版本已变化');
          return {
            status: 'success',
            conclusion: await visible(tx, accountId, identity, record, 'read'),
          };
        });
      } catch (error) {
        if (!(error instanceof NodeConclusionError)) throw error;
        return { status: error.code, message: error.message };
      }
    },
  };
}
export type { ConfirmNodeConclusionInput };
