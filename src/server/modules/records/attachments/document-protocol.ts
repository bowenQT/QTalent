import { z } from 'zod';
import { decodedPdfTextSchema, validPdfText } from './pdf-text';
import { parseLimitsSchema } from './limits';
import { sourceLocationSchema } from '../../../../contracts/sources';
export const DOCX_DECODER_VERSION = 'mammoth@1.13.0:body-v1';
export const PDF_DECODER_VERSION = 'pdfjs-dist@6.4.299:items-v2';
export const MATERIAL_PDF_DECODER_VERSION = `${PDF_DECODER_VERSION}+page-u16-v1`;
export const documentBudgetSchema = z.strictObject({
  maxDurationMs: z.number().int().positive().max(60000).default(60000),
  maxOldGenerationSizeMb: z.number().int().min(16).max(256).default(256),
  maxUncompressedBytes: z
    .number()
    .int()
    .positive()
    .max(32 * 1024 ** 2)
    .default(32 * 1024 ** 2),
  maxPages: z.number().int().positive().max(200).default(200),
  maxOutputChars: z.number().int().positive().max(1_000_000).default(1_000_000),
  maxImagePixels: z.number().int().positive().max(2_000_000).default(2_000_000),
});
export type DocumentBudget = z.infer<typeof documentBudgetSchema>;
export type DocumentDecoderOptions = z.input<typeof documentBudgetSchema>;
export const documentMessageSchema = z
  .strictObject({
    format: z.enum(['docx', 'pdf']),
    bytes: z.instanceof(Uint8Array),
    limits: parseLimitsSchema,
    budget: documentBudgetSchema,
    capturePdfText: z.literal(true).optional(),
  })
  .refine((message) => !message.capturePdfText || message.format === 'pdf');
export const documentOutcomeSchema = z.discriminatedUnion('status', [
  z
    .strictObject({
      status: z.literal('decoded'),
      segments: z.array(
        z.strictObject({
          excerpt: z.string().min(1).regex(/\S/),
          location: sourceLocationSchema.options[1],
        }),
      ),
      pdfText: decodedPdfTextSchema.optional(),
    })
    .refine(
      (result) =>
        !result.pdfText || validPdfText(result.pdfText, result.segments),
    ),
  z.strictObject({
    status: z.literal('unsupported'),
    reason: z.enum(['format', 'scanned']),
  }),
  z.strictObject({
    status: z.literal('failed'),
    reason: z.enum([
      'invalid_content',
      'resource_limit',
      'processing_failed',
      'cancelled',
    ]),
  }),
]);
export type DocumentMessage = z.infer<typeof documentMessageSchema>;
export type DocumentOutcome = z.infer<typeof documentOutcomeSchema>;
export class DocumentFault extends Error {
  constructor(readonly reason: 'invalid_content' | 'resource_limit') {
    super(reason);
  }
}
