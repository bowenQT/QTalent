import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { materialSourceSchema } from '../../../../contracts/sources';
import {
  createMaterialPdfDecoder,
  createDocumentDecoders,
} from '../attachments/document-decoders';
import { MATERIAL_PDF_DECODER_VERSION } from '../attachments/document-protocol';
import { parseAttachment } from '../attachments/parse';
import {
  MaterialProjectionError,
  projectAttachmentPdf,
  verifyPdfParse,
} from './projection';

// Fixed combination: BOW-866 17ce4a52ecba0fe8e459d7bd1e4a0e02d673d803
// plus BOW-926 a5d13dc67ff381bf3013c13ee912743961192d33. No DB or mock decoder.
const originalVersionId = 'demo-926-pdf-version';
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const limits = {
  maxBytes: 1_000_000,
  maxFragments: 100,
  maxFragmentChars: 1000,
};
async function fixture(name: string) {
  return readFile(
    new URL(
      `../../../../../tests/fixtures/attachments/${name}`,
      import.meta.url,
    ),
  );
}
async function decode(bytes: Uint8Array, material = true) {
  return parseAttachment({
    version: {
      mediaId: 'demo-926-upload',
      originalVersionId,
      filename: 'demo.pdf',
      mediaType: 'application/pdf',
      byteLength: bytes.length,
      sha256: sha256(bytes),
    },
    content: (async function* () {
      yield bytes;
    })(),
    limits,
    decoders: {
      pdf: material ? createMaterialPdfDecoder() : createDocumentDecoders().pdf,
    },
  });
}
async function project(bytes: Uint8Array) {
  const parsed = await decode(bytes);
  if (parsed.status !== 'parsed')
    throw new Error(`synthetic PDF failed: ${parsed.status}`);
  const expected = {
    parseVersionId: parsed.parseVersionId,
    originalVersionId,
    contentDigest: sha256(bytes),
    parserVersion: `pdf:${MATERIAL_PDF_DECODER_VERSION}`,
    projectionVersion: 'pdf-page-text-v1',
  };
  const result = projectAttachmentPdf(parsed, expected, {
    sourceCategory: 'original',
    demo: true,
  });
  expect(result.binding).toEqual(expected);
  expect(result.fragments.map((source) => source.fragmentId).sort()).toEqual(
    parsed.fragments.map((source) => source.fragmentId).sort(),
  );
  for (const source of result.fragments) {
    expect(materialSourceSchema.parse(source)).toEqual(source);
    expect(
      result.pages[source.location.page - 1].text.slice(
        source.location.textRange.start,
        source.location.textRange.end,
      ),
    ).toBe(source.excerpt);
  }
  expect(verifyPdfParse(JSON.parse(JSON.stringify(result)), expected)).toEqual(
    result,
  );
  return { parsed, expected, result };
}
// Entirely synthetic one-page PDF: three CIDs map to 演, 😀, 示. The actual
// PDF.js ToUnicode decoder, not a mock string, must produce four UTF-16 units.
function unicodePdf() {
  const stream = (s: string) => `<< /Length ${Buffer.byteLength(s)} >>
stream
${s}
endstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [8 0 R] >>',
    stream(
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Demo-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 3 beginbfchar <0001> <6F14> <0002> <D83DDE00> <0003> <793A> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
    ),
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 4 0 R /DW 1000 >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 3 0 R >>',
    stream('BT /F1 12 Tf 40 730 Td <000100020003> Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
  ];
  let output = '%PDF-1.7\n';
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj
${object}
endobj
`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (const offset of offsets)
    output += `${String(offset).padStart(10, '0')} 00000 n 
`;
  output += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
  return Buffer.from(output);
}

