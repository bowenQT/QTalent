import type { WorkerOptions } from 'node:worker_threads';
import type { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
interface WorkerFixture extends EventEmitter {
  options: WorkerOptions;
  terminate: ReturnType<typeof vi.fn>;
  stdout: { resume: ReturnType<typeof vi.fn> };
  stderr: { resume: ReturnType<typeof vi.fn> };
}
const state = vi.hoisted(() => ({ workers: [] as WorkerFixture[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      options: WorkerOptions;
      stdout = { resume: vi.fn() };
      stderr = { resume: vi.fn() };
      terminate = vi.fn(async () => 0);
      constructor(_url: URL, options: WorkerOptions) {
        super();
        this.options = options;
        state.workers.push(this);
      }
    },
  };
});
import { createDocumentDecoders } from './document-decoders';
const options = {
  limits: { maxBytes: 100, maxFragments: 10, maxFragmentChars: 50 },
};
beforeEach(() => {
  state.workers.length = 0;
});
describe('document worker transport boundary', () => {
  it('sends only an exclusive exact-length byte buffer and strict metadata, and cleans up after a valid reply', async () => {
    const backing = Buffer.alloc(8192, 0x73);
    const bytes = backing.subarray(100, 103);
    bytes.set([1, 2, 3]);
    const promise = createDocumentDecoders().docx.decode(bytes, options);
    const worker = state.workers[0];
    const data = worker.options.workerData as {
      bytes: Uint8Array;
      format: string;
    };
    expect(Object.keys(data).sort()).toEqual([
      'budget',
      'bytes',
      'format',
      'limits',
    ]);
    expect(data.format).toBe('docx');
    expect([...data.bytes]).toEqual([1, 2, 3]);
    expect(data.bytes.buffer.byteLength).toBe(3);
    expect(data.bytes.buffer).not.toBe(bytes.buffer);
    expect(worker.options.transferList).toEqual([data.bytes.buffer]);
    expect(worker.options.resourceLimits).toEqual({
      maxOldGenerationSizeMb: 256,
      stackSizeMb: 4,
    });
    expect(worker.options.stdout).toBe(true);
    expect(worker.options.stderr).toBe(true);
    expect(worker.stdout.resume).toHaveBeenCalledOnce();
    expect(worker.stderr.resume).toHaveBeenCalledOnce();
    worker.emit('message', { status: 'decoded', segments: [] });
    expect(await promise).toEqual({ status: 'decoded', segments: [] });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.eventNames()).toEqual([]);
  });
  it.each(['oom', 'error', 'exit'] as const)(
    'fails closed and terminates on %s',
    async (event) => {
      const promise = createDocumentDecoders().pdf.decode(
        new Uint8Array([1]),
        options,
      );
      const worker = state.workers[0];
      if (event === 'exit') worker.emit('exit', 0);
      else
        worker.emit(
          'error',
          Object.assign(
            new Error('private source detail'),
            event === 'oom' ? { code: 'ERR_WORKER_OUT_OF_MEMORY' } : {},
          ),
        );
      expect(await promise).toEqual({
        status: 'failed',
        reason: event === 'oom' ? 'resource_limit' : 'processing_failed',
      });
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(worker.eventNames()).toEqual([]);
    },
  );
  it('rejects malformed worker replies and does not report success if termination fails', async () => {
    const promise = createDocumentDecoders().pdf.decode(
      new Uint8Array([1]),
      options,
    );
    state.workers[0].emit('message', {
      status: 'decoded',
      segments: [],
      privateUrl: 'secret',
    });
    expect(await promise).toEqual({
      status: 'failed',
      reason: 'invalid_content',
    });
    const other = createDocumentDecoders().pdf.decode(
      new Uint8Array([1]),
      options,
    );
    state.workers[1].terminate.mockRejectedValue(
      new Error('private diagnostic'),
    );
    state.workers[1].emit('message', { status: 'decoded', segments: [] });
    expect(await other).toEqual({
      status: 'failed',
      reason: 'processing_failed',
    });
    expect(state.workers[1].eventNames()).toEqual([]);
  });
  it('does not spawn an already cancelled request and cleans abort listener/timer after cancellation', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    expect(
      await createDocumentDecoders().pdf.decode(new Uint8Array([1]), {
        ...options,
        signal: cancelled.signal,
      }),
    ).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(state.workers).toHaveLength(0);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = createDocumentDecoders().pdf.decode(new Uint8Array([1]), {
      ...options,
      signal: controller.signal,
    });
    controller.abort();
    expect(await promise).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(state.workers[0].eventNames()).toEqual([]);
  });
});
