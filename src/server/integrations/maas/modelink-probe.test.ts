import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeModelink } from './modelink-probe';
import { MODELINK_MODEL } from './modelink';

const response = (value: unknown) =>
  new Response(
    JSON.stringify({
      id: 'chatcmpl-probe-demo',
      model: MODELINK_MODEL,
      choices: [
        {
          message: { role: 'assistant', content: JSON.stringify(value) },
          finish_reason: 'stop',
        },
      ],
    }),
  );
afterEach(() => vi.unstubAllGlobals());

describe('manual Modelink acceptance probe (offline)', () => {
  it('does not dispatch without the explicit configured environment', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const report = await probeModelink({});
    expect(report.samples).toHaveLength(2);
    for (const sample of report.samples)
      expect(sample).toMatchObject({
        schemaValid: false,
        expectedValue: false,
        kind: 'configuration',
        metadata: { attempts: 0 },
      });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('exercises real client text/image paths with a controlled transport and returns only evidence', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ marker: 'BOW843_DEMO' }))
      .mockResolvedValueOnce(response({ color: 'red' }));
    const report = await probeModelink(
      { MODELINK_API_KEY: 'dummy-probe-key' },
      { fetch: fetcher },
    );
    expect(report.samples).toMatchObject([
      {
        sample: 'text',
        schemaValid: true,
        expectedValue: true,
        metadata: {
          model: MODELINK_MODEL,
          promptVersion: 'bow843-probe-v1/text',
          attempts: 1,
        },
      },
      {
        sample: 'image',
        schemaValid: true,
        expectedValue: true,
        metadata: {
          model: MODELINK_MODEL,
          promptVersion: 'bow843-probe-v1/image',
          attempts: 1,
        },
      },
    ]);
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.messages[0].content[1].image_url.url).toMatch(
      /^data:image\/png;base64,/,
    );
    const output = JSON.stringify(report);
    for (const raw of [
      'BOW843_DEMO',
      'data:image',
      'dummy-probe-key',
      'messages',
      'value',
    ])
      expect(output).not.toContain(raw);
  });

  it('reports unexpected image interpretation separately from successful structure validation', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('private upstream error', { status: 503 }),
      )
      .mockResolvedValueOnce(response({ color: 'unknown' }));
    const report = await probeModelink(
      { MODELINK_API_KEY: 'dummy-probe-key' },
      { fetch: fetcher },
    );
    expect(report.samples).toMatchObject([
      {
        sample: 'text',
        schemaValid: false,
        expectedValue: false,
        kind: 'outcome_unknown',
        status: 503,
      },
      { sample: 'image', schemaValid: true, expectedValue: false },
    ]);
    expect(JSON.stringify(report)).not.toContain('private');
  });
});
