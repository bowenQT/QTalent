import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { parseAttachment } from '../attachments/parse';
import { createDocumentDecoders } from '../attachments/document-decoders';
import { projectAttachmentDocument } from './attachment-document-save';
import { verifyUploadObject } from '../uploads/content';
import { fixture } from '../../../../../tests/fixtures/upload-fake';

async function document(format: 'txt' | 'docx' = 'txt') {
  const bytes =
    format === 'txt'
      ? Buffer.from(
          '\uFEFF  第一段演示原文。\r\n保留段内换行。\r\n\r\n第二段精确引用。  ',
        )
      : await readFile('tests/fixtures/attachments/chinese-pages.docx');
  const version = {
    mediaId: 'demo-upload',
    originalVersionId: 'demo-original',
    filename: `demo.${format}`,
    mediaType:
      format === 'txt'
        ? 'text/plain'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const parsed = await parseAttachment({
    version,
    content: (async function* () {
      yield bytes;
    })(),
    limits: {
      maxBytes: 1024 * 1024,
      maxFragments: 100,
      maxFragmentChars: 10000,
    },
    decoders: createDocumentDecoders(),
  });
  if (parsed.status !== 'parsed')
    throw new Error(`Expected real ${format} parse`);
  return { parsed, version };
}
const provenance = { sourceCategory: 'original', demo: true };
it.each(['txt', 'docx'] as const)(
  'projects real %s text with unchanged paragraph sources and no physical pages',
  async (format) => {
    const { parsed, version } = await document(format);
    const projected = projectAttachmentDocument(parsed, version, provenance);
    expect(projected.pages).toEqual([]);
    expect(projected.binding).toMatchObject({
      parseVersionId: parsed.parseVersionId,
      originalVersionId: version.originalVersionId,
      parserVersion: parsed.parserVersion,
      projectionVersion: 'document-paragraph-v1',
    });
    expect(projected.fragments).toHaveLength(2);
    for (const fragment of parsed.fragments)
      expect(projected.fragments).toContainEqual({
        ...fragment,
        ...provenance,
      });
    if (format === 'docx')
      expect(parsed.fragments.map((f) => f.location.paragraph)).toEqual([
        'docx:body:p1:u16:2-10',
        'docx:body:p4:u16:0-8',
      ]);
    else {
      const text =
        '\uFEFF  第一段演示原文。\r\n保留段内换行。\r\n\r\n第二段精确引用。  '.slice(
          1,
        );
      for (const fragment of projected.fragments) {
        if (fragment.location.kind !== 'document')
          throw new Error('Expected paragraph');
        const [start, end] = fragment.location.paragraph
          .split(':u16:')[1]
          .split('-')
          .map(Number);
        expect(text.slice(start, end)).toBe(fragment.excerpt);
      }
    }
  },
);
it.each([
  'version',
  'digest',
  'parser',
  'format',
  'range',
  'order',
  'page',
  'duplicate',
  'provenance',
  'pdfText',
] as const)(
  'refuses mismatched %s rather than publishing invented document sources',
  async (kind) => {
    const { parsed, version } = await document();
    const changed = structuredClone(parsed);
    let source: unknown = provenance;
    if (kind === 'version')
      changed.fragments[0].originalVersionId = 'other-original';
    if (kind === 'digest') changed.sha256 = 'a'.repeat(64);
    if (kind === 'parser') changed.parserVersion = 'docx:unapproved';
    if (kind === 'format') version.mediaType = 'application/pdf';
    if (kind === 'range')
      changed.fragments[0].location.paragraph = 'txt:p1:u16:0-1';
    if (kind === 'order') changed.fragments.reverse();
    if (kind === 'page') changed.fragments[0].location.page = 1;
    if (kind === 'duplicate')
      changed.fragments[1].fragmentId = changed.fragments[0].fragmentId;
    if (kind === 'provenance')
      source = {
        ...provenance,
        sourceCategory: 'historical_evaluation',
        evaluationKind: 'interview',
      };
    if (kind === 'pdfText')
      changed.pdfText = { version: 'pdf-page-text-v1', pages: [], ranges: [] };
    expect(() => projectAttachmentDocument(changed, version, source)).toThrow(
      'invalid_material_parse',
    );
  },
);

it('a corrupted DOCX with a valid upload envelope reaches the real decoder and fails safely', async () => {
  const bytes = await readFile('tests/fixtures/attachments/chinese-pages.docx');
  const payload = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  bytes[payload] ^= 1;
  const mediaType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const fake = fixture();
  await fake.put('synthetic/corrupt-docx', bytes, mediaType);
  const object = await verifyUploadObject(
    fake.options.storage,
    'synthetic/corrupt-docx',
    {
      ...fake.request,
      filename: 'corrupt.docx',
      declaredBytes: bytes.length,
      declaredMediaType: mediaType,
    },
  );
  expect(object.byteLength).toBe(bytes.length);
  const result = await parseAttachment({
    version: {
      mediaId: 'demo-upload',
      originalVersionId: 'demo-corrupt',
      filename: 'corrupt.docx',
      mediaType,
      byteLength: bytes.length,
      sha256: object.sha256,
    },
    content: (async function* () {
      yield bytes;
    })(),
    limits: {
      maxBytes: 1024 * 1024,
      maxFragments: 100,
      maxFragmentChars: 10000,
    },
    decoders: createDocumentDecoders(),
  });
  expect(result).toMatchObject({ status: 'failed', reason: 'invalid_content' });
});
