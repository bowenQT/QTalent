import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  documentMessageSchema,
  documentBudgetSchema,
  documentOutcomeSchema,
  MATERIAL_PDF_DECODER_VERSION,
} from './document-protocol';
import { parseAttachment } from './parse';

const limits = { maxBytes: 100, maxFragments: 10, maxFragmentChars: 100 };
function output() {
  return {
    status: 'decoded' as const,
    segments: [
      {
        excerpt: '😀',
        location: {
          kind: 'document' as const,
          page: 1,
          paragraph: 'pdf:items:0-1',
        },
      },
    ],
    pdfText: {
      version: 'pdf-page-text-v1' as const,
      pages: [{ page: 1, text: ' 😀 ' }],
      ranges: [{ segmentIndex: 0, page: 1, textRange: { start: 1, end: 3 } }],
    },
  };
}
async function parsed(
  value: unknown,
  version = MATERIAL_PDF_DECODER_VERSION,
  format: 'pdf' | 'docx' = 'pdf',
) {
  const bytes = Buffer.from('synthetic adapter protocol bytes');
  return parseAttachment({
    version: {
      mediaId: 'demo',
      originalVersionId: 'demo',
      filename: `demo.${format}`,
      mediaType:
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    content: (async function* () {
      yield bytes;
    })(),
    limits,
    decoders: { [format]: { version, decode: async () => value } },
  });
}
describe('untrusted decoder page projection validation', () => {
  it('accepts an exact whole-code-point range and binds raw text in parse identity', async () => {
    const value = output();
    const first = await parsed(value);
    expect(first.status).toBe('parsed');
    value.pdfText.pages[0].text += '未保留装饰';
    const second = await parsed(value);
    expect(second.status).toBe('parsed');
    if (first.status === 'parsed' && second.status === 'parsed')
      expect(first.parseVersionId).not.toBe(second.parseVersionId);
  });
  it.each([
    [
      'missing range',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges = [];
      },
    ],
    [
      'duplicate range',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges.push(v.pdfText.ranges[0]);
      },
    ],
    [
      'wrong segment',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges[0].segmentIndex = 1;
      },
    ],
    [
      'missing physical page',
      (v: ReturnType<typeof output>) => {
        v.pdfText.pages[0].page = 2;
      },
    ],
    [
      'nonexistent range page',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges[0].page = 2;
      },
    ],
    [
      'wrong fragment page',
      (v: ReturnType<typeof output>) => {
        v.segments[0].location.page = 2;
      },
    ],
    [
      'reversed range',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges[0].textRange = { start: 3, end: 1 };
      },
    ],
    [
      'out of bounds',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges[0].textRange.end = 20;
      },
    ],
    [
      'changed excerpt',
      (v: ReturnType<typeof output>) => {
        v.segments[0].excerpt = '其他';
      },
    ],
    [
      'half pair start',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges[0].textRange.start = 2;
        v.segments[0].excerpt = '\ude00';
      },
    ],
    [
      'half pair end',
      (v: ReturnType<typeof output>) => {
        v.pdfText.ranges[0].textRange.end = 2;
        v.segments[0].excerpt = '\ud83d';
      },
    ],
    [
      'invalid page Unicode',
      (v: ReturnType<typeof output>) => {
        v.pdfText.pages[0].text += '\ud800';
      },
    ],
    [
      'page output overflow',
      (v: ReturnType<typeof output>) => {
        v.pdfText.pages[0].text = 'a'.repeat(1_000_001);
      },
    ],
    [
      'cumulative output overflow',
      (v: ReturnType<typeof output>) => {
        v.pdfText.pages.push({ page: 2, text: 'a'.repeat(999_999) });
      },
    ],
  ])('rejects %s without partial text', async (_name, alter) => {
    const value = output();
    alter(value);
    expect(documentOutcomeSchema.safeParse(value).success).toBe(false);
    expect(await parsed(value)).toMatchObject({
      status: 'failed',
      reason: 'invalid_content',
    });
  });
  it('rejects unknown projection fields/version, an omitted promised projection and legacy/DOCX masquerades', async () => {
    const value = output();
    expect(
      await parsed({
        ...value,
        pdfText: { ...value.pdfText, raw: 'not permitted' },
      }),
    ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
    expect(
      await parsed({
        ...value,
        pdfText: { ...value.pdfText, version: 'unknown' },
      }),
    ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
    expect(
      await parsed({ status: 'decoded', segments: value.segments }),
    ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
    expect(await parsed(value, 'pdfjs-dist@6.4.299:items-v2')).toMatchObject({
      status: 'failed',
      reason: 'invalid_content',
    });
    expect(
      await parsed(value, MATERIAL_PDF_DECODER_VERSION, 'docx'),
    ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
    expect(
      documentMessageSchema.safeParse({
        format: 'docx',
        bytes: new Uint8Array(),
        limits,
        budget: documentBudgetSchema.parse({}),
        capturePdfText: true,
      }).success,
    ).toBe(false);
  });
});
