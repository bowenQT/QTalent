import { describe, expect, it } from 'vitest';
import {
  parseWecomFrame,
  type WecomMessage,
} from '../../integrations/wecom/protocol';
import {
  describeWecomDelivery,
  describeWecomReceipt,
  planWecomReceiptAttempt,
} from './message';
function message(
  overrides: {
    scope?: string;
    botId?: string;
    senderId?: string;
    messageId?: string;
    requestId?: string;
    text?: string;
  } = {},
): WecomMessage {
  const expected = {
    scope: overrides.scope ?? 'scope-demo',
    botId: overrides.botId ?? 'bot-demo',
  };
  const frame = parseWecomFrame(
    JSON.stringify({
      cmd: 'aibot_msg_callback',
      headers: { req_id: overrides.requestId ?? 'request-demo' },
      body: {
        msgid: overrides.messageId ?? 'message-demo',
        aibotid: expected.botId,
        from: { userid: overrides.senderId ?? 'sender-demo' },
        chattype: 'single',
        msgtype: 'text',
        text: { content: overrides.text ?? '材料（演示）' },
      },
    }),
    expected,
  );
  if (frame.kind !== 'message')
    throw new Error('Synthetic protocol fixture invalid');
  return frame.message;
}
describe('persistent WeCom message identity inputs', () => {
  it('a delivery replay with a different ACK id retains the same key and exact text digest', () => {
    expect(describeWecomDelivery(message({ requestId: 'second' }))).toEqual(
      describeWecomDelivery(message()),
    );
  });
  it.each(['scope', 'botId', 'senderId', 'messageId'] as const)(
    'isolates %s',
    (field) => {
      expect(
        describeWecomDelivery(message({ [field]: 'different-demo' })).key,
      ).not.toBe(describeWecomDelivery(message()).key);
    },
  );
  it('does not trim or normalize source text under the same message id', () => {
    const original = describeWecomDelivery(message());
    const changed = describeWecomDelivery(message({ text: ' 材料（演示） ' }));
    expect(changed.key).toBe(original.key);
    expect(changed.inputDigest).not.toBe(original.inputDigest);
  });
  it('rejects an inconsistent protocol source and a missing group id', () => {
    const value = message();
    expect(() =>
      describeWecomDelivery({
        ...value,
        source: { ...value.source, messageKey: 'wrong' },
      }),
    ).toThrow();
    expect(() =>
      describeWecomDelivery({
        ...value,
        source: { ...value.source, chatType: 'group', chatId: null },
      }),
    ).toThrow();
  });
  it('keeps media capabilities out of the descriptor and preserves part ordering', () => {
    const base = message();
    const media: WecomMessage = {
      ...base,
      parts: [
        {
          kind: 'image',
          url: 'https://media.example.invalid/temporary',
          aesKey: 'synthetic-key',
        },
        { kind: 'text', text: '说明（演示）' },
      ],
    };
    const original = describeWecomDelivery(media);
    const renewed = describeWecomDelivery({
      ...media,
      parts: [
        {
          kind: 'image',
          url: 'https://media.example.invalid/renewed',
          aesKey: 'renewed-key',
        },
        media.parts[1],
      ],
    });
    expect(renewed).toEqual(original);
    expect(JSON.stringify(original)).not.toMatch(
      /media\.example|synthetic-key|说明/,
    );
    expect(
      describeWecomDelivery({ ...media, parts: [...media.parts].reverse() })
        .inputDigest,
    ).not.toBe(original.inputDigest);
    expect(
      describeWecomDelivery({
        ...media,
        parts: [
          {
            kind: 'file',
            url: 'https://media.example.invalid/temporary',
            aesKey: 'synthetic-key',
          },
          media.parts[1],
        ],
      }).inputDigest,
    ).not.toBe(original.inputDigest);
  });
  it('validates a nonempty bounded part list', () => {
    const base = message();
    expect(() => describeWecomDelivery({ ...base, parts: [] })).toThrow();
    expect(() =>
      describeWecomDelivery({
        ...base,
        parts: Array.from({ length: 21 }, () => base.parts[0]),
      }),
    ).toThrow();
  });
});
describe('receipt persistence decisions', () => {
  const key = 'a'.repeat(64);
  const input = {
    kind: 'private_receipt' as const,
    batchId: 'batch-demo',
    revision: 1,
    status: 'processing' as const,
  };
  it('only allows a fresh reservation; ACK replays do not send again', () => {
    const receipt = describeWecomReceipt(key, input);
    expect(planWecomReceiptAttempt(null, receipt.fingerprint)).toBe('reserve');
    expect(
      planWecomReceiptAttempt(
        { fingerprint: receipt.fingerprint, state: 'acknowledged' },
        receipt.fingerprint,
      ),
    ).toBe('acknowledged');
  });
  it.each(['reserved', 'outcome_unknown'] as const)(
    'does not automatically resend a %s attempt after restart',
    (state) => {
      const receipt = describeWecomReceipt(key, input);
      expect(
        planWecomReceiptAttempt(
          { fingerprint: receipt.fingerprint, state },
          receipt.fingerprint,
        ),
      ).toBe('outcome_unknown');
    },
  );
  it('processing and completed processing can notify at the same draft revision; corrupt fingerprints conflict', () => {
    const first = describeWecomReceipt(key, input);
    const changed = describeWecomReceipt(key, { ...input, status: 'failed' });
    expect(changed.key).not.toBe(first.key);
    expect(() =>
      planWecomReceiptAttempt(
        { fingerprint: first.fingerprint, state: 'acknowledged' },
        changed.fingerprint,
      ),
    ).toThrow('wecom_delivery_conflict');
    expect(describeWecomReceipt(key, { ...input, revision: 2 }).key).not.toBe(
      first.key,
    );
  });
  it('separates group ACK and private receipt; rejects hidden names or counts', () => {
    expect(describeWecomReceipt(key, { kind: 'group_ack' }).key).not.toBe(
      describeWecomReceipt(key, input).key,
    );
    expect(() =>
      describeWecomReceipt(key, { ...input, hiddenCount: 4 } as typeof input),
    ).toThrow();
    expect(() =>
      describeWecomReceipt(key, { kind: 'group_ack', name: '甲（演示）' } as {
        kind: 'group_ack';
      }),
    ).toThrow();
    expect(() => describeWecomReceipt('bad', input)).toThrow();
  });
});
