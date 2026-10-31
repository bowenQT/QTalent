import { createHash, randomBytes } from 'node:crypto';
import {
  readOriginalSchema,
  type ReadOriginalInput,
} from '../../../../contracts/media';
import { UploadError, type UploadOptions, type ReadTicket } from './types';
import { requireUploadAccount, safeUpload } from './service';
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
function parseRange(header?: string) {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  const start = Number(match?.[1]);
  const end = match?.[2] ? Number(match[2]) : undefined;
  if (
    !match ||
    !Number.isSafeInteger(start) ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < start))
  )
    throw new UploadError('validation_error', 'invalid_range');
  return { start, ...(end === undefined ? {} : { end }) };
}
function identity(value: ReadOriginalInput | ReadTicket): ReadOriginalInput {
  if ('fragmentId' in value && typeof value.fragmentId === 'string')
    return {
      fragmentId: value.fragmentId,
      originalVersionId: value.originalVersionId,
    };
  if ('originalId' in value)
    return {
      originalId: value.originalId,
      originalVersionId: value.originalVersionId,
    };
  throw new UploadError('validation_error', 'invalid_input');
}
export function createOriginalReader(options: UploadOptions) {
  const now = options.now ?? Date.now;
  const missing = () => new UploadError('not_found', 'original_not_found');
  return {
    grant(
      accountId: string | null,
      input: unknown,
    ): Promise<{ url: string; expiresAt: string }> {
      return safeUpload(async () => {
        requireUploadAccount(accountId);
        const parsed = readOriginalSchema.safeParse(input);
        if (!parsed.success)
          throw new UploadError('validation_error', 'invalid_input');
        const token = randomBytes(32).toString('base64url');
        const reference = identity(parsed.data);
        return options.store.transaction([], async (tx) => {
          const object = await tx.findObject(reference.originalVersionId);
          const intent = object ? await tx.findIntent(object.uploadId) : null;
          const completed = intent?.completed;
          if (
            !completed ||
            completed.originalVersionId !== reference.originalVersionId ||
            ('originalId' in reference &&
              reference.originalId !== completed.originalId)
          )
            throw missing();
          if (!(await options.policy.canReadOriginal(accountId, reference, tx)))
            throw missing();
          const expiresAt = now() + 60000;
          await tx.insertTicket({
            originalId: completed.originalId,
            originalVersionId: completed.originalVersionId,
            fragmentId: 'fragmentId' in reference ? reference.fragmentId : null,
            requestedRange: parsed.data.range ?? null,
            digest: hash(token),
            accountId,
            expiresAt,
          });
          return {
            url: `/api/uploads/original?ticket=${token}`,
            expiresAt: new Date(expiresAt).toISOString(),
          };
        });
      });
    },
    open(
      accountId: string | null,
      token: string,
      rangeHeader?: string,
    ): Promise<Response> {
      return safeUpload(async () => {
        requireUploadAccount(accountId);
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw missing();
        const headerRange = parseRange(rangeHeader);
        const { ticket, object, intent } = await options.store.transaction(
          [],
          async (tx) => {
            const ticket = await tx.findTicket(hash(token));
            if (
              !ticket ||
              ticket.accountId !== accountId ||
              ticket.expiresAt <= now()
            )
              throw missing();
            const object = await tx.findObject(ticket.originalVersionId);
            const intent = object ? await tx.findIntent(object.uploadId) : null;
            if (
              !object ||
              !intent?.completed ||
              intent.completed.originalId !== ticket.originalId ||
              intent.completed.originalVersionId !== ticket.originalVersionId ||
              !(await options.policy.canReadOriginal(
                accountId,
                identity(ticket),
                tx,
              ))
            )
              throw missing();
            return { ticket, object, intent };
          },
        );
        const range =
          headerRange ??
          (ticket.requestedRange
            ? {
                start: ticket.requestedRange.start,
                ...(ticket.requestedRange.endInclusive === undefined
                  ? {}
                  : { end: ticket.requestedRange.endInclusive }),
              }
            : undefined);
        const stat = await options.storage.statObject({
          objectKey: object.objectKey,
        });
        if (
          stat.key !== object.objectKey ||
          stat.byteLength !== object.byteLength ||
          stat.mediaType !== object.mediaType ||
          stat.etag !== object.etag
        )
          throw new UploadError('unavailable', 'original_integrity');
        const opened = await options.storage.openObject({
          objectKey: object.objectKey,
          range,
        });
        try {
          if (
            ticket.expiresAt <= now() ||
            !(await options.policy.canReadOriginal(accountId, identity(ticket)))
          )
            throw missing();
          const source = opened.body.getReader();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                if (ticket.expiresAt <= now()) throw missing();
                const next = await source.read();
                if (ticket.expiresAt <= now()) throw missing();
                if (next.done) {
                  source.releaseLock();
                  opened.close();
                  controller.close();
                } else controller.enqueue(next.value);
              } catch {
                await source.cancel().catch(() => {});
                opened.close();
                controller.error(
                  new UploadError('unavailable', 'original_stream_unavailable'),
                );
              }
            },
            async cancel() {
              opened.close();
              await source.cancel();
            },
          });
          const filename = encodeURIComponent(intent.request.filename).replace(
            /['()*]/g,
            (char) => `%${char.charCodeAt(0).toString(16)}`,
          );
          return new Response(body, {
            status: opened.status,
            headers: {
              ...opened.headers,
              'cache-control': 'private, no-store',
              'x-content-type-options': 'nosniff',
              'content-disposition': `${intent.request.purpose === 'audio' ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
            },
          });
        } catch (error) {
          opened.close();
          await opened.body.cancel().catch(() => {});
          throw error;
        }
      });
    },
  };
}
