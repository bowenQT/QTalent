import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { createClock } from '../../lib/clock';
import {
  materialReviewCommandResultSchema,
  materialReviewResolutionReceiptSchema,
} from '../../contracts/material-review';
import type { MaterialReviewCommandResult } from '../../contracts/material-review';
import type {
  RecordingWork,
  ResumeRecording,
} from '../modules/records/recordings/types';
import {
  planSpeakerBinding,
  projectSpeakerBindings,
  requireSpeakerAccess,
  requireBoundCandidates,
  speakerBindingCommandSchema,
  speakerBindingFingerprint,
  speakerCandidates,
  SpeakerBindingError,
  type SpeakerBindingCommand,
  type SpeakerBindingSnapshot,
  type SpeakerBindingAuthority,
  type SpeakerBindingPlan,
  type SpeakerBindingReceipt,
} from '../modules/records/speaker-binding';

type Version = Pick<
  SpeakerBindingSnapshot,
  'batchId' | 'materialId' | 'evaluationNodeId' | 'membershipRevision'
> & {
  recordingId: string;
  originalVersionId: string;
  transcriptVersionId: string;
  recordCollectionId: string;
};
export interface SpeakerBindingOperation {
  fingerprint: string;
  version: Version;
  result: SpeakerBindingReceipt;
}
export interface SpeakerBindingDependencies<C> {
  environment: string;
  wallNow(): Date;
  /** All ports below use this same native transaction; exceptions roll EVERYTHING back. */
  transaction<T>(run: (tx: C) => Promise<T>): Promise<T>;
  lockOperation(tx: C, accountId: string, operationId: string): Promise<void>;
  locate(
    tx: C,
    batchId: string,
    itemId: string,
  ): Promise<{ recordingId: string } | null>;
  /** Lock recording + current 846 collection/membership + processing job before loading facts. */
  lockRecording(tx: C, recordingId: string): Promise<void>;
  loadSnapshot(
    tx: C,
    batchId: string,
    itemId: string,
  ): Promise<SpeakerBindingSnapshot | null>;
  loadAuthority(
    tx: C,
    accountId: string,
    snapshot: SpeakerBindingSnapshot,
    businessNow: string,
  ): Promise<SpeakerBindingAuthority>;
  readOperation(
    tx: C,
    accountId: string,
    operationId: string,
  ): Promise<SpeakerBindingOperation | null>;
  /** Binding+item CAS, append manual ledger; never replace/delete prior human decisions. */
  commitChange(
    tx: C,
    snapshot: SpeakerBindingSnapshot,
    plan: SpeakerBindingPlan,
  ): Promise<void>;
  /** Invalidate ONLY supplied current unconfirmed drafts and advance derived binding revision. */
  invalidateDrafts(
    tx: C,
    snapshot: SpeakerBindingSnapshot,
    plan: SpeakerBindingPlan,
  ): Promise<string[]>;
  /** Store real resumeGrant, reopen the checkpoint and enqueue unique work in this same tx.
   * Returns the canonical processing job ID, not the queue message ID. */
  commitResume(
    tx: C,
    input: {
      grant: ResumeRecording;
      work: RecordingWork;
      operationKey: string;
    },
  ): Promise<{ jobId: string }>;
  appendAudit(
    tx: C,
    accountId: string,
    plan: SpeakerBindingPlan,
  ): Promise<void>;
  saveOperation(
    tx: C,
    accountId: string,
    operationId: string,
    operation: SpeakerBindingOperation,
  ): Promise<void>;
}
const readInput = z.strictObject({
  batchId: z.string().min(1).max(200).regex(/\S/),
  itemId: z.string().min(1).max(200).regex(/\S/),
});
const version = (s: SpeakerBindingSnapshot): Version => ({
  batchId: s.batchId,
  materialId: s.materialId,
  evaluationNodeId: s.evaluationNodeId,
  membershipRevision: s.membershipRevision,
  recordingId: s.transcript.recordingId,
  originalVersionId: s.transcript.originalVersionId,
  transcriptVersionId: s.transcript.id,
  recordCollectionId: s.context.recordCollectionId,
});
function conflict(message: string): never {
  throw new SpeakerBindingError('conflict', message);
}
const sameIds = (a: string[], b: string[]) =>
  new Set(a).size === a.length &&
  isDeepStrictEqual([...a].sort(), [...b].sort());
