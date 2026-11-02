import type { PgBoss } from 'pg-boss';
import type { Database, Transaction } from '../db/client';
import { registerAttachmentParseJob } from '../jobs/attachment-parse';
import { createJobStore } from '../jobs/repository';
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

/** Only PDF page text has a canonical store; other parsed formats are refused
 * as unsupported rather than saved without their provenance.
 */
class UnstoredFormat extends Error {}

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
    saveParse: async (tx, binding, parsed) => {
      if (binding.version.mediaType !== 'application/pdf')
        throw new UnstoredFormat();
      return saveAttachmentPdf(tx, binding, parsed, {
        sourceCategory: 'original',
        demo: input.demo,
      });
    },
    // Arranging parsed attachments is not connected: the batch reads each
    // file's parse from its own job and keeps its arrangement job queued.
    enqueueArrange: async () => {},
  };

  /** Every claimed attempt ends terminal: the queue never retries, so an error
   * after the claim settles the job here instead of leaving it parsing.
   */
  async function settle(jobId: string, attempt: number, unsupported: boolean) {
    return store.locked(jobId, async (tx) => {
      let job: JobRecord | null = tx.record;
      if (
        !job ||
        job.kind !== 'media' ||
        job.attempt !== attempt ||
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
            errorCode: 'processing_failed',
            result: attachmentJobResultSchema.parse({
              stage: unsupported ? 'unsupported' : 'failed',
              mediaId: job.resourceId,
              source: null,
              fragmentIds: [],
              failureReason: unsupported ? 'format' : 'processing_failed',
            }),
          },
          now(),
        ),
      );
      return unsupported ? 'unsupported' : 'failed';
    });
  }

  async function run(payload: unknown) {
    const { jobId, attempt } = attachmentJobPayloadSchema.parse(payload);
    try {
      return (
        await runAttachmentParse(
          store,
          ports,
          { jobId, attempt },
          {
            now,
            limits: attachmentParseLimits,
            decoders: { pdf: createMaterialPdfDecoder() },
          },
        )
      ).status;
    } catch (error) {
      return settle(jobId, attempt, error instanceof UnstoredFormat);
    }
  }

  return {
    run,
    register: () => registerAttachmentParseJob(input.boss, run),
  };
}
