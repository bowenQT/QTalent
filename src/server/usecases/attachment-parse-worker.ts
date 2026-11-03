import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Database, Transaction } from '../db/client';
import {
  attachmentParseMessageId,
  attachmentParseQueue,
  registerAttachmentParseJob,
  sendAttachmentParse,
} from '../jobs/attachment-parse';
import { createJobStore } from '../jobs/repository';
import { jobSnapshots } from '../jobs/schema';
import type { JobStore } from '../jobs/service';
import { advanceJob, type JobRecord } from '../jobs/state';
import {
  attachmentJobPayloadSchema,
  attachmentJobResultSchema,
  type AttachmentBinding,
  type AttachmentParsePorts,
} from '../modules/records/attachments/flow';
import {
  createDocumentDecoders,
  createMaterialPdfDecoder,
} from '../modules/records/attachments/document-decoders';
import { createValidatedAttachmentInput } from '../modules/records/attachments/upload-input';
import type { ParseLimits } from '../modules/records/attachments/types';
import { saveAttachmentPdf } from '../modules/records/material-sources/attachment-save';
import { saveAttachmentDocument } from '../modules/records/material-sources/attachment-document-save';
import { readValidatedUploadInTransaction } from '../modules/records/uploads/handoff-transaction';
import { readUploadCollectionMembers } from '../modules/records/uploads/store';
import type { UploadStorage } from '../modules/records/uploads/types';
import { runAttachmentParse } from './attachment-parse';
import { canWriteArrange, loadArrangeActor } from './record-arrange-context';
import { lockIntakeTable } from './talent-source-projection';

/** Parse budget the trusted runner grants each attachment. */
export const attachmentParseLimits: ParseLimits = {
  maxBytes: 64 * 1024 * 1024,
  maxFragments: 5000,
  maxFragmentChars: 100_000,
};

/** A claimed parse untouched this long has lost its runner: well past the
 * 60 s PDF decode budget plus reading the 64 MiB input. */
export const attachmentParseLeaseMs = 5 * 60 * 1000;
/** A queued job untouched this long is treated as having lost its message;
 * the worker polls the queue every 2 s, so a deliverable message is normally
 * claimed well before then. A job whose current message is still waiting is
 * never resent. */
export const attachmentParseQueuedMs = 10 * 60 * 1000;
/** Revision at which recovery settles a job as failed instead of handing it
 * out again, so neither a lost message nor a file that kills its runner loops
 * forever. Every claim and every resend advances the revision: a new job is 1,
 * so a queued job is resent at most three times, a claimed one once. */
const maxRecoveryRevision = 4;
const pendingMessage = new Set(['created', 'retry', 'active']);

/** Formats without a native source store are refused before reading bytes. */
class UnstoredFormat extends Error {}

type Settlement = 'unsupported' | 'refused' | 'failed';

/** Intake reader lock first, then the job row, then the upload collection lock
 * taken by the upload reader: the order batch intake uses, so a parse never
 * holds a job row while waiting on intake.
 */
export function attachmentJobStore(db: Database): JobStore<Transaction> {
  return {
    locked: (jobId, run) =>
      db.transaction(async (outer) => {
        await lockIntakeTable(outer, 'locked');
        return createJobStore(outer).locked(jobId, run);
      }),
  };
}

/** The upload is still a live member of its collection: released or
 * re-attributed uploads remain historical facts but are no longer processed. */
async function isCurrentMember(tx: Transaction, binding: AttachmentBinding) {
  const current = await readUploadCollectionMembers(
    tx,
    binding.recordCollectionId,
  );
  const member = current?.members.find(
    ({ intent }) => intent.id === binding.version.mediaId,
  );
  return (
    !!member &&
    member.intent.releasedAt === null &&
    member.intent.accountId === binding.accountId &&
    member.intent.completed?.originalVersionId ===
      binding.version.originalVersionId
  );
}

