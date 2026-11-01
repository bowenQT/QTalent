import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  recordInputSchema,
  recordSelectionInputSchema,
  recordStartResultSchema,
  recordSelectionResultSchema,
  recordJobSchema,
  type RecordInput,
} from '../../contracts/record';
import type { Database, Transaction } from '../db/client';
import { originals, originalVersions, fragments } from '../modules/records';
import {
  type StoredArrangeInput,
  type ArrangeSourceContext,
} from '../modules/records/arrange/input-state/schema';
import {
  lockArrangeOperation,
  readArrangeInput,
  lockArrangeInput,
  readArrangeOperation,
  insertArrangeInput,
  supersedeArrangeInput,
  insertArrangeOperation,
} from '../modules/records/arrange/input-state/store';
import {
  bindSelectedInput,
  arrangeOperationFingerprint,
} from '../modules/records/arrange/input-state/bind';
import {
  loadArrangeActor,
  canWriteArrange,
  writableSubject,
  textSubjects,
  loadRecordArrangeSnapshot,
  buildRecordPageContext,
  type RecordPageInput,
} from './record-arrange-context';
import {
  prepareArrange,
  arrangeJobResultSchema,
} from '../modules/records/arrange';
import { canReadProject } from '../authz';
import { ForbiddenError } from './project-context';
import { createJobService, type JobStore } from '../jobs/service';
import { createJobStore, insertJob } from '../jobs/repository';
import { jobSnapshots } from '../jobs/schema';
import {
  newJob,
  applyJobCommand,
  advanceJob,
  type JobRecord,
} from '../jobs/state';
import { createRecordArrangePolicy } from '../jobs/record-arrange';
import { recordAudit } from '../platform/audit';

