import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeDocumentMessage } from './document-dispatch';
import { documentBudgetSchema } from './document-protocol';

const state = vi.hoisted(() => ({
  warnings: [] as unknown[][],
  failure: null as 'operators' | 'text' | null,
  images: false,
  vectorOnly: false,
  items: [] as Array<{
    str: string;
    dir: string;
    transform: number[];
    hasEOL: boolean;
  }>,
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async (importOriginal) => {
  const pdf =
    await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
  return {
    ...pdf,
    getDocument() {
      return {
        promise: Promise.resolve({
          numPages: 1,
          isPureXfa: false,
          getJSActions: async () => null,
          getAttachments: async () => null,
          _transport: {
            messageHandler: { sendWithStream: () => new ReadableStream() },
          },
          async getPage() {
            return {
              pageNumber: 1,
              getStructTree: async () => null,
              getJSActions: async () => null,
              async getOperatorList() {
                for (const warning of state.warnings) console.warn(...warning);
                if (state.failure === 'operators')
                  throw new Error('synthetic operator stream error');
                return {
                  fnArray: state.images
                    ? [pdf.OPS.paintImageXObject]
                    : state.vectorOnly
                      ? [pdf.OPS.constructPath]
                      : [],
                };
              },
              async getTextContent() {
                if (state.failure === 'text')
                  throw new Error('synthetic text stream error');
                return { items: state.items };
              },
              cleanup() {},
            };
          },
        }),
        async destroy() {},
      };
    },
  };
});
function item(str: string, hasEOL = true, transform = [12, 0, 0, 12, 40, 700]) {
  return { str, dir: 'ltr', transform, hasEOL };
}
const decode = () =>
  decodeDocumentMessage({
    format: 'pdf',
    bytes: new Uint8Array([1]),
    limits: { maxBytes: 100, maxFragments: 10, maxFragmentChars: 100 },
    budget: documentBudgetSchema.parse({}),
  });
beforeEach(() => {
  state.warnings = [];
  state.failure = null;
  state.images = false;
  state.vectorOnly = false;
  state.items = [item('演示正文')];
});
describe('PDF diagnostics and original item positions', () => {
  it.each([
    'Warning: TT: undefined function: 21',
    'Warning: TT: CALL non-existent function',
  ])(
    'accepts a pinned font hint diagnostic without discarding valid text: %s',
    async (warning) => {
      const original = console.warn;
      state.warnings = [[warning]];
      expect(await decode()).toMatchObject({
        status: 'decoded',
        segments: [{ excerpt: '演示正文' }],
      });
      expect(console.warn).toBe(original);
    },
  );
  it.each([
    'Warning: Image dimensions are missing, or not numbers.',
    'Warning: TT: unknown diagnostic',
    'Warning: getTextContent - ignoring errors during task: synthetic',
  ])('rejects an unclassified or content-loss warning: %s', async (warning) => {
    const original = console.warn;
    state.warnings = [[warning]];
    expect(await decode()).toEqual({
      status: 'failed',
      reason: 'invalid_content',
    });
    expect(console.warn).toBe(original);
  });
  it.each(['operators', 'text'] as const)(
    'does not hide a real %s failure behind a benign font warning',
    async (failure) => {
      state.warnings = [['Warning: TT: undefined function: 21']];
      state.failure = failure;
      expect(await decode()).toEqual({
        status: 'failed',
        reason: 'invalid_content',
      });
    },
  );
  it('flushes ranges at filtered items rather than reindexing or spanning omitted evidence', async () => {
    state.items = [
      item('演示正文一', false),
      item('斜置装饰', false, [8, 8, -8, 8, 40, 700]),
      item('北森'),
      item('演示正文二'),
    ];
    expect(await decode()).toEqual({
      status: 'decoded',
      segments: [
        {
          excerpt: '演示正文一',
          location: { kind: 'document', page: 1, paragraph: 'pdf:items:0-1' },
        },
        {
          excerpt: '演示正文二',
          location: { kind: 'document', page: 1, paragraph: 'pdf:items:3-4' },
        },
      ],
    });
  });
  it('filters a split platform watermark but preserves a body sentence mentioning the platform', async () => {
    state.items = [
      item('北', false),
      item('森'),
      item('北森', false),
      item('平台对接说明'),
    ];
    expect(await decode()).toEqual({
      status: 'decoded',
      segments: [
        {
          excerpt: '北森平台对接说明',
          location: { kind: 'document', page: 1, paragraph: 'pdf:items:2-4' },
        },
      ],
    });
  });
  it('keeps a horizontal sheared baseline and filters vertical text', async () => {
    state.items = [
      item('演示斜体正文', true, [12, 1e-14, 3, 12, 40, 700]),
      { ...item('竖向装饰'), dir: 'ttb' },
    ];
    expect(await decode()).toEqual({
      status: 'decoded',
      segments: [
        {
          excerpt: '演示斜体正文',
          location: { kind: 'document', page: 1, paragraph: 'pdf:items:0-1' },
        },
      ],
    });
  });
  it('does not call an empty vector-only page scanned, but rejects images with no retained body text', async () => {
    state.vectorOnly = true;
    state.items = [];
    expect(await decode()).toEqual({ status: 'decoded', segments: [] });
    state.images = true;
    state.items = [item('www.beisen.com')];
    expect(await decode()).toEqual({
      status: 'unsupported',
      reason: 'scanned',
    });
  });
});

const decodeWithText = () =>
  decodeDocumentMessage({
    format: 'pdf',
    bytes: new Uint8Array([1]),
    limits: { maxBytes: 100, maxFragments: 10, maxFragmentChars: 100 },
    budget: documentBudgetSchema.parse({}),
    capturePdfText: true,
  });
describe('page text and retained evidence mapping', () => {
  it('maps trimming, repeated excerpts, EOL and filtered text without conflating item indexes', async () => {
    state.items = [
      item('  演😀示  '),
      item('演😀示', false),
      item('斜置', false, [8, 8, -8, 8, 40, 700]),
      item('北森'),
      item(' 演😀示 '),
    ];
    expect(await decodeWithText()).toMatchObject({
      status: 'decoded',
      pdfText: {
        version: 'pdf-page-text-v1',
        pages: [{ page: 1, text: '  演😀示  \n演😀示斜置北森\n 演😀示 \n' }],
        ranges: [
          { segmentIndex: 0, page: 1, textRange: { start: 2, end: 6 } },
          { segmentIndex: 1, page: 1, textRange: { start: 9, end: 13 } },
          { segmentIndex: 2, page: 1, textRange: { start: 19, end: 23 } },
        ],
      },
    });
  });
  it('joins a real surrogate pair split across adjacent retained items', async () => {
    state.items = [item('演\ud83d', false), item('\ude00示')];
    expect(await decodeWithText()).toMatchObject({
      status: 'decoded',
      pdfText: {
        pages: [{ page: 1, text: '演😀示\n' }],
        ranges: [{ textRange: { start: 0, end: 4 } }],
      },
    });
  });
  it('fails closed if filtering would split a surrogate pair', async () => {
    state.items = [
      item('演\ud83d', false),
      item('\ude00', false, [8, 8, -8, 8, 40, 700]),
    ];
    expect(await decodeWithText()).toEqual({
      status: 'failed',
      reason: 'invalid_content',
    });
  });
  it('does not return partial page text after an actual extraction error', async () => {
    state.failure = 'text';
    expect(await decodeWithText()).toEqual({
      status: 'failed',
      reason: 'invalid_content',
    });
  });
});
