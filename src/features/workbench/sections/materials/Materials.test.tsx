// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import { sampleReceipt } from '@/app/dev/workbench/SampleMaterials';
import type { MaterialBatchReceipt } from '@/contracts/materials';
import {
  MaterialsPortProvider,
  type MaterialsPort,
  type SubmitOutcome,
  type UploadOutcome,
} from './materials-port';
import { MaterialsCards, MaterialsFold } from './Materials';
import { POLL_MS } from './use-batches';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  location.hash = '';
});

type Deferred<T> = {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

/** A port whose every call waits until the test answers it. */
function manualPort() {
  const uploads: {
    file: File;
    progress: (percent: number) => void;
    signal: AbortSignal;
    answer: Deferred<UploadOutcome>;
  }[] = [];
  const submits: {
    input: Parameters<MaterialsPort['submit']>[0];
    answer: Deferred<SubmitOutcome>;
  }[] = [];
  const reads: {
    batchId: string;
    answer: Deferred<MaterialBatchReceipt | null>;
  }[] = [];
  const port: MaterialsPort = {
    upload: (file, progress, signal) =>
      new Promise((resolve, reject) =>
        uploads.push({ file, progress, signal, answer: { resolve, reject } }),
      ),
    submit: (input) =>
      new Promise((resolve, reject) =>
        submits.push({ input, answer: { resolve, reject } }),
      ),
    read: (batchId) =>
      new Promise((resolve, reject) =>
        reads.push({ batchId, answer: { resolve, reject } }),
      ),
  };
  return { port, uploads, submits, reads };
}

const doc = (name: string, size = 10) =>
  new File(['x'.repeat(size)], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

function choose(files: File[]) {
  const input = document.querySelector<HTMLInputElement>(
    '#upload input[type=file]',
  )!;
  fireEvent.change(input, { target: { files } });
}

function mount(port: MaterialsPort | null, mentor = false) {
  const body = mentor ? <MaterialsFold /> : <MaterialsCards />;
  return render(
    <ToastProvider>
      {port ? (
        <MaterialsPortProvider port={port}>{body}</MaterialsPortProvider>
      ) : (
        body
      )}
    </ToastProvider>,
  );
}

const batchCard = () => document.querySelector<HTMLElement>('.n-dropbatch')!;
const head = () => batchCard().querySelector('.n-rstate')!.textContent;
const task = () => document.querySelector<HTMLElement>('#tasks .n-task')!;

describe('materials without a backend', () => {
  it('HR: both cards say 待接入, the drop zone is inert, no counts or progress', () => {
    const { container } = mount(null);
    expect(
      [...container.querySelectorAll('h3')].map((title) => title.textContent),
    ).toEqual(['进行中的任务', '上传材料']);
    expect(screen.getAllByText('待接入')).toHaveLength(2);
    const zone = screen.getByRole('button', { name: /拖入文件/ });
    expect(zone.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('input[type=file]')).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      container.querySelector('[role=progressbar], .n-task, .n-dropbatch'),
    ).toBeNull();
    expect(container.textContent).not.toMatch(/\d+ 个/);
  });

  it('mentor: the fold has no count and opens from the clip link', () => {
    const { container } = mount(null, true);
    const fold = container.querySelector<HTMLDetailsElement>('details#fold')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('材料与任务');
    act(() => {
      location.hash = '#upload';
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(fold.open).toBe(true);
  });

  it('mentor: opens at once when the page is opened at #upload', () => {
    location.hash = '#upload';
    const { container } = mount(null, true);
    expect(
      container.querySelector<HTMLDetailsElement>('details#fold')!.open,
    ).toBe(true);
  });
});

describe('materials with a backend', () => {
  it('uploads with progress, submits once, and reads the receipt until it settles', async () => {
    vi.useFakeTimers();
    const { port, uploads, submits, reads } = manualPort();
    mount(port);
    expect(screen.getByText('投递的材料会出现在这里')).toBeTruthy();
    choose([doc('纪要.docx'), doc('评审.docx'), doc('现场.heic')]);

    expect(uploads).toHaveLength(2);
    expect(within(batchCard()).getByText('本次投递 · 3 个文件')).toBeTruthy();
    expect(batchCard().textContent).toContain('待换文件 · 暂不支持 .heic 格式');
    act(() => uploads[0].progress(55.4));
    expect(
      within(batchCard())
        .getByRole('progressbar', { name: '纪要.docx 上传中' })
        .getAttribute('aria-valuenow'),
    ).toBe('55');
    expect(task().textContent).toContain(
      '上传中 · 3 个文件 · 2 个上传中 · 1 个待换文件',
    );

    await act(async () =>
      uploads[0].answer.resolve({ status: 'uploaded', uploadId: 'u-1' }),
    );
    expect(submits).toHaveLength(0);
    await act(async () =>
      uploads[1].answer.resolve({ status: 'uploaded', uploadId: 'u-2' }),
    );
    expect(submits).toHaveLength(1);
    expect(submits[0].input.files.map((file) => file.uploadId)).toEqual([
      'u-1',
      'u-2',
    ]);
    expect(task().textContent).toContain('提交中');

    const ids = submits[0].input.files.map((file, index) => ({
      clientFileId: file.clientFileId,
      filename: ['纪要.docx', '评审.docx'][index],
    }));
    await act(async () =>
      submits[0].answer.resolve({
        status: 'accepted',
        receipt: sampleReceipt('batch-1', ids, false),
      }),
    );
    expect(head()).toBe('处理中');
    expect(task().textContent).toContain('处理中 · 2 个文件 · 2 个处理中');

    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(reads.map((read) => read.batchId)).toEqual(['batch-1']);
    // Nothing readable right now: the next read is still scheduled.
    await act(async () => reads[0].answer.resolve(null));
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(reads).toHaveLength(2);
    await act(async () =>
      reads[1].answer.resolve(sampleReceipt('batch-1', ids, true)),
    );
    expect(head()).toBe('待核对');
    expect(batchCard().textContent).toContain('已解析 · 可以定位到原文');
    expect(batchCard().textContent).toContain('待核对 · 1 处');
    expect(task().textContent).toContain(
      '待核对 · 2 个文件 · 0 件事 · 1 处待核对',
    );
    await act(async () => vi.advanceTimersByTime(POLL_MS * 3));
    expect(reads).toHaveLength(2);
  });

  it('cancels a file while it uploads, and the rest still goes', async () => {
    const { port, uploads, submits } = manualPort();
    mount(port);
    choose([doc('一.docx'), doc('二.docx')]);
    const row = within(batchCard())
      .getByText('一.docx')
      .closest('.n-file') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '取消上传' }));
    expect(uploads[0].signal.aborted).toBe(true);
    expect(row.textContent).toContain('已取消 · 已移出本次投递');
    // A late answer for the canceled transfer changes nothing.
    await act(async () =>
      uploads[0].answer.resolve({ status: 'uploaded', uploadId: 'late' }),
    );
    await act(async () =>
      uploads[1].answer.resolve({ status: 'uploaded', uploadId: 'u-2' }),
    );
    expect(submits[0].input.files.map((file) => file.uploadId)).toEqual([
      'u-2',
    ]);
  });

  it('retries an interrupted upload with the same file, or lets it go', async () => {
    const { port, uploads, submits } = manualPort();
    mount(port);
    choose([doc('一.docx'), doc('二.docx')]);
    await act(async () =>
      uploads[0].answer.resolve({
        status: 'interrupted',
        message: '连接中断，可以重试',
      }),
    );
    await act(async () => uploads[1].answer.reject(new Error('network')));
    expect(head()).toBe('上传中断');
    expect(submits).toHaveLength(0);
    const [first, second] = [
      ...batchCard().querySelectorAll<HTMLElement>('.n-file'),
    ];
    expect(second.textContent).toContain('连接中断，可以重试');
    fireEvent.click(within(first).getByRole('button', { name: '重试' }));
    expect(uploads).toHaveLength(3);
    expect(uploads[2].file.name).toBe('一.docx');
    fireEvent.click(within(second).getByRole('button', { name: '取消上传' }));
    await act(async () =>
      uploads[2].answer.resolve({ status: 'uploaded', uploadId: 'u-1' }),
    );
    expect(submits).toHaveLength(1);
    expect(submits[0].input.files.map((file) => file.uploadId)).toEqual([
      'u-1',
    ]);
  });

  it('ends without submitting when the server rejects every file', async () => {
    const { port, uploads, submits } = manualPort();
    mount(port);
    choose([doc('一.docx')]);
    await act(async () =>
      uploads[0].answer.resolve({
        status: 'rejected',
        message: '文件内容和扩展名对不上',
      }),
    );
    expect(submits).toHaveLength(0);
    expect(head()).toBe('已结束');
    expect(batchCard().textContent).toContain(
      '待换文件 · 文件内容和扩展名对不上',
    );
  });

  it('resubmits an interrupted submission with the same operation', async () => {
    const { port, uploads, submits } = manualPort();
    mount(port);
    choose([doc('一.docx')]);
    await act(async () =>
      uploads[0].answer.resolve({ status: 'uploaded', uploadId: 'u-1' }),
    );
    await act(async () =>
      submits[0].answer.resolve({
        status: 'interrupted',
        message: '服务暂时不可用',
      }),
    );
    expect(head()).toBe('提交中断');
    expect(batchCard().textContent).toContain('服务暂时不可用');
    fireEvent.click(
      within(batchCard()).getByRole('button', { name: '重新提交' }),
    );
    expect(submits).toHaveLength(2);
    expect(submits[1].input.operationId).toBe(submits[0].input.operationId);
    await act(async () => submits[1].answer.reject(new Error('network')));
    expect(batchCard().textContent).toContain('连接中断，可以重新提交');
  });

  it('keeps the first ten files and says how many to choose again', () => {
    const { port, uploads } = manualPort();
    mount(port);
    choose(Array.from({ length: 12 }, (_, index) => doc(`${index + 1}.docx`)));
    expect(uploads).toHaveLength(10);
    expect(screen.getByRole('status').textContent).toContain(
      '其余 2 个请再选一次',
    );
  });

  it('mentor: counts batches in progress on this page, never a 0', async () => {
    const { port, uploads } = manualPort();
    const { container } = mount(port, true);
    const summary = container.querySelector('summary')!;
    expect(summary.textContent).toBe('材料与任务');
    choose([doc('一.docx')]);
    expect(summary.textContent).toBe('材料与任务1 个在处理');
    await act(async () =>
      uploads[0].answer.resolve({ status: 'rejected', message: '格式不对' }),
    );
    expect(summary.textContent).toBe('材料与任务');
  });

  it('stops transfers when the page goes away', () => {
    const { port, uploads } = manualPort();
    const page = mount(port);
    choose([doc('一.docx')]);
    page.unmount();
    expect(uploads[0].signal.aborted).toBe(true);
  });
});
