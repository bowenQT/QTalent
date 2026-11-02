import 'server-only';
import { createKodoClient } from '../integrations/kodo';
import type { UploadStorage } from '../modules/records/uploads/types';

const kodoEnvironment = {
  endpoint: 'QINIU_KODO_ENDPOINT',
  s3Region: 'QINIU_KODO_S3_REGION',
  uploadEndpoint: 'QINIU_KODO_UPLOAD_ENDPOINT',
  managementEndpoint: 'QINIU_KODO_MANAGEMENT_ENDPOINT',
  accessKey: 'QINIU_KODO_ACCESS_KEY',
  secretKey: 'QINIU_KODO_SECRET_KEY',
  bucket: 'QINIU_KODO_BUCKET',
} as const;

/** The deployed Kodo client, or null when the deployment has not configured it. */
export function kodoUploadStorageFromEnv(
  environment: Record<string, string | undefined> = process.env,
): UploadStorage | null {
  const value = (name: string) => environment[name]?.trim() || undefined;
  const endpoint = value(kodoEnvironment.endpoint);
  const uploadEndpoint = value(kodoEnvironment.uploadEndpoint);
  const managementEndpoint = value(kodoEnvironment.managementEndpoint);
  const accessKey = value(kodoEnvironment.accessKey);
  const secretKey = value(kodoEnvironment.secretKey);
  const bucket = value(kodoEnvironment.bucket);
  const s3Region = value(kodoEnvironment.s3Region);
  if (
    !endpoint ||
    !uploadEndpoint ||
    !managementEndpoint ||
    !accessKey ||
    !secretKey ||
    !bucket
  )
    return null;
  return createKodoClient({
    endpoint,
    uploadEndpoint,
    managementEndpoint,
    accessKey,
    secretKey,
    bucket,
    ...(s3Region ? { s3Region } : {}),
  });
}
