import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Database, Transaction } from '../db/client';
import {
  attachmentParseQueue,
  registerAttachmentParseJob,
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
import { createMaterialPdfDecoder } from '../modules/records/attachments/document-decoders';
import { createValidatedAttachmentInput } from '../modules/records/attachments/upload-input';
import { stagedParseJob } from '../modules/records/material-review/read';
import type { ParseLimits } from '../modules/records/attachments/types';
import { saveAttachmentPdf } from '../modules/records/material-sources/attachment-save';
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
/** Claims a job may take before a lost runner settles it as failed instead of
 * being handed out again: a file that kills its runner never loops forever.
 * Each claim (queued→running, then running→partial) advances the revision. */
const maxClaimRevision = 4;

/** Only PDF page text has a canonical store; other formats are refused as
 * unsupported before any byte is read rather than saved without provenance.
 */
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
    stagedJob: stagedParseJob,
    canProcess: async (tx, binding: AttachmentBinding) => {
      if (binding.target.kind === 'event') return false;
      if (!(await isCurrentMember(tx, binding))) return false;
      const actor = await loadArrangeActor(
        tx,
        binding.accountId,
        input.businessNow(),
      );
      return binding.target.kind === 'people'
        ? canWriteArrange(actor, binding.target.personIds, null)
        : canWriteArrange(actor, [], null, binding.target.evaluationNodeId);
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
      if (binding && binding.version.mediaType !== 'application/pdf')
        throw new UnstoredFormat();
      return binding;
    },
    saveParse: (tx, binding, parsed) =>
      saveAttachmentPdf(tx, binding, parsed, {
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
  ) {
    return store.locked(jobId, async (tx) => {
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
    const { jobId, attempt } = attachmentJobPayloadSchema.parse(payload);
    // The revision this runner holds: the one it claimed, or the one it found
    // when the claim was refused or failed before committing.
    let fence: number | null = null;
    const fenced: JobStore<Transaction> = {
      locked: (id, work) =>
        store.locked(id, async (tx) => {
          const first = fence === null;
          if (first) fence = tx.record?.revision ?? null;
          const result = await work(tx);
          if (
            first &&
            typeof result === 'object' &&
            result !== null &&
            'status' in result &&
            result.status === 'claimed' &&
            'revision' in result
          )
            fence = result.revision as number;
          return result;
        }),
    };
    let outcome: Settlement;
    try {
      const { status } = await runAttachmentParse(
        fenced,
        ports,
        { jobId, attempt },
        {
          now,
          limits: attachmentParseLimits,
          decoders: { pdf: createMaterialPdfDecoder() },
        },
      );
      if (status !== 'forbidden') return status;
      outcome = 'refused';
    } catch (error) {
      outcome = error instanceof UnstoredFormat ? 'unsupported' : 'failed';
    }
    return fence === null ? 'ignored' : settle(jobId, attempt, fence, outcome);
  }

  /** Hands claimed parses that outlived their lease back to the queue, or
   * settles them once they have used up their claims. */
  async function recover() {
    const stale = await input.db
      .select({
        jobId: jobSnapshots.jobId,
        attempt: jobSnapshots.attempt,
        revision: jobSnapshots.revision,
      })
      .from(jobSnapshots)
      .where(
        and(
          eq(jobSnapshots.kind, 'media'),
          inArray(jobSnapshots.status, ['running', 'partial']),
          sql`${jobSnapshots.result}->>'stage' = 'parsing'`,
          lt(
            jobSnapshots.updatedAt,
            new Date(
              input.now().getTime() - attachmentParseLeaseMs,
            ).toISOString(),
          ),
        ),
      );
    for (const job of stale) {
      if (job.revision >= maxClaimRevision)
        await settle(job.jobId, job.attempt, job.revision, 'failed');
      else
        await input.boss.send(attachmentParseQueue, {
          jobId: job.jobId,
          attempt: job.attempt,
        });
    }
    return stale.length;
  }

  return {
    run,
    recover,
    register: () => registerAttachmentParseJob(input.boss, run, recover),
  };
}
