// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  useMaterialsPort,
  type MaterialsPort,
} from '@/features/workbench/sections/materials/materials-port';
import { SampleMaterials, sampleReceipt } from './SampleMaterials';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function portOf(failFirst: boolean) {
  let port: MaterialsPort | null = null;
  function Probe() {
    port = useMaterialsPort();
    return null;
  }
  render(
    <SampleMaterials failFirst={failFirst}>
      <Probe />
    </SampleMaterials>,
  );
  if (!port) throw new Error('no port');
  return port as MaterialsPort;
}
const file = (name: string) => new File(['x'], name);

describe('development materials sample', () => {
  it('uploads in ten steps, submits a processing batch and settles on the first read', async () => {
    vi.useFakeTimers();
    const port = portOf(false);
    const progress: number[] = [];
    const upload = port.upload(
      file('纪要.docx'),
      (percent) => progress.push(percent),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(2000);
    const outcome = await upload;
    expect(progress).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(outcome.status).toBe('uploaded');
    if (outcome.status !== 'uploaded') throw new Error('uploaded');

    const submit = port.submit({
      operationId: 'op',
      files: [{ clientFileId: 'c-1', uploadId: outcome.uploadId }],
    });
    await vi.advanceTimersByTimeAsync(200);
    const accepted = await submit;
    if (accepted.status !== 'accepted') throw new Error('accepted');
    expect(accepted.receipt).toMatchObject({
      batchId: 'b-op',
      status: 'processing',
      files: [{ filename: '纪要.docx', status: 'processing' }],
    });
    expect(await port.read('b-op')).toMatchObject({
      status: 'completed',
      revision: 2,
    });
    expect(await port.read('unknown')).toBeNull();
  });

  it('interrupts only the first transfer when asked to', async () => {
    vi.useFakeTimers();
    const port = portOf(true);
    const progress: number[] = [];
    const first = port.upload(
      file('a.docx'),
      (percent) => progress.push(percent),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toEqual({
      status: 'interrupted',
      message: '连接中断，可以重试',
    });
    expect(progress).toEqual([10, 20, 30, 40, 50]);
    const second = port.upload(
      file('a.docx'),
      () => undefined,
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect((await second).status).toBe('uploaded');
  });

  it('stops a transfer when it is canceled', async () => {
    vi.useFakeTimers();
    const port = portOf(false);
    const controller = new AbortController();
    const upload = port.upload(
      file('a.docx'),
      () => undefined,
      controller.signal,
    );
    const settled = expect(upload).rejects.toThrow('aborted');
    controller.abort();
    await settled;
  });

  it('builds receipts the batch contract accepts', () => {
    const files = ['a', 'b', 'c'].map((id) => ({
      clientFileId: id,
      filename: `${id}.docx`,
    }));
    expect(sampleReceipt('b', files, false).counts.files.processing).toBe(3);
    const settledRun = sampleReceipt('b', files, true);
    expect(settledRun.status).toBe('needs_review');
    expect(settledRun.files.map((entry) => entry.status)).toEqual([
      'parsed',
      'needs_review',
      'failed',
    ]);
    expect(settledRun.items).toHaveLength(1);
    expect(sampleReceipt('b', files.slice(0, 1), true).status).toBe(
      'completed',
    );
  });
});