export function createAttachmentParseWorker(input: {
  db: Database;
  boss: PgBoss;
  storage: Pick<UploadStorage, 'openObject'>;
  /** Fragments saved outside production carry the demo mark. */
  demo: boolean;
  businessNow(): string;
  now(): Date;
}) {
  const store = attachmentJobStore(input.db);
  const now = () => input.now().toISOString();
  const attachment = createValidatedAttachmentInput<Transaction>({
    readValidatedUploadInContext: readValidatedUploadInTransaction,
    readValidatedUpload: (reference) =>
      input.db.transaction((tx) =>
        readValidatedUploadInTransaction(tx, reference),
      ),
    canProcess: async (tx, binding: AttachmentBinding) => {
      if (binding.target.kind !== 'people') return false;
      if (!(await isCurrentMember(tx, binding))) return false;
      const actor = await loadArrangeActor(
        tx,
        binding.accountId,
        input.businessNow(),
      );
      return canWriteArrange(actor, binding.target.personIds, null);
    },
    openObject: async (objectKey, signal) => {
      const object = await input.storage.openObject({ objectKey, signal });
      return (async function* () {
        const reader = object.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            yield next.value;
          }
        } finally {
          reader.releaseLock();
          object.close();
        }
      })();
    },
  });
  const ports: AttachmentParsePorts<Transaction> = {
    ...attachment,
    loadAuthorizedAttachment: async (tx, job) => {
      const binding = await attachment.loadAuthorizedAttachment(tx, job);
      if (
        binding &&
        ![
          'application/pdf',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ].includes(binding.version.mediaType)
      )
        throw new UnstoredFormat();
      return binding;
    },
    saveParse: (tx, binding, parsed) =>
      (binding.version.mediaType === 'application/pdf'
        ? saveAttachmentPdf
        : saveAttachmentDocument)(tx, binding, parsed, {
        sourceCategory: 'original',
        demo: input.demo,
      }),
    // Arranging parsed attachments is not connected: the batch reads each
    // file's parse from its own job and keeps its arrangement job queued.
    enqueueArrange: async () => {},
  };

  /** Ends a job this runner saw at revision `fence` and could not finish. A
   * job another runner has since claimed has another revision and is left to
   * it; stale attempts and settled jobs are ignored.
   */
  async function settle(
    jobId: string,
    attempt: number,
    fence: number,
    outcome: Settlement,
    jobs: JobStore<Transaction> = store,
  ) {
    return jobs.locked(jobId, async (tx) => {
      let job: JobRecord | null = tx.record;
      if (
        !job ||
        job.kind !== 'media' ||
        job.attempt !== attempt ||
        job.revision !== fence ||
        !['queued', 'running', 'partial'].includes(job.status)
      )
        return 'ignored';
      if (job.cancelRequestedAt !== null) {
        await tx.save(
          advanceJob(
            job,
            { attempt, expectedRevision: job.revision, status: 'cancelled' },
            now(),
          ),
        );
        return 'cancelled';
      }
      if (job.status === 'queued')
        job = advanceJob(
          job,
          { attempt, expectedRevision: job.revision, status: 'running' },
          now(),
        );
      await tx.save(
        advanceJob(
          job,
          {
            attempt,
            expectedRevision: job.revision,
            status: 'failed',
            // A refused claim reads like an input that changed under the
            // job, never as why the account may not process it.
            errorCode:
              outcome === 'refused' ? 'input_changed' : 'processing_failed',
            result: attachmentJobResultSchema.parse({
              stage: outcome === 'unsupported' ? 'unsupported' : 'failed',
              mediaId: job.resourceId,
              source: null,
              fragmentIds: [],
              failureReason:
                outcome === 'unsupported' ? 'format' : 'processing_failed',
            }),
          },
          now(),
        ),
      );
      return outcome;
    });
  }

  async function run(payload: unknown) {
    const { jobId, attempt, revision } =
      attachmentJobPayloadSchema.parse(payload);
    // The revision this runner holds once its claim transaction has ended: the
    // one it committed, or the one it found when the claim was refused or
    // rolled back. A claim that never reached the job leaves it to recovery.
    let fence: number | null = null;
    let claiming = true;
    const fenced: JobStore<Transaction> = {
      locked: async (id, work) => {
        if (!claiming) return store.locked(id, work);
        claiming = false;
        let observed: number | null = null;
        let claimed: number | null = null;
        try {
          const result = await store.locked(id, async (tx) => {
            observed = tx.record?.revision ?? null;
            const outcome = await work(tx);
            if (
              typeof outcome === 'object' &&
              outcome !== null &&
              'status' in outcome &&
              outcome.status === 'claimed' &&
              'revision' in outcome
            )
              claimed = outcome.revision as number;
            return outcome;
          });
          fence = claimed ?? observed;
          return result;
        } catch (error) {
          fence = observed;
          throw error;
        }
      },
    };
    let outcome: Settlement;
    try {
      const { status } = await runAttachmentParse(
        fenced,
        ports,
        { jobId, attempt, revision },
        {
          now,
          limits: attachmentParseLimits,
          decoders: {
            ...createDocumentDecoders(),
            pdf: createMaterialPdfDecoder(),
          },
        },
      );
      if (status !== 'forbidden') return status;
      outcome = 'refused';
    } catch (error) {
      outcome = error instanceof UnstoredFormat ? 'unsupported' : 'failed';
    }
    return fence === null ? 'ignored' : settle(jobId, attempt, fence, outcome);
  }

  /** Resends every media job whose state has outlived its window: queued
   * with no waiting message, or claimed by a runner that stopped touching it.
   * Each resend advances the revision in the transaction that sends it, so the
   * older message is ignored; jobs at the revision bound are settled as
   * failed. Concurrent scans skip each other's rows. */
  async function recover() {
    const at = input.now().getTime();
    const before = (ms: number) => new Date(at - ms).toISOString();
    return input.db.transaction(async (tx) => {
      await lockIntakeTable(tx, 'locked');
      const stale = await tx
        .select({
          jobId: jobSnapshots.jobId,
          status: jobSnapshots.status,
          attempt: jobSnapshots.attempt,
          revision: jobSnapshots.revision,
        })
        .from(jobSnapshots)
        .where(
          and(
            eq(jobSnapshots.kind, 'media'),
            or(
              and(
                eq(jobSnapshots.status, 'queued'),
                lt(jobSnapshots.updatedAt, before(attachmentParseQueuedMs)),
              ),
              and(
                inArray(jobSnapshots.status, ['running', 'partial']),
                sql`${jobSnapshots.result}->>'stage' = 'parsing'`,
                lt(jobSnapshots.updatedAt, before(attachmentParseLeaseMs)),
              ),
            ),
          ),
        )
        .for('update', { skipLocked: true });
      let recovered = 0;
      for (const job of stale) {
        if (job.status === 'queued') {
          const message = await input.boss.getJobById(
            attachmentParseQueue,
            attachmentParseMessageId(job.jobId, job.revision),
          );
          if (message && pendingMessage.has(message.state)) continue;
        }
        recovered += 1;
        if (job.revision >= maxRecoveryRevision) {
          await settle(
            job.jobId,
            job.attempt,
            job.revision,
            'failed',
            createJobStore(tx),
          );
          continue;
        }
        const revision = job.revision + 1;
        await tx
          .update(jobSnapshots)
          .set({ revision, updatedAt: new Date(at).toISOString() })
          .where(eq(jobSnapshots.jobId, job.jobId));
        await sendAttachmentParse(
          input.boss,
          { jobId: job.jobId, attempt: job.attempt, revision },
          { db: fromDrizzle(tx, sql) },
        );
      }
      return recovered;
    });
  }

  return {
    run,
    recover,
    register: () => registerAttachmentParseJob(input.boss, run, recover),
  };
}
