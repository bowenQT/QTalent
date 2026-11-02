import { randomUUID } from 'node:crypto';
import type { DbExecutor } from '../../db/client';
import { auditEvents } from './schema';
import { entryAuditMetadataSchema, type EntryAuditMetadata } from './metadata';
export async function recordAudit(
  db: DbExecutor,
  event: {
    actorId: string;
    action: string;
    resourceId: string | null;
    metadata?: EntryAuditMetadata;
  },
) {
  const metadata =
    event.metadata === undefined
      ? undefined
      : entryAuditMetadataSchema.parse(event.metadata);
  await db.insert(auditEvents).values({
    id: randomUUID(),
    ...event,
    ...(metadata === undefined ? {} : { metadata }),
  });
}
