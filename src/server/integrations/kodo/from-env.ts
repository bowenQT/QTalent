import { createKodoClient } from './client';

export type KodoEnvironment = Partial<
  Record<
    | 'QINIU_KODO_ENDPOINT'
    | 'QINIU_KODO_S3_REGION'
    | 'QINIU_KODO_UPLOAD_ENDPOINT'
    | 'QINIU_KODO_MANAGEMENT_ENDPOINT'
    | 'QINIU_KODO_ACCESS_KEY'
    | 'QINIU_KODO_SECRET_KEY'
    | 'QINIU_KODO_BUCKET',
    string
  >
>;

/** The deployed Kodo client, or null when the deployment has not configured it.
 * The client validates the values only once all required keys are present.
 */
export function createKodoClientFromEnv(
  environment: KodoEnvironment,
): ReturnType<typeof createKodoClient> | null {
  const value = (name: keyof KodoEnvironment) =>
    environment[name]?.trim() || undefined;
  const endpoint = value('QINIU_KODO_ENDPOINT');
  const uploadEndpoint = value('QINIU_KODO_UPLOAD_ENDPOINT');
  const managementEndpoint = value('QINIU_KODO_MANAGEMENT_ENDPOINT');
  const accessKey = value('QINIU_KODO_ACCESS_KEY');
  const secretKey = value('QINIU_KODO_SECRET_KEY');
  const bucket = value('QINIU_KODO_BUCKET');
  const s3Region = value('QINIU_KODO_S3_REGION');
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
