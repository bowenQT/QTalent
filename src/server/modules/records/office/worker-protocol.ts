import { z } from 'zod';
import { officeLimits, officeWorkerLimits } from './limits';
import { officeLocationContractSha, type ParsedOffice } from './types';
export const officeWorkerBudgetSchema = z.strictObject({
  maxDurationMs: z
    .number()
    .int()
    .positive()
    .max(officeWorkerLimits.maxDurationMs)
    .default(officeWorkerLimits.maxDurationMs),
  maxOldGenerationSizeMb: z
    .number()
    .int()
    .min(16)
    .max(officeWorkerLimits.maxOldGenerationSizeMb)
    .default(officeWorkerLimits.maxOldGenerationSizeMb),
  maxOutputBytes: z
    .number()
    .int()
    .min(256)
    .max(officeWorkerLimits.maxOutputBytes)
    .default(officeWorkerLimits.maxOutputBytes),
  maxDiagnosticBytes: z
    .number()
    .int()
    .positive()
    .max(officeWorkerLimits.maxDiagnosticBytes)
    .default(officeWorkerLimits.maxDiagnosticBytes),
});
export type OfficeWorkerBudget = z.infer<typeof officeWorkerBudgetSchema>;
export type OfficeWorkerOptions = z.input<typeof officeWorkerBudgetSchema>;
export const officeWorkerInputSchema = z.strictObject({
  version: z.literal(1),
  format: z.enum(['pptx', 'xlsx']),
  bytes: z
    .instanceof(Uint8Array)
    .refine(
      (bytes) =>
        bytes.byteLength > 0 && bytes.byteLength <= officeLimits.maxInputBytes,
    ),
  budget: officeWorkerBudgetSchema,
});
const scalar = z.union([
  z.strictObject({
    type: z.enum(['number', 'text', 'date', 'error']),
    value: z.string(),
    raw: z.string(),
  }),
  z.strictObject({
    type: z.literal('boolean'),
    value: z.boolean(),
    raw: z.string(),
  }),
]);
const cell = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('constant'), value: scalar }),
  z.strictObject({
    kind: z.literal('formula'),
    expression: z.string(),
    formulaType: z.string(),
    sharedIndex: z.string().nullable(),
    range: z.string().nullable(),
    cached: z.discriminatedUnion('state', [
      z.strictObject({ state: z.literal('present'), value: scalar }),
      z.strictObject({ state: z.literal('missing') }),
    ]),
  }),
]);
const presentation = z.strictObject({
  kind: z.literal('presentation'),
  slide: z.number().int().positive(),
});
const spreadsheet = z.strictObject({
  kind: z.literal('spreadsheet'),
  sheet: z.string().min(1).regex(/\S/),
  cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/),
});
export const officeWorkerOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1),
    status: z.literal('parsed'),
    result: z.strictObject({
      format: z.enum(['pptx', 'xlsx']),
      inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
      locationContractSha: z.literal(officeLocationContractSha),
      attribution: z.literal('unresolved'),
      fragments: z
        .array(
          z.discriminatedUnion('kind', [
            z.strictObject({
              kind: z.enum(['slide_text', 'speaker_notes']),
              text: z.string(),
              location: presentation,
            }),
            z.strictObject({
              kind: z.literal('cell'),
              text: z.string().nullable(),
              location: spreadsheet,
              hidden: z.boolean(),
              content: cell,
            }),
          ]),
        )
        .min(1)
        .max(officeLimits.maxTableCells),
    }),
  }),
  z.strictObject({
    version: z.literal(1),
    status: z.literal('failed'),
    kind: z.enum([
      'unsupported_format',
      'invalid_document',
      'unsupported_content',
      'limit_exceeded',
      'cancelled',
      'processing_failed',
    ]),
    reason: z
      .string()
      .max(96)
      .regex(/^[A-Za-z0-9_]+$/),
  }),
]);
export type OfficeWorkerOutcome = z.infer<typeof officeWorkerOutcomeSchema>;
export class OfficeIsolationError extends Error {
  constructor(
    readonly kind: 'limit_exceeded' | 'cancelled' | 'processing_failed',
    readonly reason: string,
  ) {
    super(`Office isolation failed: ${kind} (${reason})`);
    this.name = 'OfficeIsolationError';
  }
}
export function encodeOfficeOutcome(
  outcome: OfficeWorkerOutcome,
  budget: OfficeWorkerBudget,
): Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(outcome);
  if (Buffer.byteLength(json, 'utf8') > budget.maxOutputBytes)
    throw new OfficeIsolationError('limit_exceeded', 'output_bytes');
  return new TextEncoder().encode(json);
}
export function decodeOfficeOutcome(
  wire: unknown,
  budget: OfficeWorkerBudget,
  expected: { format: 'pptx' | 'xlsx'; inputSha256: string },
): OfficeWorkerOutcome {
  if (!(wire instanceof Uint8Array))
    throw new OfficeIsolationError(
      'processing_failed',
      'invalid_worker_message',
    );
  if (wire.byteLength > budget.maxOutputBytes)
    throw new OfficeIsolationError('limit_exceeded', 'output_bytes');
  let checked: ReturnType<typeof officeWorkerOutcomeSchema.safeParse>;
  try {
    checked = officeWorkerOutcomeSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire)),
    );
  } catch {
    throw new OfficeIsolationError(
      'processing_failed',
      'invalid_worker_message',
    );
  }
  if (!checked.success)
    throw new OfficeIsolationError(
      'processing_failed',
      'invalid_worker_message',
    );
  const result = checked.data;
  if (
    result.status === 'parsed' &&
    (result.result.format !== expected.format ||
      result.result.inputSha256 !== expected.inputSha256 ||
      result.result.fragments.some((f) =>
        expected.format === 'pptx' ? f.kind === 'cell' : f.kind !== 'cell',
      ))
  )
    throw new OfficeIsolationError(
      'processing_failed',
      'worker_result_mismatch',
    );
  return result;
}
export function successfulOfficeOutcome(
  result: ParsedOffice,
): OfficeWorkerOutcome {
  return { version: 1, status: 'parsed', result };
}
