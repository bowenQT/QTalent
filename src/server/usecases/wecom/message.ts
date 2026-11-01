import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  wecomIdSchema,
  wecomLimits,
  wecomMessageKey,
  type WecomMessage,
} from '../../integrations/wecom/protocol';

export class WecomDeliveryConflict extends Error {
  constructor() {
    super('wecom_delivery_conflict');
    this.name = 'WecomDeliveryConflict';
  }
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceSchema = z.strictObject({
  scope: wecomIdSchema,
  botId: wecomIdSchema,
  senderId: wecomIdSchema,
  messageId: wecomIdSchema,
  messageKey: z.string(),
  chatType: z.enum(['single', 'group']),
  chatId: wecomIdSchema.nullable(),
});
const partSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    text: z.string().min(1).max(20_480).regex(/\S/),
  }),
  z.strictObject({
    kind: z.enum(['image', 'file']),
    url: z.string().min(1).max(4096),
    aesKey: z.string().min(1).max(100),
  }),
]);

/** A pure descriptor, NOT transport proof or authorization. Only the verified
 * WS receiver may call persistence after903/current domain checks. */
export function describeWecomDelivery(message: WecomMessage) {
  const source = sourceSchema.parse(message.source);
  if (
    source.messageKey !==
      wecomMessageKey(source.scope, source.botId, source.messageId) ||
    (source.chatType === 'group' && source.chatId === null)
  )
    throw new WecomDeliveryConflict();
  const parts = z
    .array(partSchema)
    .min(1)
    .max(wecomLimits.maxParts)
    .parse(message.parts);
  const key = digest([
    source.scope,
    source.botId,
    source.senderId,
    source.messageId,
  ]);
  // Request ACK ids and expiring URLs/keys are delivery capabilities, not durable
  // identities. Media integrity is separately checked against archived plaintext
  // hashes; this digest never claims to prove that two media bodies are equal.
  const inputDigest = digest({
    chatType: source.chatType,
    chatId: source.chatId,
    parts: parts.map((part) =>
      part.kind === 'text'
        ? { kind: part.kind, text: part.text }
        : { kind: part.kind },
    ),
  });
  return Object.freeze({ key, inputDigest, partCount: parts.length });
}

const receiptSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('group_ack') }),
  z.strictObject({
    kind: z.literal('private_receipt'),
    batchId: wecomIdSchema,
    revision: z.number().int().positive().safe(),
    status: z.enum([
      'processing',
      'needs_review',
      'awaiting_confirmation',
      'failed',
    ]),
  }),
]);
export type WecomReceiptFact = z.infer<typeof receiptSchema>;
export function describeWecomReceipt(
  messageKey: string,
  raw: WecomReceiptFact,
) {
  const key = sha.parse(messageKey);
  const receipt = receiptSchema.parse(raw);
  return {
    //845's batch revision tracks draft content, not every processing transition.
    // Deduplicate each safe status separately; a processing receipt cannot consume
    // the later awaiting-confirmation notification at the same batch revision.
    key: digest([
      key,
      receipt.kind,
      receipt.kind === 'private_receipt' ? receipt.batchId : null,
      receipt.kind === 'private_receipt' ? receipt.revision : null,
      receipt.kind === 'private_receipt' ? receipt.status : null,
    ]),
    fingerprint: digest(receipt),
    receipt,
  };
}

export type StoredWecomReceiptAttempt = {
  fingerprint: string;
  state: 'reserved' | 'acknowledged' | 'outcome_unknown';
};
/** The caller durably reserves BEFORE sending and checks current identity again.
 * A previous reservation may have reached the provider before a crash: retrying
 * it cannot be called exactly-once. No automatic resend from either unknown state. */
export function planWecomReceiptAttempt(
  previous: StoredWecomReceiptAttempt | null,
  fingerprint: string,
): 'reserve' | 'acknowledged' | 'outcome_unknown' {
  sha.parse(fingerprint);
  if (previous === null) return 'reserve';
  const stored = z
    .strictObject({
      fingerprint: sha,
      state: z.enum(['reserved', 'acknowledged', 'outcome_unknown']),
    })
    .parse(previous);
  if (stored.fingerprint !== fingerprint) throw new WecomDeliveryConflict();
  return stored.state === 'acknowledged' ? 'acknowledged' : 'outcome_unknown';
}
