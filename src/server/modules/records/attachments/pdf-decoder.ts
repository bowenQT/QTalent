import { createRequire } from 'node:module';
import path from 'node:path';
import {
  DocumentFault,
  type DocumentMessage,
  type DocumentOutcome,
} from './document-protocol';
import type { AttachmentSegment } from './types';
import { PDF_TEXT_VERSION, type DecodedPdfText } from './pdf-text';
import { guardPdfOperators } from './pdf-operator-guard';

function containsTable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.role === 'Table' ||
    (Array.isArray(item.children) && item.children.some(containsTable))
  );
}
// These pinned PDF.js diagnostics concern optional TrueType hint bytecode,
// not the text mapping or operator stream. Unknown warnings still fail closed.
const fontHintWarnings = new Set([
  'Warning: TT: CALL invalid functions stack delta.',
  'Warning: TT: CALL non-existent function',
  'Warning: TT: nested FDEFs not allowed',
  'Warning: TT: ENDF bad stack',
  'Warning: TT: nested IDEFs not allowed',
  'Warning: TT: complementing a missing function tail',
  'Warning: TT: more functions defined than expected',
]);
function benignFontHint(args: unknown[]): boolean {
  return (
    args.length === 1 &&
    typeof args[0] === 'string' &&
    (fontHintWarnings.has(args[0]) ||
      /^Warning: TT: (?:undefined function|invalid function id): \d+$/.test(
        args[0],
      ))
  );
}
const platformMarks = new Set([
  '北森',
  'beisen',
  'italent',
  '北森italent',
  'www.beisen.com',
  'www.italent.cn',
]);
function platformWatermark(text: string): boolean {
  // Whole lines only: a body sentence mentioning the platform remains evidence.
  return platformMarks.has(
    text.normalize('NFKC').replace(/\s+/g, '').toLowerCase(),
  );
}
function horizontal(item: { dir: string; transform: number[] }): boolean {
  const [a, b] = item.transform;
  const scale = Math.hypot(a, b);
  // Baseline direction, not glyph slant: horizontal italic text may have c != 0.
  return item.dir !== 'ttb' && scale > 0 && Math.abs(b) <= scale * 1e-6;
}
/** Called only in the dedicated worker in production; no canvas rendering. */
export async function decodePdf(
  message: DocumentMessage,
): Promise<DocumentOutcome> {
  const warn = console.warn;
  let warned = false;
  console.warn = (...args: unknown[]) => {
    if (!benignFontHint(args)) warned = true;
  };
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let operatorGuard: ReturnType<typeof guardPdfOperators> | undefined;
  try {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const root = path.dirname(
      createRequire(import.meta.url).resolve('pdfjs-dist/package.json'),
    );
    task = pdf.getDocument({
      data: new Uint8Array(message.bytes),
      stopAtErrors: true,
      verbosity: pdf.VerbosityLevel.WARNINGS,
      useWorkerFetch: false,
      useWasm: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      cMapUrl: path.join(root, 'cmaps') + path.sep,
      cMapPacked: true,
      standardFontDataUrl: path.join(root, 'standard_fonts') + path.sep,
      maxImageSize: message.budget.maxImagePixels,
    });
    const document = await task.promise;
    operatorGuard = guardPdfOperators(document, pdf.version);
    if (document.numPages > message.budget.maxPages)
      throw new DocumentFault('resource_limit');
    if (
      document.isPureXfa ||
      (await document.getJSActions())?.size ||
      (await document.getAttachments())?.size
    )
      return { status: 'unsupported', reason: 'format' };
    const imageOps = new Set([
      pdf.OPS.paintImageXObject,
      pdf.OPS.paintInlineImageXObject,
      pdf.OPS.paintImageMaskXObject,
      pdf.OPS.paintImageXObjectRepeat,
      pdf.OPS.paintInlineImageXObjectGroup,
      pdf.OPS.paintImageMaskXObjectGroup,
      pdf.OPS.paintImageMaskXObjectRepeat,
      pdf.OPS.paintSolidColorImageMask,
    ]);
    const segments: AttachmentSegment[] = [];
    let total = 0;
    let rawTotal = 0;
    const pdfText: DecodedPdfText = {
      version: PDF_TEXT_VERSION,
      pages: [],
      ranges: [],
    };
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      try {
        if (
          containsTable(await page.getStructTree()) ||
          (await page.getJSActions())?.size
        )
          return { status: 'unsupported', reason: 'format' };
        const operations = await page.getOperatorList({
          annotationMode: pdf.AnnotationMode.DISABLE,
        });
        operatorGuard.check();
        if (warned) throw new DocumentFault('invalid_content');
        const text = await page.getTextContent({
          disableNormalization: true,
          includeMarkedContent: false,
        });
        if (warned) throw new DocumentFault('invalid_content');
        let start = 0,
          raw = '';
        let pageText = '',
          rawOffset = 0;
        function append(text: string) {
          if (!message.capturePdfText) return;
          rawTotal += text.length;
          if (rawTotal > message.budget.maxOutputChars)
            throw new DocumentFault('resource_limit');
          pageText += text;
        }
        const before = segments.length;
        function add(end: number) {
          const excerpt = raw.trim();
          if (excerpt && !platformWatermark(excerpt)) {
            total += excerpt.length;
            if (
              total > message.budget.maxOutputChars ||
              excerpt.length > message.limits.maxFragmentChars ||
              segments.length >= message.limits.maxFragments
            )
              throw new DocumentFault('resource_limit');
            if (message.capturePdfText) {
              const offset = rawOffset + raw.length - raw.trimStart().length;
              pdfText.ranges.push({
                segmentIndex: segments.length,
                page: page.pageNumber,
                textRange: { start: offset, end: offset + excerpt.length },
              });
            }
            segments.push({
              excerpt,
              location: {
                kind: 'document',
                page: page.pageNumber,
                paragraph: `pdf:items:${start}-${end}`,
              },
            });
          }
          raw = '';
          start = end;
          rawOffset = pageText.length;
        }
        text.items.forEach((item, index) => {
          if (!('str' in item)) throw new DocumentFault('invalid_content');
          if (!horizontal(item)) {
            // Do not reindex retained items or cite a span containing omitted text.
            add(index);
            start = index + 1;
            append(item.str);
            if (item.hasEOL) append('\n');
            rawOffset = pageText.length;
            return;
          }
          append(item.str);
          raw += item.str;
          if (raw.length > message.limits.maxFragmentChars)
            throw new DocumentFault('resource_limit');
          if (item.hasEOL) {
            add(index + 1);
            append('\n');
            rawOffset = pageText.length;
          }
        });
        add(text.items.length);
        if (message.capturePdfText)
          pdfText.pages.push({ page: page.pageNumber, text: pageText });
        if (
          segments.length === before &&
          operations.fnArray.some((operation) => imageOps.has(operation))
        )
          return { status: 'unsupported', reason: 'scanned' };
      } finally {
        page.cleanup();
      }
    }
    if (warned) throw new DocumentFault('invalid_content');
    return {
      status: 'decoded',
      segments,
      ...(message.capturePdfText ? { pdfText } : {}),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      /Image exceeded maximum allowed size/.test(error.message)
    )
      throw new DocumentFault('resource_limit');
    throw error;
  } finally {
    try {
      await task?.destroy();
    } finally {
      operatorGuard?.restore();
      console.warn = warn;
    }
  }
}
