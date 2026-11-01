import type { Database } from '../../db/client';
import { createInitialImageDisclosureReader } from '../media-initial-image';
import {
  createImageDisclosureGate,
  type ImageGateDependencies,
} from './policy';

/** Initial-image lane only. Current permission is always read from PostgreSQL;
 * no caller-supplied loadCurrent or authorization snapshot can replace it.
 * Each reader call commits before object I/O, native crop or model I/O.
 * Object bytes still require an explicitly supplied bounded storage reader.
 */
export function createNativeInitialImageGate(
  db: Database,
  dependencies: Omit<ImageGateDependencies, 'loadCurrent'>,
) {
  return createImageDisclosureGate({
    ...dependencies,
    loadCurrent: createInitialImageDisclosureReader(db),
  });
}
