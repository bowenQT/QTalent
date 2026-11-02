import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  parseAttachment,
  resolveAttachmentQuote,
  type AttachmentDecoder,
  type ParseAttachmentInput,
  type ParsedAttachment,
} from '.';
import { createDocumentDecoders } from './document-decoders';
import { decodeDocumentMessage } from './document-dispatch';
import {
  DOCX_DECODER_VERSION,
  PDF_DECODER_VERSION,
  documentBudgetSchema,
  type DocumentDecoderOptions,
} from './document-protocol';

const limits = {
  maxBytes: 1024 * 1024,
  maxFragments: 100,
  maxFragmentChars: 1000,
};
function directDecoders(
  options: DocumentDecoderOptions = {},
): Record<'docx' | 'pdf', AttachmentDecoder> {
  const budget = documentBudgetSchema.parse(options);
  return Object.fromEntries(
    (['docx', 'pdf'] as const).map((format) => [
      format,
      {
        version: format === 'docx' ? DOCX_DECODER_VERSION : PDF_DECODER_VERSION,
        decode: (bytes: Uint8Array, options: { limits: typeof limits }) =>
          decodeDocumentMessage({
            format,
            bytes,
            limits: options.limits,
            budget,
          }),
      },
    ]),
  ) as Record<'docx' | 'pdf', AttachmentDecoder>;
}
async function input(
  name: string,
  options: DocumentDecoderOptions = {},
): Promise<ParseAttachmentInput> {
  const bytes = await readFile(
    new URL(
      `../../../../../tests/fixtures/attachments/${name}`,
      import.meta.url,
    ),
  );
  return {
    version: {
      mediaId: 'synthetic-upload',
      originalVersionId: 'synthetic-version',
      filename: name,
      mediaType: name.endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    content: (async function* () {
      yield bytes;
    })(),
    limits,
    decoders: directDecoders(options),
  };
}
async function parsed(name: string): Promise<ParsedAttachment> {
  const result = await parseAttachment(await input(name));
  expect(result.status).toBe('parsed');
  if (result.status !== 'parsed') throw new Error('expected parsed');
  return result;
}
describe('real DOCX and PDF parsing', () => {
  it('extracts Chinese DOCX body paragraphs, preserves empty/break paragraph ordinals and never invents physical pages', async () => {
    const result = await parsed('chinese-pages.docx');
    expect(
      result.fragments.map((f) => ({
        excerpt: f.excerpt,
        location: f.location,
      })),
    ).toEqual([
      {
        excerpt: '第一段演示原文。',
        location: { kind: 'document', paragraph: 'docx:body:p1:u16:2-10' },
      },
      {
        excerpt: '第二页精确引用。',
        location: { kind: 'document', paragraph: 'docx:body:p4:u16:0-8' },
      },
    ]);
    expect(result.parserVersion).toContain('mammoth@1.13.0');
    expect(
      resolveAttachmentQuote(
        result,
        result.fragments[1].fragmentId,
        '精确引用',
        3,
      ),
    ).toMatchObject({ location: { paragraph: 'docx:body:p4:u16:0-8' } });
  });
  it('extracts real PDF Chinese text with physical page and actual item range citations', async () => {
    const result = await parsed('chinese-pages.pdf');
    expect(
      result.fragments.map((f) => ({
        excerpt: f.excerpt,
        location: f.location,
      })),
    ).toEqual([
      {
        excerpt: '第一页演示原文。',
        location: { kind: 'document', page: 1, paragraph: 'pdf:items:0-1' },
      },
      {
        excerpt: '同页第二行。',
        location: { kind: 'document', page: 1, paragraph: 'pdf:items:1-2' },
      },
      {
        excerpt: '第二页精确引用。',
        location: { kind: 'document', page: 2, paragraph: 'pdf:items:0-1' },
      },
    ]);
    expect(result.parserVersion).toContain('pdfjs-dist@6.4.299');
    expect(
      resolveAttachmentQuote(
        result,
        result.fragments[2].fragmentId,
        '精确引用',
        3,
      ),
    ).toMatchObject({
      originalVersionId: 'synthetic-version',
      location: { page: 2, paragraph: 'pdf:items:0-1' },
    });
    expect(
      resolveAttachmentQuote(
        result,
        result.fragments[0].fragmentId,
        '精确引用',
        3,
      ),
    ).toBeNull();
  });
  it.each(['campus', 'hr', 'professional'])(
    'decodes the BOW-896 synthetic %s PDF with a logo without treating the page as scanned',
    async (template) => {
      const value = await input(`logo-demo-${template}.pdf`);
      value.limits = { ...limits, maxFragments: 300 };
      const result = await parseAttachment(value);
      expect(result.status).toBe('parsed');
      if (result.status !== 'parsed') throw new Error('expected parsed');
      expect(
        result.fragments.some((fragment) => fragment.excerpt.includes('演示')),
      ).toBe(true);
      expect(
        result.fragments.every(
          (fragment) =>
            fragment.location.page !== undefined &&
            /^pdf:items:\d+-\d+$/.test(fragment.location.paragraph),
        ),
      ).toBe(true);
      expect(result.parserVersion).toContain('pdfjs-dist@6.4.299');
      if (template === 'hr') {
        expect(
          result.fragments.some((fragment) => fragment.location.page === 3),
        ).toBe(true);
      }
    },
  );
  it('filters rotated text and platform watermarks while keeping original item ranges and body mentions', async () => {
    const result = await parsed('filtered-text.pdf');
    expect(result.fragments.map((fragment) => fragment.excerpt)).toEqual([
      '演示正文一。',
      '北森平台对接说明。',
      '演示正文二。',
    ]);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(
        await readFile(
          new URL(
            '../../../../../tests/fixtures/attachments/filtered-text.pdf',
            import.meta.url,
          ),
        ),
      ),
      useSystemFonts: false,
    });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const text = await page.getTextContent({ disableNormalization: true });
      for (const fragment of result.fragments) {
        const match = /^pdf:items:(\d+)-(\d+)$/.exec(
          fragment.location.paragraph,
        );
        expect(match).not.toBeNull();
        const original = text.items
          .slice(Number(match![1]), Number(match![2]))
          .map((item) => ('str' in item ? item.str : ''))
          .join('')
          .trim();
        expect(fragment.location.page).toBe(1);
        expect(original).toBe(fragment.excerpt);
      }
    } finally {
      await task.destroy();
    }
  });
  it('does not compress physical page numbers when an actual blank page is skipped', async () => {
    expect(
      (await parsed('blank-middle.pdf')).fragments.map((f) => f.location.page),
    ).toEqual([1, 3]);
  });
  it.each(['empty.docx', 'empty.pdf'])(
    'rejects a valid empty %s without fake fragments',
    async (name) => {
      expect(await parseAttachment(await input(name))).toMatchObject({
        status: 'failed',
        reason: 'empty',
      });
    },
  );
  it.each(['docx', 'pdf'])(
    'rejects zero-byte %s before decoding',
    async (extension) => {
      const value = await input(`empty.${extension}`);
      value.version.byteLength = 0;
      value.version.sha256 = createHash('sha256').update('').digest('hex');
      value.content = (async function* () {
        yield new Uint8Array();
      })();
      expect(await parseAttachment(value)).toMatchObject({
        status: 'failed',
        reason: 'empty',
      });
    },
  );
  it('rejects actual DOCX tables rather than flattening cell text as a paragraph', async () => {
    expect(await parseAttachment(await input('table.docx'))).toMatchObject({
      status: 'unsupported',
      reason: 'format',
    });
  });
  it.each(['scanned.pdf', 'mixed-scanned.pdf'])(
    'rejects %s without publishing a partial text document',
    async (name) => {
      expect(await parseAttachment(await input(name))).toMatchObject({
        status: 'unsupported',
        reason: 'scanned',
      });
    },
  );
  it('fails closed when an oversized image would otherwise disappear from operator inspection', async () => {
    expect(
      await parseAttachment(await input('oversized-image.pdf')),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
  });
  it('fails closed when a missing-dimensions image is warned about and omitted by PDF.js', async () => {
    expect(
      await parseAttachment(await input('missing-image-size.pdf')),
    ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
  });
  it('reads only hyperlink display text and does not follow an external DOCX file URI', async () => {
    const result = await parsed('external-link.docx');
    expect(result.fragments[0].excerpt).toBe('外链显示文字');
    expect(JSON.stringify(result)).not.toContain('file:///');
  });
  it('preserves inline tab/line text and rejects unsupported body content without silently dropping it', async () => {
    expect((await parsed('inline.docx')).fragments[0].excerpt).toBe(
      '演示\t协作\n完成',
    );
    expect(
      await parseAttachment(await input('unsupported-content.docx')),
    ).toMatchObject({ status: 'unsupported', reason: 'format' });
  });
  it('rejects a PDF Table that is explicitly identified by the document structure tree', async () => {
    expect(
      await parseAttachment(await input('tagged-table.pdf')),
    ).toMatchObject({ status: 'unsupported', reason: 'format' });
  });
  it('enforces DOCX fragment, per-fragment and total output budgets', async () => {
    const fragments = await input('chinese-pages.docx');
    fragments.limits = { ...limits, maxFragments: 1 };
    expect(await parseAttachment(fragments)).toMatchObject({
      status: 'failed',
      reason: 'resource_limit',
    });
    const characters = await input('chinese-pages.docx');
    characters.limits = { ...limits, maxFragmentChars: 3 };
    expect(await parseAttachment(characters)).toMatchObject({
      status: 'failed',
      reason: 'resource_limit',
    });
    expect(
      await parseAttachment(
        await input('chinese-pages.docx', { maxOutputChars: 5 }),
      ),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
  });
  it('does not execute embedded PDF JavaScript and explicitly rejects the unsupported feature', async () => {
    expect(await parseAttachment(await input('javascript.pdf'))).toMatchObject({
      status: 'unsupported',
      reason: 'format',
    });
  });
  it('applies ZIP actual output budget and PDF page/text budgets', async () => {
    expect(
      await parseAttachment(
        await input('compressed-large.docx', { maxUncompressedBytes: 2048 }),
      ),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
    expect(
      await parseAttachment(await input('chinese-pages.pdf', { maxPages: 1 })),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
    expect(
      await parseAttachment(
        await input('chinese-pages.pdf', { maxOutputChars: 5 }),
      ),
    ).toMatchObject({ status: 'failed', reason: 'resource_limit' });
  });
  it.each(['docx', 'pdf'])(
    'classifies a corrupt %s through the real approved library',
    async (extension) => {
      const value = await input(`empty.${extension}`);
      const bytes = Buffer.from('not a valid document');
      value.version.byteLength = bytes.length;
      value.version.sha256 = createHash('sha256').update(bytes).digest('hex');
      value.content = (async function* () {
        yield bytes;
      })();
      expect(await parseAttachment(value)).toMatchObject({
        status: 'failed',
        reason: 'invalid_content',
      });
    },
  );
  it.each(['docx', 'pdf'])(
    'uses the actual isolated worker by default for %s',
    async (extension) => {
      const value = await input(`chinese-pages.${extension}`);
      delete value.decoders;
      expect(await parseAttachment(value)).toMatchObject({ status: 'parsed' });
    },
  );
  it('terminates actual workers on deadline and cancellation', async () => {
    const value = await input('chinese-pages.pdf');
    value.decoders = createDocumentDecoders({ maxDurationMs: 1 });
    expect(await parseAttachment(value)).toMatchObject({
      status: 'failed',
      reason: 'resource_limit',
    });
    const next = await input('chinese-pages.pdf');
    const controller = new AbortController();
    next.signal = controller.signal;
    next.decoders = createDocumentDecoders();
    const pending = parseAttachment(next);
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({
      status: 'failed',
      reason: 'cancelled',
    });
  });
});
