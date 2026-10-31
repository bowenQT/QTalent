import { z } from 'zod';
import {
  staffingCandidateSchema,
  staffingDemandSchema,
  staffingMatchSchema,
  staffingJudgmentResultSchema,
} from '../../../../contracts/staffing';
import { sourceSchema } from '../../../../contracts/sources';
import { demandInputVersion, MATCH_INPUT_VERSION } from './prompt';
const text = z.string().min(1).regex(/\S/);
const evidenceSchema = z.strictObject({
  eventId: text,
  personId: text,
  nature: z.enum([
    'original_fact',
    'self_report',
    'management_observation',
    'human_conclusion',
  ]),
  situation: z.string().optional(),
  behavior: text,
  impact: z.string().optional(),
  source: sourceSchema,
});
const cellSchema = z
  .strictObject({
    match: staffingMatchSchema,
    claim: text.nullable(),
    error: z.enum(['no_evidence', 'input_changed', 'jev_failed']).nullable(),
    providerError: z
      .enum([
        'configuration',
        'invalid_request',
        'authentication',
        'permission',
        'rate_limited',
        'unavailable',
        'network',
        'outcome_unknown',
        'invalid_response',
        'timeout',
        'cancelled',
      ])
      .nullable(),
  })
  .refine((cell) =>
    cell.match.progress === 'judging'
      ? cell.claim !== null
      : cell.claim === null,
  );
export const matchRunSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: text,
    initiatorAccountId: text,
    demand: staffingDemandSchema.options[1],
    inputVersion: z.string().regex(/^[0-9a-f]{64}$/),
    inputFormatVersion: z.literal(MATCH_INPUT_VERSION),
    jevPromptVersion: text,
    createdAt: z.iso.datetime(),
    candidates: z.array(
      z.strictObject({
        person: staffingCandidateSchema.shape.person,
        evidence: z.array(evidenceSchema),
        cells: z.array(cellSchema),
      }),
    ),
  })
  .refine((run) => {
    const requiredIds = new Set(run.demand.requirements.map((item) => item.id));
    return (
      run.inputVersion === demandInputVersion(run.demand) &&
      new Set(run.candidates.map((candidate) => candidate.person.id)).size ===
        run.candidates.length &&
      run.candidates.every(
        (candidate) =>
          candidate.evidence.every(
            (unit) => unit.personId === candidate.person.id,
          ) &&
          candidate.cells.length === requiredIds.size &&
          new Set(candidate.cells.map((cell) => cell.match.requirementId))
            .size === requiredIds.size &&
          candidate.cells.every((cell) =>
            requiredIds.has(cell.match.requirementId),
          ),
      )
    );
  });
export const matchOperationSchema = z.strictObject({
  fingerprint: text,
  runId: text,
  judgment: staffingJudgmentResultSchema.nullable(),
});
