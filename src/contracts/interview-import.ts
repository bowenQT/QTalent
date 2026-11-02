import { z } from 'zod';

/**
 * The /import preview as the server reads it (BOW-906). The shape is the preview model
 * of src/features/interview-import/model.ts; the server fills it from the stored batch
 * and the 906 plan, so the page renders rows exactly as stored.
 */
const text = z.string().min(1).regex(/\S/);
const selectionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('recognized'), value: text }),
  z.strictObject({
    status: z.literal('unrecognized'),
    reason: z.enum([
      'missing_selection',
      'multiple_selections',
      'options_mismatch',
      'unsupported_graphics',
      'applicability_unknown',
    ]),
    page: z.number().int().positive(),
    options: z.array(text),
    marked: z.array(text),
  }),
  z.strictObject({
    status: z.literal('not_applicable'),
    reason: z.literal('non_management_position'),
  }),
]);
export const interviewImportRowSchema = z.strictObject({
  rowId: text,
  pages: z.strictObject({
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  }),
  observedName: text,
  // `unknown`: no recruitment record matches the printed name yet.
  candidateStatus: z.enum([
    'hired',
    'rejected',
    'offer_pending',
    'offer_declined',
    'unknown',
  ]),
  located: z.boolean(),
  template: z.strictObject({ name: text, scale: z.string() }),
  interviewedOn: z.string(),
  match: z
    .strictObject({
      personId: text,
      name: text,
      hue: z.number().int(),
      photo: z.string().nullable(),
      org: z.string(),
      title: z.string(),
      joinedOn: z.string(),
    })
    .nullable(),
  interviewer: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('matched'), name: text }),
    z.strictObject({
      status: z.literal('pending'),
      observedName: text,
      reviewItemId: text,
    }),
  ]),
  scale: z.array(z.strictObject({ item: text, selection: selectionSchema })),
  result: z.string(),
  comment: z.string().nullable(),
  redacted: z.number().int().nonnegative(),
  duplicate: z.strictObject({ importedOn: text }).nullable(),
  reviewItemId: text.nullable(),
  confirmed: z.boolean(),
  filled: z.record(z.string(), z.string()),
});
export type InterviewImportRow = z.infer<typeof interviewImportRowSchema>;

export type InterviewImportPreview = {
  batch: {
    id: string;
    file: string;
    pageCount: number;
    uploadedBy: string;
    uploadedAt: string;
    prior: null;
    rows: InterviewImportRow[];
  };
  /** Each row's compare-and-set revision, sent back with HR's next change. */
  revisions: Record<string, number>;
};
export type InterviewImportPreviewResult =
  | { status: 'ok'; preview: InterviewImportPreview }
  | { status: 'forbidden' | 'not_found' | 'unavailable' };

export const interviewImportConfirmInputSchema = z.strictObject({
  batchId: text.max(200),
  rowId: text.max(200),
  expectedRevision: z.number().int().positive(),
  ok: z.boolean(),
});
export type InterviewImportConfirmInput = z.infer<
  typeof interviewImportConfirmInputSchema
>;
export const interviewImportSendInputSchema = z.strictObject({
  batchId: text.max(200),
  rowId: text.max(200),
  expectedRevision: z.number().int().positive(),
});
/** One unread item HR fills in; an empty value clears HR's entry. */
export const interviewImportFillInputSchema = z.strictObject({
  batchId: text.max(200),
  rowId: text.max(200),
  expectedRevision: z.number().int().positive(),
  item: text.max(200),
  value: z.string().max(20),
});
export type InterviewImportFillInput = z.infer<
  typeof interviewImportFillInputSchema
>;
export type InterviewImportRowResult =
  | { status: 'ok'; row: InterviewImportRow; revision: number }
  | {
      status: 'conflict' | 'forbidden' | 'not_found' | 'unavailable';
      message: string;
    };
