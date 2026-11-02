import { z } from 'zod';
import {
  materialBatchInputSchema,
  type MaterialBatchInput,
} from '../../../contracts/materials';
import type { WecomMessage } from '../../integrations/wecom/protocol';
import { describeWecomDelivery } from './message';

const targetSchema = z.strictObject({
  evaluationNodeId: materialBatchInputSchema.shape.evaluationNodeId,
  personIds: materialBatchInputSchema.shape.personIds.min(1),
  projectId: materialBatchInputSchema.shape.projectId,
});
type TextBatchPreparation =
  | { status: 'ready'; input: MaterialBatchInput }
  | {
      status: 'unavailable';
      reason: 'target_required' | 'archive_required' | 'single_text_required';
    };

/** Pure preparation, never authentication or a durable receipt. The receiver
 * must obtain current identity and this complete target from server readers in
 * the same transaction as the actual producer. A parsed message is not a grant.
 * Only one plain text part is supported until trusted media archival is wired. */
export function prepareWecomTextBatch(
  message: WecomMessage,
  serverTarget: unknown,
): TextBatchPreparation {
  const delivery = describeWecomDelivery(message);
  const target = targetSchema.safeParse(serverTarget);
  if (!target.success)
    return { status: 'unavailable', reason: 'target_required' };
  if (message.parts.some((part) => part.kind !== 'text'))
    return { status: 'unavailable', reason: 'archive_required' };
  const part = message.parts[0];
  if (message.parts.length !== 1 || part?.kind !== 'text')
    return { status: 'unavailable', reason: 'single_text_required' };
  return {
    status: 'ready',
    input: materialBatchInputSchema.parse({
      ...target.data,
      operationId: `wecom:text:${delivery.key}`,
      text: part.text,
      files: [],
    }),
  };
}
