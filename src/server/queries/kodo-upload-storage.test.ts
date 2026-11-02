import { describe, expect, it } from 'vitest';
import { kodoUploadStorageFromEnv } from './kodo-upload-storage';

const complete = {
  QINIU_KODO_ENDPOINT: 'https://s3.cn-east-1.qiniucs.com',
  QINIU_KODO_UPLOAD_ENDPOINT: 'https://up.qiniup.com',
  QINIU_KODO_MANAGEMENT_ENDPOINT: 'https://rs.qiniuapi.com',
  QINIU_KODO_ACCESS_KEY: 'synthetic-access-key',
  QINIU_KODO_SECRET_KEY: 'synthetic-secret-key',
  QINIU_KODO_BUCKET: 'demo-bucket',
};

describe('Kodo upload storage from the deployment environment', () => {
  it('builds a client only when every required value is present', () => {
    const storage = kodoUploadStorageFromEnv(complete);
    expect(storage?.issueUploadGrant).toBeTypeOf('function');
    for (const name of Object.keys(complete))
      expect(
        kodoUploadStorageFromEnv({ ...complete, [name]: '  ' }),
      ).toBeNull();
    expect(kodoUploadStorageFromEnv({})).toBeNull();
  });

  it('passes an explicit S3 region through and rejects malformed values', () => {
    expect(
      kodoUploadStorageFromEnv({
        ...complete,
        QINIU_KODO_S3_REGION: 'cn-east-1',
      }),
    ).not.toBeNull();
    expect(() =>
      kodoUploadStorageFromEnv({
        ...complete,
        QINIU_KODO_ENDPOINT: 'not-a-url',
      }),
    ).toThrow();
  });
});
