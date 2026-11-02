import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnnotationMode,
  getDocument,
  OPS,
  Util,
  version,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfBox, PdfCircle, PdfLayoutPage } from './types';

type Matrix = readonly [number, number, number, number, number, number];
type GraphicsState = {
  matrix: Matrix;
  fill: string;
  stroke: string;
  fillAlpha: number;
  strokeAlpha: number;
  supported: boolean;
  clip: PdfBox | null;
};
const identity: Matrix = [1, 0, 0, 1, 0, 0];

function numbers(value: unknown): number[] | null {
  const list = Array.isArray(value)
    ? value
    : value instanceof Float32Array || value instanceof Float64Array
      ? Array.from(value)
      : null;
  return list?.every(
    (item: unknown) => typeof item === 'number' && Number.isFinite(item),
  )
    ? list
    : null;
}
function matrix(value: unknown): Matrix | null {
  const n = numbers(value);
  return n?.length === 6 ? [n[0], n[1], n[2], n[3], n[4], n[5]] : null;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  const n = Util.transform([...a], [...b]);
  return [n[0], n[1], n[2], n[3], n[4], n[5]];
}
function bounds(box: PdfBox, m: Matrix): PdfBox {
  const points = [
    [box[0], box[1]],
    [box[0], box[3]],
    [box[2], box[1]],
    [box[2], box[3]],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
function contains(a: PdfBox, b: PdfBox): boolean {
  return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
}
function intersect(a: PdfBox, b: PdfBox): PdfBox {
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
}
function overlaps(a: PdfBox, b: PdfBox): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}
function color(value: string): PdfCircle['color'] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  if (!match) return 'other';
  const [r, g, b] = match.slice(1).map((part) => Number.parseInt(part, 16));
  if (b >= 140 && b - r >= 60 && b - g >= 25) return 'blue';
  return Math.max(r, g, b) - Math.min(r, g, b) <= 25 ? 'neutral' : 'other';
}

/** PDF.js 6.4 packs DrawOPS (0=move, 1=line, 2=cubic, 3=quadratic, 4=close). */
function pathKind(value: unknown): 'circle' | 'rectangle' | 'other' {
  const n = numbers(value);
  if (!n) return 'other';
  let moves = 0,
    lines = 0,
    curves = 0;
  for (let i = 0; i < n.length;) {
    const op = n[i++];
    if (op === 0) {
      moves++;
      i += 2;
    } else if (op === 1) {
      lines++;
      i += 2;
    } else if (op === 2) {
      curves++;
      i += 6;
    } else if (op === 3) {
      return 'other';
    } else if (op !== 4) return 'other';
    if (i > n.length) return 'other';
  }
  if (moves === 1 && curves === 4 && lines === 0) return 'circle';
  return moves === 1 && curves === 0 && lines >= 3 && lines <= 4
    ? 'rectangle'
    : 'other';
}

/**
 * Extract painted radio circles, including q/Q, CTM, form transforms, clipping and opacity.
 * A later fill, image or shading that overlaps an earlier circle may hide it, so that circle is
 * marked unsupported and the row goes to manual review instead of reading a value.
 */
