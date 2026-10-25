import { randomUUID } from 'node:crypto';
import type { DbExecutor } from '../../db/client';
import { auditEvents } from './schema';
export async function recordAudit(
  db: DbExecutor,
  event: { actorId: string; action: string; resourceId: string },
) {
  await db.insert(auditEvents).values({ id: randomUUID(), ...event });
}
