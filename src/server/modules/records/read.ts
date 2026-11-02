import type { DbExecutor } from '../../db/client';
import {
  events,
  eventParticipants,
  eventSources,
  statements,
  originals,
  originalVersions,
  fragments,
  historicalEvaluations,
  historicalParticipants,
} from './schema';
/** Complete raw relations, including withdrawn events, guard shared quotes.
 * Display filtering must never remove a shared subject from source authorization.
 */
export async function readEvidenceForTalent(db: DbExecutor) {
  return {
    events: await db.select().from(events),
    participants: await db.select().from(eventParticipants),
    eventSources: await db.select().from(eventSources),
    statements: await db.select().from(statements),
    originals: await db.select().from(originals),
    versions: await db.select().from(originalVersions),
    fragments: await db.select().from(fragments),
    historical: await db.select().from(historicalEvaluations),
    historicalParticipants: await db.select().from(historicalParticipants),
  };
}
