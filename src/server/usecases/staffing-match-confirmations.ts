import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { importSnapshots } from '../modules/records';
import type { EventConfirmationFact } from '../modules/staffing/matching/types';

type Nature = EventConfirmationFact['nature'];
const NATURES: readonly string[] = [
  'original_fact',
  'self_report',
  'management_observation',
  'human_conclusion',
];

/** The nature an event's own statements state; null when they do not say one. */
export function eventNature(kinds: readonly string[]): Nature | null {
  if (kinds.includes('management_observation')) return 'management_observation';
  const distinct = [...new Set(kinds)];
  return distinct.length === 1 && NATURES.includes(distinct[0]!)
    ? (distinct[0] as Nature)
    : null;
}

/**
 * BOW-854 confirmation facts, read inside the matching loader's snapshot.
 * Only pinned demo-seed events have both a stated nature (their statements)
 * and an accepted provenance (their single import snapshot row). An 846 save
 * writes no statement, so a human-saved event has no nature fact and is not
 * matched: no fact is defaulted to original_fact or human_conclusion.
 */
export async function readStaffingMatchConfirmations(
  tx: DbExecutor,
  data: {
    events: readonly {
      id: string;
      personId: string;
      demo: boolean;
      withdrawnAt: Date | null;
    }[];
    statements: readonly { eventId: string; kind: string }[];
  },
): Promise<EventConfirmationFact[]> {
  const demo = data.events.filter((event) => event.demo);
  if (!demo.length) return [];
  const snapshots = await tx
    .select({ id: importSnapshots.id, recordId: importSnapshots.recordId })
    .from(importSnapshots)
    .where(
      inArray(
        importSnapshots.recordId,
        demo.map((event) => event.id),
      ),
    );
  return demo.flatMap((event): EventConfirmationFact[] => {
    const own = snapshots.filter((row) => row.recordId === event.id);
    const nature = eventNature(
      data.statements
        .filter((row) => row.eventId === event.id)
        .map((row) => row.kind),
    );
    if (own.length !== 1 || !nature) return [];
    return [
      {
        recordId: event.id,
        personId: event.personId,
        active: event.withdrawnAt === null,
        state: 'confirmed',
        confirmation: {
          kind: 'prototype_baseline',
          id: own[0]!.id,
          demo: true,
        },
        nature,
      },
    ];
  });
}