describe('real PDF bytes → production worker → canonical projection', () => {
  it('keeps exact multi-page text, real span positions and deterministic producer identities', async () => {
    const bytes = await fixture('chinese-pages.pdf');
    const first = await project(bytes);
    expect(
      first.result.pages.map(({ page, text }) => ({ page, text })),
    ).toEqual([
      { page: 1, text: '第一页演示原文。\n同页第二行。' },
      { page: 2, text: '第二页精确引用。' },
    ]);
    const sources = first.result.fragments.map(({ excerpt, location }) => ({
      excerpt,
      location,
    }));
    expect(sources).toHaveLength(3);
    expect(sources).toEqual(
      expect.arrayContaining([
        {
          excerpt: '第一页演示原文。',
          location: { kind: 'pdf', page: 1, textRange: { start: 0, end: 8 } },
        },
        {
          excerpt: '同页第二行。',
          location: { kind: 'pdf', page: 1, textRange: { start: 9, end: 15 } },
        },
        {
          excerpt: '第二页精确引用。',
          location: { kind: 'pdf', page: 2, textRange: { start: 0, end: 8 } },
        },
      ]),
    );
    expect((await project(bytes)).result).toEqual(first.result);
    const legacy = await decode(bytes, false);
    expect(legacy.status).toBe('parsed');
    expect(legacy).not.toHaveProperty('pdfText');
    expect(() =>
      projectAttachmentPdf(legacy, first.expected, {
        sourceCategory: 'original',
        demo: true,
      }),
    ).toThrow(MaterialProjectionError);
  }, 60000);

  it('retains a blank middle physical page rather than renumbering later citations', async () => {
    const { result } = await project(await fixture('blank-middle.pdf'));
    expect(result.pages.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(result.pages[1].text).toBe('');
    expect(
      result.fragments.map((source) => source.location.page).sort(),
    ).toEqual([1, 3]);
  }, 60000);

  it('keeps filtered raw text in the page while admitting only retained excerpts', async () => {
    const { result } = await project(await fixture('filtered-text.pdf'));
    expect(result.pages[0].text).toContain('非水平装饰。');
    expect(result.pages[0].text).toContain('www.beisen.com');
    expect(result.fragments.map((source) => source.excerpt).sort()).toEqual(
      ['演示正文一。', '北森平台对接说明。', '演示正文二。'].sort(),
    );
  }, 60000);

  it('validates real ToUnicode surrogate pairs and rejects a post-decode split even when the quote agrees', async () => {
    const { parsed, expected, result } = await project(unicodePdf());
    expect(result.pages[0].text).toBe('演😀示');
    expect(result.fragments[0].location.textRange).toEqual({
      start: 0,
      end: 4,
    });
    const tampered = structuredClone(parsed);
    tampered.pdfText!.ranges[0].textRange = { start: 1, end: 2 };
    tampered.fragments[0].excerpt = '\ud83d';
    expect(() =>
      projectAttachmentPdf(tampered, expected, {
        sourceCategory: 'original',
        demo: true,
      }),
    ).toThrow(MaterialProjectionError);
    expect(() =>
      projectAttachmentPdf(
        parsed,
        { ...expected, contentDigest: '0'.repeat(64) },
        { sourceCategory: 'original', demo: true },
      ),
    ).toThrow(MaterialProjectionError);
  }, 60000);

  it.each([
    'mixed-scanned.pdf',
    'javascript.pdf',
    'tagged-table.pdf',
    'empty.pdf',
  ])(
    'does not manufacture canonical success from rejected %s',
    async (name) => {
      const bytes = await fixture(name);
      const parsed = await decode(bytes);
      expect(parsed.status).not.toBe('parsed');
      expect(() =>
        projectAttachmentPdf(
          parsed,
          {
            parseVersionId: 'unavailable',
            originalVersionId,
            contentDigest: sha256(bytes),
            parserVersion: `pdf:${MATERIAL_PDF_DECODER_VERSION}`,
            projectionVersion: 'pdf-page-text-v1',
          },
          { sourceCategory: 'original', demo: true },
        ),
      ).toThrow(MaterialProjectionError);
    },
    60000,
  );
});
