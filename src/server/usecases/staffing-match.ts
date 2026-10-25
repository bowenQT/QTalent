import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { createClock } from '../../lib/clock';
import { activeRoles } from '../authz';
import {
  buildAuthorizedModelInput,
  type LoadTalentSnapshot,
  type TalentSource,
} from '../authz/talent';
import {
  staffingDemandSchema,
  type StaffingDemand,
} from '../../contracts/staffing';
import { sourceSchema, type Source } from '../../contracts/sources';
import type { JevClient } from '../integrations/jev';
import { createMatchingService } from '../modules/staffing/matching/service';
import {
  MatchingError,
  type MatchStore,
  type MatchScope,
  type EventConfirmationFact,
} from '../modules/staffing/matching/types';
import { referenceKey } from '../modules/staffing/matching/prompt';
import { assembleMatchingEvidence } from '../modules/staffing/matching/evidence';
import {
  createPostgresMatchStore,
  loadMatchRun,
} from '../modules/staffing/matching/store';
import {
  staffingMatchJobPolicy,
  staffingMatchQueue,
  registerStaffingMatch,
} from '../jobs/staffing-match';
import type { Database, Transaction } from '../db/client';
import { loadProjectContext } from './project-context';
import { readEvidenceForTalent } from '../modules/records';

/** Facts come from the event confirmation authority, never inferred from scores. */
export type { EventConfirmationFact } from '../modules/staffing/matching/types';
export interface StaffingMatchDependencies<C> {
  environment: string;
  store: MatchStore<C>;
  demands: {
    read(
      accountId: string,
      demandId: string,
      revision?: number,
    ): Promise<StaffingDemand | null>;
  };
  loadEvidence(
    accountId: string,
    today: string,
  ): Promise<{
    snapshot: Awaited<ReturnType<LoadTalentSnapshot>>;
    confirmations: EventConfirmationFact[];
    sources: Source[];
    actor: { id: string; name: string };
  }>;
  jev: JevClient;
  wallNow?: () => Date;
  id?: () => string;
}
export function createStaffingMatchUsecase<C>(
  deps: StaffingMatchDependencies<C>,
) {
  const wallNow = deps.wallNow ?? (() => new Date());
  const clock = createClock(deps.environment, wallNow);
  async function scope(
    accountId: string,
    demandId: string,
    revision: number,
  ): Promise<MatchScope> {
    const current = await deps.demands.read(accountId, demandId);
    if (!current) throw new MatchingError('forbidden');
    const parsedCurrent = staffingDemandSchema.parse(current);
    if (parsedCurrent.id !== demandId || parsedCurrent.revision !== revision)
      throw new MatchingError('stale');
    const pinned = await deps.demands.read(accountId, demandId, revision);
    const demand = staffingDemandSchema.parse(pinned);
    if (
      demand.status !== 'confirmed' ||
      JSON.stringify(demand) !== JSON.stringify(parsedCurrent)
    )
      throw new MatchingError('conflict');
    const loaded = await deps.loadEvidence(accountId, clock.today());
    if (
      loaded.snapshot.context.account.id !== accountId ||
      loaded.snapshot.context.account.personId !== loaded.actor.id ||
      !loaded.actor.name.trim() ||
      !activeRoles(loaded.snapshot.context).some(
        (role) => role === 'manager' || role === 'hr',
      )
    )
      throw new MatchingError('forbidden');
    // This is the existing authorization entry point, including all co-subjects
    // and field/source restrictions supplied by the 837 projection adapter.
    const selectedRecords = loaded.snapshot.records.map((record) => ({
      ...record,
      fields: record.fields.filter((field) =>
        record.kind === 'person'
          ? ['name', 'orgName'].includes(field.name) && field.kind === 'person'
          : ['situation', 'behavior', 'impact'].includes(field.name) &&
            ['evaluation', 'management-observation'].includes(field.kind),
      ),
    }));
    const { items } = await buildAuthorizedModelInput(async () => ({
      ...loaded.snapshot,
      records: selectedRecords,
    }));
    const candidates: MatchScope['candidates'] = [];
    for (const person of items.filter((record) => record.kind === 'person')) {
      const name = person.fields.name,
        orgName = person.fields.orgName;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof orgName !== 'string' ||
        !orgName.trim() ||
        person.fieldKinds.name !== 'person' ||
        person.fieldKinds.orgName !== 'person'
      )
        continue;
      const existing = candidates.find(
        (candidate) => candidate.person.id === person.personId,
      );
      if (existing) {
        if (
          existing.person.name !== name ||
          existing.person.orgName !== orgName
        )
          throw new MatchingError('conflict');
        continue;
      }
      const evidence: MatchScope['candidates'][number]['evidence'] = [];
      for (const fact of loaded.confirmations) {
        if (
          !fact.active ||
          fact.state !== 'confirmed' ||
          fact.personId !== person.personId
        )
          continue;
        if (
          fact.confirmation.kind === 'human' &&
          (!fact.confirmation.id.trim() ||
            !fact.confirmation.actorId.trim() ||
            !Number.isFinite(Date.parse(fact.confirmation.confirmedAt)))
        )
          continue;
        const event = items.find(
          (record) =>
            record.id === fact.recordId &&
            record.personId === fact.personId &&
            ['evaluation', 'management-observation'].includes(record.kind),
        );
        if (
          !event ||
          typeof event.fields.behavior !== 'string' ||
          !event.fields.behavior.trim() ||
          event.fieldKinds.behavior === 'ai-inference'
        )
          continue;
        for (const visible of event.sources) {
          const detail = loaded.sources.find(
            (source) =>
              referenceKey(source) === referenceKey(visible) &&
              source.excerpt === visible.excerpt,
          );
          if (!detail) continue;
          const source = sourceSchema.parse(detail);
          if (
            fact.confirmation.kind === 'prototype_baseline' &&
            (!fact.confirmation.id.trim() ||
              !fact.confirmation.demo ||
              source.sourceCategory !== 'prototype_baseline' ||
              !source.demo)
          )
            continue;
          evidence.push({
            eventId: fact.recordId,
            personId: fact.personId,
            nature: fact.nature,
            ...(typeof event.fields.situation === 'string'
              ? { situation: event.fields.situation }
              : {}),
            behavior: event.fields.behavior,
            ...(typeof event.fields.impact === 'string'
              ? { impact: event.fields.impact }
              : {}),
            source,
          });
        }
      }
      candidates.push({
        person: { id: person.personId, name, orgName },
        evidence,
      });
    }
    return { demand, actor: loaded.actor, candidates };
  }
  return createMatchingService({
    store: deps.store,
    scope,
    jev: deps.jev,
    now: () => wallNow().toISOString(),
    id: deps.id ?? randomUUID,
  });
}

