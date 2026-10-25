import { describe, expect, it } from 'vitest';
import { createFakeMaas, maasConfigSchema } from './maas';
import { createFakeJev, jevConfigSchema } from './jev';
import { createFakeTingwu, tingwuConfigSchema } from './tingwu';
import { createFakeKodo, kodoConfigSchema } from './kodo';
describe('offline adapter boundaries', () => {
  it('MaaS returns the supplied synthetic result, rejecting malformed input', async () => {
    const client = createFakeMaas({ summary: 'synthetic' });
    await expect(
      client.extract({ sourceRefs: ['test-source'], text: 'synthetic text' }),
    ).resolves.toEqual({ summary: 'synthetic' });
    await expect(
      client.extract({ sourceRefs: [], text: '' }),
    ).rejects.toThrow();
  });
  it('Jev preserves four-state result with no confidence field', async () => {
    for (const conclusion of [
      'supported',
      'not_supported',
      'insufficient',
      'conflict',
    ] as const) {
      expect(
        await createFakeJev(conclusion).decide({
          requirement: 'test requirement',
          evidence: [{ sourceRef: 'test-source', text: 'synthetic' }],
        }),
      ).toEqual({ conclusion });
    }
    await expect(
      createFakeJev('supported').decide({ requirement: '', evidence: [] }),
    ).rejects.toThrow();
  });
  it('Tingwu requires an archived source and returns traceable synthetic transcript', async () => {
    const client = createFakeTingwu([
      { startMs: 0, endMs: 1000, text: 'synthetic' },
    ]);
    expect(
      await client.transcribe({ sourceRef: 'test-archived-source' }),
    ).toEqual({
      sourceRef: 'test-archived-source',
      segments: [{ startMs: 0, endMs: 1000, text: 'synthetic' }],
    });
    await expect(client.transcribe({ sourceRef: '' })).rejects.toThrow();
  });
  it('Kodo fake stores immutable bytes and detects conflicting overwrite', async () => {
    const client = createFakeKodo();
    const input = { key: 'test/segment', bytes: new Uint8Array([1, 2, 3]) };
    const receipt = await client.write(input);
    expect(receipt.byteLength).toBe(3);
    expect(await client.write(input)).toEqual(receipt);
    await expect(
      client.write({ ...input, bytes: new Uint8Array([4]) }),
    ).rejects.toThrow('conflict');
    const received = await client.read(input.key);
    received[0] = 99;
    expect(await client.read(input.key)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(client.read('missing')).rejects.toThrow('not found');
    await expect(
      client.write({ key: '', bytes: input.bytes }),
    ).rejects.toThrow();
  });
  it('all live configuration schemas require explicit credentials and HTTPS endpoints', () => {
    for (const schema of [
      maasConfigSchema,
      jevConfigSchema,
      tingwuConfigSchema,
      kodoConfigSchema,
    ])
      expect(schema.safeParse({}).success).toBe(false);
    expect(
      maasConfigSchema.safeParse({
        endpoint: 'http://invalid.test',
        apiKey: 'test-key',
        model: 'test',
      }).success,
    ).toBe(false);
  });
});
