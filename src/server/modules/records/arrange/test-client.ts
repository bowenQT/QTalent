import { z } from 'zod';
import {
  createFakeMaas,
  metadataFor,
  type StructuredMaasClient,
} from '../../../integrations/maas';

const payloadSchema = z.object({
  people: z.array(z.string().min(1)),
  dimensions: z.array(z.string().min(1)),
  sources: z.array(z.object({ excerpt: z.string().trim().min(1) })).min(1),
});

/** Explicit shared-worker injection for offline e2e. Never a production fallback. */
export function createRecordArrangeTestClient(
  environment: string,
): StructuredMaasClient {
  if (environment !== 'test')
    throw new Error('Record arranger requires the test environment');
  return {
    async generateStructured(input) {
      const user = [...input.messages]
        .reverse()
        .find((message) => message.role === 'user');
      let raw: unknown;
      try {
        raw = JSON.parse(user?.content ?? 'null');
      } catch {
        return {
          ok: false,
          kind: 'invalid_request',
          retryable: false,
          metadata: metadataFor(input),
        };
      }
      const payload = payloadSchema.safeParse(raw);
      if (!payload.success)
        return {
          ok: false,
          kind: 'invalid_request',
          retryable: false,
          metadata: metadataFor(input),
        };
      const behavior = payload.data.sources
        .map((source) => source.excerpt)
        .join('\n');
      return createFakeMaas({
        sbi: {
          title: behavior.slice(0, 24),
          situation: '',
          behavior,
          impact: '',
        },
        scores: payload.data.people.flatMap((personId) =>
          payload.data.dimensions.map((dimensionId) => ({
            state: 'unknown',
            personId,
            dimensionId,
            reason: '离线测试未形成评分建议',
          })),
        ),
      }).generateStructured(input);
    },
  };
}
