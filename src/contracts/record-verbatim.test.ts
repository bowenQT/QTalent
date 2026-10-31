import { describe, expect, it } from 'vitest';
import {
  recordCitationSchema,
  recordDraftSchema,
  recordInputSchema,
} from './record';

const input = (text: string) => ({
  operation_id: ' operation-demo ',
  text,
  attachmentIds: [' attachment-demo '],
  personId: ' demo-lin ',
  projectId: null,
});
const reference = {
  fragmentId: 'fragment-demo',
  originalVersionId: 'version-demo',
  location: { kind: 'document' as const, paragraph: '1' },
};

describe('verbatim record input and citations', () => {
  it.each([
    '  林舟补写回滚步骤。  ',
    '\n林舟补写回滚步骤。\r\n',
    ' \n林舟补写回滚步骤。\n ',
  ])(
    'retains the exact original text while still normalizing IDs: %j',
    (text) => {
      expect(recordInputSchema.parse(input(text))).toEqual({
        ...input(text),
        operation_id: 'operation-demo',
        attachmentIds: ['attachment-demo'],
        personId: 'demo-lin',
      });
    },
  );
  it.each(['input', 'source'] as const)(
    'retains whitespace in a %s quote without changing its offset or reference',
    (kind) => {
      const quote = ' \n林舟补写回滚步骤。\n ';
      const citation =
        kind === 'input'
          ? { kind, quote, start: 4, end: 4 + quote.length }
          : { kind, quote, reference };
      expect(recordCitationSchema.parse(citation)).toEqual(citation);
    },
  );
  it.each(['', ' ', '\n\r\t'])(
    'continues to reject blank input and quotes: %j',
    (text) => {
      expect(recordInputSchema.safeParse(input(text)).success).toBe(false);
      expect(
        recordCitationSchema.safeParse({
          kind: 'input',
          quote: text,
          start: 0,
          end: 1,
        }).success,
      ).toBe(false);
      expect(
        recordCitationSchema.safeParse({
          kind: 'source',
          quote: text,
          reference,
        }).success,
      ).toBe(false);
    },
  );
  it('preserves raw input through draft parsing while ordinary titles and labels keep their existing normalization', () => {
    const originalInput = input(' \n林舟补写回滚步骤。\n ');
    const parsed = recordDraftSchema.parse({
      draftId: ' draft-demo ',
      revision: 1,
      origin: 'text',
      originalInput,
      sbi: {
        title: ' 回滚记录 ',
        situation: '',
        behavior: ' 补写回滚步骤 ',
        impact: '',
      },
      people: [
        {
          state: 'needs_selection',
          candidates: [{ id: ' demo-lin ', label: ' 林舟（演示） ' }],
          reason: ' 请选择 ',
        },
      ],
      project: { state: 'none' },
      scores: [],
    });
    expect(parsed.originalInput.text).toBe(originalInput.text);
    expect(parsed.draftId).toBe('draft-demo');
    expect(parsed.sbi.title).toBe('回滚记录');
    expect(parsed.people[0]).toMatchObject({
      candidates: [{ id: 'demo-lin', label: '林舟（演示）' }],
      reason: '请选择',
    });
  });
});
