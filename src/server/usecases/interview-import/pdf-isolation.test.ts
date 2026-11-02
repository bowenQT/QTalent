import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { materialSourceLocationSchema } from '../../../contracts/sources';
import type { InterviewReviewResult } from '../../modules/records/attachments/interview-review/types';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { Worker, WorkerOptions } from 'node:worker_threads';
const state = vi.hoisted(() => ({
  script: null as string | null,
  constructionFails: false,
  workers: [] as Worker[],
  inputs: [] as {
    bytes: Uint8Array;
    backingLength: number;
    options: WorkerOptions;
  }[],
}));
// The seam records REAL Worker instances. It never fakes their event loop,
// terminate, PDF parser or threadId. Fault scripts are trusted test-only threads.
vi.mock('node:worker_threads', async () => {
  const actual = await vi.importActual<typeof import('node:worker_threads')>(
    'node:worker_threads',
  );
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(entry: string | URL, options: WorkerOptions) {
        if (state.constructionFails)
          throw new Error('synthetic-private-constructor-diagnostic');
        const data = options.workerData as { bytes: Uint8Array };
        state.inputs.push({
          bytes: data.bytes.slice(),
          backingLength: data.bytes.buffer.byteLength,
          options,
        });
        super(
          state.script
            ? new URL(
                'data:text/javascript,' + encodeURIComponent(state.script),
              )
            : entry,
          options,
        );
        state.workers.push(this);
      }
    },
  };
});
import { parseInterviewReviewPdf } from '../../modules/records/attachments/interview-review/parser';
import { parseInterviewPdfIsolated } from './pdf-isolation';
import { executePdfWorkerRequest } from './pdf-worker';
import {
  decodePdfWorkerReply,
  encodePdfWorkerResult,
  type PdfIsolationBudget,
} from './pdf-protocol';
const options = {
  positionKind: 'non_management',
  allowSyntheticDemo: true,
} as const;
const budget: PdfIsolationBudget = {
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxDurationMs: 5000,
};
const bytes = (name = 'professional') =>
  readFile(`tests/fixtures/bow-896/interview/${name}.pdf`);
beforeEach(() => {
  state.script = null;
  state.constructionFails = false;
  state.inputs = [];
  state.workers = [];
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(state.workers.map((worker) => worker.terminate()));
  expect(state.workers.every((worker) => worker.threadId === -1)).toBe(true);
});
const parse = async (
  name = 'professional',
  limits: PdfIsolationBudget = budget,
  signal?: AbortSignal,
) =>
  parseInterviewPdfIsolated({
    bytes: await bytes(name),
    options,
    budget: limits,
    signal,
  });
function assertStopped() {
  expect(state.workers).toHaveLength(1);
  expect(state.workers[0].threadId).toBe(-1);
  expect(state.workers[0].eventNames()).toEqual([]);
}

