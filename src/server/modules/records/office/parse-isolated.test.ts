import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, unzipSync } from 'fflate';
import { parseOfficeBytes } from './parse';
import { parseOfficeIsolated } from './parse-isolated';
import { executeOfficeWorker } from './parse-worker';
import { officeLimits } from './limits';
import {
  decodeOfficeOutcome,
  encodeOfficeOutcome,
  officeWorkerBudgetSchema,
  successfulOfficeOutcome,
} from './worker-protocol';
const harness = vi.hoisted(() => ({
  source: undefined as string | undefined,
  marker: undefined as SharedArrayBuffer | undefined,
  workers: [] as import('node:worker_threads').Worker[],
  inputs: [] as {
    size: number;
    backing: number;
    bytes: Uint8Array;
    env: unknown;
    execArgv: unknown;
  }[],
  throwStart: false,
  throwTerminate: false,
}));
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(
        file: ConstructorParameters<typeof actual.Worker>[0],
        options?: ConstructorParameters<typeof actual.Worker>[1],
      ) {
        if (harness.throwStart) throw new Error('Synthetic start failure');
        const bytes = options?.workerData?.bytes as Uint8Array | undefined;
        const snapshot = {
          size: bytes?.byteLength ?? 0,
          backing: bytes?.buffer.byteLength ?? 0,
          bytes: Uint8Array.from(bytes ?? []),
          env: options?.env,
          execArgv: options?.execArgv,
        };
        if (harness.source)
          super(harness.source, {
            eval: true,
            workerData: harness.marker,
            stdout: true,
            stderr: true,
            execArgv: [],
            env: {},
          });
        else super(file, options);
        harness.inputs.push(snapshot);
        harness.workers.push(this);
      }
      override async terminate() {
        const exit = await super.terminate();
        if (harness.throwTerminate)
          throw new Error('Synthetic termination error');
        return exit;
      }
    },
  };
});
beforeEach(() => {
  harness.source = undefined;
  harness.marker = undefined;
  harness.workers = [];
  harness.inputs = [];
  harness.throwStart = false;
  harness.throwTerminate = false;
});
afterEach(async () => {
  harness.throwTerminate = false;
  await Promise.all(harness.workers.map((w) => w.terminate()));
  vi.restoreAllMocks();
});
const budget = officeWorkerBudgetSchema.parse({});
const pptx = () => ({
  format: 'pptx' as const,
  bytes: fixture('ordered-slides.pptx'),
});
async function entered(marker: Int32Array) {
  const end = Date.now() + 4000;
  while (Atomics.load(marker, 0) !== 1) {
    if (Date.now() > end) throw new Error('Worker did not enter computation');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function busyWorker() {
  harness.marker = new SharedArrayBuffer(8);
  harness.source =
    "const {workerData}=require('node:worker_threads'); const m=new Int32Array(workerData); Atomics.store(m,0,1); while(true){Atomics.add(m,1,1)}";
  return new Int32Array(harness.marker);
}

const fixtures = new URL(
  '../../../../../tests/fixtures/office/',
  import.meta.url,
);
const fixture = (name: string) => readFileSync(new URL(name, fixtures));
function understatedArchive(): Uint8Array {
  const entries = unzipSync(fixture('ordered-slides.pptx'));
  entries['media/unused.bin'] = new Uint8Array(32 * 1024 * 1024 + 1);
  const bytes = zipSync(entries);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const length = view.getUint16(i + 28, true);
    const name = new TextDecoder().decode(
      bytes.subarray(i + 46, i + 46 + length),
    );
    if (name !== 'media/unused.bin') continue;
    view.setUint32(i + 24, 1, true);
    view.setUint32(view.getUint32(i + 42, true) + 22, 1, true);
    return bytes;
  }
  throw new Error('Missing synthetic test entry');
}
describe('actual Office expansion budget', () => {
  it('rejects actual expanded bytes even when ZIP headers understate an unused part', async () => {
    const bytes = understatedArchive();
    expect(bytes.byteLength).toBeLessThan(8 * 1024 * 1024);
    await expect(
      parseOfficeBytes({ format: 'pptx', bytes }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded' });
  });
});

describe('real Office worker and complete wire budgets', () => {
  it.each([
    ['pptx', 'ordered-slides.pptx'],
    ['xlsx', 'cached-values.xlsx'],
    ['xlsx', 'cache-types.xlsx'],
  ] as const)(
    'keeps complete %s facts/locations/cache states equivalent for %s',
    async (format, file) => {
      const bytes = fixture(file);
      const raw = await parseOfficeBytes({ format, bytes });
      expect(await parseOfficeIsolated({ format, bytes })).toEqual(raw);
      expect(harness.workers).toHaveLength(1);
      expect(harness.workers[0].threadId).toBe(-1);
    },
  );
  it('transfers only an exact owned copy, preserves pooled caller bytes and excludes environment', async () => {
    const original = fixture('ordered-slides.pptx');
    const whole = Buffer.alloc(original.length + 32, 0xcc);
    whole.set(original, 11);
    const before = Buffer.from(whole);
    const bytes = whole.subarray(11, 11 + original.length);
    await parseOfficeIsolated({ format: 'pptx', bytes });
    expect(whole).toEqual(before);
    expect(harness.inputs[0]).toMatchObject({
      size: bytes.length,
      backing: bytes.length,
      env: {},
      execArgv: ['--import', 'tsx'],
    });
    expect(harness.inputs[0].bytes).toEqual(new Uint8Array(original));
  });
  it('rejects understated actual expansion in the real worker', async () => {
    await expect(
      parseOfficeIsolated({ format: 'pptx', bytes: understatedArchive() }),
    ).rejects.toMatchObject({
      kind: 'limit_exceeded',
      reason: 'package_expansion_actual',
    });
    expect(harness.workers[0].threadId).toBe(-1);
  });
  it('rejects a real malformed DEFLATE stream instead of continuing with intact parts', async () => {
    const bytes = Uint8Array.from(pptx().bytes);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(8, true)).toBe(8);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[start] = 7; // DEFLATE BTYPE=3 is invalid, not merely a mismatched ZIP CRC.
    await expect(
      parseOfficeIsolated({ format: 'pptx', bytes }),
    ).rejects.toMatchObject({ kind: 'invalid_document' });
    expect(harness.workers[0].threadId).toBe(-1);
  });
  it('rejects a real decompression entry overflow', async () => {
    const entries = unzipSync(pptx().bytes);
    for (let i = 0; i < 1025; i++) entries[`unused/${i}`] = new Uint8Array();
    await expect(
      parseOfficeIsolated({ format: 'pptx', bytes: zipSync(entries) }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded' });
  });
  it('enforces complete serialized output rather than only display text', async () => {
    await expect(
      parseOfficeIsolated(pptx(), { maxOutputBytes: 256 }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded', reason: 'output_bytes' });
    expect(harness.workers[0].threadId).toBe(-1);
  });
  it('counts large formula provenance even when visible cached text is small', async () => {
    const entries = unzipSync(fixture('cached-values.xlsx'));
    const xml = new TextDecoder().decode(entries['xl/worksheets/sheet5.xml']);
    entries['xl/worksheets/sheet5.xml'] = new TextEncoder().encode(
      xml.replace('<f>1+1</f>', '<f>' + '1+'.repeat(10000) + '1</f>'),
    );
    const input = { format: 'xlsx' as const, bytes: zipSync(entries) };
    const raw = await parseOfficeBytes(input);
    expect(
      raw.fragments.reduce((n, f) => n + (f.text?.length ?? 0), 0),
    ).toBeLessThan(8192);
    expect(
      Buffer.byteLength(JSON.stringify(successfulOfficeOutcome(raw))),
    ).toBeGreaterThan(8192);
    await expect(
      parseOfficeIsolated(input, { maxOutputBytes: 8192 }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded', reason: 'output_bytes' });
  });
  it('rejects actual text above the existing extraction ceiling', async () => {
    const entries = unzipSync(pptx().bytes);
    entries['ppt/slides/slide7.xml'] = new TextEncoder().encode(
      new TextDecoder()
        .decode(entries['ppt/slides/slide7.xml'])
        .replace(
          '演示第一页：团队甲共同完成交付。',
          '演'.repeat(officeLimits.maxTextChars + 1),
        ),
    );
    await expect(
      parseOfficeIsolated({ format: 'pptx', bytes: zipSync(entries) }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded' });
  });
  it.each([
    ['pptx', 'truncated.pptx'],
    ['xlsx', 'unsupported.zip'],
  ] as const)(
    'preserves parser failures for actual %s/%s',
    async (format, file) => {
      const input = { format, bytes: fixture(file) };
      const raw = await parseOfficeBytes(input).catch((error) => error);
      await expect(parseOfficeIsolated(input)).rejects.toMatchObject({
        kind: raw.kind,
        reason: raw.reason,
      });
      expect(harness.workers[0].threadId).toBe(-1);
    },
  );
  it('rejects malformed request/oversized input/pre-cancel before creating any worker', async () => {
    await expect(
      parseOfficeIsolated({
        format: 'docx',
        bytes: new Uint8Array([1]),
      } as never),
    ).rejects.toMatchObject({ kind: 'unsupported_format' });
    await expect(
      parseOfficeIsolated({ format: 'xlsx', bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ kind: 'invalid_document' });
    await expect(
      parseOfficeIsolated({
        format: 'xlsx',
        bytes: new Uint8Array(officeLimits.maxInputBytes + 1),
      }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded', reason: 'input_size' });
    await expect(
      parseOfficeIsolated({ ...pptx(), signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    await expect(
      parseOfficeIsolated(pptx(), { maxDurationMs: 60001 }),
    ).rejects.toMatchObject({ reason: 'invalid_budget' });
    await expect(
      parseOfficeIsolated({ ...pptx(), signal: {} as AbortSignal }),
    ).rejects.toMatchObject({ reason: 'invalid_signal' });
    expect(harness.workers).toHaveLength(0);
  });
});
describe('real thread hard termination and failure terminal states', () => {
  it('terminates an already computing thread on cancellation before settling', async () => {
    const marker = busyWorker();
    const controller = new AbortController();
    const pending = parseOfficeIsolated({
      ...pptx(),
      signal: controller.signal,
    });
    const observed = expect(pending).rejects.toMatchObject({
      kind: 'cancelled',
      reason: 'aborted',
    });
    await entered(marker);
    controller.abort();
    await observed;
    expect(harness.workers[0].threadId).toBe(-1);
    const value = Atomics.load(marker, 1);
    await new Promise((r) => setTimeout(r, 15));
    expect(Atomics.load(marker, 1)).toBe(value);
  });
  it('hard-times out an already computing thread with an unresponsive event loop', async () => {
    const marker = busyWorker();
    const pending = parseOfficeIsolated(pptx(), { maxDurationMs: 1500 });
    const observed = expect(pending).rejects.toMatchObject({
      kind: 'limit_exceeded',
      reason: 'timeout',
    });
    await entered(marker);
    await observed;
    expect(harness.workers[0].threadId).toBe(-1);
  });
  it.each([
    ['throw new Error("SYNTHETIC_PRIVATE_DATA")', 'worker_error'],
    ['process.exit(0)', 'worker_exit'],
    [
      'require("node:worker_threads").parentPort.postMessage("bad")',
      'invalid_worker_message',
    ],
  ])(
    'returns a stable failure for a real faulty worker: %s',
    async (source, reason) => {
      harness.source = source;
      const error = await parseOfficeIsolated(pptx()).catch((e) => e);
      expect(error).toMatchObject({ kind: 'processing_failed', reason });
      expect(error.message).not.toContain('SYNTHETIC_PRIVATE_DATA');
      expect(harness.workers[0].threadId).toBe(-1);
    },
  );
  it('bounds actual private stdout/stderr and terminates noisy workers', async () => {
    harness.source =
      'process.stdout.write("x".repeat(70000));setInterval(()=>{},100)';
    await expect(parseOfficeIsolated(pptx())).rejects.toMatchObject({
      kind: 'limit_exceeded',
      reason: 'diagnostic_bytes',
    });
    expect(harness.workers[0].threadId).toBe(-1);
  });
  it('rejects an oversized message from a real worker before JSON parsing', async () => {
    harness.source =
      'require("node:worker_threads").parentPort.postMessage(new Uint8Array(1025))';
    await expect(
      parseOfficeIsolated(pptx(), { maxOutputBytes: 1024 }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded', reason: 'output_bytes' });
  });
  it('reports worker creation and termination errors without returning a false success', async () => {
    harness.throwStart = true;
    await expect(parseOfficeIsolated(pptx())).rejects.toMatchObject({
      reason: 'worker_start',
    });
    harness.throwStart = false;
    harness.throwTerminate = true;
    await expect(parseOfficeIsolated(pptx())).rejects.toMatchObject({
      reason: 'worker_termination',
    });
    expect(harness.workers[0].threadId).toBe(-1);
  });
});
describe('bounded runtime protocol and worker dispatch', () => {
  it('rejects invalid wire bytes, structure, version, source hash and format', async () => {
    const raw = await parseOfficeBytes(pptx());
    const expected = { format: 'pptx' as const, inputSha256: raw.inputSha256 };
    for (const wire of [
      null,
      new Uint8Array([255]),
      new TextEncoder().encode('{'),
      new TextEncoder().encode('{"version":2}'),
    ])
      expect(() => decodeOfficeOutcome(wire, budget, expected)).toThrow();
    const outcome = successfulOfficeOutcome(raw);
    expect(
      decodeOfficeOutcome(
        encodeOfficeOutcome(outcome, budget),
        budget,
        expected,
      ),
    ).toEqual(outcome);
    expect(() =>
      decodeOfficeOutcome(encodeOfficeOutcome(outcome, budget), budget, {
        ...expected,
        inputSha256: '0'.repeat(64),
      }),
    ).toThrow('worker_result_mismatch');
    expect(() =>
      decodeOfficeOutcome(encodeOfficeOutcome(outcome, budget), budget, {
        ...expected,
        format: 'xlsx',
      }),
    ).toThrow('worker_result_mismatch');
  });
  it('executes worker dispatch for real bytes and serializes stable parse/input/output failures', async () => {
    const input = {
      version: 1,
      format: 'pptx' as const,
      bytes: pptx().bytes,
      budget,
    };
    const raw = await parseOfficeBytes(pptx());
    const expected = { format: 'pptx' as const, inputSha256: raw.inputSha256 };
    expect(
      decodeOfficeOutcome(await executeOfficeWorker(input), budget, expected),
    ).toEqual(successfulOfficeOutcome(raw));
    expect(
      decodeOfficeOutcome(await executeOfficeWorker({}), budget, expected),
    ).toMatchObject({
      status: 'failed',
      kind: 'processing_failed',
      reason: 'invalid_worker_input',
    });
    expect(
      decodeOfficeOutcome(
        await executeOfficeWorker({
          ...input,
          bytes: fixture('truncated.pptx'),
        }),
        budget,
        expected,
      ),
    ).toMatchObject({ status: 'failed', kind: 'invalid_document' });
    expect(
      decodeOfficeOutcome(
        await executeOfficeWorker({
          ...input,
          budget: { ...budget, maxOutputBytes: 256 },
        }),
        budget,
        expected,
      ),
    ).toMatchObject({
      status: 'failed',
      kind: 'limit_exceeded',
      reason: 'output_bytes',
    });
  });
});
