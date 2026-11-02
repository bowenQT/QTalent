import type { JobStore } from '../jobs/service';
import { advanceJob, type JobRecord } from '../jobs/state';
import {
  attachmentBindingSchema,
  attachmentJobPayloadSchema,
  attachmentJobResultSchema,
  type AttachmentBinding,
  type AttachmentParsePorts,
} from '../modules/records/attachments/flow';
import {
  parseAttachment,
  type ParseAttachmentInput,
} from '../modules/records/attachments';

export type AttachmentRunOutcome = {
  status:
    'parsed' | 'unsupported' | 'failed' | 'cancelled' | 'ignored' | 'forbidden';
};
export interface AttachmentRunOptions {
  limits: ParseAttachmentInput['limits'];
  decoders?: ParseAttachmentInput['decoders'];
  signal?: AbortSignal;
  now: () => string;
}
function matchingBinding(job: JobRecord, binding: AttachmentBinding) {
  return (
    binding.completedJobId === job.jobId &&
    binding.version.mediaId === job.resourceId &&
    binding.version.originalVersionId === job.inputVersion
  );
}
type Claim =
  | { status: 'claimed'; revision: number; binding: AttachmentBinding }
  | AttachmentRunOutcome;
export async function runAttachmentParse<C>(
  store: JobStore<C>,
  ports: AttachmentParsePorts<C>,
  payload: unknown,
  options: AttachmentRunOptions,
): Promise<AttachmentRunOutcome> {
  const input = attachmentJobPayloadSchema.parse(payload);
  const claim: Claim = await store.locked(input.jobId, async (tx) => {
    const job = tx.record;
    if (
      !job ||
      job.jobId !== input.jobId ||
      job.kind !== 'media' ||
      job.attempt !== input.attempt ||
      !['queued', 'running', 'partial'].includes(job.status)
    )
      return { status: 'ignored' };
    const loaded = await ports.loadAuthorizedAttachment(tx.context, job);
    if (loaded === null) return { status: 'forbidden' };
    const checked = attachmentBindingSchema.safeParse(loaded);
    if (!checked.success || !matchingBinding(job, checked.data))
      return { status: 'ignored' };
    if (job.status !== 'queued') {
      const result = attachmentJobResultSchema.safeParse(job.result);
      if (
        !result.success ||
        result.data.stage !== 'parsing' ||
        result.data.mediaId !== job.resourceId
      )
        return { status: 'ignored' };
    }
    if (job.cancelRequestedAt !== null) {
      await tx.save(
        advanceJob(
          job,
          {
            attempt: input.attempt,
            expectedRevision: job.revision,
            status: 'cancelled',
          },
          options.now(),
        ),
      );
      return { status: 'cancelled' };
    }
    const next = advanceJob(
      job,
      {
        attempt: input.attempt,
        expectedRevision: job.revision,
        status: job.status === 'queued' ? 'running' : 'partial',
        result: {
          stage: 'parsing',
          mediaId: job.resourceId,
          source: null,
          fragmentIds: [],
        },
      },
      options.now(),
    );
    await tx.save(next);
    return {
      status: 'claimed',
      revision: next.revision,
      binding: checked.data,
    };
  });
  if (claim.status !== 'claimed') return claim;
  const parsed = await parseAttachment({
    version: claim.binding.version,
    // Opening is lazy, so unsupported formats/missing adapters never read bytes.
    content: (async function* () {
      yield* await ports.open(claim.binding, options.signal);
    })(),
    limits: options.limits,
    decoders: options.decoders,
    signal: options.signal,
  });
  return store.locked(input.jobId, async (tx) => {
    const current = tx.record;
    if (
      !current ||
      current.jobId !== input.jobId ||
      current.kind !== 'media' ||
      current.attempt !== input.attempt ||
      !['running', 'partial'].includes(current.status)
    )
      return { status: 'ignored' };
    if (current.cancelRequestedAt !== null) {
      await tx.save(
        advanceJob(
          current,
          {
            attempt: input.attempt,
            expectedRevision: current.revision,
            status: 'cancelled',
          },
          options.now(),
        ),
      );
      return { status: 'cancelled' };
    }
    if (current.revision !== claim.revision) return { status: 'ignored' };
    // Only this claim may finalize failure. A previously accepted cancel is
    // acknowledged above without committing or disclosing parsed material.
    const loaded = await ports.loadAuthorizedAttachment(tx.context, current);
    const binding = attachmentBindingSchema.safeParse(loaded);
    if (
      !binding.success ||
      !matchingBinding(current, binding.data) ||
      JSON.stringify(binding.data) !== JSON.stringify(claim.binding)
    ) {
      await tx.save(
        advanceJob(
          current,
          {
            attempt: input.attempt,
            expectedRevision: claim.revision,
            status: 'failed',
            errorCode: 'input_changed',
            result: attachmentJobResultSchema.parse({
              stage: 'failed',
              mediaId: current.resourceId,
              source: null,
              fragmentIds: [],
              failureReason: 'processing_failed',
            }),
          },
          options.now(),
        ),
      );
      return { status: loaded === null ? 'forbidden' : 'ignored' };
    }
    const result = attachmentJobResultSchema.parse(
      parsed.status === 'parsed'
        ? {
            stage: 'parsed',
            mediaId: current.resourceId,
            source: {
              fragmentId: parsed.fragments[0].fragmentId,
              originalVersionId: parsed.originalVersionId,
            },
            fragmentIds: parsed.fragments.map(
              (fragment) => fragment.fragmentId,
            ),
          }
        : {
            stage: parsed.status === 'unsupported' ? 'unsupported' : 'failed',
            mediaId: current.resourceId,
            source: null,
            fragmentIds: [],
            failureReason: parsed.reason,
          },
    );
    // Validate the common jobs fence before any business operation. All three
    // ports below MUST use this transaction context; failure rolls everything back.
    const next = advanceJob(
      current,
      {
        attempt: input.attempt,
        expectedRevision: claim.revision,
        status: parsed.status === 'parsed' ? 'completed' : 'failed',
        result,
        errorCode:
          parsed.status === 'failed' &&
          parsed.reason === 'dependency_unavailable'
            ? 'dependency_unavailable'
            : 'processing_failed',
      },
      options.now(),
    );
    if (parsed.status === 'parsed') {
      const inserted = await ports.saveParse(tx.context, binding.data, parsed);
      if (inserted === 'created')
        await ports.enqueueArrange(tx.context, {
          mediaId: current.resourceId,
          parseVersionId: parsed.parseVersionId,
          originalVersionId: parsed.originalVersionId,
          accountId: binding.data.accountId,
          target: binding.data.target,
          sources: parsed.fragments.map(
            ({ fragmentId, originalVersionId, location }) => ({
              fragmentId,
              originalVersionId,
              location,
            }),
          ),
        });
    }
    await tx.save(next);
    return { status: parsed.status };
  });
}
