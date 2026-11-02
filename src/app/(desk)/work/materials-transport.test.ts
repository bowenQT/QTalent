import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleReceipt } from '@/app/dev/workbench/SampleMaterials';
import { MATERIAL_ROUTES, materialsTransport } from './materials-transport';

const respond = (body: unknown, init: { redirected?: boolean } = {}) => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const response = new Response(JSON.stringify(body));
    Object.defineProperty(response, 'redirected', {
      value: init.redirected ?? false,
    });
    return response;
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};

afterEach(() => vi.unstubAllGlobals());

describe('materialsTransport', () => {
  it('posts the upload declaration and parses the grant answer', async () => {
    const fetcher = respond({
      status: 'unsupported',
      reason: 'format',
      message: '请上传文字型 PDF',
    });
    const declaration = {
      purpose: 'attachment' as const,
      filename: '演示.pdf',
      declaredBytes: 10,
      declaredMediaType: 'application/pdf',
      operationId: 'op-1',
    };
    const signal = new AbortController().signal;
    expect(await materialsTransport.requestUpload(declaration, signal)).toEqual(
      { status: 'unsupported', reason: 'format', message: '请上传文字型 PDF' },
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(MATERIAL_ROUTES.uploads);
    expect(init).toMatchObject({ method: 'POST', signal });
    expect(JSON.parse(String(init!.body))).toEqual(declaration);
  });

  it('posts the completion with the upload it completes', async () => {
    const fetcher = respond({ status: 'staged', uploadId: 'u/1' });
    const input = {
      uploadId: 'u/1',
      receiptRef: 'hash',
      operationId: 'op-2',
      expectedRevision: 1,
    };
    expect(
      await materialsTransport.completeUpload(
        input,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'staged', uploadId: 'u/1' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/record/uploads/complete');
    expect(JSON.parse(String(init!.body))).toEqual(input);
    respond({ status: 'not_found', message: '上传已过期' });
    expect(
      await materialsTransport.completeUpload(
        input,
        new AbortController().signal,
      ),
    ).toEqual({ status: 'failed', message: '上传已过期' });
  });

  it('maps batch answers, including no evaluation node in progress', async () => {
    const input = { operationId: 'op-3', files: [] };
    const receipt = sampleReceipt(
      'b-1',
      [{ clientFileId: 'c-1', filename: '演示访谈.docx' }],
      false,
    );
    respond({ status: 'success', replayed: true, result: receipt });
    expect(await materialsTransport.submitBatch(input)).toEqual({
      status: 'success',
      receipt,
    });
    respond({ status: 'no_active_node', message: 'no node' });
    expect(await materialsTransport.submitBatch(input)).toEqual({
      status: 'no_active_node',
    });
    respond({ status: 'forbidden', message: '这批材料由导师提交' });
    expect(await materialsTransport.submitBatch(input)).toEqual({
      status: 'declined',
      message: '这批材料由导师提交',
    });
    respond({ status: 'validation_error', fieldErrors: {} });
    expect((await materialsTransport.submitBatch(input)).status).toBe(
      'declined',
    );
  });

  it('treats a sign-in redirect or an unknown body as a lost connection', async () => {
    const input = { operationId: 'op-4', files: [] };
    respond({ status: 'success' }, { redirected: true });
    await expect(materialsTransport.submitBatch(input)).rejects.toThrow();
    respond({ unexpected: true });
    await expect(materialsTransport.submitBatch(input)).rejects.toThrow();
  });

  it('reads the batch through the existing record read', async () => {
    const fetcher = respond({ status: 'not_found', message: '找不到这批材料' });
    expect(await materialsTransport.readBatch('b 1')).toEqual({
      status: 'not_found',
      message: '找不到这批材料',
    });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/record/batches/b%201');
  });
});
