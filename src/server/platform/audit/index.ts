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
  const id = randomUUID();
  await db.insert(auditEvents).values({
    id,
    ...event,
    ...(metadata === undefined ? {} : { metadata }),
  });
  return id;
}
