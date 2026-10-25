import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sourceReferenceSchema } from '../../../../contracts/sources';
import { attachmentParseResultSchema } from '../../../../contracts/media';
import {
  parseAttachment,
  resolveAttachmentQuote,
  type AttachmentDecoder,
  type AttachmentVersion,
  type ParseAttachmentInput,
} from '.';

const limits = { maxBytes: 16384, maxFragments: 100, maxFragmentChars: 1000 };
function input(
  text: string | Uint8Array,
  patch: Partial<AttachmentVersion> = {},
): ParseAttachmentInput {
  const bytes = typeof text === 'string' ? Buffer.from(text) : text;
  return {
    version: {
      mediaId: 'upload-1',
      originalVersionId: 'version-1',
      filename: '演示材料.txt',
      mediaType: 'text/plain',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ...patch,
    },
    content: (async function* () {
      yield bytes.subarray(0, 1);
      yield bytes.subarray(1);
    })(),
    limits,
  };
}
async function parsed(text: string, patch: Partial<AttachmentVersion> = {}) {
  const result = await parseAttachment(input(text, patch));
  expect(result.status).toBe('parsed');
  if (result.status !== 'parsed') throw new Error('expected parsed');
  return result;
}

describe('attachment parser', () => {
  it('preserves Chinese and CRLF exact substrings with post-BOM UTF16 offsets and no fabricated page', async () => {
    const original = '  演示人员协作\r\n完成任务。\r\n \t\r\n第二段🙂。  ';
    const result = await parsed('\uFEFF' + original);
    expect(result.fragments.map((f) => f.excerpt)).toEqual([
      '演示人员协作\r\n完成任务。',
      '第二段🙂。',
    ]);
    expect(result.fragments[0].location).toEqual({
      kind: 'document',
      paragraph: 'txt:p1:u16:2-15',
    });
    const secondStart = original.indexOf('第二段');
    expect(result.fragments[1].location).toEqual({
      kind: 'document',
      paragraph: `txt:p2:u16:${secondStart}-${secondStart + '第二段🙂。'.length}`,
    });
    for (const f of result.fragments)
      expect(
        sourceReferenceSchema.safeParse({
          fragmentId: f.fragmentId,
          originalVersionId: f.originalVersionId,
          location: f.location,
        }).success,
      ).toBe(true);
    expect(
      attachmentParseResultSchema.safeParse({
        status: 'parsed',
        parseVersionId: result.parseVersionId,
        fragments: result.fragments,
      }).success,
    ).toBe(true);
  });
  it('keeps repeated paragraphs separate and explicit form feed as segmentation without inventing pages', async () => {
    const result = await parsed('重复。\n\n重复。\f第三段。');
    expect(result.fragments).toHaveLength(3);
    expect(new Set(result.fragments.map((f) => f.fragmentId)).size).toBe(3);
    expect(result.fragments.every((f) => f.location.page === undefined)).toBe(
      true,
    );
  });
  it('has stable replay identities but isolates source versions and parser versions', async () => {
    const a = await parsed('演示。');
    const b = await parsed('演示。');
    const c = await parsed('演示。', { originalVersionId: 'version-2' });
    expect(a).toEqual(b);
    expect(c.parseVersionId).not.toBe(a.parseVersionId);
    expect(c.fragments[0].fragmentId).not.toBe(a.fragments[0].fragmentId);
  });
  it('accepts one byte and preserves HTML-looking source as text', async () => {
    expect((await parsed('a')).fragments[0].excerpt).toBe('a');
    expect((await parsed('<script>演示</script>')).fragments[0].excerpt).toBe(
      '<script>演示</script>',
    );
  });
  it.each(['', ' \t\n\r\n', '\uFEFF'])(
    'rejects empty/blank content without fake fragments %#',
    async (text) => {
      expect(await parseAttachment(input(text))).toMatchObject({
        status: 'failed',
        reason: 'empty',
      });
    },
  );
  it.each([
    new Uint8Array([0xc3, 0x28]),
    new Uint8Array([0]),
    new Uint8Array([0x1b, 0x41]),
  ])('rejects invalid UTF8 and non-text controls %#', async (bytes) => {
    expect(await parseAttachment(input(bytes))).toMatchObject({
      status: 'failed',
      reason: 'invalid_content',
    });
  });
  it.each([
    [
      'file.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    [
      'file.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    ['file.mp4', 'video/mp4'],
    ['file.doc', 'application/msword'],
  ])(
    'explicitly rejects out-of-scope %s before reading',
    async (filename, mediaType) => {
      const value = input('irrelevant', { filename, mediaType });
      value.content = (async function* () {
        throw new Error('must not read');
      })();
      expect(await parseAttachment(value)).toEqual({
        status: 'unsupported',
        reason: 'format',
        message: '暂不支持，请上传 TXT、DOCX 或文字型 PDF',
      });
    },
  );
  it.each([
    [
      'file.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['file.pdf', 'application/pdf'],
  ])(
    'reports an absent approved adapter as unavailable for %s',
    async (filename, mediaType) => {
      expect(
        await parseAttachment(input('fixture', { filename, mediaType })),
      ).toMatchObject({ status: 'failed', reason: 'dependency_unavailable' });
    },
  );
  it('rejects a declared format mismatch', async () => {
    expect(
      await parseAttachment(
        input('hello', { filename: 'file.txt', mediaType: 'application/pdf' }),
      ),
    ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
  });
  it.each([{ sha256: '0'.repeat(64) }, { byteLength: 1 }])(
    'rechecks verified length and digest %#',
    async (patch) => {
      expect(await parseAttachment(input('真实原文', patch))).toMatchObject({
        status: 'failed',
        reason: 'integrity',
      });
    },
  );
  it('fails on resource caps without publishing a partial document', async () => {
    const bytes = input('abcd');
    bytes.limits = { ...limits, maxBytes: 3 };
    expect(await parseAttachment(bytes)).toMatchObject({
      status: 'failed',
      reason: 'resource_limit',
    });
    const fragments = input('a\n\nb');
    fragments.limits = { ...limits, maxFragments: 1 };
    expect(await parseAttachment(fragments)).toMatchObject({
      status: 'failed',
      reason: 'resource_limit',
    });
    const chars = input('abcd');
    chars.limits = { ...limits, maxFragmentChars: 3 };
    expect(await parseAttachment(chars)).toMatchObject({
      status: 'failed',
      reason: 'resource_limit',
    });
  });
  it('does not expose stream errors or continue after cancellation', async () => {
    const broken = input('a');
    broken.content = (async function* () {
      throw new Error('private object key');
    })();
    expect(await parseAttachment(broken)).toEqual({
      status: 'failed',
      reason: 'processing_failed',
      message: '附件解析失败，请稍后重试',
    });
    const controller = new AbortController();
    controller.abort();
    expect(
      await parseAttachment({ ...input('a'), signal: controller.signal }),
    ).toMatchObject({ status: 'failed', reason: 'cancelled' });
  });
  it('validates real PDF page/paragraph locators from the decoder port and keeps each quote local', async () => {
    const decoder: AttachmentDecoder = {
      version: 'fixture-pdf-v1',
      decode: vi.fn().mockResolvedValue({
        status: 'decoded',
        segments: [
          {
            excerpt: '第一页中文',
            location: { kind: 'document', page: 1, paragraph: 'items:0-2' },
          },
          {
            excerpt: '第二页原句',
            location: { kind: 'document', page: 2, paragraph: 'items:0-1' },
          },
        ],
      }),
    };
    const result = await parseAttachment({
      ...input('synthetic', {
        filename: 'file.pdf',
        mediaType: 'application/pdf',
      }),
      decoders: { pdf: decoder },
    });
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') throw new Error('expected parsed');
    expect(result.fragments.map((f) => f.location.page)).toEqual([1, 2]);
    const ref = resolveAttachmentQuote(
      result,
      result.fragments[1].fragmentId,
      '原句',
      3,
    );
    expect(ref).toEqual({
      fragmentId: result.fragments[1].fragmentId,
      originalVersionId: 'version-1',
      location: { kind: 'document', page: 2, paragraph: 'items:0-1' },
    });
    expect(
      resolveAttachmentQuote(
        result,
        result.fragments[1].fragmentId,
        '第一页中文',
        0,
      ),
    ).toBeNull();
    expect(resolveAttachmentQuote(result, 'made-up', '原句', 3)).toBeNull();
    expect(
      resolveAttachmentQuote(result, result.fragments[1].fragmentId, '原句', 0),
    ).toBeNull();
  });
  it.each([
    {
      status: 'decoded',
      segments: [
        { excerpt: 'text', location: { kind: 'document', paragraph: 'p1' } },
      ],
    },
    {
      status: 'decoded',
      segments: [
        {
          excerpt: 'text',
          location: { kind: 'document', paragraph: 'p1', page: 0 },
        },
      ],
    },
    {
      status: 'decoded',
      segments: [
        {
          excerpt: 'text',
          location: { kind: 'document', paragraph: 'p1', page: 1 },
        },
        {
          excerpt: 'other',
          location: { kind: 'document', paragraph: 'p1', page: 1 },
        },
      ],
    },
    { status: 'decoded', segments: [], url: 'https://private.invalid' },
  ])(
    'rejects malformed decoder output without source forgery %#',
    async (output) => {
      expect(
        await parseAttachment({
          ...input('fixture', {
            filename: 'file.pdf',
            mediaType: 'application/pdf',
          }),
          decoders: { pdf: { version: 'test-v1', decode: async () => output } },
        }),
      ).toMatchObject({ status: 'failed', reason: 'invalid_content' });
    },
  );
  it('passes through explicit scanned/table unsupported from decoder without success', async () => {
    for (const reason of ['scanned', 'format'] as const) {
      expect(
        await parseAttachment({
          ...input('fixture', {
            filename: 'file.pdf',
            mediaType: 'application/pdf',
          }),
          decoders: {
            pdf: {
              version: 'test-v1',
              decode: async () => ({ status: 'unsupported', reason }),
            },
          },
        }),
      ).toMatchObject({ status: 'unsupported', reason });
    }
  });
  it('accepts a DOCX decoder paragraph without inventing rendered pages (port test only)', async () => {
    const result = await parseAttachment({
      ...input('fixture', {
        filename: 'file.docx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      decoders: {
        docx: {
          version: 'test-v1',
          decode: async () => ({
            status: 'decoded',
            segments: [
              {
                excerpt: '正文',
                location: { kind: 'document', paragraph: 'body:p3' },
              },
            ],
          }),
        },
      },
    });
    expect(result.status).toBe('parsed');
    if (result.status === 'parsed')
      expect(result.fragments[0].location).toEqual({
        kind: 'document',
        paragraph: 'body:p3',
      });
  });
});
