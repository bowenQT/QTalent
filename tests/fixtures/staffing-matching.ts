import { vi } from 'vitest';
import type { StaffingDemand } from '../../src/contracts/staffing';
import type { Source } from '../../src/contracts/sources';
import type {
  LoadTalentSnapshot,
  TalentRecord,
} from '../../src/server/authz/talent';
import type {
  MatchStore,
  MatchRun,
  StoredMatchOperation,
  MatchTransaction,
} from '../../src/server/modules/staffing/matching/types';
import type { JobRecord } from '../../src/server/jobs/state';
import { staffingMatchingSamples } from '../../src/server/modules/staffing/matching/samples';
import {
  createStaffingMatchUsecase,
  type EventConfirmationFact,
} from '../../src/server/usecases/staffing-match';

export class MemoryMatchStore implements MatchStore<null> {
  state = {
    runs: new Map<string, MatchRun>(),
    jobs: new Map<string, JobRecord>(),
    operations: new Map<string, StoredMatchOperation>(),
    enqueued: [] as JobRecord[],
  };
  failEnqueue = false;
  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(
    _key: string,
    run: (tx: MatchTransaction<null>) => Promise<T>,
  ): Promise<T> {
    const task = this.tail.then(async () => {
      const state = structuredClone(this.state);
      const key = (account: string, operation: string) =>
        JSON.stringify([account, operation]);
      const result = await run({
        context: null,
        load: async (id) => {
          const item = state.runs.get(id),
            job = state.jobs.get(id);
          return item && job ? { run: item, job } : null;
        },
        insert: async (item, job) => {
          state.runs.set(item.id, item);
          state.jobs.set(job.jobId, job);
        },
        save: async (item, job) => {
          state.runs.set(item.id, item);
          state.jobs.set(job.jobId, job);
        },
        operation: async (account, operation) =>
          state.operations.get(key(account, operation)) ?? null,
        saveOperation: async (account, operation, value) => {
          state.operations.set(key(account, operation), value);
        },
        enqueue: async (job) => {
          if (this.failEnqueue) throw new Error('queue unavailable');
          state.enqueued.push(job);
        },
      });
      this.state = state;
      return result;
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
}
export function matchingFixture() {
  const store = new MemoryMatchStore();
  const demand: StaffingDemand = {
    id: 'demand-a',
    projectId: 'project-a',
    revision: 2,
    inputText: '找能独立负责接口验收的人',
    requirements: [
      {
        id: 'required-a',
        text: '独立负责接口验收并补齐核心接口',
        priority: 'required',
      },
    ],
    status: 'confirmed',
    confirmedBy: { id: 'manager', name: '演示·管理者' },
    confirmedAt: '2026-09-01T10:00:00.000Z',
  };
  const context: Awaited<ReturnType<LoadTalentSnapshot>>['context'] = {
    account: { id: 'account-hr', personId: 'hr', isSystemAdmin: false },
    now: '2026-09-04',
    grants: [
      {
        accountId: 'account-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'cohort-a',
        validFrom: '2026-01-01',
        validTo: '2026-10-01',
        revokedAt: null,
      },
    ],
    enrollments: [],
    assignments: [],
    projects: [],
    members: [],
    people: [],
  };
  const records: TalentRecord[] = [],
    sources: Source[] = [],
    facts: EventConfirmationFact[] = [];
  const rawSources: Awaited<ReturnType<LoadTalentSnapshot>>['sources'] = [];
  for (const sample of [
    ...staffingMatchingSamples,
    {
      demo: true,
      id: 'hidden',
      name: '演示·范围外',
      behavior: '禁止发送的范围外行为',
      conclusion: 'supported' as const,
    },
  ]) {
    const subject = {
      personId: sample.id,
      cohortId: sample.id === 'hidden' ? 'cohort-b' : 'cohort-a',
    };
    context.people.push({ id: sample.id, noReview: false });
    context.enrollments.push({
      personId: sample.id,
      cohortId: subject.cohortId,
      confirmed: true,
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    });
    const reference = {
      fragmentId: 'fragment-' + sample.id,
      originalVersionId: 'version-' + sample.id,
    };
    const source: Source = {
      ...reference,
      location: { kind: 'document', paragraph: '段落-' + sample.id },
      excerpt: sample.behavior,
      originalTitle: '演示·接口验收记录',
      recordedByName: null,
      sourceType: 'document',
      sourceCategory: 'original',
      demo: true,
    };
    sources.push(source);
    rawSources.push({
      ...reference,
      location: { kind: 'document', paragraph: '段落-' + sample.id },
      excerpt: sample.behavior,
      subjects: [subject],
      kind: 'evaluation',
    });
    records.push({
      id: 'person-' + sample.id,
      subject,
      kind: 'person',
      fields: [
        {
          name: 'name',
          kind: 'person',
          value: sample.name,
          subjects: [],
          sources: [],
        },
        {
          name: 'orgName',
          kind: 'person',
          value: '演示组',
          subjects: [],
          sources: [],
        },
      ],
    });
    records.push({
      id: 'event-' + sample.id,
      subject,
      kind: 'evaluation',
      fields: [
        {
          name: 'situation',
          kind: 'evaluation',
          value: '',
          subjects: [],
          sources: [reference],
        },
        {
          name: 'behavior',
          kind: 'evaluation',
          value: sample.behavior,
          subjects: [],
          sources: [reference],
        },
        {
          name: 'impact',
          kind: 'evaluation',
          value: '',
          subjects: [],
          sources: [reference],
        },
      ],
    });
    facts.push({
      recordId: 'event-' + sample.id,
      personId: sample.id,
      active: true,
      state: 'confirmed',
      confirmation: {
        kind: 'human',
        id: 'confirmed-' + sample.id,
        actorId: 'hr',
        confirmedAt: '2026-09-02T10:00:00.000Z',
      },
      nature: 'management_observation',
    });
  }
  const snapshot = { context, records, sources: rawSources };
  const readDemand = vi.fn(
    async (
      _account: string,
      _id: string,
      revision?: number,
    ): Promise<StaffingDemand | null> =>
      revision !== undefined && revision !== demand.revision
        ? null
        : structuredClone(demand),
  );
  const loadEvidence = vi.fn(async (account: string, today: string) => ({
    snapshot: {
      ...structuredClone(snapshot),
      context: {
        ...structuredClone(context),
        account: { ...context.account, id: account },
        now: today,
      },
    },
    confirmations: structuredClone(facts),
    sources: structuredClone(sources),
    actor: { id: 'hr', name: '演示·HR' },
  }));
  const decide = vi.fn(
    async (input: {
      requirement: string;
      evidence: { sourceRef: string; text: string }[];
    }) => ({
      conclusion:
        staffingMatchingSamples.find((sample) =>
          input.evidence[0]?.sourceRef.includes('fragment-' + sample.id),
        )?.conclusion ?? ('insufficient' as const),
    }),
  );
  let nextId = 0;
  const dependencies = {
    environment: 'test',
    store,
    demands: { read: readDemand },
    loadEvidence,
    jev: { decide },
    wallNow: () => new Date('2031-04-05T06:07:08.000Z'),
    id: () => 'run-' + ++nextId,
  };
  return {
    store,
    demand,
    context,
    records,
    sources,
    rawSources,
    facts,
    readDemand,
    loadEvidence,
    decide,
    dependencies,
    service: createStaffingMatchUsecase(dependencies),
  };
}
