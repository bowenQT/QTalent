import { z } from 'zod';
import type { AttachmentSegment } from './types';

export const PDF_TEXT_VERSION = 'pdf-page-text-v1';
export const decodedPdfTextSchema = z
  .strictObject({
    version: z.literal(PDF_TEXT_VERSION),
    pages: z
      .array(
        z.strictObject({
          page: z.number().int().positive(),
          text: z
            .string()
            .max(1_000_000)
            .refine(
              (text) =>
                !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
                  text,
                ),
            ),
        }),
      )
      .min(1)
      .max(200),
    ranges: z.array(
      z.strictObject({
        segmentIndex: z.number().int().nonnegative(),
        page: z.number().int().positive(),
        textRange: z.strictObject({
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
        }),
      }),
    ),
  })
  .refine(
    (value) =>
      value.pages.reduce((sum, page) => sum + page.text.length, 0) <= 1_000_000,
  );
export type DecodedPdfText = z.infer<typeof decodedPdfTextSchema>;

function boundary(text: string, offset: number) {
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}
/** Validate every mapping against the actual page string, never item ordinals. */
export function validPdfText(
  projection: DecodedPdfText,
  segments: AttachmentSegment[],
): boolean {
  if (
    projection.pages.some((page, index) => page.page !== index + 1) ||
    projection.ranges.length !== segments.length
  )
    return false;
  return projection.ranges.every((range, index) => {
    const segment = segments[index];
    const page = projection.pages[range.page - 1];
    const { start, end } = range.textRange;
    return (
      range.segmentIndex === index &&
      page !== undefined &&
      segment.location.page === range.page &&
      start < end &&
      end <= page.text.length &&
      boundary(page.text, start) &&
      boundary(page.text, end) &&
      page.text.slice(start, end) === segment.excerpt
    );
  });
}
