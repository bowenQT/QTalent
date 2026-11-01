import { z } from 'zod';
// Deliberately closed: no text, credentials, headers or arbitrary attributes.
export const entryAuditMetadataSchema = z.strictObject({
  channel: z.enum(['web', 'wecom', 'mcp', 'agentapi']),
  revision: z.number().int().positive().nullable(),
});
export type EntryAuditMetadata = z.infer<typeof entryAuditMetadataSchema>;