export function readCircles(
  operators: { fnArray: number[]; argsArray: unknown[] },
  viewport: Matrix,
): PdfCircle[] {
  const result: PdfCircle[] = [];
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    matrix: identity,
    fill: '#000000',
    stroke: '#000000',
    fillAlpha: 1,
    strokeAlpha: 1,
    supported: true,
    clip: null,
  };
  let pendingClip = false;
  const fills = new Set([
    OPS.fill,
    OPS.eoFill,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const images = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintSolidColorImageMask,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
  ]);
  const occlude = (area: PdfBox | null) => {
    const visible = area && state.clip ? intersect(area, state.clip) : area;
    const pageBox = visible
      ? bounds(visible, viewport)
      : state.clip
        ? bounds(state.clip, viewport)
        : null;
    for (const circle of result)
      if (!pageBox || overlaps(pageBox, circle.box)) circle.supported = false;
  };
  const strokes = new Set([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i];
    const raw = operators.argsArray[i];
    const args: unknown[] = Array.isArray(raw) ? raw : [];
    if (
      op === OPS.save ||
      op === OPS.paintFormXObjectBegin ||
      op === OPS.beginGroup
    ) {
      stack.push({ ...state });
      if (op === OPS.paintFormXObjectBegin && args[0] !== null) {
        const m = matrix(args[0]);
        if (m) state.matrix = multiply(state.matrix, m);
        else state.supported = false;
      }
      if (op === OPS.beginGroup) state.supported = false;
      if (op === OPS.paintFormXObjectBegin) {
        const n = numbers(args[1]);
        if (n?.length === 4) {
          const clip = bounds([n[0], n[1], n[2], n[3]], state.matrix);
          state.clip = state.clip ? intersect(state.clip, clip) : clip;
        }
      }
    } else if (
      op === OPS.restore ||
      op === OPS.paintFormXObjectEnd ||
      op === OPS.endGroup
    ) {
      state = stack.pop() ?? { ...state, supported: false };
    } else if (op === OPS.transform) {
      const m = matrix(args);
      if (m) state.matrix = multiply(state.matrix, m);
      else state.supported = false;
    } else if (op === OPS.setFillRGBColor || op === OPS.setStrokeRGBColor) {
      const value = typeof args[0] === 'string' ? args[0] : '';
      if (op === OPS.setFillRGBColor) state.fill = value;
      else state.stroke = value;
    } else if (op === OPS.setFillTransparent) state.fill = 'transparent';
    else if (op === OPS.setStrokeTransparent) state.stroke = 'transparent';
    else if (op === OPS.setFillColorN) state.fill = '';
    else if (op === OPS.setStrokeColorN) state.stroke = '';
    else if (op === OPS.clip || op === OPS.eoClip) pendingClip = true;
    else if (op === OPS.setGState && Array.isArray(args[0])) {
      for (const entry of args[0]) {
        if (!Array.isArray(entry)) {
          state.supported = false;
          continue;
        }
        if (entry[0] === 'ca' && typeof entry[1] === 'number')
          state.fillAlpha = entry[1];
        else if (entry[0] === 'CA' && typeof entry[1] === 'number')
          state.strokeAlpha = entry[1];
        else if (entry[0] === 'SMask' && entry[1] !== false)
          state.supported = false;
        else if (entry[0] === 'BM' && entry[1] !== 'source-over')
          state.supported = false;
        else if (entry[0] === 'TR') state.supported = false;
      }
    } else if (images.has(op)) occlude(bounds([0, 0, 1, 1], state.matrix));
    else if (op === OPS.shadingFill) occlude(null);
    else if (op === OPS.constructPath) {
      const n = numbers(args[2]);
      const paths = Array.isArray(args[1]) ? args[1] : [];
      const kind = pathKind(paths[0]);
      if (!n || n.length !== 4) continue;
      const rawBox: PdfBox = [n[0], n[1], n[2], n[3]];
      const box = bounds(rawBox, state.matrix);
      const fullyVisible = !state.clip || contains(state.clip, box);
      const visible =
        !state.clip ||
        (box[2] > state.clip[0] &&
          box[0] < state.clip[2] &&
          box[3] > state.clip[1] &&
          box[1] < state.clip[3]);
      const pageBox = bounds(box, viewport);
      const width = pageBox[2] - pageBox[0],
        height = pageBox[3] - pageBox[1];
      const radio =
        kind === 'circle' &&
        width >= 2 &&
        width <= 24 &&
        height >= 2 &&
        height <= 24 &&
        Math.abs(width - height) <= 1;
      const paintOp = typeof args[0] === 'number' ? args[0] : -1;
      // Concentric radio paints (a white centre over a blue ring) are resolved by the parser.
      if (
        !radio &&
        visible &&
        fills.has(paintOp) &&
        state.fillAlpha > 0 &&
        state.fill !== 'transparent'
      )
        occlude(box);
      if (radio && visible)
        for (const filled of [true, false]) {
          if (!(filled ? fills : strokes).has(paintOp)) continue;
          const alpha = filled ? state.fillAlpha : state.strokeAlpha;
          if (
            alpha === 0 ||
            (filled ? state.fill : state.stroke) === 'transparent'
          )
            continue;
          result.push({
            box: pageBox,
            color: color(filled ? state.fill : state.stroke),
            filled,
            supported: state.supported && fullyVisible && alpha === 1,
          });
        }
      if (pendingClip) {
        if (kind === 'rectangle')
          state.clip = state.clip ? intersect(state.clip, box) : box;
        else state.supported = false;
        pendingClip = false;
      }
    }
  }
  return result;
}