export type StaffingMatchEvidenceData = Awaited<
  ReturnType<typeof loadProjectContext>
> &
  Awaited<ReturnType<typeof readEvidenceForTalent>>;
/** 846 supplies actual event confirmation facts; 837 supplies the shared complete
 * source projection. This loader performs all domain reads in one real snapshot.
 */
export function createStaffingMatchEvidenceLoader(ports: {
  db: Database;
  readConfirmations(
    tx: Transaction,
    data: StaffingMatchEvidenceData,
  ): Promise<EventConfirmationFact[]>;
  projectSources(
    data: StaffingMatchEvidenceData,
  ): Promise<{ sources: TalentSource[]; details: Source[] }>;
}): StaffingMatchDependencies<Transaction>['loadEvidence'] {
  return (accountId, today) =>
    ports.db.transaction(
      async (tx) => {
        const data = {
          ...(await loadProjectContext(tx, accountId, today)),
          ...(await readEvidenceForTalent(tx)),
        };
        const confirmations = await ports.readConfirmations(tx, data);
        const projection = await ports.projectSources(data);
        return assembleMatchingEvidence({
          context: data.context,
          directory: data.directory,
          projects: data.staffing.projects,
          events: data.events,
          eventSources: data.eventSources,
          confirmations,
          sources: projection.sources,
          sourceDetails: projection.details,
        });
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
}
/** Composition only; no database, queue or provider access at construction. */
export function createStaffingMatchRuntime(
  deps: Omit<StaffingMatchDependencies<Transaction>, 'store'> & {
    db: Database;
    boss(queue: typeof staffingMatchQueue): Promise<PgBoss>;
  },
) {
  const enqueue: Parameters<typeof createPostgresMatchStore>[1] = async (
    tx,
    job,
  ) => {
    const boss = await deps.boss(staffingMatchQueue);
    const id = await boss.send(
      staffingMatchQueue,
      { jobId: job.jobId, attempt: job.attempt },
      { db: fromDrizzle(tx, sql) },
    );
    if (!id) throw new Error('Matching enqueue rejected');
  };
  const service = createStaffingMatchUsecase({
    ...deps,
    store: createPostgresMatchStore(deps.db, enqueue),
  });
  return {
    service,
    policy: staffingMatchJobPolicy({
      loadRun: loadMatchRun,
      project: service.project,
      enqueue,
    }),
    registerWorker: (boss: PgBoss) =>
      registerStaffingMatch(boss, service.execute),
  };
}
