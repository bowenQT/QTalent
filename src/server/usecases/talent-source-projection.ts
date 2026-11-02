import { sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import type {
  TalentSource,
  TalentSubject,
  TalentKind,
  TalentAuthorizationContext,
} from '../authz/talent';
import {
  arrangeInputs,
  type readEvidenceForTalent,
  type StoredArrangeInput,
} from '../modules/records';
import { confirmationSources } from './record-confirmation-sources';
import { sourceKey } from './source-key';
export { sourceKey } from './source-key';

/** Complete raw provenance, including withdrawn events and every shared subject.
 * This graph is not a permission grant or an immutable-version/locator check.
 * Callers still apply current authorization and validate the actual original.
 */
export type RawTalentSourceData = Awaited<
  ReturnType<typeof readEvidenceForTalent>
> & {
  context: TalentAuthorizationContext;
  staffing: { projects: { id: string; cohortId: string | null }[] };
};

declare const intakeTableBrand: unique symbol;
/** The whole arrange_inputs table, unfiltered. Only readIntakeTable (and the
 * test fixture below) produce one, so no caller can pass a filtered subset. */
export type IntakeTable = {
  readonly [intakeTableBrand]: true;
  readonly rows: readonly StoredArrangeInput[];
};
const asIntakeTable = (rows: StoredArrangeInput[]) =>
  ({ rows }) as unknown as IntakeTable;

/** Read every intake row: no creator, person, batch or superseded filter.
 * - 'snapshot': read-only paths inside the caller's own snapshot, no lock. Safe
 *   under READ COMMITTED as well, because intake rows only ever add subjects and
 *   requiredKinds to a fragment; a concurrent intake can only narrow access.
 * - 'locked': paths that write other tables or hand sources to the model. SHARE
 *   fences intake DML until commit. Take it before batch / draft locks.
 * - 'locked-for-write': the transaction itself inserts or updates intake rows.
 *   SHARE ROW EXCLUSIVE is self-exclusive, so two writers cannot both hold SHARE
 *   and then deadlock upgrading to write. Take it as the first lock.
 * Calling it again in the same transaction re-reads, including own inserts. */
export async function readIntakeTable(
  tx: Transaction,
  mode: 'snapshot' | 'locked' | 'locked-for-write',
): Promise<IntakeTable> {
  if (mode !== 'snapshot') await lockIntakeTable(tx, mode);
  return asIntakeTable(await tx.select().from(arrangeInputs));
}
/** Take the intake lock alone, as a transaction's first lock (see readIntakeTable). */
export async function lockIntakeTable(
  tx: Transaction,
  mode: 'locked' | 'locked-for-write',
): Promise<void> {
  await tx.execute(
    mode === 'locked'
      ? sql`lock table ${arrangeInputs} in share mode`
      : sql`lock table ${arrangeInputs} in share row exclusive mode`,
  );
}

/** Unit-test fixtures only; production code must read the table. */
export function intakeTableForTests(rows: StoredArrangeInput[]): IntakeTable {
  return asIntakeTable(rows);
}

export type TalentSourceProjectionData = RawTalentSourceData & {
  intake: IntakeTable;
};

/** Permission requirement for the four approved, pinned prototype history kinds.
 * The baseline's graduation row needs restricted evaluation access, not the
 * personnel-material restriction that excludes every role from model input.
 * Its historical kind, source category, scale and values remain unchanged.
 * New source types/free-text labels need their own confirmed classification.
 */
export function historicalEvaluationRequiredKind(row: {
  kind: string;
  sourceCategory: string;
}): 'evaluation' | 'restricted-evaluation' | null {
  if (row.sourceCategory !== 'prototype_baseline') return null;
  switch (row.kind) {
    case '训练营周评':
    case 'MS 路演评审':
    case '奖项答辩':
      return 'evaluation';
    case '结营评审':
      return 'restricted-evaluation';
    default:
      return null;
  }
}

export function eventSubject(
  data: RawTalentSourceData,
  event: RawTalentSourceData['events'][number],
): TalentSubject {
  return {
    personId: event.personId,
    evaluationNodeId: event.evaluationNodeId,
    cohortId:
      event.evaluationNodeId !== null
        ? (data.context.evaluationNodes?.find(
            (node) => node.id === event.evaluationNodeId,
          )?.cohortId ?? null)
        : (data.staffing.projects.find((p) => p.id === event.projectId)
            ?.cohortId ?? null),
  };
}
export function historicalSubject(
  data: RawTalentSourceData,
  row: RawTalentSourceData['historical'][number],
  personId: string,
): TalentSubject {
  return {
    personId,
    evaluationNodeId: row.evaluationNodeId,
    cohortId:
      data.context.evaluationNodes?.find(
        (node) => node.id === row.evaluationNodeId,
      )?.cohortId ?? null,
  };
}
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}
/** The only source projection: the formal graph plus every matching intake,
 * superseded ones included. A fragment with no formal links (new text before
 * its first save) takes its subjects from the matching intake contexts alone.
 * Any matching intake that fails integrity checks, or a linked fragment with no
 * formal subjects, yields no subjects, so every reader refuses it. Callers still
 * apply current permissions to each subject of the result. */
