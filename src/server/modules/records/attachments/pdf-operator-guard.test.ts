import { describe, expect, it } from 'vitest';
import { guardPdfOperators } from './pdf-operator-guard';
describe('PDF.js pinned operator rejection guard', () => {
  it('preserves other actions, receiver and arguments while recording a sticky stream failure before forwarding it', async () => {
    let source: ReadableStreamDefaultController<unknown> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        source = controller;
      },
    });
    const marker = { unchanged: true };
    const payload = { page: 1 };
    const handler = {
      sendWithStream(this: unknown, action: string, data: unknown) {
        expect(this).toBe(handler);
        expect(data).toBe(payload);
        return action === 'GetOperatorList' ? stream : marker;
      },
    };
    const original = handler.sendWithStream;
    const guard = guardPdfOperators(
      { _transport: { messageHandler: handler } },
      '6.4.299',
    );
    expect(handler.sendWithStream('OtherAction', payload)).toBe(marker);
    const guarded = handler.sendWithStream('GetOperatorList', payload);
    if (!(guarded instanceof ReadableStream)) throw new Error('not a stream');
    const reader = guarded.getReader();
    source!.enqueue('first chunk');
    expect(await reader.read()).toEqual({ value: 'first chunk', done: false });
    guard.check();
    source!.error(
      new Error('Image exceeded maximum allowed size and was removed.'),
    );
    await expect(reader.read()).rejects.toThrow();
    expect(() => guard.check()).toThrow('resource_limit');
    expect(() => guard.check()).toThrow('resource_limit');
    guard.restore();
    expect(handler.sendWithStream).toBe(original);
  });
  it.each([
    { version: 'future', document: {} },
    { version: '6.4.299', document: {} },
    {
      version: '6.4.299',
      document: { _transport: { messageHandler: { sendWithStream: 123 } } },
    },
  ])('fails closed for an unknown version or private shape %#', (value) => {
    expect(() => guardPdfOperators(value.document, value.version)).toThrow(
      'invalid_content',
    );
  });
  it('forwards normal EOF and propagates consumer cancellation to the same reader', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue('chunk');
      },
      cancel() {
        cancelled = true;
      },
    });
    const handler = { sendWithStream: (_action: string) => stream };
    const guard = guardPdfOperators(
      { _transport: { messageHandler: handler } },
      '6.4.299',
    );
    const reader = handler.sendWithStream('GetOperatorList').getReader();
    await reader.read();
    await reader.cancel();
    expect(cancelled).toBe(true);
    guard.check();
    guard.restore();
    const empty = {
      sendWithStream: (_action: string) =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    };
    const other = guardPdfOperators(
      { _transport: { messageHandler: empty } },
      '6.4.299',
    );
    expect(
      await empty.sendWithStream('GetOperatorList').getReader().read(),
    ).toEqual({ done: true, value: undefined });
    other.check();
    other.restore();
  });
});
