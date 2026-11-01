import { expect, it } from 'vitest';
import { createRecordArrangeTestClient } from './test-client';
import { arrangeRecord } from './index';
import { exampleSnapshot } from './examples';
import { modelArrangementSchema } from './schema';

it('is explicitly limited to the test environment', () => {
  expect(() => createRecordArrangeTestClient('production')).toThrow(
    'test environment',
  );
  expect(() => createRecordArrangeTestClient('development')).toThrow(
    'test environment',
  );
});
it('deterministically arranges only supplied authorized excerpts and leaves all scores unknown', async () => {
  const snapshot = exampleSnapshot();
  const client = createRecordArrangeTestClient('test');
  const first = await arrangeRecord(async () => snapshot, client);
  const second = await arrangeRecord(async () => snapshot, client);
  expect(first).toEqual(second);
  if (first.status !== 'arranged') throw new Error('expected offline draft');
  expect(first.value.draft.sbi.behavior).toBe(
    snapshot.authorization.sources[0]!.excerpt,
  );
  expect(first.value.draft.scores).toEqual([
    {
      state: 'unknown',
      personId: 'demo-lin',
      dimensionId: 'judgment',
      reason: '离线测试未形成评分建议',
    },
  ]);
  expect(first.value.evidence).toEqual([]);
  expect(first.value.draft.sbi.situation).toBe('');
});
it.each(['{', '{}', '{"people":[],"dimensions":[],"sources":[]}'])(
  'rejects a malformed offline payload without manufacturing behavior: %s',
  async (content) => {
    const result = await createRecordArrangeTestClient(
      'test',
    ).generateStructured({
      promptVersion: 'record-arrange.v1',
      messages: [
        { role: 'system', content: 'JSON' },
        { role: 'user', content },
      ],
      schema: modelArrangementSchema,
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'invalid_request',
      retryable: false,
    });
    expect(result.metadata.attempts).toBe(0);
  },
);
