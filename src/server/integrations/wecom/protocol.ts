import { createHash } from 'node:crypto';
import { z } from 'zod';
export const WECOM_WS_URL = 'wss://openws.work.weixin.qq.com';
export const WECOM_PROTOCOL_REFERENCE =
  '80615b987ef69c6028ad764924609247c0725955';
export const wecomLimits = {
  maxFrameBytes: 128 * 1024,
  maxParts: 20,
  maxQueuedMessages: 32,
  maxQueuedSends: 32,
  maxMediaBytes: 32 * 1024 * 1024,
} as const;
export class WecomError extends Error {
  constructor(
    readonly kind:
      | 'invalid_config'
      | 'invalid_frame'
      | 'unsupported_message'
      | 'authentication_failed'
      | 'ack_failed'
      | 'timeout'
      | 'closed'
      | 'forbidden'
      | 'unavailable'
      | 'queue_full'
      | 'invalid_media'
      | 'media_limit'
      | 'unsafe_url'
      | 'download_failed',
  ) {
    super(`WeCom: ${kind}`);
    this.name = 'WecomError';
  }
}
export const wecomIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const media = z.object({
  url: z.string().min(1).max(4096),
  aeskey: z.string().min(1).max(100),
});
const text = z.object({ content: z.string().min(1).max(20_480).regex(/\S/) });
const item = z.discriminatedUnion('msgtype', [
  z.object({ msgtype: z.literal('text'), text }),
  z.object({ msgtype: z.literal('image'), image: media }),
]);
const base = z.object({
  msgid: wecomIdSchema,
  aibotid: wecomIdSchema,
  from: z.object({ userid: wecomIdSchema }),
  chattype: z.enum(['single', 'group']),
  chatid: wecomIdSchema.optional(),
});
const messageBody = z.discriminatedUnion('msgtype', [
  base.extend({ msgtype: z.literal('text'), text }),
  base.extend({ msgtype: z.literal('image'), image: media }),
  base.extend({ msgtype: z.literal('file'), file: media }),
  base.extend({
    msgtype: z.literal('mixed'),
    mixed: z.object({
      msg_item: z.array(item).min(1).max(wecomLimits.maxParts),
    }),
  }),
]);
const envelope = z.object({
  cmd: z.string().max(64).optional(),
  headers: z.object({ req_id: wecomIdSchema }),
  body: z.unknown().optional(),
  errcode: z.number().int().min(-2147483648).max(2147483647).optional(),
});
export type WecomPart = Readonly<
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'file'; url: string; aesKey: string }
>;
export type WecomSource = Readonly<{
  scope: string;
  botId: string;
  messageId: string;
  messageKey: string;
  senderId: string;
  chatType: 'single' | 'group';
  chatId: string | null;
}>;
export type WecomMessage = Readonly<{
  requestId: string;
  source: WecomSource;
  parts: readonly WecomPart[];
}>;
export type WecomFrame =
  | { kind: 'ack'; requestId: string; code: number }
  | { kind: 'message'; message: WecomMessage }
  | { kind: 'disconnected' }
  | { kind: 'ignored' };
/** A stable domain-operation key, not an in-memory or persistent exactly-once ledger. */
export function wecomMessageKey(
  scope: string,
  botId: string,
  messageId: string,
): string {
  if (
    ![scope, botId, messageId].every((v) => wecomIdSchema.safeParse(v).success)
  )
    throw new WecomError('invalid_config');
  return `wecom:${createHash('sha256')
    .update(JSON.stringify([scope, botId, messageId]))
    .digest('hex')}`;
}
export function parseWecomFrame(
  raw: string | Uint8Array,
  expected: { scope: string; botId: string },
): WecomFrame {
  try {
    if (
      (typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength) >
      wecomLimits.maxFrameBytes
    )
      throw new WecomError('invalid_frame');
    const value: unknown = JSON.parse(
      typeof raw === 'string'
        ? raw
        : new TextDecoder('utf-8', { fatal: true }).decode(raw),
    );
    const frame = envelope.parse(value);
    if (!frame.cmd) {
      if (frame.errcode === undefined) throw new WecomError('invalid_frame');
      return {
        kind: 'ack',
        requestId: frame.headers.req_id,
        code: frame.errcode,
      };
    }
    if (frame.cmd === 'aibot_event_callback') {
      const event = z
        .object({ event: z.object({ eventtype: z.string() }) })
        .parse(frame.body);
      return {
        kind:
          event.event.eventtype === 'disconnected_event'
            ? 'disconnected'
            : 'ignored',
      };
    }
    if (frame.cmd !== 'aibot_msg_callback') return { kind: 'ignored' };
    const type = z.object({ msgtype: z.string() }).parse(frame.body).msgtype;
    if (!['text', 'image', 'file', 'mixed'].includes(type))
      throw new WecomError('unsupported_message');
    const body = messageBody.parse(frame.body);
    if (
      body.aibotid !== expected.botId ||
      (body.chattype === 'group' && !body.chatid)
    )
      throw new WecomError('invalid_frame');
    const source: WecomSource = Object.freeze({
      scope: expected.scope,
      botId: expected.botId,
      messageId: body.msgid,
      messageKey: wecomMessageKey(expected.scope, expected.botId, body.msgid),
      senderId: body.from.userid,
      chatType: body.chattype,
      chatId: body.chattype === 'group' ? body.chatid! : null,
    });
    const toPart = (part: z.infer<typeof item>): WecomPart =>
      part.msgtype === 'text'
        ? Object.freeze({ kind: 'text', text: part.text.content })
        : Object.freeze({
            kind: 'image',
            url: part.image.url,
            aesKey: part.image.aeskey,
          });
    const parts: WecomPart[] =
      body.msgtype === 'mixed'
        ? body.mixed.msg_item.map(toPart)
        : body.msgtype === 'text'
          ? [Object.freeze({ kind: 'text', text: body.text.content })]
          : [
              Object.freeze({
                kind: body.msgtype,
                url: body.msgtype === 'image' ? body.image.url : body.file.url,
                aesKey:
                  body.msgtype === 'image'
                    ? body.image.aeskey
                    : body.file.aeskey,
              }),
            ];
    return {
      kind: 'message',
      message: Object.freeze({
        requestId: frame.headers.req_id,
        source,
        parts: Object.freeze(parts),
      }),
    };
  } catch (error) {
    throw error instanceof WecomError ? error : new WecomError('invalid_frame');
  }
}
