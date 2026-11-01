import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEDIA_FORMATS, MAX_UPLOAD_BYTES } from '../../../contracts/media';
import type { createKodoClient } from '../../integrations/kodo';
import { RecordingError } from '../../modules/records/recordings/policy';
import type { RecordingPorts } from './ports';
import {
  probeAudio,
  validateProbeOptions,
  type AudioProbeOptions,
} from './audio-probe';

type Kodo = Pick<
  ReturnType<typeof createKodoClient>,
  'statObject' | 'openObject'
>;
const invalid = () => new RecordingError('invalid_archive');
const unavailable = () => new RecordingError('provider_unavailable');

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(unavailable());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Uses the existing Kodo streaming reader; no signer, download URL or alternate
 * object store implementation. Caller must hold current processing authority. */
export function createKodoAudioInspector(
  kodo: Kodo,
  options: AudioProbeOptions & { maxBytes: number; readTimeoutMs: number },
): RecordingPorts['inspectAudio'] {
  validateProbeOptions(options);
  if (
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > MAX_UPLOAD_BYTES ||
    !Number.isSafeInteger(options.readTimeoutMs) ||
    options.readTimeoutMs < 1 ||
    options.readTimeoutMs > 600000
  )
    throw new Error('invalid_audio_inspector_config');

  return async (upload, reference, externalSignal) => {
    // Snapshot immutable facts before awaiting anything. Reject wrong-version
    // handoffs before reading bytes, rather than trusting inspect(upload)'s input.
    const fact = { ...upload.object };
    const version = upload.originalVersionId;
    if (
      upload.purpose !== 'audio' ||
      upload.uploadId !== reference.uploadId ||
      upload.originalId !== reference.originalId ||
      upload.jobId !== reference.uploadJobId ||
      version !== reference.originalVersionId ||
      ![version, fact.objectKey, fact.etag].every(
        (v) => typeof v === 'string' && v.trim().length > 0,
      ) ||
      !Number.isSafeInteger(fact.byteLength) ||
      fact.byteLength < 1 ||
      fact.byteLength > options.maxBytes ||
      !/^[a-f0-9]{64}$/.test(fact.sha256) ||
      !MEDIA_FORMATS.some(
        (f) =>
          f.purpose === 'audio' &&
          f.mediaTypes.some((m) => m === fact.mediaType),
      )
    )
      throw invalid();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.readTimeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, controller.signal])
      : controller.signal;
    let directory: string | undefined;
    let opened: Awaited<ReturnType<Kodo['openObject']>> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (signal.aborted) throw unavailable();
      async function verifyStat() {
        const stat = await abortable(
          kodo.statObject({ objectKey: fact.objectKey, signal }),
          signal,
        );
        if (
          stat.key !== fact.objectKey ||
          stat.byteLength !== fact.byteLength ||
          stat.etag !== fact.etag ||
          stat.mediaType !== fact.mediaType
        )
          throw invalid();
      }
      await verifyStat();
      // Kodo must obey abort even if open is in flight. A late open is closed too.
      const pending = kodo.openObject({ objectKey: fact.objectKey, signal });
      void pending
        .then(
          (value) => {
            if (signal.aborted) value.close();
          },
          () => {},
        )
        .catch(() => {});
      opened = await abortable(pending, signal);
      if (
        opened.status !== 200 ||
        opened.headers['content-length'] !== String(fact.byteLength) ||
        opened.headers['content-type'] !== fact.mediaType
      )
        throw invalid();
      directory = await mkdtemp(join(tmpdir(), 'qtalent-audio-'));
      const path = join(directory, 'archive');
      const file = await open(path, 'wx', 0o600);
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        reader = opened.body.getReader();
        while (true) {
          const chunk = await abortable(reader.read(), signal);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > fact.byteLength) throw invalid();
          hash.update(chunk.value);
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            if (signal.aborted) throw unavailable();
            const written = await file.write(
              chunk.value,
              offset,
              chunk.value.byteLength - offset,
            );
            if (written.bytesWritten === 0) throw unavailable();
            offset += written.bytesWritten;
          }
        }
      } finally {
        await file.close();
      }
      if (bytes !== fact.byteLength || hash.digest('hex') !== fact.sha256)
        throw invalid();
      await verifyStat();
      const media = await probeAudio(path, bytes, options, signal);
      if (signal.aborted) throw unavailable();
      if (
        !MEDIA_FORMATS.some(
          (f) =>
            f.purpose === 'audio' &&
            f.extension === media.format &&
            f.mediaTypes.some((m) => m === fact.mediaType),
        )
      )
        throw invalid();
      return {
        ...media,
        originalVersionId: version,
        sha256: fact.sha256,
        byteLength: bytes,
      };
    } catch (error) {
      if (error instanceof RecordingError) throw error;
      // Never expose Kodo messages, object keys, headers, temp paths or native diagnostics.
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
      try {
        opened?.close();
        if (reader) {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (directory) await rm(directory, { recursive: true, force: true });
      } catch {
        throw unavailable();
      }
    }
  };
}