// Fresh, ASCII-only test PDFs. No official document or parser implementation.
function resourcePdf(
  streams: string[],
  image?: { width: number; height: number },
) {
  const imageId = 3 + streams.length * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${streams.length} /Kids [${streams.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
  ];
  for (const [index, stream] of streams.entries()) {
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << ${image ? `/XObject << /Im1 ${imageId} 0 R >>` : ''} >> /Contents ${3 + index * 2} 0 R >>`,
    );
  }
  if (image)
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nabc\nendstream`,
    );
  let output = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}
function assertProvenance(result: InterviewReviewResult) {
  if (result.status === 'rejected')
    throw new Error('Expected synthetic detail forms');
  for (const page of result.pageTexts) {
    expect(page.extractionVersion).toBe('interview-review-lines-v1');
    expect(page.sha256).toBe(
      createHash('sha256').update(page.text).digest('hex'),
    );
  }
  for (const row of result.reviews) {
    expect(row.identity.candidateName?.value).toBe('谷嘉树（演示）');
    expect(row.identity.positionNumber).toBeNull();
    const regions = [
      row.templateSource,
      ...(row.identity.candidateName?.sources ?? []),
      ...Object.values(row.metadata).flatMap((field) => field?.sources ?? []),
      ...[
        ...row.dimensions.map((row) => row.selection),
        row.interviewRating,
        row.suggestedLevel,
      ].flatMap((selection) =>
        selection.status === 'not_applicable' ? [] : [selection.source],
      ),
    ];
    for (const region of regions) {
      const page = result.pageTexts.find((page) => page.page === region.page);
      expect(page).toBeDefined();
      if (!page) throw new Error('Missing page');
      expect(region.textRange.end).toBeLessThanOrEqual(page.text.length);
      expect(
        page.text.slice(region.textRange.start, region.textRange.end).trim(),
      ).not.toBe('');
      const location = {
        kind: 'pdf',
        page: region.page,
        textRange: region.textRange,
      };
      expect(materialSourceLocationSchema.parse(location)).toEqual(location);
      expect(
        materialSourceLocationSchema.safeParse({ ...location, box: region.box })
          .success,
      ).toBe(false);
    }
  }
}

describe('real isolated fixed-900 interview parser', () => {
  it.each(['campus', 'hr', 'professional'])(
    'preserves the actual %s PDF result through a terminated thread',
    async (name) => {
      const content = await bytes(name);
      const direct = await parseInterviewReviewPdf(content, options);
      const output = await parse(name);
      expect(output).toEqual({ status: 'parsed', result: direct });
      if (output.status === 'parsed') assertProvenance(output.result);
      assertStopped();
      expect(state.inputs[0].options).toMatchObject({
        execArgv: ['--import', 'tsx'],
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
      });
    },
  );
  it.each(['score-missing', 'score-multiple', 'unknown-template'])(
    'preserves %s as manual/rejected, not a successful import',
    async (name) => {
      const result = await parse(name);
      expect(result.status).toBe('parsed');
      if (result.status !== 'parsed') throw new Error('transport');
      expect(result.result.status).toBe(
        name === 'unknown-template' ? 'rejected' : 'needs_manual_input',
      );
      assertStopped();
    },
  );
  it('does not enable synthetic profiles implicitly', async () => {
    const result = await parseInterviewPdfIsolated({
      bytes: await bytes(),
      options: { positionKind: 'unknown' },
      budget,
    });
    expect(result).toMatchObject({
      status: 'parsed',
      result: { status: 'rejected', reason: 'unverified_template_profile' },
    });
    assertStopped();
  });
  it('transfers exactly the view without detaching or changing caller memory', async () => {
    const content = await bytes();
    const backing = Buffer.alloc(content.length + 1024, 0x71);
    content.copy(backing, 333);
    const before = Buffer.from(backing);
    const view = backing.subarray(333, 333 + content.length);
    expect(
      (await parseInterviewPdfIsolated({ bytes: view, options, budget }))
        .status,
    ).toBe('parsed');
    expect(state.inputs[0].bytes).toEqual(new Uint8Array(content));
    expect(state.inputs[0].backingLength).toBe(content.length);
    expect(backing).toEqual(before);
    expect(backing.byteLength).toBe(content.length + 1024);
    assertStopped();
  });
  it('rejects invalid budgets and input oversize before spawning or copying', async () => {
    expect(
      await parse('professional', { ...budget, maxDurationMs: 0 }),
    ).toEqual({ status: 'failed', reason: 'invalid_request' });
    expect(
      await parse('professional', { ...budget, maxInputBytes: 8 }),
    ).toEqual({ status: 'failed', reason: 'resource_limit' });
    expect(state.workers).toHaveLength(0);
    expect(state.inputs).toHaveLength(0);
  });
  it('does not start a pre-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await parse('professional', budget, controller.signal)).toEqual({
      status: 'failed',
      reason: 'cancelled',
    });
    expect(state.workers).toHaveLength(0);
  });
  it('terminates an actual running parser thread on cancellation and removes the listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const content = await bytes();
    const pending = parseInterviewPdfIsolated({
      bytes: content,
      options,
      budget,
      signal: controller.signal,
    });
    await once(state.workers[0], 'online');
    controller.abort();
    expect(await pending).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    assertStopped();
  });
  it('terminates the real 900 thread on its deadline', async () => {
    expect(
      await parse('professional', { ...budget, maxDurationMs: 1 }),
    ).toEqual({ status: 'failed', reason: 'timeout' });
    assertStopped();
  });
  it('also stops a real CPU-bound thread instead of only racing its promise', async () => {
    state.script = 'while (true) {}';
    const started = performance.now();
    expect(
      await parse('professional', { ...budget, maxDurationMs: 200 }),
    ).toEqual({ status: 'failed', reason: 'timeout' });
    expect(performance.now() - started).toBeLessThan(3000);
    assertStopped();
  });
  it('rejects a real late reply even when the parent deadline timer is delayed', async () => {
    // Only the host timer is delayed; the real thread/clock/parser still run.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(
      await parse('professional', { ...budget, maxDurationMs: 1 }),
    ).toEqual({ status: 'failed', reason: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
    assertStopped();
  });
  it('settles and terminates once when a real worker sends duplicate messages', async () => {
    state.script =
      "import { parentPort } from 'node:worker_threads'; const result={status:'rejected',reason:'unknown_template',message:'演示拒绝'}; parentPort.postMessage({protocol:1,status:'result',payload:new TextEncoder().encode(JSON.stringify(result)).buffer}); parentPort.postMessage({protocol:1,status:'failed',reason:'invalid_pdf'}); setInterval(()=>{},1000);";
    const content = await bytes();
    const pending = parseInterviewPdfIsolated({
      bytes: content,
      options,
      budget,
    });
    const terminate = vi.spyOn(state.workers[0], 'terminate');
    expect(await pending).toEqual({
      status: 'parsed',
      result: {
        status: 'rejected',
        reason: 'unknown_template',
        message: '演示拒绝',
      },
    });
    expect(terminate).toHaveBeenCalledOnce();
    assertStopped();
  });
  it('bounds the actual parser output before it crosses back as a success DTO', async () => {
    expect(
      await parse('professional', { ...budget, maxOutputBytes: 32 }),
    ).toEqual({ status: 'failed', reason: 'resource_limit' });
    assertStopped();
  });
  it.each([
    {
      pages: 200,
      expected: {
        status: 'parsed',
        result: { status: 'rejected', reason: 'no_detail_review' },
      },
    },
    { pages: 201, expected: { status: 'failed', reason: 'resource_limit' } },
  ])(
    'enforces the real 900 $pages-page boundary inside the thread',
    async ({ pages, expected }) => {
      const outcome = await parseInterviewPdfIsolated({
        bytes: resourcePdf(Array.from({ length: pages }, () => '')),
        options,
        budget,
      });
      expect(outcome).toMatchObject(expected);
      assertStopped();
    },
    10000,
  );
  it('preserves resource_limit for a real oversized PDF image', async () => {
    expect(
      await parseInterviewPdfIsolated({
        bytes: resourcePdf(['/Im1 Do'], { width: 2001, height: 1000 }),
        options,
        budget,
      }),
    ).toEqual({ status: 'failed', reason: 'resource_limit' });
    assertStopped();
  });
  it('rejects a real failed shading stream rather than accepting partial layout', async () => {
    expect(
      await parseInterviewPdfIsolated({
        bytes: resourcePdf(['0 0 10 10 re f /Missing sh']),
        options,
        budget,
      }),
    ).toEqual({ status: 'failed', reason: 'invalid_pdf' });
    assertStopped();
  });
  it('classifies damaged PDF bytes without exposing a cause or successful DTO', async () => {
    expect(
      await parseInterviewPdfIsolated({
        bytes: new TextEncoder().encode(
          '%PDF-1.7\nsynthetic-private-corrupt-content',
        ),
        options,
        budget,
      }),
    ).toEqual({ status: 'failed', reason: 'invalid_pdf' });
    assertStopped();
  });
  it.each(['throw', 'exit'])(
    'fails closed for a real worker %s with no usable reply',
    async (mode) => {
      state.script =
        mode === 'throw'
          ? "console.error('synthetic-private-diagnostic'); throw new Error('synthetic-private-error')"
          : 'process.exit(0)';
      const result = await parse();
      expect(result).toEqual({ status: 'failed', reason: 'worker_failed' });
      expect(JSON.stringify(result)).not.toContain('private');
      assertStopped();
    },
  );
  it('bounds diagnostics without forwarding their contents', async () => {
    state.script =
      "process.stderr.write('synthetic-private-diagnostic'.repeat(100)); setInterval(() => {}, 1000)";
    expect(
      await parse('professional', { ...budget, maxOutputBytes: 64 }),
    ).toEqual({ status: 'failed', reason: 'resource_limit' });
    assertStopped();
  });
  it('does not return a success if actual termination fails', async () => {
    const content = await bytes();
    const pending = parseInterviewPdfIsolated({
      bytes: content,
      options,
      budget,
    });
    vi.spyOn(state.workers[0], 'terminate').mockRejectedValue(
      new Error('synthetic-private-stop-error'),
    );
    expect(await pending).toEqual({
      status: 'failed',
      reason: 'termination_failed',
    });
    // afterEach restores the method and verifies the real worker is stopped.
  });
  it('sanitizes constructor failures without claiming a running worker', async () => {
    state.constructionFails = true;
    expect(await parse()).toEqual({
      status: 'failed',
      reason: 'worker_failed',
    });
    expect(state.workers).toHaveLength(0);
  });
  it.each([
    "parentPort.postMessage({ protocol: 9, status: 'failed', reason: 'worker_failed' })",
    "parentPort.postMessage({ protocol: 1, status: 'result', payload: new Uint8Array([255]).buffer })",
    "parentPort.postMessage({ protocol: 1, status: 'result', payload: new TextEncoder().encode('{bad json').buffer })",
    "parentPort.postMessage({ protocol: 1, status: 'result', payload: new TextEncoder().encode(JSON.stringify({status:'parsed', reviews:[], private:'synthetic-private'})).buffer })",
  ])(
    'rejects malformed replies from real fault-injection threads',
    async (code) => {
      state.script =
        "import { parentPort } from 'node:worker_threads'; " + code;
      expect(await parse()).toEqual({
        status: 'failed',
        reason: 'invalid_result',
      });
      assertStopped();
    },
  );
});

