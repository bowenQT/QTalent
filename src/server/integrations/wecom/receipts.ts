import { z } from 'zod';
import { buildEntryDeepLink } from '../../../contracts/entry-links';
import { WecomError, type WecomMessage } from './protocol';
const receiptSchema = z.strictObject({
  batchId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  status: z.enum([
    'processing',
    'needs_review',
    'awaiting_confirmation',
    'failed',
  ]),
});
export type WecomBatchReceipt = z.infer<typeof receiptSchema>;
export type WecomAction = Readonly<
  | { kind: 'receive' }
  | { kind: 'group_ack' }
  | { kind: 'private_receipt'; batchId: string; expectedRevision: number }
>;
export function validateWebOrigin(origin: unknown): string {
  try {
    if (typeof origin !== 'string' || /[\s\x00-\x1f\x7f]/.test(origin))
      throw new Error();
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.origin !== origin ||
      !/^[a-zA-Z0-9.-]+$/.test(url.hostname)
    )
      throw new Error();
    return origin;
  } catch {
    throw new WecomError('invalid_config');
  }
}
export function groupAcknowledgement(message: WecomMessage) {
  if (message.source.chatType !== 'group')
    throw new WecomError('invalid_frame');
  return {
    cmd: 'aibot_respond_msg' as const,
    requestId: message.requestId,
    action: Object.freeze({ kind: 'group_ack' as const }),
    body: {
      msgtype: 'stream',
      stream: {
        id: `ack_${message.source.messageKey.slice(-32)}`,
        finish: true,
        content: '收到了',
      },
    },
  };
}
/** Only lookup metadata from the existing 903 relative-link builder. No access token or source payload. */
export function privateBatchReceipt(
  message: WecomMessage,
  input: WecomBatchReceipt,
  origin: string,
) {
  const checked = receiptSchema.safeParse(input);
  if (!checked.success) throw new WecomError('invalid_frame');
  const receipt = checked.data;
  const labels = {
    processing: '材料处理中',
    needs_review: '材料需要核对',
    awaiting_confirmation: '材料待确认',
    failed: '材料处理失败',
  } as const;
  const href =
    validateWebOrigin(origin) +
    buildEntryDeepLink({
      kind: 'material_batch',
      id: receipt.batchId,
      expectedRevision: receipt.revision,
    });
  return {
    cmd: 'aibot_send_msg' as const,
    action: Object.freeze({
      kind: 'private_receipt' as const,
      batchId: receipt.batchId,
      expectedRevision: receipt.revision,
    }),
    body: {
      chatid: message.source.senderId,
      msgtype: 'markdown',
      markdown: { content: `${labels[receipt.status]}\n[打开批次](${href})` },
    },
  };
}
