import { expect, it, vi } from 'vitest';
import {
  createFakeModelinkMaas,
  metadataFor,
  MODELINK_MODEL,
} from '../../../integrations/maas';
import {
  createUnsupportedReview,
  MATCH_REVIEW_PROMPT_VERSION,
  unsupportedReviewSchema,
} from './review';
const input = {
  requirement: '演示·负责接口验收',
  evidence: [{ sourceRef: 'demo-reference', text: '演示·明确的行为材料' }],
};
it.each(['not_supported', 'supported', 'insufficient', 'conflict'] as const)(
  '实际结构化客户端复核%s，保存模型和提示词版本',
  async (conclusion) => {
    const client = createFakeModelinkMaas({ conclusion }),
      called = vi.spyOn(client, 'generateStructured');
    expect(await createUnsupportedReview(client).review(input)).toEqual({
      status: conclusion === 'not_supported' ? 'confirmed' : 'disputed',
      conclusion,
      model: MODELINK_MODEL,
      promptVersion: MATCH_REVIEW_PROMPT_VERSION,
      error: null,
    });
    expect(called).toHaveBeenCalledTimes(1);
    const user = called.mock.calls[0]![0].messages.find(
      (m) => m.role === 'user',
    );
    expect(JSON.parse(user!.content as string)).toEqual(input);
  },
);
it('非法枚举/坏输出不生成判断，无额外重试', async () => {
  const client = createFakeModelinkMaas({ conclusion: 'probably' }),
    called = vi.spyOn(client, 'generateStructured');
  expect(await createUnsupportedReview(client).review(input)).toMatchObject({
    status: 'failed',
    conclusion: null,
    error: 'invalid_response',
  });
  expect(called).toHaveBeenCalledTimes(1);
});
it('超时分类不保存供应商正文或异常', async () => {
  const client = createFakeModelinkMaas({ conclusion: 'not_supported' });
  vi.spyOn(client, 'generateStructured').mockResolvedValue({
    ok: false,
    kind: 'outcome_unknown',
    reason: 'timeout',
    retryable: false,
    metadata: metadataFor(
      { promptVersion: MATCH_REVIEW_PROMPT_VERSION },
      MODELINK_MODEL,
    ),
  });
  expect(await createUnsupportedReview(client).review(input)).toMatchObject({
    status: 'failed',
    conclusion: null,
    error: 'timeout',
  });
  const failure = new Error('DO_NOT_STORE_RAW_PROVIDER_CONTENT');
  vi.spyOn(client, 'generateStructured').mockRejectedValue(failure);
  expect(
    JSON.stringify(await createUnsupportedReview(client).review(input)),
  ).not.toContain(failure.message);
});
it('无证据不调用客户端，缺真实客户端不启用fake默认', async () => {
  const client = createFakeModelinkMaas({ conclusion: 'not_supported' }),
    called = vi.spyOn(client, 'generateStructured');
  expect(
    await createUnsupportedReview(client).review({ ...input, evidence: [] }),
  ).toMatchObject({ status: 'failed', error: 'invalid_request' });
  expect(called).not.toHaveBeenCalled();
  expect(() =>
    createUnsupportedReview(undefined as unknown as typeof client),
  ).toThrow('Missing Gemini review client');
});
it('持久复核状态与枚举必须一致，不接受伪确认', () => {
  const base = {
    model: MODELINK_MODEL,
    promptVersion: MATCH_REVIEW_PROMPT_VERSION,
    error: null,
  };
  expect(
    unsupportedReviewSchema.safeParse({
      ...base,
      status: 'confirmed',
      conclusion: 'supported',
    }).success,
  ).toBe(false);
  expect(
    unsupportedReviewSchema.safeParse({
      ...base,
      status: 'failed',
      conclusion: null,
    }).success,
  ).toBe(false);
});

it('真实结构化回执模型或prompt版本不匹配则关闭', async () => {
  const client = createFakeModelinkMaas({ conclusion: 'not_supported' });
  vi.spyOn(client, 'generateStructured').mockResolvedValue({
    ok: true,
    value: { conclusion: 'not_supported' },
    metadata: {
      ...metadataFor(
        { promptVersion: MATCH_REVIEW_PROMPT_VERSION },
        MODELINK_MODEL,
      ),
      promptVersion: 'other-version',
    },
  });
  expect(await createUnsupportedReview(client).review(input)).toMatchObject({
    status: 'failed',
    conclusion: null,
    error: 'invalid_response',
  });
});

it('供应商返回另一个模型时明确分类为非法响应，不接受其元数据', async () => {
  const client = createFakeModelinkMaas({ conclusion: 'not_supported' });
  vi.spyOn(client, 'generateStructured').mockResolvedValue({
    ok: true,
    value: { conclusion: 'not_supported' },
    metadata: {
      ...metadataFor(
        { promptVersion: MATCH_REVIEW_PROMPT_VERSION },
        MODELINK_MODEL,
      ),
      model: 'different-provider-model' as typeof MODELINK_MODEL,
    },
  });
  expect(await createUnsupportedReview(client).review(input)).toMatchObject({
    status: 'failed',
    conclusion: null,
    error: 'invalid_response',
  });
});