describe('worker receiver and strict bounded wire format', () => {
  it('checks the same receiver input even without the outer caller', async () => {
    expect(await executePdfWorkerRequest({ bytes: 'not-bytes' })).toMatchObject(
      { status: 'failed', reason: 'invalid_request' },
    );
    expect(
      await executePdfWorkerRequest({
        bytes: new Uint8Array(3),
        options,
        budget: { ...budget, maxInputBytes: 2 },
      }),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
    expect(
      await executePdfWorkerRequest({
        bytes: new Uint8Array([1, 2]),
        options,
        budget,
      }),
    ).toMatchObject({ status: 'failed', reason: 'invalid_pdf' });
    const reply = await executePdfWorkerRequest({
      bytes: await bytes(),
      options,
      budget,
    });
    expect(decodePdfWorkerReply(reply, 1024 * 1024).status).toBe('parsed');
  });
  it('rejects extra result fields, payload oversize and invalid JSON at the parent boundary', () => {
    const result = {
      status: 'rejected',
      reason: 'unknown_template',
      message: '演示拒绝',
    } as const;
    const reply = encodePdfWorkerResult(result, 1024);
    expect(decodePdfWorkerReply(reply, 1024)).toEqual({
      status: 'parsed',
      result,
    });
    expect(decodePdfWorkerReply(reply, 1)).toEqual({
      status: 'failed',
      reason: 'resource_limit',
    });
    expect(
      decodePdfWorkerReply(
        {
          protocol: 1,
          status: 'result',
          payload: new TextEncoder().encode('{}').buffer,
        },
        1024,
      ),
    ).toEqual({ status: 'failed', reason: 'invalid_result' });
    const unexpected = { ...result, private: 'synthetic-private' };
    expect(encodePdfWorkerResult(unexpected, 1024)).toMatchObject({
      status: 'failed',
      reason: 'invalid_result',
    });
    expect(
      decodePdfWorkerReply(
        { protocol: 1, status: 'failed', reason: 'cancelled' },
        1024,
      ),
    ).toEqual({ status: 'failed', reason: 'cancelled' });
  });
});
