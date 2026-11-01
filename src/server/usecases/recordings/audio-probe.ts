import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { RecordingError } from '../../modules/records/recordings/policy';
import type { InspectedAudio } from '../../modules/records/recordings/types';

export type AudioProbeOptions = {
  /** Explicit, deployment-provided FFmpeg binaries; never resolved via user PATH. */
  ffprobePath: string;
  ffmpegPath: string;
  timeoutMs: number;
  maxDurationMs: number;
};
const invalid = () => new RecordingError('invalid_archive');
const unavailable = () => new RecordingError('provider_unavailable');
const metadataSchema = z.object({
  streams: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        codec_type: z.string(),
        codec_name: z.string().min(1),
        sample_rate: z.string().optional(),
        channels: z.number().int().optional(),
        disposition: z.object({ attached_pic: z.number().int() }),
      }),
    )
    .min(1)
    .max(16),
  format: z.object({ format_name: z.string(), size: z.string() }),
});
const inputOptions = [
  '-threads',
  '1',
  '-max_alloc',
  '33554432',
  '-probesize',
  '1048576',
  '-analyzeduration',
  '5000000',
  // A regular inherited descriptor is seekable for M4A. No network, file URL,
  // playlist or container external-reference protocol is available to the input.
  '-protocol_whitelist',
  'fd',
  '-format_whitelist',
  'wav,mp3,aac,mov',
  '-fd',
  '0',
];

export function validateProbeOptions(options: AudioProbeOptions) {
  if (
    ![options.ffprobePath, options.ffmpegPath].every(
      (path) => isAbsolute(path) && !path.includes('\0'),
    ) ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 600000 ||
    !Number.isSafeInteger(options.maxDurationMs) ||
    options.maxDurationMs < 1 ||
    options.maxDurationMs > 21600000
  )
    throw new Error('invalid_audio_probe_config');
}

/** Reject a truncated RIFF even if a decoder tolerates its inconsistent chunk sizes. */
async function validateWave(path: string, byteLength: number) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const header = Buffer.alloc(12);
    if (
      (await file.read(header, 0, 12, 0)).bytesRead !== 12 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE' ||
      header.readUInt32LE(4) + 8 !== byteLength
    )
      throw invalid();
    let offset = 12;
    let data = 0;
    let formats = 0;
    let chunks = 0;
    const chunk = Buffer.alloc(8);
    while (offset < byteLength) {
      if (
        ++chunks > 4096 ||
        offset + 8 > byteLength ||
        (await file.read(chunk, 0, 8, offset)).bytesRead !== 8
      )
        throw invalid();
      const size = chunk.readUInt32LE(4);
      const kind = chunk.toString('ascii', 0, 4);
      if (kind === 'data') {
        if (size === 0) throw invalid();
        data++;
      }
      if (kind === 'fmt ') {
        if (size < 16) throw invalid();
        formats++;
      }
      offset += 8 + size + (size % 2);
      if (offset > byteLength) throw invalid();
    }
    if (data !== 1 || formats !== 1) throw invalid();
  } finally {
    await file.close();
  }
}

/** Stream and count output; raw diagnostics and audio never leave this private adapter. */
async function run(
  executable: string,
  args: string[],
  path: string,
  signal: AbortSignal,
  maxOutputBytes: number,
  capture: boolean,
) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile() || signal.aborted) throw unavailable();
    return await new Promise<{ bytes: number; output: Buffer }>(
      (resolve, reject) => {
        let failure: RecordingError | undefined;
        let bytes = 0;
        const chunks: Buffer[] = [];
        const child = spawn(executable, args, {
          stdio: [file.fd, 'pipe', 'pipe'],
          // Do not pass application/vendor credentials to the native decoder.
          env: {
            NODE_ENV: 'production',
            LANG: 'C',
            LC_ALL: 'C',
            AV_LOG_FORCE_NOCOLOR: '1',
          },
          windowsHide: true,
        });
        function stop(error: RecordingError) {
          failure ??= error;
          child.kill('SIGKILL');
        }
        const abort = () => stop(unavailable());
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        child.stdout!.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxOutputBytes) stop(invalid());
          else if (capture) chunks.push(chunk);
        });
        child.stdout!.on('error', () => stop(unavailable()));
        child.stderr!.on('data', () => stop(invalid()));
        child.stderr!.on('error', () => stop(unavailable()));
        child.on('error', () => {
          failure ??= unavailable();
        });
        // Wait for close, including the streams, before closing the input FD or
        // deleting the temp file. A timeout cannot leave a decoder running.
        child.on('close', (code) => {
          signal.removeEventListener('abort', abort);
          if (failure) reject(failure);
          else if (code !== 0) reject(invalid());
          else resolve({ bytes, output: Buffer.concat(chunks) });
        });
      },
    );
  } finally {
    await file.close();
  }
}

/** Actual demux + decode of a verified local file. Duration is decoded samples,
 * not duration tags, timestamps, filenames or a caller-supplied duration. */
export async function probeAudio(
  path: string,
  byteLength: number,
  options: AudioProbeOptions,
  externalSignal?: AbortSignal,
): Promise<Pick<InspectedAudio, 'format' | 'durationMs'>> {
  validateProbeOptions(options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal;
  try {
    const metadata = await run(
      options.ffprobePath,
      [
        '-v',
        'error',
        ...inputOptions,
        '-show_entries',
        'stream=index,codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic:format=format_name,size',
        '-of',
        'json',
        '-i',
        'fd:',
      ],
      path,
      signal,
      65536,
      true,
    );
    let json: unknown;
    try {
      json = JSON.parse(metadata.output.toString('utf8'));
    } catch {
      throw invalid();
    }
    const parsed = metadataSchema.safeParse(json);
    if (!parsed.success) throw invalid();
    const { streams, format } = parsed.data;
    const audio = streams.filter((stream) => stream.codec_type === 'audio');
    if (
      audio.length !== 1 ||
      streams.some(
        (s) =>
          s.codec_type !== 'audio' &&
          !(s.codec_type === 'video' && s.disposition.attached_pic === 1),
      ) ||
      !/^\d+$/.test(format.size) ||
      Number(format.size) !== byteLength ||
      !/^\d+$/.test(audio[0].sample_rate ?? '') ||
      Number(audio[0].sample_rate) < 8000 ||
      Number(audio[0].sample_rate) > 192000 ||
      !audio[0].channels ||
      audio[0].channels < 1 ||
      audio[0].channels > 8
    )
      throw invalid();
    const name = format.format_name;
    let detected: InspectedAudio['format'];
    if (name === 'wav' || name === 'mp3' || name === 'aac') detected = name;
    else if (name === 'mov,mp4,m4a,3gp,3g2,mj2') detected = 'm4a';
    else throw invalid();
    if (detected === 'wav') await validateWave(path, byteLength);
    const decoded = await run(
      options.ffmpegPath,
      [
        '-nostdin',
        '-hide_banner',
        '-v',
        'error',
        '-xerror',
        '-max_error_rate',
        '0',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-err_detect',
        'explode',
        ...inputOptions,
        '-i',
        'fd:',
        '-map',
        `0:${audio[0].index}`,
        '-vn',
        '-sn',
        '-dn',
        '-af',
        'aresample=16000,asetpts=N/SR/TB',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        '-f',
        's16le',
        'pipe:1',
      ],
      path,
      signal,
      options.maxDurationMs * 32,
      false,
    );
    if (decoded.bytes === 0 || decoded.bytes % 2 !== 0) throw invalid();
    return { format: detected, durationMs: Math.ceil(decoded.bytes / 32) };
  } catch (error) {
    if (error instanceof RecordingError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}
