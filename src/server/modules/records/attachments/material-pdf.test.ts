import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { decodeDocumentMessage } from './document-dispatch';
import {
  documentBudgetSchema,
  MATERIAL_PDF_DECODER_VERSION,
} from './document-protocol';
vi.setConfig({ testTimeout: 60000 });
import {
  createDocumentDecoders,
  createMaterialPdfDecoder,
} from './document-decoders';
import { parseAttachment } from './parse';
import type { AttachmentDecoder, ParsedAttachment } from './types';

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
async function parse(
  bytes: Uint8Array,
  decoder: AttachmentDecoder = {
    version: MATERIAL_PDF_DECODER_VERSION,
    decode: (bytes, options) =>
      decodeDocumentMessage({
        format: 'pdf',
        bytes,
        limits: options.limits,
        budget: documentBudgetSchema.parse({}),
        capturePdfText: true,
      }),
  },
) {
  return parseAttachment({
    version: {
      mediaId: 'demo-upload',
      originalVersionId: 'demo-pdf-version',
      filename: 'demo.pdf',
      mediaType: 'application/pdf',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    content: (async function* () {
      yield bytes;
    })(),
    limits,
    decoders: { pdf: decoder },
  });
}
function requireParsed(
  result: Awaited<ReturnType<typeof parse>>,
): ParsedAttachment {
  expect(result.status).toBe('parsed');
  if (result.status !== 'parsed')
    throw new Error('expected synthetic PDF success');
  return result;
}
function verifyRanges(result: ParsedAttachment) {
  expect(result.pdfText?.version).toBe('pdf-page-text-v1');
  expect(result.pdfText?.ranges).toHaveLength(result.fragments.length);
  for (const range of result.pdfText!.ranges) {
    const fragment = result.fragments.find(
      (f) => f.fragmentId === range.fragmentId,
    )!;
    const page = result.pdfText!.pages.find((p) => p.page === range.page)!;
    expect(page.text.slice(range.textRange.start, range.textRange.end)).toBe(
      fragment.excerpt,
    );
    expect(fragment.location.page).toBe(range.page);
  }
}
// A real, self-contained synthetic PDF. CID 0001 maps to an astral character;
// no font files, employee data, external requests or fixture directory writes.
function astralPdf() {
  const objects: string[] = ['', ''];
  const add = (value: string) => objects.push(value);
  const stream = (value: string) =>
    `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`;
  const cmap = add(
    stream(
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Demo-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 3 beginbfchar <0001> <D83DDE00> <0002> <6F14> <0003> <793A> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
    ),
  );
  const descriptor = add(
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
  );
  const descendant = add(
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor ${descriptor} 0 R /DW 1000 >>`,
  );
  const font = add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${cmap} 0 R >>`,
  );
  const content = add(stream('BT /F1 12 Tf 40 730 Td <000200010003> Tj ET'));
  const page = add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
  );
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count 1 /Kids [${page} 0 R] >>`;
  let output = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}

describe('versioned material PDF production input', () => {
  it('returns actual page text and verified ranges through the bounded production worker', async () => {
    const bytes = await fixture('chinese-pages.pdf');
    const legacy = requireParsed(
      await parse(bytes, createDocumentDecoders().pdf),
    );
    const result = requireParsed(
      await parse(bytes, createMaterialPdfDecoder()),
    );
    verifyRanges(result);
    expect(result.pdfText?.pages).toEqual([
      { page: 1, text: '第一页演示原文。\n同页第二行。' },
      { page: 2, text: '第二页精确引用。' },
    ]);
    expect(
      result.fragments.map(({ excerpt, location }) => ({ excerpt, location })),
    ).toEqual(
      legacy.fragments.map(({ excerpt, location }) => ({ excerpt, location })),
    );
    expect(legacy).not.toHaveProperty('pdfText');
    expect(result.parseVersionId).not.toBe(legacy.parseVersionId);
    expect(requireParsed(await parse(bytes)).parseVersionId).toBe(
      result.parseVersionId,
    );
  });
  it('retains empty physical pages without manufacturing fragments', async () => {
    const result = requireParsed(
      await parse(await fixture('blank-middle.pdf')),
    );
    verifyRanges(result);
    expect(result.pdfText?.pages[1]).toEqual({ page: 2, text: '' });
    expect(result.pdfText?.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(result.pdfText?.ranges.map((r) => r.page)).toEqual([1, 3]);
  });
  it('keeps actual rotated text and watermark in page text while ranges select only retained evidence', async () => {
    const result = requireParsed(
      await parse(await fixture('filtered-text.pdf')),
    );
    verifyRanges(result);
    const text = result.pdfText!.pages[0].text;
    expect(text).toContain('非水平装饰。');
    expect(text).toContain('www.beisen.com');
    expect(result.fragments.map((f) => f.excerpt)).toEqual([
      '演示正文一。',
      '北森平台对接说明。',
      '演示正文二。',
    ]);
    expect(result.pdfText!.ranges[1].textRange.start).toBe(
      text.indexOf('北森平台对接说明。'),
    );
  });
  it('uses UTF-16 offsets for a real ToUnicode surrogate pair', async () => {
    const result = requireParsed(await parse(astralPdf()));
    verifyRanges(result);
    expect(result.pdfText!.pages[0].text).toBe('演😀示');
    expect(result.pdfText!.ranges[0].textRange).toEqual({ start: 0, end: 4 });
  });
  it.each([
    'mixed-scanned.pdf',
    'javascript.pdf',
    'tagged-table.pdf',
    'empty.pdf',
  ])(
    'never returns partial page text when %s cannot produce a supported parse',
    async (name) => {
      const result = await parse(await fixture(name));
      expect(result.status).not.toBe('parsed');
      expect(result).not.toHaveProperty('pdfText');
    },
  );
  it('bounds all raw page text, including filtered text, and preserves cancellation', async () => {
    const bytes = await fixture('filtered-text.pdf');
    expect(
      await parse(bytes, createMaterialPdfDecoder({ maxOutputChars: 30 })),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
    const controller = new AbortController();
    controller.abort();
    expect(
      await createMaterialPdfDecoder().decode(bytes, {
        limits,
        signal: controller.signal,
      }),
    ).toEqual({ status: 'failed', reason: 'cancelled' });
  });
});
