import { describe, expect, it, vi } from 'vitest';
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { materialSourceLocationSchema } from '../../../../../contracts/sources';
import { readCircles, readPdfLayout } from './pdf-layout';

// One CID maps to the actual two-code-unit character through the ToUnicode CMap.
const hex = (text: string) =>
  [...text]
    .map((c) =>
      c === '😀' ? 'fffe' : c.charCodeAt(0).toString(16).padStart(4, '0'),
    )
    .join('');
function text(value: string, x: number, y: number) {
  return `BT /F1 10 Tf 1 0 0 1 ${x} ${842 - y} Tm <${hex(value)}> Tj ET`;
}
function circle(x: number, y: number, selected = false, radius = 5) {
  y = 842 - y;
  const k = radius * 0.5522847498;
  return `${selected ? '0.086 0.365 1 rg' : '0.65 0.65 0.65 RG'}
${x + radius} ${y} m
${x + radius} ${y + k} ${x + k} ${y + radius} ${x} ${y + radius} c
${x - k} ${y + radius} ${x - radius} ${y + k} ${x - radius} ${y} c
${x - radius} ${y - k} ${x - k} ${y - radius} ${x} ${y - radius} c
${x + k} ${y - radius} ${x + radius} ${y - k} ${x + radius} ${y} c
h ${selected ? 'f' : 'S'}`;
}
function pdf(
  streams: string[],
  image?: { width: number; height: number; colorSpace?: string },
): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${streams.length} /Kids [${streams.map((_, i) => `${8 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /DemoSans /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DemoSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /CIDToGIDMap /Identity >>',
    '<< /Type /FontDescriptor /FontName /DemoSans /Flags 4 /FontBBox [0 -200 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 800 /StemV 80 >>',
  ];
  const cmap =
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Demo-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange 1 beginbfchar <FFFE> <D83DDE00> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  objects.push(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  streams.forEach((stream, i) => {
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> ${image ? `/XObject << /Im1 ${7 + streams.length * 2} 0 R >>` : ''} >> /Contents ${7 + i * 2} 0 R >>`,
    );
  });
  if (image)
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.colorSpace ?? '/DeviceRGB'} /BitsPerComponent 8 /Length 3 >>\nstream\nabc\nendstream`,
    );
  let output = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

describe('PDF layout extraction', () => {
  it('reads Chinese text and real vector colors at page coordinates without rendering', async () => {
    const bytes = pdf([
      text('明细评价（演示）', 40, 80) +
        circle(180, 100) +
        circle(240, 100, true),
    ]);
    const before = bytes.slice();
    const pages = await readPdfLayout(bytes);
    expect(bytes).toEqual(before);
    expect(pages[0].text[0].text).toBe('明细评价（演示）');
    expect(pages[0].text[0].box[0]).toBe(40);
    expect(pages[0].circles).toEqual([
      {
        box: [175, 95, 185, 105],
        color: 'neutral',
        filled: false,
        supported: true,
      },
      {
        box: [235, 95, 245, 105],
        color: 'blue',
        filled: true,
        supported: true,
      },
    ]);
  });
  it('preserves the PDF failure cause', async () => {
    await expect(readPdfLayout(new Uint8Array([1, 2]))).rejects.toMatchObject({
      name: 'InterviewReviewPdfError',
      cause: expect.any(Error),
    });
  });
  it('tracks transforms and save/restore across circles', async () => {
    const pages = await readPdfLayout(
      pdf([
        `q 1 0 0 1 20 10 cm ${circle(100, 100, true)} Q ${circle(200, 100)}`,
      ]),
    );
    expect(pages[0].circles.map((c) => c.box)).toEqual([
      [115, 85, 125, 95],
      [195, 95, 205, 105],
    ]);
  });
  it('does not accept rectangles, text colors, or large decorative circles as radios', async () => {
    const pages = await readPdfLayout(
      pdf([
        `${text('1 2 3 4 5', 100, 100)} 0.1 0.3 1 rg 100 742 10 10 re f ${circle(300, 100, true, 30)}`,
      ]),
    );
    expect(pages[0].circles).toEqual([]);
  });
});

// These rows are an explicit synthetic profile. They do not certify an official export.
const demoOptions = {
  positionKind: 'non_management',
  allowSyntheticDemo: true,
} as const;
const templates = [
  '校招专业面试通用评价表',
  '七牛面试评价表-HR',
  '七牛面试评价表-专业面试官',
];
const dimensionNames = ['专业能力', '潜力', '沟通协作', '管理能力'];
function radio(
  label: string,
  y: number,
  choices: string[],
  selected: string[],
) {
  return [
    text(label, 40, y + 3),
    ...choices.map(
      (value, index) =>
        text(value, 215 + index * 61, y + 3) +
        circle(205 + index * 61, y, selected.includes(value)),
    ),
  ].join('\n');
}
function syntheticReview(
  name = templates[0],
  change: {
    missing?: boolean;
    multiple?: boolean;
    crossPage?: boolean;
    management?: boolean;
    marker?: boolean;
    candidate?: string | null;
    unicodeHeader?: boolean;
    comment?: string[];
    twoLine?: string;
    cover?: string;
  } = {},
): Uint8Array {
  const rows = dimensionNames.map((label, index) =>
    index === 0 && change.twoLine
      ? [
          text(label, 40, 303),
          ...['1', '2', '3', '4', '5'].map(
            (value, i) =>
              text(value, 215 + (i % 3) * 61, 303 + Math.floor(i / 3) * 20) +
              circle(
                205 + (i % 3) * 61,
                300 + Math.floor(i / 3) * 20,
                value === change.twoLine,
              ),
          ),
        ].join('\n')
      : radio(
          label,
          300 + index * 50,
          ['1', '2', '3', '4', '5'],
          index === 3
            ? change.management
              ? ['4']
              : []
            : index === 0 && change.missing
              ? []
              : index === 0 && change.multiple
                ? ['2', '4']
                : [['2'], ['4'], ['3']][index],
        ),
  );
  const detail = [
    change.marker === false
      ? ''
      : text(change.unicodeHeader ? '化名演示😀' : '化名演示', 400, 50),
    text(name, 40, 110),
    text('明细评价', 40, 135),
    change.candidate === null
      ? ''
      : text('候选人：' + (change.candidate ?? '谷嘉树（演示）'), 40, 150),
    text('面试官：陈川（演示）', 40, 165),
    text('面试时间：2026-10-01 10:00（演示）', 40, 190),
    text('面试类型：专业面试', 40, 215),
    text('面试结果：通过（演示）', 40, 240),
    ...rows,
    radio('面试评级', 500, ['S', 'A', 'B', 'C', 'D'], ['B']),
    change.crossPage
      ? text('建议职级续下页', 40, 560)
      : radio('建议职级', 550, ['N1', 'N2', 'N3', 'N4', 'N5'], ['N3']),
    ...(
      change.comment ?? [
        '综合评价：先复现问题，再验证修复。',
        '保留失败项，方便后续核对。',
      ]
    ).map((line, index) => text(line, 40, 620 + index * 20)),
    change.cover ?? '',
  ].join('\n');
  return pdf(
    change.crossPage
      ? [
          detail,
          [
            text('化名演示', 400, 50),
            text(name, 40, 110),
            text('明细评价（续页）', 40, 135),
            radio('建议职级', 220, ['N1', 'N2', 'N3', 'N4', 'N5'], ['N3']),
          ].join('\n'),
        ]
      : [detail],
  );
}

import { parseInterviewReviewLayout, parseInterviewReviewPdf } from './parser';
import type {
  InterviewReviewResult,
  ParsedInterviewReview,
  PdfLayoutPage,
} from './types';
function review(result: InterviewReviewResult): ParsedInterviewReview {
  expect(result.status).not.toBe('rejected');
  if (result.status === 'rejected') throw new Error(result.reason);
  expect(result.reviews).toHaveLength(1);
  return result.reviews[0];
}
async function layout() {
  return readPdfLayout(syntheticReview());
}

describe('deterministic interview review parsing', () => {
  it.each(templates)(
    'reads the synthetic %s scale without taking the first text option',
    async (name) => {
      const result = await parseInterviewReviewPdf(
        syntheticReview(name),
        demoOptions,
      );
      expect(result.status).toBe('parsed');
      const parsed = review(result);
      expect(parsed.demo).toBe(true);
      expect(parsed.templateFingerprint).toBe('bow-896-synthetic-v1');
      expect(parsed.dimensions.map((row) => row.selection)).toMatchObject([
        {
          status: 'recognized',
          value: '2',
          source: { page: 1, box: [261, 295, 271, 305] },
        },
        {
          status: 'recognized',
          value: '4',
          source: { page: 1, box: [383, 345, 393, 355] },
        },
        {
          status: 'recognized',
          value: '3',
          source: { page: 1, box: [322, 395, 332, 405] },
        },
        { status: 'not_applicable', reason: 'non_management_position' },
      ]);
      expect(parsed.interviewRating).toMatchObject({
        status: 'recognized',
        value: 'B',
      });
      expect(parsed.suggestedLevel).toMatchObject({
        status: 'recognized',
        value: 'N3',
      });
      expect(parsed.metadata).toMatchObject({
        interviewTime: { value: '2026-10-01 10:00（演示）' },
        interviewType: { value: '专业面试' },
        interviewer: { value: '陈川（演示）' },
        interviewResult: { value: '通过（演示）' },
        overallComment: {
          value: '先复现问题，再验证修复。\n保留失败项，方便后续核对。',
        },
      });
    },
  );
  it('continues HR suggested level onto the next page', async () => {
    const result = await parseInterviewReviewPdf(
      syntheticReview(templates[1], { crossPage: true }),
      demoOptions,
    );
    expect(result.status).toBe('parsed');
    expect(review(result).suggestedLevel).toMatchObject({
      status: 'recognized',
      value: 'N3',
      source: { page: 2, box: [322, 215, 332, 225] },
    });
  });
  it.each([
    { missing: true, reason: 'missing_selection' },
    { multiple: true, reason: 'multiple_selections' },
  ])('requires manual input for $reason', async ({ reason, ...change }) => {
    const result = await parseInterviewReviewPdf(
      syntheticReview(templates[0], change),
      demoOptions,
    );
    expect(result.status).toBe('needs_manual_input');
    expect(review(result).dimensions[0].selection).toMatchObject({
      status: 'unrecognized',
      reason,
    });
    expect(review(result).dimensions[0].selection).not.toHaveProperty('value');
  });
  it('refuses unverified production templates by default', async () => {
    expect(
      await parseInterviewReviewPdf(syntheticReview(), {
        positionKind: 'non_management',
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'unverified_template_profile',
    });
    expect(
      await parseInterviewReviewPdf(
        syntheticReview(templates[0], { marker: false }),
        demoOptions,
      ),
    ).toMatchObject({
      status: 'rejected',
      reason: 'unverified_template_profile',
    });
  });
  it('rejects unknown template names explicitly', async () => {
    const pages = await layout();
    pages[0].text.find((item) => item.text === templates[0])!.text =
      '评价表名称：未知评价表';
    expect(parseInterviewReviewLayout(pages, demoOptions)).toMatchObject({
      status: 'rejected',
      reason: 'unknown_template',
    });
  });
  it.each(['missing', 'duplicated', 'renamed', 'extra'])(
    'rejects a %s dimension fingerprint',
    async (kind) => {
      const pages = await layout();
      const first = pages[0].text.find((item) => item.text === '专业能力')!;
      if (kind === 'missing')
        pages[0].text = pages[0].text.filter((item) => item !== first);
      if (kind === 'duplicated')
        pages[0].text.push({ text: '专业能力', box: [40, 660, 100, 670] });
      if (kind === 'renamed') first.text = '新增维度';
      if (kind === 'extra')
        pages[0].text.push({
          text: '新增维度 1 2 3 4 5',
          box: [40, 660, 500, 670],
        });
      expect(parseInterviewReviewLayout(pages, demoOptions)).toMatchObject({
        status: 'rejected',
        reason: 'fingerprint_mismatch',
      });
    },
  );
  it('does not use overview comments as a second review', async () => {
    const pages = await layout();
    const overview: PdfLayoutPage = {
      ...structuredClone(pages[0]),
      page: 1,
      text: [
        { text: '概览评价', box: [40, 100, 120, 110] },
        { text: templates[0], box: [40, 130, 260, 140] },
        { text: '综合评价：概览重复评语', box: [40, 200, 260, 210] },
      ],
    };
    pages[0].page = 2;
    const parsed = review(
      parseInterviewReviewLayout([overview, ...pages], demoOptions),
    );
    expect(parsed.metadata.overallComment?.value).not.toContain('概览');
    expect(
      parsed.metadata.overallComment?.sources.every(
        (source) => source.page === 2,
      ),
    ).toBe(true);
  });
  it('reports missing metadata instead of borrowing the next field', async () => {
    const pages = await layout();
    pages[0].text = pages[0].text.filter(
      (item) => !item.text.startsWith('面试官'),
    );
    const result = parseInterviewReviewLayout(pages, demoOptions);
    expect(result.status).toBe('needs_manual_input');
    expect(review(result).metadata.interviewer).toBeNull();
  });
  it('reads a metadata value on its following line', async () => {
    const pages = await layout();
    const time = pages[0].text.find((item) =>
      item.text.startsWith('面试时间'),
    )!;
    pages[0].text = pages[0].text.filter(
      (item) => center(item.box) !== center(time.box),
    );
    pages[0].text.push({ text: '面试时间：', box: time.box });
    pages[0].text.push({
      text: '2026-10-02（演示）',
      box: [40, 197, 220, 207],
    });
    expect(
      review(parseInterviewReviewLayout(pages, demoOptions)).metadata
        .interviewTime?.value,
    ).toBe('2026-10-02（演示）');
  });
  it('keeps unknown applicability separate from non-management', async () => {
    const result = await parseInterviewReviewPdf(syntheticReview(), {
      positionKind: 'unknown',
      allowSyntheticDemo: true,
    });
    expect(result.status).toBe('needs_manual_input');
    expect(review(result).dimensions[3].selection).toMatchObject({
      status: 'unrecognized',
      reason: 'applicability_unknown',
    });
    const management = await parseInterviewReviewPdf(
      syntheticReview(templates[0], { management: true }),
      { positionKind: 'management', allowSyntheticDemo: true },
    );
    expect(review(management).dimensions[3].selection).toMatchObject({
      status: 'recognized',
      value: '4',
    });
  });
  it('does not score a text-only PDF', async () => {
    const pages = await layout();
    pages[0].circles = [];
    const result = parseInterviewReviewLayout(pages, demoOptions);
    expect(result.status).toBe('needs_manual_input');
    expect(review(result).dimensions[0].selection).toMatchObject({
      status: 'unrecognized',
      reason: 'missing_selection',
    });
  });
  it.each([
    'count',
    'labels',
    'color',
    'opacity',
    'none',
    'multiple',
    'missing_field',
  ])('refuses invalid rating %s', async (kind) => {
    const pages = await layout();
    const ratingCircles = pages[0].circles.filter(
      (item) => center(item.box) === 500,
    );
    if (kind === 'count')
      pages[0].circles = pages[0].circles.filter(
        (item) => item !== ratingCircles[0],
      );
    if (kind === 'labels')
      pages[0].text.find((item) => item.text === 'S')!.text = 'X';
    if (kind === 'color') ratingCircles[0].color = 'other';
    if (kind === 'opacity') ratingCircles[0].supported = false;
    if (kind === 'none')
      ratingCircles.forEach((item) => (item.color = 'neutral'));
    if (kind === 'multiple') ratingCircles[0].color = 'blue';
    if (kind === 'missing_field')
      pages[0].text = pages[0].text.filter((item) => item.text !== '面试评级');
    const result = parseInterviewReviewLayout(pages, demoOptions);
    expect(result.status).toBe('needs_manual_input');
    expect(review(result).interviewRating.status).toBe('unrecognized');
    expect(review(result).interviewRating).not.toHaveProperty('value');
  });
  it('reports no detail form for an empty or overview-only document', () => {
    expect(parseInterviewReviewLayout([], demoOptions)).toMatchObject({
      status: 'rejected',
      reason: 'no_detail_review',
    });
  });
});
function center(box: readonly number[]) {
  return (box[1] + box[3]) / 2;
}

const roundPath = [
  0, 10, 5, 2, 10, 8, 8, 10, 5, 10, 2, 2, 10, 0, 8, 0, 5, 2, 0, 2, 2, 0, 5, 0,
  2, 8, 0, 10, 2, 10, 5, 4,
];
const rectanglePath = [0, 0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 4];
const view = [1, 0, 0, -1, 0, 842] as const;
type Op = [number, unknown[]];
const paint: Op = [
  OPS.constructPath,
  [OPS.fill, [new Float32Array(roundPath)], new Float32Array([0, 0, 10, 10])],
];
const blue: Op = [OPS.setFillRGBColor, ['#167bff']];
function vectors(entries: Op[]) {
  return readCircles(
    {
      fnArray: entries.map((entry) => entry[0]),
      argsArray: entries.map((entry) => entry[1]),
    },
    view,
  );
}

describe('vector visibility and graphics state', () => {
  it('preserves a blue outer ring when its white center is drawn afterwards', async () => {
    const pages = await layout();
    pages[0].circles.push({
      box: [263, 297, 269, 303],
      filled: true,
      color: 'neutral',
      supported: true,
    });
    expect(
      review(parseInterviewReviewLayout(pages, demoOptions)).dimensions[0]
        .selection,
    ).toMatchObject({ status: 'recognized', value: '2' });
    pages[0].circles.push({
      box: [261, 295, 271, 305],
      filled: true,
      color: 'neutral',
      supported: true,
    });
    expect(
      review(parseInterviewReviewLayout(pages, demoOptions)).dimensions[0]
        .selection,
    ).toMatchObject({ status: 'unrecognized', reason: 'missing_selection' });
  });
  it('tracks forms and restores the preceding graphics state', () => {
    const marks = vectors([
      blue,
      [
        OPS.paintFormXObjectBegin,
        [
          [1, 0, 0, 1, 20, 10],
          [0, 0, 100, 100],
        ],
      ],
      paint,
      [OPS.paintFormXObjectEnd, []],
      paint,
    ]);
    expect(marks.map((mark) => mark.box)).toEqual([
      [20, 822, 30, 832],
      [0, 832, 10, 842],
    ]);
    expect(marks.every((mark) => mark.color === 'blue' && mark.supported)).toBe(
      true,
    );
  });
  it('marks partial clipping as unsupported and ignores completely clipped circles', () => {
    expect(
      vectors([
        [OPS.paintFormXObjectBegin, [null, [0, 0, 5, 10]]],
        blue,
        paint,
      ])[0].supported,
    ).toBe(false);
    expect(
      vectors([
        [OPS.paintFormXObjectBegin, [null, [20, 20, 30, 30]]],
        blue,
        paint,
      ]),
    ).toEqual([]);
  });
  it('respects rectangular clipping paths', () => {
    const clip: Op = [
      OPS.constructPath,
      [OPS.endPath, [rectanglePath], [0, 0, 10, 10]],
    ];
    expect(vectors([[OPS.clip, []], clip, blue, paint])[0].supported).toBe(
      true,
    );
    expect(
      vectors([
        [OPS.eoClip, []],
        [OPS.constructPath, [OPS.endPath, [roundPath], [0, 0, 10, 10]]],
        blue,
        paint,
      ])[0].supported,
    ).toBe(false);
  });
  it.each([
    ['ca', 0.5],
    ['SMask', {}],
    ['BM', 'multiply'],
    ['TR', {}],
  ])('does not silently accept unsupported %s state', (key, value) => {
    expect(
      vectors([blue, [OPS.setGState, [[[key, value]]]], paint])[0].supported,
    ).toBe(false);
  });
  it('ignores alpha zero and transparent paint, then accepts a visible RGB color again', () => {
    expect(vectors([blue, [OPS.setGState, [[['ca', 0]]]], paint])).toEqual([]);
    expect(vectors([blue, [OPS.setFillTransparent, []], paint])).toEqual([]);
    expect(vectors([[OPS.setFillTransparent, []], blue, paint])[0].color).toBe(
      'blue',
    );
    const stroke: Op = [
      OPS.constructPath,
      [OPS.stroke, [roundPath], [0, 0, 10, 10]],
    ];
    expect(vectors([[OPS.setStrokeTransparent, []], stroke])).toEqual([]);
    expect(
      vectors([
        [OPS.setStrokeRGBColor, ['#167bff']],
        [OPS.setGState, [[['CA', 0.5]]]],
        stroke,
      ])[0].supported,
    ).toBe(false);
  });
  it('keeps unknown color and complex groups unrecognized', () => {
    expect(vectors([[OPS.setFillColorN, ['pattern']], paint])[0].color).toBe(
      'other',
    );
    const stroke: Op = [
      OPS.constructPath,
      [OPS.stroke, [roundPath], [0, 0, 10, 10]],
    ];
    expect(vectors([[OPS.setStrokeColorN, ['pattern']], stroke])[0].color).toBe(
      'other',
    );
    expect(vectors([[OPS.setFillRGBColor, ['#ff6600']], paint])[0].color).toBe(
      'other',
    );
    const marks = vectors([
      blue,
      [OPS.beginGroup, [{}]],
      paint,
      [OPS.endGroup, []],
      paint,
    ]);
    expect(marks.map((mark) => mark.supported)).toEqual([false, true]);
  });
  it('fails closed on malformed relevant graphics operands', () => {
    expect(vectors([blue, [OPS.transform, [1, 2]], paint])[0].supported).toBe(
      false,
    );
    expect(
      vectors([blue, [OPS.paintFormXObjectBegin, [[1], null]], paint])[0]
        .supported,
    ).toBe(false);
    expect(vectors([blue, [OPS.restore, []], paint])[0].supported).toBe(false);
    expect(vectors([blue, [OPS.setGState, [[null]]], paint])[0].supported).toBe(
      false,
    );
    expect(
      vectors([[OPS.constructPath, [OPS.fill, [[99]], [0, 0, 10, 10]]]]),
    ).toEqual([]);
    expect(
      vectors([[OPS.constructPath, [OPS.fill, [roundPath], null]]]),
    ).toEqual([]);
  });
  it('parses PDF bytes without fetching a model or remote resource', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Remote fetch forbidden'));
    try {
      expect(
        (await parseInterviewReviewPdf(syntheticReview(), demoOptions)).status,
      ).toBe('parsed');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
  it('keeps two detail forms and their metadata separate', async () => {
    const first = await readPdfLayout(syntheticReview(templates[0]));
    const second = await readPdfLayout(syntheticReview(templates[2]));
    second[0].page = 2;
    second[0].text.find((item) => item.text.startsWith('面试类型'))!.text =
      '面试类型：第二次面试（演示）';
    const result = parseInterviewReviewLayout(
      [...first, ...second],
      demoOptions,
    );
    expect(result.status).toBe('parsed');
    if (result.status === 'rejected') throw new Error(result.reason);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0].metadata.interviewType?.value).toBe('专业面试');
    expect(result.reviews[1].metadata.interviewType?.value).toBe(
      '第二次面试（演示）',
    );
  });
});

describe('BOW-900 real PDF resource/error boundaries', () => {
  it('rejects more than 200 pages instead of returning a partial layout', async () => {
    await expect(
      readPdfLayout(
        pdf(Array.from({ length: 201 }, () => text('演示页', 40, 100))),
      ),
    ).rejects.toMatchObject({
      name: 'InterviewReviewPdfError',
      reason: 'resource_limit',
    });
  });
  it('rejects an oversized image even when PDF.js would suppress its operator error', async () => {
    await expect(
      readPdfLayout(
        pdf([text('演示正文', 40, 100) + ' q 10 0 0 10 0 0 cm /Im1 Do Q'], {
          width: 2001,
          height: 1000,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'InterviewReviewPdfError',
      reason: 'resource_limit',
    });
  });
  it('rejects an actual failed shading operator stream instead of returning partial circles', async () => {
    await expect(
      readPdfLayout(pdf([text('演示正文', 40, 100) + ' /Missing sh'])),
    ).rejects.toMatchObject({
      name: 'InterviewReviewPdfError',
      reason: 'invalid_content',
    });
  });
});

describe('actual page text provenance and optional raw candidate metadata', () => {
  it('extracts the literal candidate label without identity mapping or invented position identifiers', async () => {
    const result = await parseInterviewReviewPdf(
      syntheticReview(),
      demoOptions,
    );
    expect(result.status).toBe('parsed');
    expect(review(result).identity).toMatchObject({
      candidateName: { value: '谷嘉树（演示）' },
      positionNumber: null,
    });
    expect(JSON.stringify(review(result).identity)).not.toMatch(
      /personId|candidateId/,
    );
  });
  it('keeps absent/ambiguous candidate data optional instead of borrowing another field', async () => {
    const missing = await parseInterviewReviewPdf(
      syntheticReview(templates[0], { candidate: null }),
      demoOptions,
    );
    expect(missing.status).toBe('parsed');
    expect(review(missing).identity.candidateName).toBeNull();
    const pages = await layout();
    pages[0].text.push({
      text: '候选人：另一个演示名',
      box: [40, 172, 250, 182],
    });
    expect(
      review(parseInterviewReviewLayout(pages, demoOptions)).identity
        .candidateName,
    ).toBeNull();
  });
  it('anchors fields/choices to unfiltered, versioned real page text with UTF-16 offsets', async () => {
    const result = await parseInterviewReviewPdf(
      syntheticReview(templates[1], { crossPage: true, unicodeHeader: true }),
      demoOptions,
    );
    const row = review(result);
    if (result.status === 'rejected') throw new Error('Unexpected rejection');
    expect(result.pageTexts[0].text).toContain('化名演示😀');
    expect(result.pageTexts[0].extractionVersion).toBe(
      'interview-review-lines-v1',
    );
    const regions = [
      row.templateSource,
      ...Object.values(row.metadata).flatMap((field) => field?.sources ?? []),
      ...(row.identity.candidateName?.sources ?? []),
      ...row.dimensions.flatMap((d) =>
        d.selection.status === 'not_applicable' ? [] : [d.selection.source],
      ),
      ...['interviewRating', 'suggestedLevel'].flatMap((key) => {
        const value = row[key as 'interviewRating' | 'suggestedLevel'];
        return value.status === 'not_applicable' ? [] : [value.source];
      }),
    ];
    for (const region of regions) {
      const page = result.pageTexts.find((page) => page.page === region.page)!;
      const { start, end } = region.textRange;
      expect(
        Number.isInteger(start) &&
          start >= 0 &&
          end > start &&
          end <= page.text.length,
      ).toBe(true);
      expect(page.text.slice(start, end).trim()).not.toBe('');
      const location = materialSourceLocationSchema.parse({
        kind: 'pdf',
        page: region.page,
        textRange: region.textRange,
      });
      expect(
        materialSourceLocationSchema.safeParse({ ...location, box: region.box })
          .success,
      ).toBe(false);
      expect(Object.keys(location)).toEqual(['kind', 'page', 'textRange']);
    }
    const title = row.templateSource;
    const page = result.pageTexts[0];
    expect(page.text.slice(title.textRange.start, title.textRange.end)).toBe(
      templates[1],
    );
    expect(title.textRange.start).toBe(page.text.indexOf(templates[1]));
    expect(title.textRange.start).toBeGreaterThan(
      [...page.text.slice(0, title.textRange.start)].length,
    );
    if (row.suggestedLevel.status === 'recognized')
      expect(
        result.pageTexts[1].text.slice(
          row.suggestedLevel.source.textRange.start,
          row.suggestedLevel.source.textRange.end,
        ),
      ).toContain('建议职级');
    const other = await parseInterviewReviewPdf(
      syntheticReview(templates[1], { crossPage: true, unicodeHeader: true }),
      demoOptions,
    );
    if (other.status === 'rejected') throw new Error('Unexpected rejection');
    expect(other.pageTexts).toEqual(result.pageTexts);
  });
  it('keeps the 200-page boundary readable', async () => {
    expect(
      await readPdfLayout(
        pdf(Array.from({ length: 200 }, () => text('演示页', 40, 100))),
      ),
    ).toHaveLength(200);
  });
});

describe('BOW-900 structural boundaries (connector findings)', () => {
  it('keeps comment continuation lines that begin with field or dimension names', async () => {
    const comment = [
      '综合评价：先复现问题，再验证修复。',
      '潜力较好，但需要继续观察。',
      '专业能力扎实，排查有条理。',
      '候选人在压力下仍能复盘。',
      '专业能力：建议补充系统设计案例。',
    ];
    const result = await parseInterviewReviewPdf(
      syntheticReview(templates[0], { comment }),
      demoOptions,
    );
    expect(result.status).toBe('parsed');
    const parsed = review(result);
    expect(parsed.metadata.overallComment).toMatchObject({
      value: ['先复现问题，再验证修复。', ...comment.slice(1)].join('\n'),
    });
    expect(parsed.metadata.overallComment?.sources).toHaveLength(5);
    expect(parsed.dimensions[0].selection).toMatchObject({
      status: 'recognized',
      value: '2',
    });
  });
  it('still ends the comment at a standalone scale label', async () => {
    const result = await parseInterviewReviewPdf(
      syntheticReview(templates[0], {
        comment: ['综合评价：先复现问题。', '专业能力'],
      }),
      demoOptions,
    );
    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'fingerprint_mismatch',
    });
  });
  it('sends a selected circle hidden by a later opaque fill to manual review', async () => {
    const covered = await parseInterviewReviewPdf(
      syntheticReview(templates[0], {
        cover: `1 1 1 rg 255 ${842 - 310} 22 20 re f`,
      }),
      demoOptions,
    );
    expect(covered.status).toBe('needs_manual_input');
    expect(review(covered).dimensions[0].selection).toMatchObject({
      status: 'unrecognized',
      reason: 'unsupported_graphics',
    });
    expect(review(covered).dimensions[0].selection).not.toHaveProperty('value');
    const elsewhere = await parseInterviewReviewPdf(
      syntheticReview(templates[0], {
        cover: `1 1 1 rg 30 ${842 - 790} 40 20 re f`,
      }),
      demoOptions,
    );
    expect(elsewhere.status).toBe('parsed');
  });
  it.each([
    ['image', [OPS.paintImageXObject, ['img']] as Op],
    ['shading', [OPS.shadingFill, ['sh']] as Op],
    [
      'rectangle',
      [
        OPS.constructPath,
        [
          OPS.fill,
          [new Float32Array(rectanglePath)],
          new Float32Array([0, 0, 10, 10]),
        ],
      ] as Op,
    ],
  ])(
    'marks an earlier circle covered by a later %s unsupported',
    (_, cover) => {
      const [circle] = vectors([blue, paint, cover]);
      expect(circle).toMatchObject({ color: 'blue', supported: false });
      const [kept] = vectors([
        blue,
        paint,
        [OPS.transform, [1, 0, 0, 1, 100, 0]],
        ...(cover[0] === OPS.shadingFill ? [] : [cover]),
      ]);
      expect(kept).toMatchObject({ color: 'blue', supported: true });
    },
  );
  it.each(['1', '3', '4', '5'])(
    'pairs two-row options with their circles (selected %s)',
    async (value) => {
      const result = await parseInterviewReviewPdf(
        syntheticReview(templates[0], { twoLine: value }),
        demoOptions,
      );
      expect(result.status).toBe('parsed');
      expect(review(result).dimensions[0].selection).toMatchObject({
        status: 'recognized',
        value,
      });
    },
  );
  it('refuses two-row options whose labels and circles do not line up', async () => {
    const pages = await readPdfLayout(
      syntheticReview(templates[0], { twoLine: '3' }),
    );
    pages[0].text = pages[0].text.filter(
      (item) => !(item.text === '5' && center(item.box) > 310),
    );
    pages[0].text.push({ text: '5', box: [337, 296, 343, 306] });
    const result = parseInterviewReviewLayout(pages, demoOptions);
    expect(result.status).toBe('needs_manual_input');
    expect(review(result).dimensions[0].selection).toMatchObject({
      status: 'unrecognized',
      reason: 'options_mismatch',
    });
  });
});
