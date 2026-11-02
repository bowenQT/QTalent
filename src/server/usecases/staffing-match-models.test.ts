import { describe, expect, it, vi } from 'vitest';
import { MODELINK_MODEL } from '../integrations/maas';
import { MATCH_REVIEW_PROMPT_VERSION } from '../modules/staffing/matching/review';
import { createStaffingMatchModels } from './staffing-match-models';

const input = {
  requirement: '演示：独立负责过一个服务端模块',
  evidence: [{ sourceRef: 'demo-ref-1', text: '演示：搭好了服务端主架构' }],
};
const env = {
  QINIU_MAAS_API_KEY: 'synthetic-jev-key',
  MODELINK_API_KEY: 'synthetic-modelink-key',
};
const jevBody = (choice: string) => ({
  id: 'chatdecisions-synthetic',
  model: 'typesafe/jev-1.14',
  answers: {
    requirement_match: {
      type: 'choice',
      choice,
      confidence: 0,
      probabilities: {
        supported: 0.1,
        not_supported: 0.7,
        insufficient: 0.1,
        conflicting: 0.1,
      },
    },
  },
  usage: { input_tokens: 20, output_tokens: 0 },
});
const geminiBody = (conclusion: string) => ({
  id: 'chatcmpl-synthetic',
  model: MODELINK_MODEL,
  choices: [
    {
      message: { role: 'assistant', content: JSON.stringify({ conclusion }) },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});
function route(jev: string, gemini: string) {
  return vi.fn<typeof fetch>(async (url) =>
    Response.json(
      String(url).endsWith('/systemone') ? jevBody(jev) : geminiBody(gemini),
    ),
  );
}
const authOf = (call: Parameters<typeof fetch>) =>
  new Headers(call[1]?.headers).get('Authorization');

describe('BOW-854 model ports from server env', () => {
  it.each([
    {},
    { QINIU_MAAS_API_KEY: env.QINIU_MAAS_API_KEY },
    { MODELINK_API_KEY: env.MODELINK_API_KEY },
    { ...env, MODELINK_API_KEY: 'has space' },
  ])('reports not configured for %o', (environment) => {
    expect(createStaffingMatchModels(environment).configured).toBe(false);
  });
  it('without keys both ports fail closed and no provider is called', async () => {
    const send = route('supported', 'supported');
    const models = createStaffingMatchModels({}, { fetch: send });
    await expect(models.jev.decide(input)).rejects.toMatchObject({
      kind: 'configuration',
    });
    expect(await models.reviewUnsupported.review(input)).toMatchObject({
      status: 'failed',
      conclusion: null,
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('sends Jev and the Gemini review to their own endpoint with their own key', async () => {
    const send = route('not_supported', 'not_supported');
    const models = createStaffingMatchModels(env, { fetch: send });
    expect(models.configured).toBe(true);
    expect(await models.jev.decide(input)).toEqual({
      conclusion: 'not_supported',
    });
    expect(await models.reviewUnsupported.review(input)).toEqual({
      status: 'confirmed',
      conclusion: 'not_supported',
      model: MODELINK_MODEL,
      promptVersion: MATCH_REVIEW_PROMPT_VERSION,
      error: null,
    });
    const [jevCall, geminiCall] = send.mock.calls;
    expect(String(jevCall![0])).toBe('https://api.modelink.ai/v1/systemone');
    expect(authOf(jevCall!)).toBe('Bearer synthetic-jev-key');
    expect(String(geminiCall![0])).toBe(
      'https://api.modelink.ai/v1/chat/completions',
    );
    expect(authOf(geminiCall!)).toBe('Bearer synthetic-modelink-key');
  });
  it('a Gemini disagreement is a dispute, never a published not_supported', async () => {
    const models = createStaffingMatchModels(env, {
      fetch: route('not_supported', 'insufficient'),
    });
    expect(await models.reviewUnsupported.review(input)).toMatchObject({
      status: 'disputed',
      conclusion: 'insufficient',
    });
  });
});