export const interviewPdfLimits = {
  maxPages: 200,
  maxImagePixels: 2_000_000,
} as const;
class PdfLayoutFault extends Error {
  constructor(readonly reason: 'invalid_content' | 'resource_limit') {
    super(reason);
  }
}
export class InterviewReviewPdfError extends Error {
  readonly reason: 'invalid_content' | 'resource_limit';
  constructor(cause: unknown) {
    super('无法读取面评 PDF，请提供未加密且可读取的原始导出文件。', { cause });
    this.name = 'InterviewReviewPdfError';
    this.reason =
      cause instanceof PdfLayoutFault ? cause.reason : 'invalid_content';
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object')
    throw new PdfLayoutFault('invalid_content');
  return value as Record<string, unknown>;
}
/** Pinned PDF.js local-document seam: public operator promises can resolve partial data on stream rejection. */
function observeOperators(document: unknown) {
  if (version !== '6.4.299') throw new PdfLayoutFault('invalid_content');
  const handler = object(object(object(document)._transport).messageHandler);
  const original = handler.sendWithStream;
  if (typeof original !== 'function')
    throw new PdfLayoutFault('invalid_content');
  let failed: PdfLayoutFault | undefined;
  function remember(error: unknown) {
    failed ??= new PdfLayoutFault(
      error instanceof Error &&
        /Image exceeded maximum allowed size/.test(error.message)
        ? 'resource_limit'
        : 'invalid_content',
    );
  }
  handler.sendWithStream = function (this: unknown, ...args: unknown[]) {
    if (args[0] !== 'GetOperatorList')
      return Reflect.apply(original, this, args);
    try {
      const stream: unknown = Reflect.apply(original, this, args);
      if (!(stream instanceof ReadableStream))
        throw new PdfLayoutFault('invalid_content');
      const reader = stream.getReader();
      return new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          } catch (error) {
            remember(error);
            controller.error(error);
          }
        },
        cancel: (reason) => reader.cancel(reason),
      });
    } catch (error) {
      remember(error);
      throw error;
    }
  };
  return {
    check() {
      if (failed) throw failed;
    },
    restore() {
      handler.sendWithStream = original;
    },
  };
}

export async function readPdfLayout(
  bytes: Uint8Array,
): Promise<PdfLayoutPage[]> {
  const root = dirname(
    fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')),
  );
  let task: ReturnType<typeof getDocument> | undefined;
  let guard: ReturnType<typeof observeOperators> | undefined;
  try {
    task = getDocument({
      data: new Uint8Array(bytes),
      cMapUrl: join(root, 'cmaps/'),
      standardFontDataUrl: join(root, 'standard_fonts/'),
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      stopAtErrors: true,
      verbosity: 0,
      maxImageSize: interviewPdfLimits.maxImagePixels,
    });
    const pdf = await task.promise;
    if (
      !Number.isInteger(pdf.numPages) ||
      pdf.numPages < 1 ||
      pdf.numPages > interviewPdfLimits.maxPages
    )
      throw new PdfLayoutFault('resource_limit');
    guard = observeOperators(pdf);
    const pages: PdfLayoutPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        const transform = matrix(viewport.transform);
        if (!transform) throw new PdfLayoutFault('invalid_content');
        const operators = await page.getOperatorList({
          annotationMode: AnnotationMode.DISABLE,
        });
        guard.check();
        if (
          operators.fnArray.length !== operators.argsArray.length ||
          object(operators).lastChunk !== true
        )
          throw new PdfLayoutFault('invalid_content');
        const text = await page.getTextContent({ disableNormalization: true });
        guard.check();
        pages.push({
          page: pageNumber,
          width: viewport.width,
          height: viewport.height,
          text: text.items.flatMap((item) => {
            if (!('str' in item) || !item.str.trim()) return [];
            const m = matrix(item.transform);
            if (!m) throw new PdfLayoutFault('invalid_content');
            const baseline = multiply(transform, m);
            const scale = Math.hypot(m[0], m[1]);
            if (scale === 0) throw new PdfLayoutFault('invalid_content');
            const ascent = text.styles[item.fontName]?.ascent ?? 0.8;
            const glyphBox: PdfBox = [
              0,
              -(1 - ascent),
              item.width / scale,
              ascent,
            ];
            return [{ text: item.str, box: bounds(glyphBox, baseline) }];
          }),
          circles: readCircles(operators, transform),
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } catch (cause) {
    throw new InterviewReviewPdfError(cause);
  } finally {
    try {
      await task?.destroy();
    } finally {
      guard?.restore();
    }
  }
}
