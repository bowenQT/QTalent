import { describe, expect, it, vi } from 'vitest';
import {
  materialSourceSchema,
  type MaterialSourceReadResult,
  type Source,
  type SourceReadResult,
} from '@/contracts/sources';
import { readForViewer, type SourceViewerPorts } from './viewer-ports';

const input = { fragmentId: 'frag-test-1', originalVersionId: 'ver-test-1' };
const recording: Source = {
  ...input,
  location: { kind: 'recording', startMs: 1_000, endMs: 4_000 },
  excerpt: '合成原话',
  originalTitle: '合成复盘',
  recordedByName: null,
  sourceType: 'recording',
  sourceCategory: 'original',
  demo: true,
};
const missing: SourceReadResult = {
  status: 'not_found',
  message: '来源不存在或不可见',
};
const image: MaterialSourceReadResult = {
  status: 'success',
  source: materialSourceSchema.parse({
    ...input,
    location: {
      kind: 'image',
      region: { left: 0.1, top: 0.1, right: 0.5, bottom: 0.4 },
    },
    excerpt: '合成截图文字',
    sourceCategory: 'original',
    demo: true,
  }),
};

function ports(overrides: Partial<SourceViewerPorts>): SourceViewerPorts {
  return {
    readSource: vi.fn(async () => ({ status: 'success', source: recording })),
    readMaterialSource: null,
    openOriginal: null,
    ...overrides,
  } as SourceViewerPorts;
}

describe('readForViewer', () => {
  it('shows an authorized source with the original pending while no reader is connected', async () => {
    const read = await readForViewer(ports({}), input);
    expect(read).toMatchObject({
      status: 'success',
      source: { title: '合成复盘', excerpt: '合成原话' },
      original: { status: 'not_connected' },
    });
  });

  it('opens the original after the source read, with the authorized source only', async () => {
    const openOriginal = vi.fn(async () => ({
      status: 'ready' as const,
      content: {
        kind: 'recording' as const,
        segments: [{ startMs: 1_000, endMs: 4_000, text: '合成原话' }],
        playback: { url: '/demo-ticket' },
      },
    }));
    const read = await readForViewer(ports({ openOriginal }), input);
    expect(openOriginal).toHaveBeenCalledWith(
      expect.objectContaining({ ...input, title: '合成复盘' }),
    );
    expect(read).toMatchObject({
      status: 'success',
      original: {
        status: 'ready',
        content: { playback: { url: '/demo-ticket' } },
      },
    });
  });

  it('keeps the excerpt when the whole original is out of scope or fails to open', async () => {
    for (const [openOriginal, status] of [
      [async () => ({ status: 'restricted' as const }), 'restricted'],
      [async () => ({ status: 'failed' as const }), 'failed'],
      [
        async () => {
          throw new Error('storage unavailable');
        },
        'failed',
      ],
    ] as const) {
      const read = await readForViewer(ports({ openOriginal }), input);
      expect(read).toMatchObject({
        status: 'success',
        source: { excerpt: '合成原话' },
        original: { status },
      });
    }
  });

  it('falls back to the material source read when the P0 read has no such pair', async () => {
    const readMaterialSource = vi.fn(async () => image);
    const read = await readForViewer(
      ports({ readSource: async () => missing, readMaterialSource }),
      input,
    );
    expect(readMaterialSource).toHaveBeenCalledWith(input);
    expect(read).toMatchObject({
      status: 'success',
      source: { title: null, location: { kind: 'image' } },
    });
  });

  it('never opens an original for code snapshots or baseline facts', async () => {
    const openOriginal = vi.fn();
    const baseline: Source = {
      ...input,
      location: { kind: 'snapshot_field', fieldPath: 'events.1.note' },
      excerpt: '合成评语',
      originalTitle: '合成基线',
      recordedByName: null,
      sourceType: 'prototype_snapshot',
      sourceCategory: 'prototype_baseline',
      displayNotice: '原型基线',
      demo: true,
    };
    const read = await readForViewer(
      ports({
        readSource: async () => ({ status: 'success', source: baseline }),
        openOriginal,
      }),
      input,
    );
    expect(openOriginal).not.toHaveBeenCalled();
    expect(read).toMatchObject({ original: { status: 'not_connected' } });
  });

  it('returns no source content when either read refuses', async () => {
    const openOriginal = vi.fn();
    const cases: [Partial<SourceViewerPorts>, string][] = [
      [{ readSource: async () => missing }, 'not_found'],
      [
        {
          readSource: async () => ({ status: 'forbidden', message: '无权' }),
          readMaterialSource: async () => image,
        },
        'forbidden',
      ],
      [
        {
          readSource: async () => ({ status: 'conflict', message: '已更新' }),
        },
        'conflict',
      ],
      [
        {
          readSource: async () => ({
            status: 'validation_error',
            fieldErrors: {},
            input: {},
          }),
        },
        'not_found',
      ],
      [
        {
          readSource: async () => missing,
          readMaterialSource: async () => missing,
        },
        'not_found',
      ],
    ];
    for (const [overrides, status] of cases) {
      const read = await readForViewer(
        ports({ ...overrides, openOriginal }),
        input,
      );
      expect(read).toEqual({ status });
    }
    expect(openOriginal).not.toHaveBeenCalled();
  });
});
