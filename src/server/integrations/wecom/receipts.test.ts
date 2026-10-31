import { describe, expect, it } from 'vitest';
import { parseEntryDeepLink } from '../../../contracts/entry-links';
import {
  groupAcknowledgement,
  privateBatchReceipt,
  validateWebOrigin,
} from './receipts';
import { parseWecomFrame, type WecomMessage } from './protocol';
function message(group = true): WecomMessage {
  const frame = parseWecomFrame(
    JSON.stringify({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'demo-request' },
      body: {
        msgid: 'm1',
        aibotid: 'b1',
        from: { userid: 'original-sender' },
        chattype: group ? 'group' : 'single',
        ...(group ? { chatid: 'private-group' } : {}),
        msgtype: 'text',
        text: { content: '秘密原文和分数5不得进回执' },
      },
    }),
    { scope: 'demo', botId: 'b1' },
  );
  if (frame.kind !== 'message') throw new Error('Expected message');
  return frame.message;
}
describe('fixed group acknowledgment and 903 ordinary private links', () => {
  it('only replies 收到了 in a group, never a batch link, name, content or score', () => {
    const ack = groupAcknowledgement(message());
    expect(ack).toMatchObject({
      cmd: 'aibot_respond_msg',
      requestId: 'demo-request',
      action: { kind: 'group_ack' },
      body: { msgtype: 'stream', stream: { finish: true, content: '收到了' } },
    });
    expect(JSON.stringify(ack.body)).not.toMatch(
      /秘密|分数|entry\/open|original-sender|private-group/,
    );
    expect(() => groupAcknowledgement(message(false))).toThrow('invalid_frame');
  });
  it.each([
    'processing',
    'needs_review',
    'awaiting_confirmation',
    'failed',
  ] as const)(
    'addresses %s only to the original sender with a canonical versioned locator',
    (status) => {
      const result = privateBatchReceipt(
        message(),
        { batchId: 'batch:demo', revision: 7, status },
        'https://demo.example.invalid',
      );
      expect(result.body.chatid).toBe('original-sender');
      expect(result.action).toEqual({
        kind: 'private_receipt',
        batchId: 'batch:demo',
        expectedRevision: 7,
      });
      const match = /\((https:\/\/[^)]+)\)/.exec(result.body.markdown.content)!;
      expect(
        parseEntryDeepLink(
          new URL(match[1]).pathname + new URL(match[1]).search,
        ),
      ).toEqual({
        kind: 'material_batch',
        id: 'batch:demo',
        expectedRevision: 7,
      });
      expect(result.body.markdown.content).not.toMatch(
        /秘密|分数|secret|token|accountId/,
      );
    },
  );
  it.each([
    'http://demo.invalid',
    '//demo.invalid',
    'https://demo.invalid/',
    'https://user:pass@demo.invalid',
    'https://demo.invalid?token=secret',
    'https://demo.invalid/#x',
    'https://demo.invalid\n',
  ])(
    'rejects an unsafe or noncanonical configured web origin: %s',
    (origin) => {
      expect(() => validateWebOrigin(origin)).toThrow('invalid_config');
    },
  );
  it('rejects an arbitrary receipt payload, invalid locator or fabricated status', () => {
    for (const input of [
      { batchId: 'x', revision: 1, status: 'confirmed' },
      { batchId: 'x', revision: 0, status: 'failed' },
      { batchId: '../injected)?x=', revision: 1, status: 'failed' },
      { batchId: 'x', revision: 1, status: 'failed', score: 5 },
    ])
      expect(() =>
        privateBatchReceipt(
          message(),
          input as never,
          'https://demo.example.invalid',
        ),
      ).toThrow('invalid_frame');
  });
});
