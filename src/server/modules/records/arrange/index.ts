import type { StructuredMaasClient } from '../../../integrations/maas';
import type { ArrangeOutcome, ArrangeSnapshot, LoadArrangeSnapshot } from './schema';
export * from './schema';
export async function prepareArrange(_snapshot: ArrangeSnapshot): Promise<unknown> { throw new Error('not implemented'); }
export async function arrangeRecord(_load: LoadArrangeSnapshot, _client: StructuredMaasClient): Promise<ArrangeOutcome> { throw new Error('not implemented'); }
