import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeAudio, validateProbeOptions } from './audio-probe';

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
