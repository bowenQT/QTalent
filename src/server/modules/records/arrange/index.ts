import {
  MAAS_MODEL,
  type StructuredMaasClient,
} from '../../../integrations/maas';
import { prepareArrange, type PreparedArrange } from './prepare';
import { arrangeMessages, RECORD_ARRANGE_PROMPT_VERSION } from './prompt';
import {
  modelArrangementSchema,
  type ArrangeOutcome,
  type LoadArrangeSnapshot,
} from './schema';
import { validateArrangement } from './validate';
export * from './schema';
export { prepareArrange, type PreparedArrange } from './prepare';
export { RECORD_ARRANGE_PROMPT_VERSION } from './prompt';
/** Exactly one adapter call. Compose a real transport with maxAttempts:1. */
export async function executePreparedArrange(
  prepared: PreparedArrange,
  client: StructuredMaasClient,
  signal?: AbortSignal,
): Promise<ArrangeOutcome> {
  try {
    const result = await client.generateStructured({
      messages: arrangeMessages(prepared),
      promptVersion: RECORD_ARRANGE_PROMPT_VERSION,
      schema: modelArrangementSchema,
      signal,
    });
    if (!result.ok)
      return {
        status: 'failed',
        failure: {
          kind: result.kind,
          retryable: result.kind === 'network' && result.retryable,
        },
      };
    if (
      result.metadata.promptVersion !== RECORD_ARRANGE_PROMPT_VERSION ||
      result.metadata.model !== MAAS_MODEL
    )
      return {
        status: 'failed',
        failure: { kind: 'invalid_response', retryable: false },
      };
    return validateArrangement(prepared, result.value);
  } catch {
    // An unexpected transport exception cannot prove that nothing was sent.
    return {
      status: 'failed',
      failure: { kind: 'outcome_unknown', retryable: false },
    };
  }
}
export async function arrangeRecord(
  load: LoadArrangeSnapshot,
  client: StructuredMaasClient,
  signal?: AbortSignal,
): Promise<ArrangeOutcome> {
  const snapshot = await load();
  if (!snapshot) return { status: 'not_found' };
  const prepared = await prepareArrange(snapshot);
  return prepared.status === 'ready'
    ? executePreparedArrange(prepared, client, signal)
    : prepared;
}
