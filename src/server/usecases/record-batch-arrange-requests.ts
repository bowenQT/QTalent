import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  materialBatchInputSchema,
  materialBatchReadInputSchema,
  type MaterialBatchSubmitResult,
  type MaterialBatchReadResult,
} from '../../contracts/materials';
import { materialReviewItemSchema } from '../../contracts/material-review';
import { recordInputSchema } from '../../contracts/record';
import type { Transaction } from '../db/client';
import { originals, originalVersions, fragments } from '../modules/records';
import {
  arrangeInputs,
  type StoredArrangeInput,
} from '../modules/records/arrange/input-state/schema';
import {
  lockArrangeOperation,
  readArrangeOperation,
  insertArrangeInput,
  insertArrangeOperation,
} from '../modules/records/arrange/input-state/store';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';
import { canReadTalent } from '../authz/talent';
import { newJob, type JobRecord } from '../jobs/state';
import { createJobService } from '../jobs/service';
import { insertJob } from '../jobs/repository';
import { jobSnapshots } from '../jobs/schema';
import { recordAudit } from '../platform/audit';
import {
  loadArrangeActor,
  buildRecordPageContext,
  canWriteArrange,
  textSubjects,
  NativeArrangeUnavailable,
  type RecordPageInput,
} from './record-arrange-context';
import {
  initialBatchMetadata,
  updateBatchJob,
  parseBatchMetadata,
} from './record-batch-arrange-state';
import {
  createNativeBatchStore,
  type NativeBatchDependencies,
} from './record-batch-arrange-store';
import { readBatchArrangeRules } from '../modules/records/arrange/batch-rules';

