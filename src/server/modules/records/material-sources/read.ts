import {
  materialSourceReadResultSchema,
  sourceReadInputSchema,
  type MaterialSourceReadResult,
} from '../../../../contracts/sources';
import {
  readTalentSource,
  type TalentAuthorizationContext,
  type TalentSource,
} from '../../../authz/talent';
import type { Transaction } from '../../../db/client';
import { encodeCanonicalLocation } from './location-codec';
import { MaterialStoreError, readMaterialFragment } from './store';

const missing = (): MaterialSourceReadResult => ({
  status: 'not_found',
  message: '来源不存在或不可见',
});

/** Internal adapter: context and the COMPLETE source union must be loaded by the
 * server in this transaction. Neither is a request DTO or a cached capability.
 * The usecase owns snapshot consistency and audit; this reads no download URL. */
export async function readAuthorizedMaterialSource(
  tx: Transaction,
  facts: { context: TalentAuthorizationContext; sources: TalentSource[] },
  input: unknown,
): Promise<MaterialSourceReadResult> {
  const reference = sourceReadInputSchema.safeParse(input);
  if (!reference.success)
    return {
      status: 'validation_error',
      fieldErrors: { source: ['请提供有效的片段和原件版本'] },
      input: null,
    };
  try {
    const visible = await readTalentSource(
      async () => ({ ...facts, records: [] }),
      reference.data,
    );
    // Do not inspect the parse (or reveal whether it is corrupt) when hidden.
    if (!visible) return missing();
    const canonical = await readMaterialFragment(
      tx,
      reference.data.fragmentId,
      reference.data.originalVersionId,
    );
    if (
      !canonical ||
      canonical.source.fragmentId !== visible.fragmentId ||
      canonical.source.originalVersionId !== visible.originalVersionId ||
      canonical.source.excerpt !== visible.excerpt ||
      encodeCanonicalLocation(canonical.source.location) !==
        encodeCanonicalLocation(visible.location)
    )
      return missing();
    return materialSourceReadResultSchema.parse({
      status: 'success',
      source: canonical.source,
    });
  } catch (error) {
    if (
      error instanceof MaterialStoreError &&
      error.code !== 'storage_unavailable'
    )
      return missing();
    // Raw database messages, quotes, graph subjects and parser diagnostics never
    // cross the public material result boundary.
    return { status: 'conflict', message: '来源暂时不可用，请稍后重试' };
  }
}
