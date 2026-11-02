import { z } from 'zod';
import {
  materialBatchInputSchema,
  materialBatchReadInputSchema,
  materialBatchReceiptSchema,
} from './materials';
import { personReadInputSchema } from './person';
import { quickViewSchema } from './people';
import {
  createStaffingDemandInputSchema,
  staffingDemandSchema,
  staffingDemandJobSnapshotSchema,
  staffingPageSchema,
} from './staffing';
import {
  buildEntryDeepLink,
  entryLinkTargetSchema,
  parseEntryDeepLink,
} from './entry-links';

export const MCP_ENTRY_TOOLS = [
  'record_moment',
  'person_brief',
  'draft_requirement',
] as const;
export const AGENTAPI_ENTRY_TOOLS = [
  'submit_material_batch',
  'read_material_batch',
  'person_brief',
  'draft_requirement',
  'read_requirement_status',
  'read_match_results',
  'read_comparison_summary',
  'read_revision_status',
  'web_entry',
] as const;
export const entryToolNameSchema = z.enum([
  ...MCP_ENTRY_TOOLS,
  'submit_material_batch',
  'read_material_batch',
  'read_requirement_status',
  'read_match_results',
  'read_comparison_summary',
  'read_revision_status',
  'web_entry',
]);
export type EntryToolName = z.infer<typeof entryToolNameSchema>;
export const ENTRY_TOOL_CHANNELS = {
  web: entryToolNameSchema.options,
  wecom: ['record_moment', 'submit_material_batch', 'read_material_batch'],
  mcp: MCP_ENTRY_TOOLS,
  agentapi: AGENTAPI_ENTRY_TOOLS,
} as const;
/** Semantic permissions: the domain adapter must resolve these using current facts. */
export const ENTRY_TOOL_PERMISSIONS = {
  record_moment: 'material:submit',
  submit_material_batch: 'material:submit',
  read_material_batch: 'material:read',
  person_brief: 'person:brief',
  draft_requirement: 'staffing:draft',
  read_requirement_status: 'staffing:read',
  read_match_results: 'staffing:read',
  read_comparison_summary: 'comparison:read',
  read_revision_status: 'selection-revision:read',
  web_entry: 'entry-link:read',
} as const satisfies Record<EntryToolName, string>;
const demandRead = z.strictObject({
  demandId: z.string().min(1).max(200),
  expectedRevision: z.number().int().positive(),
});
export const entryToolInputSchemas = {
  record_moment: materialBatchInputSchema,
  submit_material_batch: materialBatchInputSchema,
  read_material_batch: materialBatchReadInputSchema,
  person_brief: personReadInputSchema,
  draft_requirement: createStaffingDemandInputSchema,
  read_requirement_status: demandRead,
  read_match_results: demandRead,
  read_comparison_summary: z.strictObject({
    batchId: z.string().min(1).max(200),
  }),
  read_revision_status: z.strictObject({
    revisionId: z.string().min(1).max(200),
    expectedRevision: z.number().int().positive(),
  }),
  web_entry: entryLinkTargetSchema,
} as const satisfies Record<EntryToolName, z.ZodType>;
/** No third-act success payload until its frozen DTO is supplied. No unknown JSON. */
export const entryToolSuccessSchemas = {
  record_moment: materialBatchReceiptSchema,
  submit_material_batch: materialBatchReceiptSchema,
  read_material_batch: materialBatchReceiptSchema,
  person_brief: quickViewSchema,
  draft_requirement: staffingDemandJobSnapshotSchema,
  read_requirement_status: staffingDemandSchema.transform((demand) => ({
    demandId: demand.id,
    revision: demand.revision,
    status: demand.status,
  })),
  read_match_results: staffingPageSchema,
  web_entry: z.strictObject({
    href: z.string().refine((href) => parseEntryDeepLink(href) !== null),
  }),
} as const satisfies Partial<Record<EntryToolName, z.ZodType>>;
export type EntryToolPayload = z.output<
  (typeof entryToolSuccessSchemas)[keyof typeof entryToolSuccessSchemas]
>;
export const entryToolFailureSchema = z.strictObject({
  status: z.enum([
    'unauthenticated',
    'forbidden',
    'unavailable',
    'validation_error',
    'not_found',
    'conflict',
  ]),
});
export type EntryToolResult =
  | { status: 'success'; payload: EntryToolPayload }
  | z.infer<typeof entryToolFailureSchema>;
export const entryToolCallSchema = z.strictObject({
  name: entryToolNameSchema,
  args: z.unknown(),
});

/** Bind returned lookup identity to what was checked, before output authorization. */
export function entryPayloadMatchesInput(
  name: EntryToolName,
  args: unknown,
  payload: EntryToolPayload,
): boolean {
  const input = args as Record<string, unknown>;
  if (name === 'record_moment' || name === 'submit_material_batch')
    return (
      'evaluationNodeId' in payload &&
      payload.evaluationNodeId === input.evaluationNodeId
    );
  if (name === 'read_material_batch')
    return 'batchId' in payload && payload.batchId === input.batchId;
  if (name === 'person_brief')
    return 'person' in payload && payload.person.id === input.id;
  if (name === 'draft_requirement')
    return (
      'kind' in payload &&
      payload.kind === 'staffing_demand' &&
      (payload.result === null || payload.result.projectId === input.projectId)
    );
  if (name === 'read_requirement_status')
    return (
      'demandId' in payload &&
      payload.demandId === input.demandId &&
      payload.revision === input.expectedRevision
    );
  if (name === 'read_match_results')
    return (
      'demand' in payload &&
      payload.demand.id === input.demandId &&
      payload.demand.revision === input.expectedRevision
    );
  if (name === 'web_entry')
    return (
      'href' in payload &&
      payload.href ===
        buildEntryDeepLink(input as z.infer<typeof entryLinkTargetSchema>)
    );
  return false;
}
