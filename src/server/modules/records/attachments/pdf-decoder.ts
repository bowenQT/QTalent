import { createRequire } from 'node:module';
import path from 'node:path';
import {
  DocumentFault,
  type DocumentMessage,
  type DocumentOutcome,
} from './document-protocol';
import type { AttachmentSegment } from './types';
import { guardPdfOperators } from './pdf-operator-guard';

function containsTable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    item.role === 'Table' ||
    (Array.isArray(item.children) && item.children.some(containsTable))
  );
}
/** Called only in the dedicated worker in production; no canvas rendering. */
export async function decodePdf(
  message: DocumentMessage,
): Promise<DocumentOutcome> {
  const warn = console.warn;
  let warned = false;
  console.warn = (..._arguments: unknown[]) => {
    warned = true;
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
        if (operations.fnArray.some((operation) => imageOps.has(operation)))
          return { status: 'unsupported', reason: 'scanned' };
        const text = await page.getTextContent({
          disableNormalization: true,
          includeMarkedContent: false,
        });
        if (warned) throw new DocumentFault('invalid_content');
        let start = 0,
          raw = '';
        const before = segments.length;
        function add(end: number) {
          const excerpt = raw.trim();
          if (excerpt) {
            total += excerpt.length;
            if (
              total > message.budget.maxOutputChars ||
              excerpt.length > message.limits.maxFragmentChars ||
              segments.length >= message.limits.maxFragments
            )
              throw new DocumentFault('resource_limit');
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
        }
        text.items.forEach((item, index) => {
          if (!('str' in item)) throw new DocumentFault('invalid_content');
          raw += item.str;
          if (raw.length > message.limits.maxFragmentChars)
            throw new DocumentFault('resource_limit');
          if (item.hasEOL) add(index + 1);
        });
        add(text.items.length);
        if (segments.length === before && operations.fnArray.length > 0)
          return { status: 'unsupported', reason: 'scanned' };
      } finally {
        page.cleanup();
      }
    }
    if (warned) throw new DocumentFault('invalid_content');
    return { status: 'decoded', segments };
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
