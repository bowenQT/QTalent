import { randomUUID } from 'node:crypto';
import { createClock } from '../../lib/clock';
import { activeRoles } from '../authz';
import {
  buildAuthorizedModelInput,
  type LoadTalentSnapshot,
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
} from '../modules/staffing/matching/types';
import { referenceKey } from '../modules/staffing/matching/prompt';

/** Facts come from the event confirmation authority, never inferred from scores. */
export interface EventConfirmationFact {
  recordId: string;
  personId: string;
  active: boolean;
  state: 'draft' | 'confirmed';
  confirmation:
    | { kind: 'human'; id: string; actorId: string; confirmedAt: string }
    | { kind: 'prototype_baseline'; id: string; demo: true };
  nature:
    | 'original_fact'
    | 'self_report'
    | 'management_observation'
    | 'human_conclusion';
}
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
      if (
        candidates.some((candidate) => candidate.person.id === person.personId)
      )
        throw new MatchingError('conflict');
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