const validation = (error: z.ZodError, input: unknown) => ({
  status: 'validation_error' as const,
  fieldErrors: {
    ...z.flattenError(error).fieldErrors,
    _form: z.flattenError(error).formErrors,
  },
  input,
});
function assertBindCandidate(
  s: SpeakerBindingSnapshot,
  a: SpeakerBindingAuthority,
  command: SpeakerBindingCommand,
) {
  const r = command.resolution;
  if (
    r.action === 'bind' &&
    !speakerCandidates(s, a).some((p) => p.personId === r.personId)
  )
    throw new SpeakerBindingError('forbidden', '绑定人员不在当前候选范围');
}
function resultError(
  error: unknown,
  command: SpeakerBindingCommand,
): MaterialReviewCommandResult {
  if (!(error instanceof SpeakerBindingError)) throw error;
  return materialReviewCommandResultSchema.parse(
    error.code === 'conflict'
      ? { status: error.code, message: error.message, input: command }
      : { status: error.code, message: error.message },
  );
}
export function createSpeakerBindingUsecase<C>(
  deps: SpeakerBindingDependencies<C>,
) {
  for (const name of [
    'wallNow',
    'transaction',
    'lockOperation',
    'locate',
    'lockRecording',
    'loadSnapshot',
    'loadAuthority',
    'readOperation',
    'commitChange',
    'invalidateDrafts',
    'commitResume',
    'appendAudit',
    'saveOperation',
  ] as const) {
    if (typeof deps[name] !== 'function')
      throw new Error('Missing speaker binding port: ' + name);
  }
  if (!deps.environment.trim())
    throw new Error('Missing speaker binding environment');
  const clock = createClock(deps.environment, deps.wallNow);
  async function load(
    tx: C,
    accountId: string,
    input: { batchId: string; itemId: string },
    recordingId: string,
    write: boolean,
  ) {
    const stored = await deps.loadSnapshot(tx, input.batchId, input.itemId);
    if (!stored)
      throw new SpeakerBindingError('not_found', '待核对条目不存在或不可见');
    const snapshot = structuredClone(stored);
    if (
      snapshot.batchId !== input.batchId ||
      snapshot.transcript.recordingId !== recordingId ||
      !snapshot.transcript.fragments.some(
        (f) => f.reviewItemId === input.itemId,
      )
    )
      conflict('条目与录音版本不一致');
    const businessNow = clock.now().toISOString();
    const authority = await deps.loadAuthority(
      tx,
      accountId,
      snapshot,
      businessNow,
    );
    if (authority.context.now !== businessNow) conflict('当前权限时间事实无效');
    requireSpeakerAccess(snapshot, authority, accountId, write);
    return { snapshot, authority };
  }
  async function verify(
    tx: C,
    accountId: string,
    command: SpeakerBindingCommand,
    before: SpeakerBindingSnapshot,
    plan: SpeakerBindingPlan,
  ) {
    const { snapshot: after, authority } = await load(
      tx,
      accountId,
      command,
      before.transcript.recordingId,
      true,
    );
    assertBindCandidate(after, authority, command);
    requireBoundCandidates(after.bindings, speakerCandidates(after, authority));
    if (
      !isDeepStrictEqual(version(after), version(before)) ||
      !isDeepStrictEqual(after.transcript, before.transcript) ||
      !isDeepStrictEqual(after.members, before.members) ||
      !isDeepStrictEqual(after.sourceSubjects, before.sourceSubjects) ||
      after.sourceKind !== before.sourceKind ||
      !isDeepStrictEqual(after.requiredKinds, before.requiredKinds) ||
      after.context.jobId !== before.context.jobId ||
      after.context.attempt !== before.context.attempt ||
      after.inventoryComplete !== true ||
      !isDeepStrictEqual(after.otherReviewItemIds, before.otherReviewItemIds) ||
      !isDeepStrictEqual(after.bindings, plan.bindings) ||
      !isDeepStrictEqual(after.itemRevisions, plan.itemRevisions)
    )
      conflict('绑定、材料或处理版本在事务中变化');
    if (
      plan.bindingChanged &&
      (after.derived === null ||
        after.derived.bindingRevision !== plan.bindings.revision ||
        after.derived.draftIds.length !== 0 ||
        after.derived.confirmedResultIds.length !== 0)
    )
      conflict('旧草稿未按当前绑定版本完整失效');
    if (
      plan.resume &&
      (after.context.canProcess !== true ||
        !isDeepStrictEqual(after.context.resumeGrant, plan.resume.grant))
    )
      conflict('当前真实恢复许可尚未提交');
  }
  return {
    async apply(
      accountId: string,
      raw: unknown,
    ): Promise<MaterialReviewCommandResult> {
      const parsed = speakerBindingCommandSchema.safeParse(raw);
      if (!parsed.success)
        return materialReviewCommandResultSchema.parse(
          validation(parsed.error, raw),
        );
      const command = parsed.data;
      try {
        return await deps.transaction(async (tx) => {
          await deps.lockOperation(tx, accountId, command.operationId);
          const location = await deps.locate(
            tx,
            command.batchId,
            command.itemId,
          );
          if (!location)
            throw new SpeakerBindingError(
              'not_found',
              '待核对条目不存在或不可见',
            );
          await deps.lockRecording(tx, location.recordingId);
          const { snapshot, authority } = await load(
            tx,
            accountId,
            command,
            location.recordingId,
            true,
          );
          assertBindCandidate(snapshot, authority, command);
          const fingerprint = speakerBindingFingerprint(command);
          const existing = await deps.readOperation(
            tx,
            accountId,
            command.operationId,
          );
          if (existing) {
            requireBoundCandidates(
              snapshot.bindings,
              speakerCandidates(snapshot, authority),
            );
            if (
              existing.fingerprint !== fingerprint ||
              !isDeepStrictEqual(existing.version, version(snapshot)) ||
              existing.result.kind !== 'speaker' ||
              existing.result.batchId !== command.batchId ||
              existing.result.itemId !== command.itemId
            )
              conflict('同一操作键的输入或材料版本不同');
            const current = await load(
              tx,
              accountId,
              command,
              location.recordingId,
              true,
            );
            assertBindCandidate(current.snapshot, current.authority, command);
            requireBoundCandidates(
              current.snapshot.bindings,
              speakerCandidates(current.snapshot, current.authority),
            );
            if (
              !isDeepStrictEqual(version(snapshot), version(current.snapshot))
            )
              conflict('重放时材料版本已变化');
            return materialReviewCommandResultSchema.parse({
              status: 'success',
              replayed: true,
              result: existing.result,
            });
          }
          const plan = planSpeakerBinding({
            snapshot,
            authority,
            accountId,
            command,
            now: deps.wallNow().toISOString(),
          });
          if (plan.changed) await deps.commitChange(tx, snapshot, plan);
          let invalidatedDraftIds: string[] = [];
          if (plan.bindingChanged) {
            invalidatedDraftIds = await deps.invalidateDrafts(
              tx,
              snapshot,
              plan,
            );
            if (!sameIds(invalidatedDraftIds, plan.invalidatedDraftIds))
              conflict('草稿失效结果不完整');
          }
          let resume: SpeakerBindingReceipt['resume'] = null;
          if (plan.resume) {
            const committed = await deps.commitResume(tx, plan.resume);
            if (committed.jobId !== snapshot.context.jobId)
              conflict('恢复任务不是当前处理任务');
            resume = { stage: 'organizing', jobId: committed.jobId };
          }
          if (plan.changed) await deps.appendAudit(tx, accountId, plan);
          const receipt =
            materialReviewResolutionReceiptSchema.options[0].parse({
              ...plan.receipt,
              invalidatedDraftIds,
              resume,
            });
          await deps.saveOperation(tx, accountId, command.operationId, {
            fingerprint,
            version: version(snapshot),
            result: receipt,
          });
          await verify(tx, accountId, command, snapshot, plan);
          return materialReviewCommandResultSchema.parse({
            status: 'success',
            replayed: false,
            result: receipt,
          });
        });
      } catch (error) {
        return resultError(error, command);
      }
    },
    async read(accountId: string, raw: unknown) {
      const parsed = readInput.safeParse(raw);
      if (!parsed.success) return validation(parsed.error, raw);
      try {
        return await deps.transaction(async (tx) => {
          const location = await deps.locate(
            tx,
            parsed.data.batchId,
            parsed.data.itemId,
          );
          if (!location)
            throw new SpeakerBindingError(
              'not_found',
              '待核对条目不存在或不可见',
            );
          await deps.lockRecording(tx, location.recordingId);
          const { snapshot, authority } = await load(
            tx,
            accountId,
            parsed.data,
            location.recordingId,
            false,
          );
          return {
            status: 'success' as const,
            result: projectSpeakerBindings(snapshot, authority, accountId),
          };
        });
      } catch (error) {
        if (!(error instanceof SpeakerBindingError)) throw error;
        return { status: error.code, message: error.message };
      }
    },
  };
}
