import { KodoError } from '../../../integrations/kodo';
import { UploadError } from './types';

/** Only the unique storage adapter can classify provider failures. HTTP 400
 * alone cannot distinguish an expired S3 signature from a malformed request.
 * Backend credentials are not the user's session, so never ask them to relogin
 * or forward a provider response/cause. This does not retry or re-sign a read.
 */
export async function readOriginalStorage<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UploadError) throw error;
    if (error instanceof KodoError) {
      switch (error.code) {
        case 'unauthorized':
          throw new UploadError('unavailable', 'original_storage_unauthorized');
        case 'expired':
          throw new UploadError('unavailable', 'original_storage_expired');
        case 'not_found':
          throw new UploadError('not_found', 'original_not_found');
        case 'invalid_input':
          throw new UploadError('validation_error', 'invalid_input');
        case 'invalid_range':
          throw new UploadError('validation_error', 'invalid_range');
      }
    }
    throw new UploadError('unavailable', 'original_storage_unavailable');
  }
}
