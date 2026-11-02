import { DocumentFault } from './document-protocol';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object')
    throw new DocumentFault('invalid_content');
  return value as Record<string, unknown>;
}
/** PDF.js 6.4.299 resolves getOperatorList with partial/empty ops before its
 * stream rejection reaches opListReadCapability. Observe that rejection before
 * the display pump can mask it. This is the sole private, pinned-version seam;
 * a version/shape change fails closed and requires the real regression fixtures.
 */
export function guardPdfOperators(document: unknown, version: string) {
  if (version !== '6.4.299') throw new DocumentFault('invalid_content');
  const handler = object(object(object(document)._transport).messageHandler);
  const original = handler.sendWithStream;
  if (typeof original !== 'function')
    throw new DocumentFault('invalid_content');
  let failed: 'resource_limit' | 'invalid_content' | undefined;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const stream: unknown = Reflect.apply(original, this, args);
    if (args[0] !== 'GetOperatorList') return stream;
    if (!(stream instanceof ReadableStream))
      throw new DocumentFault('invalid_content');
    const reader = stream.getReader();
    return new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          // Sticky before forwarding: PDF.js may resolve its public promise in
          // the same error turn. Never turn a rejected chunk into a blank page.
          const message = error instanceof Error ? error.message : '';
          failed ??= /Image exceeded maximum allowed size/.test(message)
            ? 'resource_limit'
            : 'invalid_content';
          controller.error(error);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
  };
  handler.sendWithStream = wrapped;
  return {
    check() {
      if (failed) throw new DocumentFault(failed);
    },
    restore() {
      handler.sendWithStream = original;
    },
  };
}