export class ArrangeInputConflict extends Error {}
export type RecordArrangeRequestDependencies = NativeBatchDependencies;
export interface TrustedArrangeSources {
  origin: 'recording' | 'attachment';
  originalInput: unknown;
  sources: unknown[];
}
export async function readArrangeJobRecord(
  tx: Transaction,
  jobId: string,
  lock = false,
): Promise<JobRecord | null> {
  const query = tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId));
  const [row] = await (lock ? query.for('update') : query);
  return row
    ? {
        ...row,
        result: row.result ?? null,
        updatedAt: new Date(row.updatedAt).toISOString(),
        cancelRequestedAt:
          row.cancelRequestedAt === null
            ? null
            : new Date(row.cancelRequestedAt).toISOString(),
      }
    : null;
}
export function createRecordBatchArrangeRequests(
  deps: NativeBatchDependencies,
) {
  const native = createNativeBatchStore(deps);
  const service = createJobService(native.store, [native.policy], () =>
    deps.now().toISOString(),
  );
  const id = deps.newId ?? randomUUID;
  async function create(
    accountId: string,
    raw: unknown,
  ): Promise<MaterialBatchSubmitResult> {
    const checked = materialBatchInputSchema.safeParse(raw);
    if (!checked.success)
      return {
        status: 'validation_error',
        fieldErrors: { input: ['请提供批次操作号、明确评价节点及原始文本'] },
        input: raw,
      };
    const input = checked.data;
    if (input.files.length)
      return {
        status: 'validation_error',
        fieldErrors: {
          files: [
            '上传与录音来源尚待真实取得/绑定读取；本入口仅处理文本，原材料不作推断',
          ],
        },
        input: raw,
      };
    if (!input.text.trim() || Buffer.byteLength(input.text, 'utf8') > 240000)
      return {
        status: 'validation_error',
        fieldErrors: { text: ['请提供非空且在本次整理预算内的原始文本'] },
        input: raw,
      };
    const fingerprint = arrangeOperationFingerprint({
      ...input,
      personIds: [...input.personIds].sort(),
    });
    return deps.db.transaction(
      async (tx): Promise<MaterialBatchSubmitResult> => {
        await lockArrangeOperation(tx, accountId, 'create', input.operationId);
        const old = await readArrangeOperation(
          tx,
          accountId,
          'create',
          input.operationId,
        );
        if (old) {
          const job = await readArrangeJobRecord(tx, old.jobId, true);
          const [stored] = await tx
            .select()
            .from(arrangeInputs)
            .where(eq(arrangeInputs.id, old.inputId))
            .for('update');
          if (
            !job ||
            !stored ||
            !(await native.authorized(tx, accountId, job, stored))
          )
            return {
              status: 'not_found',
              message: '整理输入不存在或当前不可见',
            };
          if (old.fingerprint !== fingerprint)
            return {
              status: 'conflict',
              message: '同一操作号的原始输入已变化，请保留编辑并换新操作号',
              input,
            };
          const metadata = parseBatchMetadata(job.result);
          if (!metadata)
            throw new NativeArrangeUnavailable(
              'native_operation_metadata_required',
            );
          return {
            status: 'success',
            replayed: true,
            result: await native.receipt(tx, job, stored, metadata),
          };
        }
        const at = deps.businessNow();
        if (!z.iso.datetime().safeParse(at).success)
          throw new NativeArrangeUnavailable('business_clock_required');
        const actor = await loadArrangeActor(tx, accountId, at);
        if (
          !canWriteArrange(
            actor,
            input.personIds,
            input.projectId,
            input.evaluationNodeId,
          )
        )
          return {
            status: 'forbidden',
            message: '当前账号没有此节点的记录权限',
          };
        const subjects = textSubjects(
          actor,
          input.text,
          input.personIds,
          input.evaluationNodeId,
        );
        if (
          subjects.some(
            (subject) =>
              subject.evaluationNodeId == null ||
              !canReadTalent(
                actor.context,
                { ...subject, kind: 'evaluation' },
                'model-input',
              ),
          )
        )
          return {
            status: 'forbidden',
            message: '原始文本涉及当前范围外的资料，请先核对范围',
          };
        // A new intake binds its rule version at the trusted business save clock.
        // Missing rules fail before creating any source/job, not via a demo fallback.
        if (!(await readBatchArrangeRules(tx, at)))
          return {
            status: 'validation_error',
            fieldErrors: {
              rules: ['当前维度与锚点版本不可用，原始文本尚未提交'],
            },
            input,
          };
        const inputId = id(),
          batchId = id(),
          jobId = id(),
          inputVersion = id();
        const originalId = id(),
          originalVersionId = id(),
          fragmentId = id();
        await tx
          .insert(originals)
          .values({ id: originalId, title: '记录原话', kind: 'original' });
        await tx.insert(originalVersions).values({
          id: originalVersionId,
          originalId,
          version: 1,
          contentDigest: createHash('sha256').update(input.text).digest('hex'),
        });
        await tx.insert(fragments).values({
          id: fragmentId,
          originalVersionId,
          excerpt: input.text,
          location: { kind: 'document', paragraph: 'input' },
        });
        const pending = input.personIds.length
          ? []
          : [
              materialReviewItemSchema.parse({
                itemId: id(),
                batchId,
                evaluationNodeId: input.evaluationNodeId,
                materialId: fragmentId,
                originalVersionId,
                revision: 1,
                state: 'pending',
                source: null,
                kind: 'unknown_person',
                observedName: null,
                candidates: [],
              }),
            ];
        const metadata = initialBatchMetadata(
          actor.context.account.personId,
          input.operationId,
          pending,
        );
        let job: JobRecord = {
          ...newJob(
            {
              jobId,
              kind: 'record_organize',
              resourceId: inputId,
              inputVersion,
            },
            deps.now().toISOString(),
          ),
          result: metadata,
        };
        if (pending.length)
          job = updateBatchJob(
            job,
            'needs_review',
            metadata,
            deps.now().toISOString(),
          );
        const stored: StoredArrangeInput = {
          id: inputId,
          creatorAccountId: accountId,
          jobId,
          inputVersion,
          batchId,
          evaluationNodeId: input.evaluationNodeId,
          boundAt: new Date(at),
          occurredOn: at.slice(0, 10),
          origin: 'text',
          // Public RecordInput follows final897 canonical text. The authoritative
          // source fragment and its digest above retain the original exact bytes.
          originalInput: recordInputSchema.parse({
            operation_id: input.operationId,
            text: input.text,
            attachmentIds: [],
            personId: input.personIds.length === 1 ? input.personIds[0] : null,
            projectId: input.projectId,
          }),
          sourceContexts: [
            {
              fragmentId,
              originalVersionId,
              subjects,
              attributedPersonIds: [...input.personIds],
              kind: 'evaluation',
              requiredKinds: [],
            },
          ],
          inputSource: { fragmentId, originalVersionId },
          personIds: [...input.personIds].sort(),
          projectMode: input.projectId === null ? 'none' : 'resolved',
          projectId: input.projectId,
          projectCandidateIds: [],
          supersededByInputId: null,
          createdAt: deps.now(),
        };
        await insertJob(tx, job);
        await insertArrangeInput(tx, stored);
        await insertArrangeOperation(tx, {
          actorAccountId: accountId,
          action: 'create',
          operationId: input.operationId,
          fingerprint,
          inputId,
          jobId,
        });
        if (!(await native.authorized(tx, accountId, job, stored)))
          throw new NativeArrangeUnavailable('input_authority_changed');
        if (!pending.length) await deps.enqueue(tx, job);
        await recordAudit(tx, {
          actorId: accountId,
          action: 'record.batch.create',
          resourceId: batchId,
        });
        return {
          status: 'success',
          replayed: false,
          result: await native.receipt(tx, job, stored, metadata),
        };
      },
      { isolationLevel: 'read committed' },
    );
  }
  return {
    native,
    policy: native.policy,
    create,
    // Existing callers cannot turn old node-less planned draft IDs into batches.
    async select(_accountId: string, raw: unknown) {
      return {
        status: 'validation_error' as const,
        fieldErrors: {
          selection: [
            '旧草稿选人入口已迁移；请使用批次当前核对项及其版本处理，不能重建或猜测评价节点',
          ],
        },
        input: raw,
      };
    },
    async createFromSources(_accountId: string, value: TrustedArrangeSources) {
      return {
        status: 'validation_error' as const,
        fieldErrors: {
          sources: [
            '媒体来源需要真实取得、人员绑定与当前节点事实后才能接通；本入口不会把旧来源映射成文本',
          ],
        },
        input: value.originalInput,
      };
    },
    read: (accountId: string, jobId: string) => service.read(accountId, jobId),
    command: (
      accountId: string,
      command: Parameters<typeof service.command>[1],
    ) => service.command(accountId, command),
    async readBatch(
      accountId: string,
      raw: unknown,
    ): Promise<MaterialBatchReadResult> {
      const checked = materialBatchReadInputSchema.safeParse(raw);
      if (!checked.success)
        return {
          status: 'validation_error',
          fieldErrors: { batchId: ['请提供有效批次'] },
          input: raw,
        };
      const rows = await deps.db
        .select()
        .from(arrangeInputs)
        .where(
          and(
            eq(arrangeInputs.batchId, checked.data.batchId),
            eq(arrangeInputs.creatorAccountId, accountId),
            isNull(arrangeInputs.supersededByInputId),
          ),
        );
      if (rows.length !== 1)
        return { status: 'not_found', message: '批次不存在或当前不可见' };
      return native.store.locked(rows[0]!.jobId, async (locked) => {
        const job = locked.record;
        if (!job || !(await native.authorized(locked.context, accountId, job)))
          return { status: 'not_found', message: '批次不存在或当前不可见' };
        const input = await native.inputForJob(locked.context, job);
        const metadata = parseBatchMetadata(job.result);
        if (!input || !metadata)
          return { status: 'not_found', message: '批次原生事实不可用' };
        return {
          status: 'success',
          replayed: false,
          result: await native.receipt(locked.context, job, input, metadata),
        };
      });
    },
    async page(accountId: string, input: RecordPageInput) {
      return deps.db.transaction(async (tx) => {
        const actor = await loadArrangeActor(tx, accountId, deps.businessNow());
        const context = buildRecordPageContext(actor, input);
        return context
          ? { status: 'success' as const, context }
          : {
              status:
                input.personId || input.projectId || input.evaluationNodeId
                  ? ('not_found' as const)
                  : ('forbidden' as const),
            };
      });
    },
  };
}
