import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleReceipt } from '@/app/dev/workbench/SampleMaterials';
import { MATERIAL_ROUTES, materialsTransport } from './materials-transport';

const { arrange } = vi.hoisted(() => ({ arrange: vi.fn() }));
vi.mock('@/server/actions/record-arrange', () => ({
  startRecordArrangeAction: arrange,
}));

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
      recordCollectionId: 'collection-1',
      target: { kind: 'unassigned' as const, evaluationNodeId: 'node-1' },
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
    const fetcher = respond({
      status: 'success',
      result: {
        status: 'staged',
        uploadId: 'u/1',
        recordCollectionId: 'collection-1',
        originalId: 'original-1',
        originalVersionId: 'version-1',
        source: null,
        revision: 2,
      },
    });
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

  it('opens a collection, and says when the server finds no single node', async () => {
    const fetcher = respond({
      status: 'success',
      recordCollectionId: 'collection-1',
      evaluationNodeId: 'node-1',
      expiresAt: '2026-11-03T12:00:00.000Z',
    });
    expect(
      await materialsTransport.openCollection({ operationId: 'op-0' }),
    ).toEqual({
      status: 'ready',
      collection: {
        recordCollectionId: 'collection-1',
        evaluationNodeId: 'node-1',
      },
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/record/uploads/collections');
    expect(JSON.parse(String(init!.body))).toEqual({ operationId: 'op-0' });
    respond({ status: 'default_node_missing' });
    expect(
      (await materialsTransport.openCollection({ operationId: 'op-0' })).status,
    ).toBe('node_missing');
    respond({ status: 'default_node_ambiguous', message: 'tie' });
    expect(
      (await materialsTransport.openCollection({ operationId: 'op-0' })).status,
    ).toBe('node_ambiguous');
    respond({ status: 'validation_error', fieldErrors: {}, input: {} });
    expect(
      (await materialsTransport.openCollection({ operationId: 'op-0' })).status,
    ).toBe('failed');
    respond({ status: 'forbidden', message: '只有 HR 和导师可以上传' });
    expect(
      await materialsTransport.openCollection({ operationId: 'op-0' }),
    ).toEqual({ status: 'failed', message: '只有 HR 和导师可以上传' });
  });

  it('submits a files-only batch and maps the answers', async () => {
    const files = [{ clientFileId: 'c-1', uploadId: 'u-1' }];
    const input = { operationId: 'op-3', files };
    const receipt = sampleReceipt(
      'b-1',
      [{ clientFileId: 'c-1', filename: '演示访谈.docx' }],
      false,
    );
    arrange.mockResolvedValueOnce({
      status: 'success',
      replayed: false,
      result: receipt,
    });
    expect(await materialsTransport.submitBatch(input)).toEqual({
      status: 'success',
      receipt,
    });
    expect(arrange).toHaveBeenCalledWith({
      operationId: 'op-3',
      personIds: [],
      projectId: null,
      text: '',
      files,
    });
    arrange.mockResolvedValueOnce({
      status: 'validation_error',
      fieldErrors: { evaluationNodeId: ['没有进行中的节点'] },
      input: {},
    });
    expect(await materialsTransport.submitBatch(input)).toEqual({
      status: 'node_unresolved',
    });
    arrange.mockResolvedValueOnce({
      status: 'validation_error',
      fieldErrors: { files: ['文件已失效'] },
      input: {},
    });
    expect((await materialsTransport.submitBatch(input)).status).toBe(
      'declined',
    );
    arrange.mockResolvedValueOnce({
      status: 'forbidden',
      message: '这批材料由导师提交',
    });
    expect(await materialsTransport.submitBatch(input)).toEqual({
      status: 'declined',
      message: '这批材料由导师提交',
    });
  });

  it('treats a sign-in redirect or an unknown body as a lost connection', async () => {
    const input = { operationId: 'op-4' };
    respond({ status: 'success' }, { redirected: true });
    await expect(materialsTransport.openCollection(input)).rejects.toThrow();
    respond({ unexpected: true });
    await expect(materialsTransport.openCollection(input)).rejects.toThrow();
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
