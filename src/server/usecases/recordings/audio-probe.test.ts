import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeAudio,
  probeVideoAudio,
  validateProbeOptions,
} from './audio-probe';

const nativeCalls = vi.hoisted(() => [] as { args: readonly string[] }[]);
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      nativeCalls.push({ args: [...(Array.isArray(args[1]) ? args[1] : [])] });
      return actual.spawn(...args);
    },
  };
});

const binaries = {
  ffprobePath:
    process.env.QTALENT_TEST_FFPROBE_PATH ??
    (process.platform === 'darwin'
      ? '/opt/homebrew/bin/ffprobe'
      : '/usr/bin/ffprobe'),
  ffmpegPath:
    process.env.QTALENT_TEST_FFMPEG_PATH ??
    (process.platform === 'darwin'
      ? '/opt/homebrew/bin/ffmpeg'
      : '/usr/bin/ffmpeg'),
};
const options = { ...binaries, timeoutMs: 10000, maxDurationMs: 10000 };
const directories: string[] = [];
afterEach(async () => {
  nativeCalls.length = 0;
  await Promise.all(
    directories.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

/** 100 ms of a deterministic synthetic tone, no speech or real-person material. */
function wave() {
  const bytes = Buffer.alloc(3244);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(3200, 40);
  for (let i = 0; i < 1600; i++)
    bytes.writeInt16LE(Math.round(4000 * Math.sin(i / 10)), 44 + i * 2);
  return bytes;
}
async function file(bytes: Uint8Array, name = 'synthetic.wav') {
  const dir = await mkdtemp(join(tmpdir(), 'q859-probe-test-'));
  directories.push(dir);
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}
async function transcode(
  extension: string,
  codec: string,
  extra: string[] = [],
) {
  const path = await file(wave());
  const output = join(path, '..', `synthetic.${extension}`);
  const result = spawnSync(
    binaries.ffmpegPath,
    [
      '-nostdin',
      '-v',
      'error',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-i',
      path,
      '-c:a',
      codec,
      ...extra,
      '-y',
      output,
    ],
    { timeout: 10000, maxBuffer: 65536 },
  );
  expect(
    result.error,
    'the test requires the actual deployment-provided FFmpeg binary',
  ).toBeUndefined();
  expect(result.status).toBe(0);
  return { path: output, bytes: await readFile(output) };
}
describe('actual media demux and decoded-sample duration', () => {
  it('decodes a known sample count even with a misleading filename', async () => {
    const bytes = wave();
    expect(
      await probeAudio(
        await file(bytes, 'no-audio-metadata.bin'),
        bytes.length,
        options,
      ),
    ).toEqual({ format: 'wav', durationMs: 100 });
  });
  it.each([
    ['mp3', 'libmp3lame', 'mp3'],
    ['m4a', 'aac', 'm4a'],
    ['aac', 'aac', 'aac'],
  ])(
    'actually decodes synthetic %s without duration-tag assumptions',
    async (extension, codec, format) => {
      const input = await transcode(extension, codec);
      const result = await probeAudio(input.path, input.bytes.length, options);
      expect(result.format).toBe(format);
      // AAC ADTS includes encoder padding; bounded by two 1024-sample frames at 16kHz.
      // This range comes from the generated 1600 samples, not the probe's own metadata.
      expect(result.durationMs).toBeGreaterThanOrEqual(100);
      expect(result.durationMs).toBeLessThanOrEqual(228);
    },
  );
  it('ignores arbitrary container duration tags', async () => {
    const input = await transcode('m4a', 'aac', [
      '-metadata',
      'duration=999999999',
    ]);
    const result = await probeAudio(input.path, input.bytes.length, options);
    expect(result.durationMs).toBeGreaterThanOrEqual(100);
    expect(result.durationMs).toBeLessThanOrEqual(228);
  });
  it.each([
    Buffer.from('not an audio container'),
    wave().subarray(0, 100),
    (() => {
      const b = wave();
      b.writeUInt32LE(1000000, 40);
      return b;
    })(),
    Buffer.alloc(0),
  ])('rejects malformed or truncated bytes', async (bytes) => {
    await expect(
      probeAudio(await file(bytes), bytes.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('rejects more decoded samples than the configured time bound', async () => {
    const bytes = wave();
    await expect(
      probeAudio(await file(bytes), bytes.length, {
        ...options,
        maxDurationMs: 99,
      }),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('rejects a substituted size even when the file decodes', async () => {
    const bytes = wave();
    await expect(
      probeAudio(await file(bytes), bytes.length + 1, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('rejects video-bearing MP4 instead of extending the audio application lane', async () => {
    const path = await file(wave());
    const output = join(path, '..', 'video.mp4');
    const result = spawnSync(
      binaries.ffmpegPath,
      [
        '-nostdin',
        '-v',
        'error',
        '-threads',
        '1',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=16x16:r=10',
        '-i',
        path,
        '-t',
        '0.1',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-threads',
        '1',
        '-y',
        output,
      ],
      { timeout: 10000 },
    );
    expect(result.status).toBe(0);
    await expect(
      probeAudio(output, (await readFile(output)).length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('rejects multiple audio tracks rather than silently choosing one', async () => {
    const path = await file(wave());
    const output = join(path, '..', 'multi.m4a');
    const result = spawnSync(
      binaries.ffmpegPath,
      [
        '-nostdin',
        '-v',
        'error',
        '-threads',
        '1',
        '-i',
        path,
        '-map',
        '0:a:0',
        '-map',
        '0:a:0',
        '-c:a',
        'aac',
        '-threads',
        '1',
        '-y',
        output,
      ],
      { timeout: 10000 },
    );
    expect(result.status).toBe(0);
    await expect(
      probeAudio(output, (await readFile(output)).length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('has no default duration when the binary is missing', async () => {
    const bytes = wave();
    await expect(
      probeAudio(await file(bytes), bytes.length, {
        ...options,
        ffprobePath: '/does-not-exist/q859-ffprobe',
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
  it('honors cancellation before spawning and during inspection', async () => {
    const bytes = wave();
    const path = await file(bytes);
    await expect(
      probeAudio(path, bytes.length, options, AbortSignal.abort()),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(
      probeAudio(path, bytes.length, { ...options, timeoutMs: 1 }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
  it.each([
    { ffmpegPath: 'ffmpeg' },
    { ffprobePath: 'ffprobe' },
    { timeoutMs: 0 },
    { timeoutMs: 600001 },
    { maxDurationMs: 0 },
    { maxDurationMs: 21600001 },
  ])('requires bounded explicit server configuration', (bad) => {
    expect(() => validateProbeOptions({ ...options, ...bad })).toThrow(
      'invalid_audio_probe_config',
    );
  });
});

/** Different video lengths, identical short synthetic audio. No private media. */
async function video(
  audioTracks = 1,
  seconds = '1',
  extension = 'mp4',
  videoTracks = 1,
) {
  const input = await file(wave());
  const output = join(input, '..', `synthetic-video.${extension}`);
  const result = spawnSync(
    binaries.ffmpegPath,
    [
      '-nostdin',
      '-v',
      'error',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=16x16:r=10:d=${seconds}`,
      '-i',
      input,
      ...Array.from({ length: videoTracks }, () => ['-map', '0:v:0']).flat(),
      ...Array.from({ length: audioTracks }, () => ['-map', '1:a:0']).flat(),
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      '-threads',
      '1',
      '-y',
      output,
    ],
    { timeout: 10000, maxBuffer: 65536 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return { path: output, bytes: await readFile(output) };
}

describe('explicit video lane decodes only the sole audio track', () => {
  it('rejects multiple timed video tracks rather than silently narrowing the original', async () => {
    const input = await video(1, '1', 'mp4', 2);
    await expect(
      probeVideoAudio(input.path, input.bytes.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });

  it('measures the audio samples rather than the longer video duration', async () => {
    const a = await video(1, '1');
    const b = await video(1, '2');
    const first = await probeVideoAudio(a.path, a.bytes.length, options);
    const second = await probeVideoAudio(b.path, b.bytes.length, options);
    expect(first).toEqual(second);
    const decodes = nativeCalls.filter(({ args }) =>
      args.includes('pcm_s16le'),
    );
    expect(decodes).toHaveLength(2);
    for (const { args } of decodes) {
      expect(args.slice(0, args.indexOf('-i'))).toContain('-vn');
      expect(args.slice(args.indexOf('-i') + 1)).toContain('-vn');
      expect(
        args.slice(args.indexOf('-map'), args.indexOf('-map') + 2),
      ).toEqual(['-map', '0:1']);
      expect(args.slice(-3)).toEqual(['-f', 's16le', 'pipe:1']);
    }
    expect(first.format).toBe('mp4');
    expect(first.durationMs).toBeGreaterThanOrEqual(100);
    expect(first.durationMs).toBeLessThanOrEqual(228);
    // The same bytes remain invalid for the legacy audio-only application lane.
    await expect(
      probeAudio(a.path, a.bytes.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it.each([0, 2])(
    'rejects %i audio tracks instead of choosing or inventing one',
    async (count) => {
      const input = await video(count);
      await expect(
        probeVideoAudio(input.path, input.bytes.length, options),
      ).rejects.toMatchObject({ code: 'invalid_archive' });
    },
  );
  it('rejects audio-only material presented as video', async () => {
    const input = await transcode('m4a', 'aac');
    await expect(
      probeVideoAudio(input.path, input.bytes.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
    const bytes = wave();
    await expect(
      probeVideoAudio(await file(bytes), bytes.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('rejects a QuickTime container instead of labelling every MOV-family input MP4', async () => {
    const input = await video(1, '1', 'mov');
    await expect(
      probeVideoAudio(input.path, input.bytes.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('fails on bad size, truncated video or decoded audio over budget', async () => {
    const input = await video();
    await expect(
      probeVideoAudio(input.path, input.bytes.length + 1, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
    const truncated = input.bytes.subarray(0, input.bytes.length / 2);
    await expect(
      probeVideoAudio(await file(truncated), truncated.length, options),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
    await expect(
      probeVideoAudio(input.path, input.bytes.length, {
        ...options,
        maxDurationMs: 99,
      }),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('cancels video inspection and has no fallback for missing tools', async () => {
    const input = await video();
    await expect(
      probeVideoAudio(
        input.path,
        input.bytes.length,
        options,
        AbortSignal.abort(),
      ),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    await expect(
      probeVideoAudio(input.path, input.bytes.length, {
        ...options,
        ffmpegPath: '/does-not-exist/q859-ffmpeg',
      }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
});

it('rejects trailing bytes tolerated by the decoder but outside the declared RIFF', async () => {
  const bytes = Buffer.concat([
    wave(),
    Buffer.from('unaccounted-trailing-bytes'),
  ]);
  const path = await file(bytes);
  const ordinaryDecode = spawnSync(
    binaries.ffmpegPath,
    ['-nostdin', '-v', 'error', '-threads', '1', '-i', path, '-f', 'null', '-'],
    { timeout: 10000, maxBuffer: 65536 },
  );
  expect(ordinaryDecode.error).toBeUndefined();
  expect(ordinaryDecode.status).toBe(0);
  await expect(probeAudio(path, bytes.length, options)).rejects.toMatchObject({
    code: 'invalid_archive',
  });
});
