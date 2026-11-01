import { z } from 'zod';
import { createModelinkMaasClientFromEnv } from './modelink';
import type { MaasResult } from './structured';

// Generated 128x128 red PNG; contains no people, source material or external URLs.
const DEMO_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABWklEQVR4nO3OQQ0AMBAEofVv+iqDxzRBALvtg/wgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwgzg/i/CDOD+L8IM4P4vwg7gEgaMOyrMtNTwAAAABJRU5ErkJggg==';
const marker = 'BOW843_DEMO' as const;
const textSchema = z.object({ marker: z.literal(marker) }).strict();
const imageSchema = z
  .object({ color: z.enum(['red', 'green', 'blue', 'unknown']) })
  .strict();

function evidence<T>(
  sample: 'text' | 'image',
  result: MaasResult<T, string>,
  expected: boolean,
) {
  return {
    sample,
    schemaValid: result.ok,
    expectedValue: expected,
    ...(result.ok
      ? {}
      : {
          kind: result.kind,
          retryable: result.retryable,
          reason: result.reason,
          status: result.status,
        }),
    metadata: result.metadata,
  };
}

/** Explicit manual acceptance probe. Importing it never contacts the provider.
 * The returned report contains only safe metadata, never prompts, image bytes or raw output.
 */
export async function probeModelink(
  environment: Record<string, string | undefined> = process.env,
  transport: { fetch?: typeof fetch } = {},
) {
  const client = createModelinkMaasClientFromEnv(environment, transport);
  const startedAt = new Date().toISOString();
  const text = await client.generateStructured({
    messages: [
      {
        role: 'user',
        content: `演示连通验收：只返回 JSON 对象 {"marker":"${marker}"}。不产生任何员工评价。`,
      },
    ],
    promptVersion: 'bow843-probe-v1/text',
    schema: textSchema,
  });
  const image = await client.generateStructured({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '演示连通验收：看图判断占满画面的主色，只返回 JSON 对象，color 的值为 red、green、blue 中的一种；看不清返回 unknown。不产生任何员工评价。',
          },
          { type: 'image_url', image_url: { url: DEMO_IMAGE, detail: 'high' } },
        ],
      },
    ],
    promptVersion: 'bow843-probe-v1/image',
    schema: imageSchema,
  });
  return {
    startedAt,
    samples: [
      evidence('text', text, text.ok && text.value.marker === marker),
      evidence('image', image, image.ok && image.value.color === 'red'),
    ],
  };
}
