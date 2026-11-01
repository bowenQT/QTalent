import { describe, expect, it } from 'vitest';
import {
  parseWecomFrame,
  type WecomMessage,
} from '../../integrations/wecom/protocol';
import { prepareWecomTextBatch } from './receiver';

function textMessage(
  text = ' 林舟（演示）记录原文。\n ',
  sender = 'sender-demo',
): WecomMessage {
  const frame = parseWecomFrame(
    JSON.stringify({
      cmd: 'aibot_msg_callback',
      headers: { req_id: 'ack-demo' },
      body: {
        msgid: 'message-demo',
        aibotid: 'bot-demo',
        from: { userid: sender },
        chattype: 'single',
        msgtype: 'text',
        text: { content: text },
        personIds: ['untrusted-person'],
        evaluationNodeId: 'untrusted-node',
      },
    }),
    { scope: 'scope-demo', botId: 'bot-demo' },
  );
  if (frame.kind !== 'message') throw new Error('Synthetic message required');
  return frame.message;
}
const target = {
  evaluationNodeId: 'node-demo',
  personIds: ['person-demo'],
  projectId: null,
};
describe('WeCom text intake preparation, not authentication', () => {
  it('preserves exact text, uses only explicit server target, and ignores ACK request ids', () => {
    const message = textMessage();
    const result = prepareWecomTextBatch(message, target);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('text plan required');
    expect(result.input).toEqual({
      ...target,
      operationId: expect.stringMatching(/^wecom:text:[a-f0-9]{64}$/),
      text: ' 林舟（演示）记录原文。\n ',
      files: [],
    });
    expect(
      prepareWecomTextBatch({ ...message, requestId: 'different-ack' }, target),
    ).toEqual(result);
    expect(
      prepareWecomTextBatch(textMessage(undefined, 'other-sender'), target),
    ).not.toEqual(result);
  });
  it.each([
    null,
    undefined,
    {},
    { ...target, projectId: undefined },
    { ...target, personIds: [] },
    { ...target, personIds: ['person-demo', 'person-demo'] },
  ])('refuses absent or incomplete trusted target %j', (value) => {
    expect(prepareWecomTextBatch(textMessage(), value)).toEqual({
      status: 'unavailable',
      reason: 'target_required',
    });
  });
  it('does not flatten or discard media and ambiguous multiple text parts', () => {
    const message = textMessage();
    expect(
      prepareWecomTextBatch(
        {
          ...message,
          parts: [
            ...message.parts,
            {
              kind: 'image',
              url: 'https://media.example.invalid/item',
              aesKey: 'synthetic-key',
            },
          ],
        },
        target,
      ),
    ).toEqual({ status: 'unavailable', reason: 'archive_required' });
    expect(
      prepareWecomTextBatch(
        { ...message, parts: [...message.parts, ...message.parts] },
        target,
      ),
    ).toEqual({ status: 'unavailable', reason: 'single_text_required' });
  });
});
