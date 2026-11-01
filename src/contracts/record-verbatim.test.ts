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

describe('final897 canonical public text and stable provenance identity', () => {
  it.each([
    '  林舟补写回滚步骤。  ',
    '\n林舟补写回滚步骤。\r\n',
    ' \n林舟补写回滚步骤。\n ',
  ])(
    'canonicalizes public input text and IDs while leaving the source argument unchanged: %j',
    (text) => {
      expect(recordInputSchema.parse(input(text))).toEqual({
        ...input(text),
        text: text.trim(),
        operation_id: 'operation-demo',
        attachmentIds: ['attachment-demo'],
        personId: 'demo-lin',
      });
    },
  );
  it.each(['input', 'source'] as const)(
    'canonicalizes a %s quote without inventing its offset or reference',
    (kind) => {
      const quote = ' \n林舟补写回滚步骤。\n ';
      const citation =
        kind === 'input'
          ? { kind, quote, start: 4, end: 4 + quote.length }
          : { kind, quote, reference };
      expect(recordCitationSchema.parse(citation)).toEqual({
        ...citation,
        quote: quote.trim(),
      });
      expect(citation.quote).toBe(quote);
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
  it('uses the frozen public text normalization while the original source value remains available', () => {
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
    expect(parsed.originalInput.text).toBe(originalInput.text.trim());
    expect(originalInput.text).toBe(' \n林舟补写回滚步骤。\n ');
    expect(parsed.draftId).toBe('draft-demo');
    expect(parsed.sbi.title).toBe('回滚记录');
    expect(parsed.people[0]).toMatchObject({
      candidates: [{ id: 'demo-lin', label: '林舟（演示）' }],
      reason: '请选择',
    });
  });
});
