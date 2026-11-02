import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ storage: null as unknown, fail: false }));
vi.mock('./kodo-upload-storage', () => ({
  kodoUploadStorageFromEnv: () => {
    if (h.fail) throw new Error('malformed deployment value');
    return h.storage;
  },
}));

import {
  materialUploadHandlersForServer,
  stageMaterialUpload,
} from './material-upload-runtime';
import { kodoUploadStorageFromEnv } from './kodo-upload-storage';

const staging = {
  purpose: 'image' as const,
  uploadId: 'upload-1',
  recordCollectionId: 'collection-1',
  originalId: 'original-1',
  originalVersionId: 'version-1',
  accountId: 'account',
  quotaScope: 'collection-1',
};

describe('material upload runtime', () => {
  it('stages unassigned uploads without dispatching a job', async () => {
    await expect(
      stageMaterialUpload({} as never, {
        ...staging,
        target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
      }),
    ).resolves.toEqual({ jobId: 'staged:upload-1' });
    await expect(
      stageMaterialUpload({} as never, {
        ...staging,
        target: { kind: 'people', personIds: ['demo-person-1'] },
      }),
    ).rejects.toThrow();
  });

  it('answers 503 while Kodo is not configured or misconfigured', async () => {
    for (const fail of [false, true]) {
      h.fail = fail;
      const handlers = materialUploadHandlersForServer();
      for (const handler of Object.values(handlers)) {
        const response = await handler(
          new Request('https://app.test/api/record/uploads', {
            method: 'POST',
          }),
        );
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          status: 'unavailable',
          message: '上传服务暂时不可用，请稍后重试',
        });
      }
    }
    h.fail = false;
    expect(kodoUploadStorageFromEnv).toBeTypeOf('function');
  });
});
