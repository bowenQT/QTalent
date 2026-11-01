import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { applyJobCommand, newJob, type JobRecord } from '../jobs/state';
import { createJobService, type JobStore } from '../jobs/service';
import type { PgBoss } from 'pg-boss';
import {
  createAttachmentParsePolicy,
  registerAttachmentParseJob,
} from '../jobs/attachment-parse';
import { createValidatedAttachmentInput } from '../modules/records/attachments/upload-input';
import type {
  AttachmentBinding,
  AttachmentParsePorts,
} from '../modules/records/attachments/flow';
import type { ParsedAttachment } from '../modules/records/attachments';
import { runAttachmentParse } from './attachment-parse';

interface Context {
  bundles: Map<string, ParsedAttachment>;
  enqueues: unknown[];
}
const now = () => '2026-10-25T16:00:00.000Z';
const payload = { jobId: 'parse-job', attempt: 1 };
const options = {
  now,
  limits: { maxBytes: 16384, maxFragments: 100, maxFragmentChars: 1000 },
};
function fixture() {
  const content = Buffer.from('第一段原文。\n\n第二段原文。');
  const binding: AttachmentBinding = {
    purpose: 'attachment',
    completedJobId: 'parse-job',
    recordCollectionId: 'record-collection',
    accountId: 'uploader',
    quotaScope: 'record-collection',
    target: { kind: 'people', personIds: ['demo-person'] },
    version: {
      mediaId: 'upload-1',
      originalVersionId: 'version-1',
      filename: 'demo.txt',
      mediaType: 'text/plain',
      byteLength: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
    },
  };
  const state: { record: JobRecord; context: Context } = {
    record: newJob(
      {
        jobId: payload.jobId,
        kind: 'media',
        resourceId: 'upload-1',
        inputVersion: 'version-1',
      },
      now(),
    ),
    context: { bundles: new Map(), enqueues: [] },
  };
  let pending: Promise<unknown> = Promise.resolve();
  const store: JobStore<Context> = {
    locked: (_id, run) => {
      const work = pending.then(async () => {
        const context = structuredClone(state.context);
        let record = structuredClone(state.record);
        const result = await run({
          context,
          record,
          save: async (next) => {
            record = next;
          },
          operation: async () => null,
          saveOperation: async () => {},
        });
        state.context = context;
        state.record = record;
        return result;
      });
      pending = work.catch(() => undefined);
      return work;
    },
  };
  const ports: AttachmentParsePorts<Context> = {
    loadAuthorizedAttachment: vi.fn(async () => structuredClone(binding)),
    open: vi.fn(async () =>
      (async function* () {
        yield content;
      })(),
    ),
    saveParse: vi.fn(async (context, _binding, parsed) => {
      const prior = context.bundles.get(parsed.parseVersionId);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(parsed))
          throw new Error('bundle conflict');
        return 'existing';
      }
      context.bundles.set(parsed.parseVersionId, parsed);
      return 'created';
    }),
    enqueueArrange: vi.fn(async (context, request) => {
      context.enqueues.push(request);
    }),
  };
  return { binding, content, state, store, ports };
}
describe('attachment parse transaction pipeline', () => {
  it('persists real fragments and sends only trusted refs to845 in the same transaction', async () => {
    const f = fixture();
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'parsed' });
    expect(f.state.record.status).toBe('completed');
    expect(f.state.context.bundles.size).toBe(1);
    expect(f.state.context.enqueues).toHaveLength(1);
    const request = f.state.context.enqueues[0];
    expect(request).toMatchObject({
      mediaId: 'upload-1',
      originalVersionId: 'version-1',
      accountId: 'uploader',
      recordCollectionId: f.binding.recordCollectionId,
      target: f.binding.target,
      sources: [
        {
          originalVersionId: 'version-1',
          location: { paragraph: 'txt:p1:u16:0-6' },
        },
        {
          originalVersionId: 'version-1',
          location: { paragraph: 'txt:p2:u16:8-14' },
        },
      ],
    });
    expect(JSON.stringify(request)).not.toContain('第一段原文');
    const persisted = [...f.state.context.bundles.values()][0];
    expect(persisted.fragments.map((x) => x.excerpt)).toEqual([
      '第一段原文。',
      '第二段原文。',
    ]);
    expect(f.ports.loadAuthorizedAttachment).toHaveBeenCalledTimes(2);
  });
  it('denies before opening when current record-write authorization is missing', async () => {
    const f = fixture();
    vi.mocked(f.ports.loadAuthorizedAttachment).mockResolvedValue(null);
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'forbidden' });
    expect(f.ports.open).not.toHaveBeenCalled();
    expect(f.state.record.status).toBe('queued');
  });
  it.each([
    { completedJobId: 'other-job' },
    { purpose: 'audio' },
    { version: { originalVersionId: 'other-version' } },
    { version: { mediaId: 'other-upload' } },
  ])('refuses inconsistent persisted bindings %#', async (patch) => {
    const f = fixture();
    vi.mocked(f.ports.loadAuthorizedAttachment).mockResolvedValue({
      ...f.binding,
      ...patch,
      version: { ...f.binding.version, ...patch.version },
    } as AttachmentBinding);
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'ignored' });
    expect(f.ports.open).not.toHaveBeenCalled();
  });
  it('does not commit after mid-parse revocation', async () => {
    const f = fixture();
    vi.mocked(f.ports.loadAuthorizedAttachment)
      .mockResolvedValueOnce(f.binding)
      .mockResolvedValueOnce(null);
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'forbidden' });
    expect(f.state.record).toMatchObject({
      status: 'failed',
      errorCode: 'input_changed',
      result: { stage: 'failed', source: null, fragmentIds: [] },
    });
    expect(f.state.context.bundles.size).toBe(0);
    expect(f.ports.enqueueArrange).not.toHaveBeenCalled();
  });
  it('does not commit if the verified object binding drifts', async () => {
    const f = fixture();
    vi.mocked(f.ports.loadAuthorizedAttachment)
      .mockResolvedValueOnce(f.binding)
      .mockResolvedValueOnce({
        ...f.binding,
        version: { ...f.binding.version, sha256: '0'.repeat(64) },
      });
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'ignored' });
    expect(f.state.record).toMatchObject({
      status: 'failed',
      errorCode: 'input_changed',
      result: { stage: 'failed', source: null, fragmentIds: [] },
    });
    expect(f.state.context.bundles.size).toBe(0);
  });
  it('terminates the registered worker after real validated-input permission revocation', async () => {
    const f = fixture();
    let mayProcess = true;
    const upload = {
      uploadId: f.binding.version.mediaId,
      originalId: 'synthetic-original',
      originalVersionId: f.binding.version.originalVersionId,
      jobId: f.binding.completedJobId,
      recordCollectionId: f.binding.recordCollectionId,
      purpose: 'attachment',
      filename: f.binding.version.filename,
      accountId: f.binding.accountId,
      quotaScope: f.binding.quotaScope,
      target: f.binding.target,
      object: {
        objectKey: 'synthetic/attachment.txt',
        byteLength: f.content.length,
        mediaType: f.binding.version.mediaType,
        sha256: f.binding.version.sha256,
        etag: 'synthetic-etag',
      },
    };
    const canProcess = vi.fn(async () => mayProcess);
    const input = createValidatedAttachmentInput<Context>({
      readValidatedUploadInContext: async () => upload,
      readValidatedUpload: async () => structuredClone(upload),
      canProcess,
      openObject: async () =>
        (async function* () {
          yield f.content;
          mayProcess = false;
        })(),
    });
    const ports = { ...f.ports, ...input };
    let dispatch:
      ((jobs: Array<{ data: unknown }>) => Promise<void>) | undefined;
    const boss = {
      createQueue: vi.fn(async () => {}),
      work: vi.fn(async (_queue: string, handler: typeof dispatch) => {
        dispatch = handler;
      }),
    };
    await registerAttachmentParseJob(boss as unknown as PgBoss, (data) =>
      runAttachmentParse(f.store, ports, data, options),
    );
    await dispatch!([{ data: payload }]);
    expect(canProcess).toHaveBeenCalledTimes(2);
    const policy = createAttachmentParsePolicy<Context>({
      can: async (_context, requester, _job, action) =>
        requester === 'viewer' && action === 'read',
      inputVersion: async () => f.binding.version.originalVersionId,
      visibleSources: async () => [],
      enqueue: async () => {},
    });
    const jobs = createJobService(f.store, [policy], now);
    expect(await jobs.read('viewer', payload.jobId)).toMatchObject({
      status: 'success',
      snapshot: {
        status: 'failed',
        result: { stage: 'failed', source: null, fragmentIds: [] },
        error: { code: 'input_changed' },
        canRetry: false,
      },
    });
    expect(await jobs.read('outsider', payload.jobId)).toEqual({
      status: 'forbidden',
    });
    expect(f.ports.saveParse).not.toHaveBeenCalled();
    expect(f.ports.enqueueArrange).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'binding-changed'] as const)(
    'acknowledges an accepted cancel even when the input is %s',
    async (change) => {
      const f = fixture();
      vi.mocked(f.ports.open).mockImplementation(async () => {
        f.state.record = applyJobCommand(
          f.state.record,
          { action: 'cancel', expectedRevision: f.state.record.revision },
          now(),
        );
        return (async function* () {
          yield f.content;
        })();
      });
      vi.mocked(f.ports.loadAuthorizedAttachment)
        .mockResolvedValueOnce(f.binding)
        .mockResolvedValueOnce(
          change === 'revoked' ? null : { ...f.binding, quotaScope: 'changed' },
        );
      expect(
        await runAttachmentParse(f.store, f.ports, payload, options),
      ).toEqual({ status: 'cancelled' });
      expect(f.state.record.status).toBe('cancelled');
      expect(f.ports.saveParse).not.toHaveBeenCalled();
      expect(f.ports.enqueueArrange).not.toHaveBeenCalled();
    },
  );
  it.each(['revoked', 'binding-changed'] as const)(
    'does not fail a newer claim after observing %s',
    async (change) => {
      const f = fixture();
      vi.mocked(f.ports.open).mockImplementation(async () => {
        f.state.record.revision++;
        return (async function* () {
          yield f.content;
        })();
      });
      vi.mocked(f.ports.loadAuthorizedAttachment)
        .mockResolvedValueOnce(f.binding)
        .mockResolvedValueOnce(
          change === 'revoked' ? null : { ...f.binding, quotaScope: 'changed' },
        );
      expect(
        await runAttachmentParse(f.store, f.ports, payload, options),
      ).toEqual({ status: 'ignored' });
      expect(f.state.record).toMatchObject({
        status: 'running',
        revision: 3,
        errorCode: null,
      });
      expect(f.ports.saveParse).not.toHaveBeenCalled();
      expect(f.ports.enqueueArrange).not.toHaveBeenCalled();
    },
  );
  it('acknowledges cancellation during parsing with zero business writes', async () => {
    const f = fixture();
    vi.mocked(f.ports.open).mockImplementation(async () => {
      f.state.record = applyJobCommand(
        f.state.record,
        { action: 'cancel', expectedRevision: f.state.record.revision },
        now(),
      );
      return (async function* () {
        yield Buffer.from('ignored');
      })();
    });
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'cancelled' });
    expect(f.state.record.status).toBe('cancelled');
    expect(f.state.context.bundles.size).toBe(0);
    expect(f.ports.enqueueArrange).not.toHaveBeenCalled();
  });
  it('acknowledges an already requested cancel before reading bytes', async () => {
    const f = fixture();
    f.state.record = applyJobCommand(
      f.state.record,
      { action: 'cancel', expectedRevision: 1 },
      now(),
    );
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'cancelled' });
    expect(f.ports.open).not.toHaveBeenCalled();
  });
  it.each(['completed', 'cancelled', 'failed', 'awaiting_manual'] as const)(
    'does not redeliver terminal or parked %s',
    async (status) => {
      const f = fixture();
      f.state.record.status = status;
      expect(
        await runAttachmentParse(f.store, f.ports, payload, options),
      ).toEqual({ status: 'ignored' });
      expect(f.ports.open).not.toHaveBeenCalled();
    },
  );
  it('fences stale attempts and unclaimed revisions', async () => {
    const stale = fixture();
    stale.state.record.attempt = 2;
    expect(
      await runAttachmentParse(stale.store, stale.ports, payload, options),
    ).toEqual({ status: 'ignored' });
    const f = fixture();
    vi.mocked(f.ports.open).mockImplementation(async () => {
      f.state.record.revision++;
      return (async function* () {
        yield Buffer.from('ignored');
      })();
    });
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'ignored' });
    expect(f.state.context.bundles.size).toBe(0);
  });
  it('can safely reclaim running/parsing after a worker crash without duplicate enqueue', async () => {
    const f = fixture();
    f.state.record.status = 'running';
    f.state.record.result = {
      stage: 'parsing',
      mediaId: 'upload-1',
      source: null,
      fragmentIds: [],
    };
    f.state.record.revision = 2;
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'parsed' });
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'ignored' });
    expect(f.state.context.enqueues).toHaveLength(1);
  });
  it('only commits the latest claim when overlapping deliveries finish out of order', async () => {
    const f = fixture();
    let release: () => void = () => {};
    let started: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const opened = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(f.ports.open).mockImplementationOnce(async () => {
      started();
      await waiting;
      return (async function* () {
        yield Buffer.from('第一段原文。\n\n第二段原文。');
      })();
    });
    const first = runAttachmentParse(f.store, f.ports, payload, options);
    await opened;
    const second = await runAttachmentParse(f.store, f.ports, payload, options);
    release();
    expect(second).toEqual({ status: 'parsed' });
    expect(await first).toEqual({ status: 'ignored' });
    expect(f.state.context.bundles.size).toBe(1);
    expect(f.state.context.enqueues).toHaveLength(1);
  });
  it('will not take over a running media task in another processing stage', async () => {
    const f = fixture();
    f.state.record.status = 'running';
    f.state.record.result = {
      stage: 'transcribing',
      mediaId: 'upload-1',
      source: null,
      fragmentIds: [],
    };
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'ignored' });
    expect(f.ports.open).not.toHaveBeenCalled();
  });
  it('rolls back fragments and snapshot together when845 enqueue fails', async () => {
    const f = fixture();
    vi.mocked(f.ports.enqueueArrange).mockRejectedValue(
      new Error('unavailable'),
    );
    await expect(
      runAttachmentParse(f.store, f.ports, payload, options),
    ).rejects.toThrow('unavailable');
    expect(f.state.context.bundles.size).toBe(0);
    expect(f.state.context.enqueues).toHaveLength(0);
    expect(f.state.record.status).toBe('running');
  });
  it('does not enqueue again when an immutable equivalent parse already exists', async () => {
    const f = fixture();
    vi.mocked(f.ports.saveParse).mockResolvedValue('existing');
    expect(
      await runAttachmentParse(f.store, f.ports, payload, options),
    ).toEqual({ status: 'parsed' });
    expect(f.ports.enqueueArrange).not.toHaveBeenCalled();
  });
  it('records dependency failure without opening or manufacturing sources', async () => {
    const f = fixture();
    f.binding.version.filename = 'document.pdf';
    f.binding.version.mediaType = 'application/pdf';
    expect(
      await runAttachmentParse(f.store, f.ports, payload, {
        ...options,
        decoders: {},
      }),
    ).toEqual({ status: 'failed' });
    expect(f.state.record.errorCode).toBe('dependency_unavailable');
    expect(f.ports.open).not.toHaveBeenCalled();
    expect(f.state.context.bundles.size).toBe(0);
  });
  it.each([
    { ...payload, accountId: 'injected' },
    { ...payload, objectKey: 'arbitrary' },
    { ...payload, attempt: 0 },
  ])('strictly validates queue payload %#', async (invalid) => {
    const f = fixture();
    await expect(
      runAttachmentParse(f.store, f.ports, invalid, options),
    ).rejects.toThrow(z.ZodError);
    expect(f.ports.loadAuthorizedAttachment).not.toHaveBeenCalled();
  });
});
