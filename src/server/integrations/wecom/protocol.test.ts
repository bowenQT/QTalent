import { describe, expect, it } from 'vitest';
import { parseWecomFrame, wecomMessageKey, wecomLimits } from './protocol';
const expected = { scope: 'demo-tenant', botId: 'demo-bot' };
function input(msgtype = 'text', extra: Record<string, unknown> = {}) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'callback-1' },
    body: {
      msgid: 'message-1',
      aibotid: 'demo-bot',
      from: { userid: 'demo-user' },
      chattype: 'single',
      msgtype,
      text: { content: '化名演示材料' },
      ...extra,
    },
  };
}
describe('WeCom protocol normalization and bounded provenance', () => {
  it('reads a text event without propagating quoted material, roles or response URLs', () => {
    const result = parseWecomFrame(
      JSON.stringify(
        input('text', {
          quote: { text: { content: '不得自动导入的引用' } },
          role: 'admin',
          response_url: 'https://untrusted.invalid/secret',
        }),
      ),
      expected,
    );
    expect(result).toMatchObject({
      kind: 'message',
      message: {
        requestId: 'callback-1',
        source: {
          scope: 'demo-tenant',
          botId: 'demo-bot',
          messageId: 'message-1',
          senderId: 'demo-user',
          chatType: 'single',
          chatId: null,
        },
        parts: [{ kind: 'text', text: '化名演示材料' }],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /不得自动导入|admin|response_url/,
    );
    if (result.kind !== 'message') throw new Error('Expected message');
    expect(Object.isFrozen(result.message.source)).toBe(true);
    expect(Object.isFrozen(result.message.parts[0])).toBe(true);
  });
  it.each(['image', 'file'])(
    'preserves encrypted %s reference without fetching it',
    (kind) => {
      const result = parseWecomFrame(
        JSON.stringify(
          input(kind, {
            [kind]: {
              url: 'https://media.example.invalid/file',
              aeskey: 'demo-key',
            },
          }),
        ),
        expected,
      );
      expect(result).toMatchObject({
        kind: 'message',
        message: {
          parts: [
            {
              kind,
              url: 'https://media.example.invalid/file',
              aesKey: 'demo-key',
            },
          ],
        },
      });
    },
  );
  it('preserves all mixed parts in order and validates group identity', () => {
    expect(
      parseWecomFrame(
        JSON.stringify(
          input('mixed', {
            chattype: 'group',
            chatid: 'demo-group',
            mixed: {
              msg_item: [
                { msgtype: 'text', text: { content: '演示说明' } },
                {
                  msgtype: 'image',
                  image: {
                    url: 'https://media.example.invalid/file',
                    aeskey: 'key',
                  },
                },
              ],
            },
          }),
        ),
        expected,
      ),
    ).toMatchObject({
      message: {
        source: { chatType: 'group', chatId: 'demo-group' },
        parts: [{ kind: 'text', text: '演示说明' }, { kind: 'image' }],
      },
    });
  });
  it('uses configured scope/bot and message ID, independent of delivery request ID', () => {
    const first = parseWecomFrame(JSON.stringify(input()), expected);
    const frame = input();
    frame.headers.req_id = 'retry-delivery';
    const second = parseWecomFrame(JSON.stringify(frame), expected);
    if (first.kind !== 'message' || second.kind !== 'message')
      throw new Error('Expected message');
    expect(first.message.source.messageKey).toBe(
      second.message.source.messageKey,
    );
    expect(wecomMessageKey('other-tenant', 'demo-bot', 'message-1')).not.toBe(
      first.message.source.messageKey,
    );
    expect(wecomMessageKey('demo-tenant', 'other-bot', 'message-1')).not.toBe(
      first.message.source.messageKey,
    );
    expect(wecomMessageKey('demo-tenant', 'demo-bot', 'message-2')).not.toBe(
      first.message.source.messageKey,
    );
    expect(() => wecomMessageKey('bad scope', 'b', 'm')).toThrow(
      'invalid_config',
    );
  });
  it.each([
    input('voice', { voice: { content: '不会替代原始音频' } }),
    input('video'),
  ])('explicitly rejects unsupported message kinds', (frame) => {
    expect(() => parseWecomFrame(JSON.stringify(frame), expected)).toThrow(
      'unsupported_message',
    );
  });
  it.each([
    input('text', { aibotid: 'other-bot' }),
    input('text', { chattype: 'group' }),
    input('text', { from: { userid: '' } }),
    input('mixed', { mixed: { msg_item: [] } }),
    input('image', { image: { url: 'https://x.invalid' } }),
    input('text', { text: { content: '  ' } }),
  ])(
    'rejects malformed or mismatched callbacks without echoing raw data',
    (frame) => {
      expect(() => parseWecomFrame(JSON.stringify(frame), expected)).toThrow(
        'invalid_frame',
      );
    },
  );
  it('bounds JSON/UTF8 and separates ACK, takeover and unrelated event frames', () => {
    expect(() =>
      parseWecomFrame('x'.repeat(wecomLimits.maxFrameBytes + 1), expected),
    ).toThrow('invalid_frame');
    expect(() => parseWecomFrame(new Uint8Array([255]), expected)).toThrow(
      'invalid_frame',
    );
    expect(() => parseWecomFrame('{', expected)).toThrow('invalid_frame');
    expect(() =>
      parseWecomFrame(JSON.stringify({ headers: { req_id: 'x' } }), expected),
    ).toThrow('invalid_frame');
    expect(
      parseWecomFrame(
        JSON.stringify({
          headers: { req_id: 'x' },
          errcode: 0,
          errmsg: 'not propagated',
        }),
        expected,
      ),
    ).toEqual({ kind: 'ack', requestId: 'x', code: 0 });
    for (const [eventtype, kind] of [
      ['disconnected_event', 'disconnected'],
      ['enter_chat', 'ignored'],
    ])
      expect(
        parseWecomFrame(
          JSON.stringify({
            cmd: 'aibot_event_callback',
            headers: { req_id: 'x' },
            body: { event: { eventtype } },
          }),
          expected,
        ),
      ).toEqual({ kind });
    expect(
      parseWecomFrame(
        JSON.stringify({ cmd: 'future_command', headers: { req_id: 'x' } }),
        expected,
      ),
    ).toEqual({ kind: 'ignored' });
  });
});