export class ArrangeInputConflict extends Error {}
class ArrangeInputMissing extends Error {}
export interface RecordArrangeRequestDependencies {
  db: Database;
  environment: string;
  businessDate(): string;
  now(): Date;
  enqueue(tx: Transaction, job: JobRecord): Promise<void>;
}
export interface TrustedArrangeSources {
  origin: 'recording' | 'attachment';
  originalInput: RecordInput;
  sources: ArrangeSourceContext[];
}
function parseInput(raw: unknown) {
  const parsed = recordInputSchema.safeParse(raw);
  if (
    parsed.success &&
    typeof raw === 'object' &&
    raw !== null &&
    'text' in raw &&
    typeof raw.text === 'string'
  )
    parsed.data.text = raw.text;
  return parsed;
}
export async function readArrangeJobRecord(
  tx: Transaction,
  id: string,
  lock = false,
): Promise<JobRecord | null> {
  const query = tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, id));
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
export function createRecordArrangeRequests(
  deps: RecordArrangeRequestDependencies,
) {
  const load = (tx: Transaction, resourceId: string, accountId?: string) =>
    loadRecordArrangeSnapshot(
      tx,
      resourceId,
      accountId,
      deps.businessDate(),
      deps.environment,
    );
  async function canAct(
    tx: Transaction,
    accountId: string,
    job: JobRecord,
    action: 'read' | 'retry' | 'resume' | 'cancel' | 'run',
  ) {
    const input = await readArrangeInput(tx, job.resourceId);
    if (
      !input ||
      input.jobId !== job.jobId ||
      input.creatorAccountId !== accountId ||
      (input.supersededByInputId !== null && action !== 'read')
    )
      return false;
    const actor = await loadArrangeActor(tx, accountId, deps.businessDate());
    return canWriteArrange(actor, input.personIds, input.projectId);
  }
  const policy = createRecordArrangePolicy<Transaction>({
    authorize: canAct,
    load,
    currentInputVersion: async (tx, resourceId) =>
      (await readArrangeInput(tx, resourceId))?.inputVersion ?? null,
    enqueue: (tx, job) => deps.enqueue(tx, job),
  });
  async function present(tx: Transaction, accountId: string, jobId: string) {
    // Reuse842's strict presentation inside the creating transaction. No nested
    // database connection can see an uncommitted input/job pair.
    const view: JobStore<Transaction> = {
      locked: async (id, run) =>
        run({
          context: tx,
          record: await readArrangeJobRecord(tx, id),
          save: async () => {
            throw new Error('Read-only job view');
          },
          operation: async () => null,
          saveOperation: async () => {
            throw new Error('Read-only job view');
          },
        }),
    };
    const result = await createJobService(view, [policy], () =>
      deps.now().toISOString(),
    ).read(accountId, jobId);
    if (result.status !== 'success') throw new ForbiddenError();
    return recordJobSchema.parse(result.snapshot);
  }
  async function verifyInput(
    tx: Transaction,
    accountId: string,
    id: string,
    allowCancelledReceipt = false,
  ) {
    if (allowCancelledReceipt) {
      const input = await readArrangeInput(tx, id);
      const job = input && (await readArrangeJobRecord(tx, input.jobId));
      if (input?.supersededByInputId !== null && job?.status === 'cancelled') {
        if (!(await canAct(tx, accountId, job, 'read')))
          throw new ForbiddenError();
        return;
      }
    }
    const snapshot = await load(tx, id, accountId);
    if (!snapshot) throw new ForbiddenError();
    if ((await prepareArrange(snapshot)).status === 'not_found')
      throw new ForbiddenError();
  }
  function mappedError<I>(error: unknown, input: I) {
    if (error instanceof ForbiddenError)
      return {
        status: 'forbidden' as const,
        message: '当前账号没有整理此输入的权限',
      };
    if (error instanceof ArrangeInputMissing)
      return {
        status: 'not_found' as const,
        message: '整理输入不存在或不可见',
      };
    if (error instanceof ArrangeInputConflict)
      return {
        status: 'conflict' as const,
        message: '输入或选择已变化，请保留输入并重新确认',
        input,
      };
    throw error;
  }
  async function create(
    accountId: string,
    raw: unknown,
    trusted?: TrustedArrangeSources,
  ): Promise<z.infer<typeof recordStartResultSchema>> {
    const checked = parseInput(raw);
    if (!checked.success)
      return {
        status: 'validation_error',
        fieldErrors: { input: ['请提供有效原始输入'] },
        input: raw,
      };
    const input = checked.data;
    if (!trusted && input.attachmentIds.length)
      return {
        status: 'validation_error',
        fieldErrors: {
          attachmentIds: ['请等待附件解析后，从已授权来源继续整理'],
        },
        input: raw,
      };
    const fingerprint = arrangeOperationFingerprint({
      input,
      origin: trusted?.origin ?? 'text',
      sources: trusted?.sources ?? null,
    });
    try {
      return await deps.db.transaction(async (tx) => {
        await lockArrangeOperation(tx, accountId, 'create', input.operation_id);
        const actor = await loadArrangeActor(
          tx,
          accountId,
          deps.businessDate(),
        );
        const personIds = input.personId === null ? [] : [input.personId];
        if (!canWriteArrange(actor, personIds, input.projectId))
          throw new ForbiddenError();
        const old = await readArrangeOperation(
          tx,
          accountId,
          'create',
          input.operation_id,
        );
        if (old) {
          await verifyInput(tx, accountId, old.inputId, true);
          if (old.fingerprint !== fingerprint) throw new ArrangeInputConflict();
          return {
            status: 'success' as const,
            replayed: true,
            result: await present(tx, accountId, old.jobId),
          };
        }
        const id = randomUUID(),
          jobId = randomUUID(),
          inputVersion = randomUUID();
        const origin = trusted?.origin ?? 'text';
        let sourceContexts: ArrangeSourceContext[];
        let inputSource: StoredArrangeInput['inputSource'] = null;
        if (trusted) {
          if (
            !trusted.sources.length ||
            trusted.sources.some((s) =>
              s.attributedPersonIds.some(
                (p) => !s.subjects.some((subject) => subject.personId === p),
              ),
            )
          )
            throw new ArrangeInputConflict();
          sourceContexts = structuredClone(trusted.sources);
        } else {
          const originalId = randomUUID(),
            originalVersionId = randomUUID(),
            fragmentId = randomUUID();
          await tx
            .insert(originals)
            .values({ id: originalId, title: '记录原话', kind: 'original' });
          await tx.insert(originalVersions).values({
            id: originalVersionId,
            originalId,
            version: 1,
            contentDigest: createHash('sha256')
              .update(input.text)
              .digest('hex'),
          });
          await tx.insert(fragments).values({
            id: fragmentId,
            originalVersionId,
            excerpt: input.text,
            location: { kind: 'document', paragraph: 'input' },
          });
          inputSource = { fragmentId, originalVersionId };
          sourceContexts = [
            {
              ...inputSource,
              subjects: textSubjects(actor, input.text, personIds),
              attributedPersonIds: personIds,
              kind: 'evaluation',
              requiredKinds: [],
            },
          ];
        }
        const mentions =
          input.projectId === null
            ? actor.staffing.projects
                .filter(
                  (p) =>
                    p.name.trim() &&
                    input.text.includes(p.name) &&
                    canReadProject(actor.context, p),
                )
                .map((p) => p.id)
            : [];
        const stored: StoredArrangeInput = {
          id,
          creatorAccountId: accountId,
          jobId,
          inputVersion,
          // This legacy entry has no trusted batch/node/business-date producer.
          batchId: null,
          evaluationNodeId: null,
          boundAt: null,
          occurredOn: null,
          origin,
          originalInput: input,
          sourceContexts,
          inputSource,
          personIds,
          projectMode:
            input.projectId !== null
              ? 'resolved'
              : mentions.length
                ? 'needs_selection'
                : 'none',
          projectId: input.projectId,
          projectCandidateIds: mentions,
          supersededByInputId: null,
          createdAt: deps.now(),
        };
        const job = newJob(
          { jobId, kind: 'record_organize', resourceId: id, inputVersion },
          deps.now().toISOString(),
        );
        await insertJob(tx, job);
        await insertArrangeInput(tx, stored);
        await verifyInput(tx, accountId, id);
        await deps.enqueue(tx, job);
        await insertArrangeOperation(tx, {
          actorAccountId: accountId,
          action: 'create',
          operationId: input.operation_id,
          fingerprint,
          inputId: id,
          jobId,
        });
        await recordAudit(tx, {
          actorId: accountId,
          action: 'record.arrange.create',
          resourceId: id,
        });
        return {
          status: 'success' as const,
          replayed: false,
          result: await present(tx, accountId, jobId),
        };
      });
    } catch (error) {
      return mappedError(error, input);
    }
  }
  return {
    policy,
    load,
    async page(accountId: string, input: RecordPageInput) {
      return deps.db.transaction(async (tx) => {
        const actor = await loadArrangeActor(
          tx,
          accountId,
          deps.businessDate(),
        );
        const context = buildRecordPageContext(actor, input);
        if (!context)
          return {
            status:
              input.personId || input.projectId
                ? ('not_found' as const)
                : ('forbidden' as const),
          };
        await recordAudit(tx, {
          actorId: accountId,
          action: 'record.arrange.context',
          resourceId: 'record',
        });
        return { status: 'success' as const, context };
      });
    },
    async canRun(tx: Transaction, job: JobRecord) {
      const input = await readArrangeInput(tx, job.resourceId);
      return (
        input !== null && (await canAct(tx, input.creatorAccountId, job, 'run'))
      );
    },
    create: (accountId: string, raw: unknown) => create(accountId, raw),
    /** Called only by an authorized recording/attachment producer, never a public JSON route. */
    createFromSources: (accountId: string, sources: TrustedArrangeSources) =>
      create(accountId, sources.originalInput, sources),
    async select(
      accountId: string,
      raw: unknown,
    ): Promise<z.infer<typeof recordSelectionResultSchema>> {
      const checked = recordSelectionInputSchema.safeParse(raw);
      if (!checked.success)
        return {
          status: 'validation_error',
          fieldErrors: { selection: ['请选择有效人员并保留输入版本'] },
          input: raw,
        };
      const input = checked.data;
      const fingerprint = arrangeOperationFingerprint({
        ...input,
        personIds: [...input.personIds].sort(),
      });
      try {
        return await deps.db.transaction(async (tx) => {
          await lockArrangeOperation(
            tx,
            accountId,
            'select',
            input.operation_id,
          );
          const previous = await lockArrangeInput(tx, input.draftId);
          if (!previous || previous.creatorAccountId !== accountId)
            throw new ArrangeInputMissing();
          const actor = await loadArrangeActor(
            tx,
            accountId,
            deps.businessDate(),
          );
          if (
            !canWriteArrange(actor, previous.personIds, previous.projectId) ||
            !canWriteArrange(actor, input.personIds, input.projectId)
          )
            throw new ForbiddenError();
          const old = await readArrangeOperation(
            tx,
            accountId,
            'select',
            input.operation_id,
          );
          if (old) {
            await verifyInput(tx, accountId, old.inputId, true);
            if (old.fingerprint !== fingerprint)
              throw new ArrangeInputConflict();
            return {
              status: 'success' as const,
              replayed: true,
              result: await present(tx, accountId, old.jobId),
            };
          }
          const previousJob = await readArrangeJobRecord(
            tx,
            previous.jobId,
            true,
          );
          const previousResult = arrangeJobResultSchema.safeParse(
            previousJob?.result,
          );
          if (
            !previousJob ||
            previousJob.status !== 'awaiting_manual' ||
            previousJob.cancelRequestedAt !== null ||
            !previousResult.success ||
            previousResult.data.state !== 'selection_required' ||
            previous.inputVersion !== input.expected_input_version ||
            previous.supersededByInputId !== null
          )
            throw new ArrangeInputConflict();
          const next = bindSelectedInput(
            previous,
            input,
            input.personIds.map((id) => writableSubject(actor, id)!),
            {
              id: randomUUID(),
              jobId: randomUUID(),
              inputVersion: randomUUID(),
              createdAt: deps.now(),
            },
          );
          const job = newJob(
            {
              jobId: next.jobId,
              kind: 'record_organize',
              resourceId: next.id,
              inputVersion: next.inputVersion,
            },
            deps.now().toISOString(),
          );
          await insertJob(tx, job);
          await insertArrangeInput(tx, next);
          await verifyInput(tx, accountId, next.id);
          const cancelled = applyJobCommand(
            previousJob,
            { action: 'cancel', expectedRevision: previousJob.revision },
            deps.now().toISOString(),
          );
          const stopped = advanceJob(
            cancelled,
            {
              status: 'cancelled',
              attempt: cancelled.attempt,
              expectedRevision: cancelled.revision,
            },
            deps.now().toISOString(),
          );
          await tx
            .update(jobSnapshots)
            .set(stopped)
            .where(eq(jobSnapshots.jobId, previousJob.jobId));
          await supersedeArrangeInput(tx, previous.id, next.id);
          await deps.enqueue(tx, job);
          await insertArrangeOperation(tx, {
            actorAccountId: accountId,
            action: 'select',
            operationId: input.operation_id,
            fingerprint,
            inputId: next.id,
            jobId: next.jobId,
          });
          await recordAudit(tx, {
            actorId: accountId,
            action: 'record.arrange.select',
            resourceId: next.id,
          });
          return {
            status: 'success' as const,
            replayed: false,
            result: await present(tx, accountId, next.jobId),
          };
        });
      } catch (error) {
        return mappedError(error, input);
      }
    },
    async read(accountId: string, jobId: string) {
      const response = await createJobService(
        createJobStore(deps.db),
        [policy],
        () => deps.now().toISOString(),
      ).read(accountId, jobId);
      if (response.status === 'success')
        await recordAudit(deps.db, {
          actorId: accountId,
          action: 'record.arrange.read',
          resourceId: jobId,
        });
      return response;
    },
  };
}