export function completeTalentSources(
  data: TalentSourceProjectionData,
): TalentSource[] {
  return confirmationSources({
    sources: rawTalentSourceGraph(data),
    versions: data.versions,
    originals: data.originals,
    inputs: [...data.intake.rows],
    linkedSourceKeys: new Set(
      [...data.eventSources, ...data.historical].map(sourceKey),
    ),
  });
}

/** Formal events and history only, before any intake restriction. Private:
 * every caller goes through completeTalentSources.
 * Relations are indexed once per call: the full demo snapshot has ~1k
 * fragments, and per-fragment scans of every relation cost seconds per read.
 */
function rawTalentSourceGraph(data: RawTalentSourceData): TalentSource[] {
  const linksBySource = groupBy(data.eventSources, sourceKey);
  const eventOrder = new Map(
    data.events.map((event, index) => [event.id, index]),
  );
  const participantsByEvent = groupBy(data.participants, (p) => p.eventId);
  const historyBySource = groupBy(data.historical, sourceKey);
  const historicalParticipantsByEvaluation = groupBy(
    data.historicalParticipants,
    (participant) => participant.evaluationId,
  );
  const observedSources = new Set(
    data.statements
      .filter((row) => row.kind === 'management_observation')
      .map(sourceKey),
  );
  const sources: TalentSource[] = data.fragments.map((fragment) => {
    const reference = {
      fragmentId: fragment.id,
      originalVersionId: fragment.originalVersionId,
    };
    const key = sourceKey(reference);
    const links = linksBySource.get(key) ?? [];
    const linkedEvents = [
      ...new Set(links.flatMap((link) => eventOrder.get(link.eventId) ?? [])),
    ]
      .sort((a, b) => a - b)
      .map((index) => data.events[index]!);
    const subjects = linkedEvents.flatMap((event) => {
      const subject = eventSubject(data, event);
      return [
        subject,
        ...(participantsByEvent.get(event.id) ?? []).map((p) => ({
          ...subject,
          personId: p.personId,
        })),
      ];
    });
    const history = historyBySource.get(key) ?? [];
    for (const row of history) {
      if (row.personId)
        subjects.push(historicalSubject(data, row, row.personId));
      for (const participant of historicalParticipantsByEvaluation.get(
        row.id,
      ) ?? [])
        subjects.push(historicalSubject(data, row, participant.personId));
    }
    const historyKinds = history.map(historicalEvaluationRequiredKind);
    const requiredKinds: TalentKind[] = [];
    if (observedSources.has(key)) requiredKinds.push('management-observation');
    // Sensitivity adds an access requirement without rewriting historical facts.
    if (historyKinds.includes('restricted-evaluation'))
      requiredKinds.push('restricted-evaluation');
    if (
      links.some((link) => !eventOrder.has(link.eventId)) ||
      historyKinds.includes(null) ||
      history.some(
        (row) =>
          !row.personId && !historicalParticipantsByEvaluation.has(row.id),
      )
    )
      subjects.length = 0;
    return {
      ...reference,
      subjects,
      kind: 'evaluation',
      requiredKinds,
      excerpt: fragment.excerpt,
      location: fragment.location,
    };
  });
  return sources;
}
