import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workbenchSchema } from '../../contracts/workbench';
import { workbenchPageSchema } from '../../contracts/page-result';
import { requireSession } from '../auth/next';
import type { EvaluationAuthzContext } from '../authz/evaluation-node';
import { getDatabase } from '../db/client';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { ForbiddenError } from '../usecases/project-context';
import { loadPersonData } from './person-data';
import { fixture } from './person-test-helpers';
import {
  getWorkbenchForCurrentUser,
  workbenchFromData,
  WorkbenchNotConnectedError,
} from './workbench';

vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/evaluation-context', () => ({
  loadEvaluationContext: vi.fn(),
}));
vi.mock('./person-data', async (original) => ({
  ...(await original<typeof import('./person-data')>()),
  loadPersonData: vi.fn(),
}));

const now = '2026-09-04T00:00:00.000Z';
const validity = { validFrom: '2026-01-01', validTo: null, revokedAt: null };
function snapshot(role: 'manager' | 'hr' | 'mentor' | 'admin' = 'mentor') {
  const base = fixture(role);
  const context: EvaluationAuthzContext = {
    ...base.context,
    now,
    projects: base.staffing.projects,
    members: base.staffing.members,
    evaluationNodes: [
      { id: 'node-one', kind: 'program_cohort', cohortId: 'cohort' },
      { id: 'node-two', kind: 'interview', cohortId: null },
    ],
    evaluationNodeSubjects: [
      { evaluationNodeId: 'node-one', personId: 'one' },
      { evaluationNodeId: 'node-two', personId: 'two' },
    ],
    evaluationRelations: [
      {
        id: 'relation-one',
        evaluationNodeId: 'node-one',
        evaluatorId: 'actor',
        personId: 'one',
        kind: 'mentor',
        ...validity,
      },
    ],
  };
  return {
    ...base,
    context,
    cohorts: [{ id: 'cohort', name: '演示第六期' }],
    employments: [],
  };
}
type Snapshot = ReturnType<typeof snapshot>;
function project(data: Snapshot, id: string, cohortId = 'cohort') {
  data.staffing.projects.push({
    id,
    name: '演示课题 ' + id,
    type: '课题',
    status: '进行中',
    goal: '演示目标',
    organizationId: 'org',
    cohortId,
    isTopic: true,
    ownerId: null,
    creatorId: 'actor',
    from: '2026-01-01',
    to: '2026-12-31',
    sortOrder: 0,
  });
  data.staffing.members.push({
    id: 'member-' + id,
    projectId: id,
    personId: 'one',
    role: '成员',
    mode: '兼职',
    validFrom: '2026-01-01',
    validTo: null,
    by: 'actor',
  });
}
async function trainees(data: Snapshot) {
  const result = await workbenchFromData(data);
  if (result.role !== 'mentor' || result.trainees.status !== 'ready')
    throw new Error('Expected actual mentor rows');
  return result.trainees.data;
}

describe('workbench with the frozen 836 DTO and current 899 authorization', () => {
  it('returns server asOf and manager actions without fabricated observations', async () => {
    const result = await workbenchFromData(snapshot('manager'));
    expect(workbenchSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual({
      role: 'manager',
      greeting: { displayName: 'Synthetic actor' },
      asOf: '2026-09-04',
      entries: ['record', 'find_people'],
      judgmentReminders: { status: 'not_connected' },
      noteworthyPeople: { status: 'not_connected' },
      noteworthyProjects: { status: 'not_connected' },
      myWatch: { status: 'not_connected' },
    });
  });

  it('keeps HR receipt, needs-review and future counters disconnected', async () => {
    expect(await workbenchFromData(snapshot('hr'))).toEqual({
      role: 'hr',
      greeting: { displayName: 'Synthetic actor' },
      asOf: '2026-09-04',
      entries: ['record', 'find_people'],
      changedPeople: { status: 'not_connected' },
      judgmentComparison: { status: 'not_connected' },
      todos: { status: 'not_connected' },
      materialTasks: { status: 'not_connected' },
    });
  });

  it('returns only four avatar facts, topic and safe unknown activity', async () => {
    const data = snapshot();
    data.directory.people[0].name = '演示阿青';
    data.directory.people[0].photo = 'demo-portrait';
    data.directory.people[0].hue = 137;
    project(data, 'one');
    const result = await workbenchFromData(data);
    expect(workbenchSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual({
      role: 'mentor',
      greeting: { displayName: 'Synthetic actor' },
      asOf: '2026-09-04',
      entries: ['record'],
      trainees: {
        status: 'ready',
        data: [
          {
            person: {
              id: 'one',
              name: '演示阿青',
              hue: 137,
              photo: 'demo-portrait',
            },
            topic: '演示课题 one',
            activity: { status: 'unknown', reason: '近期记录尚未接通' },
          },
        ],
      },
      todos: { status: 'not_connected' },
      recommendations: { status: 'not_connected' },
      materialTasks: { status: 'not_connected' },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /summary|score|anchor|source|quadrant|management|confidence|Synthetic two|recordedThisWeek/,
    );
  });

  it('does not use old assignments after the node relation expires or is revoked', async () => {
    for (const field of ['validTo', 'revokedAt'] as const) {
      const data = snapshot();
      data.context.evaluationRelations[0][field] = now;
      expect(data.context.assignments).toHaveLength(1);
      expect(await workbenchFromData(data)).toHaveProperty('trainees', {
        status: 'empty',
      });
    }
  });

  it('excludes future, other-evaluator, wrong-node and wrong-subject relations', async () => {
    const variants = [
      { validFrom: '2026-09-05' },
      { evaluatorId: 'someone-else' },
      { evaluationNodeId: 'node-two' },
      { personId: 'two' },
    ];
    for (const variant of variants) {
      const data = snapshot();
      Object.assign(data.context.evaluationRelations[0], variant);
      expect(await workbenchFromData(data)).toHaveProperty('trainees', {
        status: 'empty',
      });
    }
  });

  it('allows the current node relation without a legacy assignment', async () => {
    const data = snapshot();
    data.context.assignments = [];
    expect((await trainees(data)).map((row) => row.person.id)).toEqual(['one']);
  });

  it('unions actual node relations without duplicating people', async () => {
    const data = snapshot();
    data.context.evaluationRelations.push(
      { ...data.context.evaluationRelations[0], id: 'duplicate' },
      {
        ...data.context.evaluationRelations[0],
        id: 'second',
        personId: 'two',
        evaluationNodeId: 'node-two',
      },
    );
    expect((await trainees(data)).map((row) => row.person.id)).toEqual([
      'one',
      'two',
    ]);
  });

  it('excludes noReview people even with a current evaluator relation', async () => {
    const data = snapshot();
    data.directory.people[0].noReview = true;
    expect(await workbenchFromData(data)).toHaveProperty('trainees', {
      status: 'empty',
    });
  });

  it('does not return legacy-only success when node facts are absent', async () => {
    const data = snapshot();
    const legacy: typeof data.context & {
      evaluationNodes?: unknown;
      evaluationNodeSubjects?: unknown;
      evaluationRelations?: unknown;
    } = { ...data.context };
    Reflect.deleteProperty(legacy, 'evaluationNodes');
    Reflect.deleteProperty(legacy, 'evaluationNodeSubjects');
    Reflect.deleteProperty(legacy, 'evaluationRelations');
    await expect(
      workbenchFromData({ ...data, context: legacy }),
    ).rejects.toMatchObject({ status: 'not_connected' });
  });

  it('keeps an unmigrated legacy roster unavailable instead of claiming empty', async () => {
    const data = snapshot();
    data.context.evaluationNodeSubjects = [];
    await expect(workbenchFromData(data)).rejects.toMatchObject({
      status: 'not_connected',
    });
  });

  it('fails closed for mixed HR/mentor scope until the shared complete-view selector exists', async () => {
    const data = snapshot();
    data.context.grants.push({
      ...data.context.grants[0],
      role: 'hr',
      cohortId: 'different',
    });
    await expect(workbenchFromData(data)).rejects.toBeInstanceOf(
      WorkbenchNotConnectedError,
    );
    data.context.grants.push({
      ...data.context.grants[0],
      role: 'manager',
      scope: 'company',
      cohortId: null,
    });
    expect(await workbenchFromData(data)).toHaveProperty('role', 'manager');
  });

  it('does not treat an expired HR grant as mixed current scope', async () => {
    const data = snapshot();
    data.context.grants.push({
      ...data.context.grants[0],
      role: 'hr',
      validTo: now,
    });
    expect(await workbenchFromData(data)).toHaveProperty('role', 'mentor');
  });

  it('rejects administrator, absent, expired, revoked and invalid business grants', async () => {
    await expect(workbenchFromData(snapshot('admin'))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const absent = snapshot();
    absent.context.grants = [];
    await expect(workbenchFromData(absent)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    for (const variant of [
      { validTo: now },
      { revokedAt: now },
      { validFrom: '2026-09-05' },
      { accountId: 'different' },
      { scope: 'company' as const },
    ]) {
      const data = snapshot();
      Object.assign(data.context.grants[0], variant);
      await expect(workbenchFromData(data)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it('reads the unique topic in the shared selected batch, not a different batch', async () => {
    const data = snapshot();
    project(data, 'six');
    project(data, 'seven', 'cohort-seven');
    data.cohorts.push({ id: 'cohort-seven', name: '演示第七期' });
    data.context.grants.push({
      ...data.context.grants[0],
      cohortId: 'cohort-seven',
    });
    data.context.enrollments.push({
      ...data.context.enrollments[0],
      cohortId: 'cohort-seven',
      validFrom: '2026-08-01',
    });
    data.context.assignments.push({
      ...data.context.assignments[0],
      cohortId: 'cohort-seven',
    });
    data.context.evaluationNodes.push({
      id: 'node-seven',
      kind: 'program_cohort',
      cohortId: 'cohort-seven',
    });
    data.context.evaluationNodeSubjects.push({
      evaluationNodeId: 'node-seven',
      personId: 'one',
    });
    expect((await trainees(data))[0].topic).toBe('演示课题 seven');
    data.context.enrollments[1].confirmed = false;
    expect((await trainees(data))[0].topic).toBe('演示课题 six');
  });

  it('uses null for several readable topics or no selected batch', async () => {
    const data = snapshot();
    project(data, 'first');
    project(data, 'second');
    expect((await trainees(data))[0].topic).toBeNull();
    data.context.enrollments = [];
    expect((await trainees(data))[0].topic).toBeNull();
  });

  it('does not disclose an unreadable or unrelated topic', async () => {
    const data = snapshot();
    project(data, 'hidden');
    data.context.assignments = [];
    expect((await trainees(data))[0].topic).toBeNull();
    data.context.members.push({
      projectId: 'hidden',
      personId: 'actor',
      validFrom: '2026-09-05',
      validTo: null,
    });
    expect((await trainees(data))[0].topic).toBeNull();
  });

  it('uses the shared Chinese team/name order and code-point ID tie-break', async () => {
    const data = snapshot();
    const original = data.directory.people[0];
    const rows = [
      { ...original, id: 'b', name: '张演示', organizationId: 'org-b' },
      { ...original, id: 'A', name: '张演示', organizationId: 'org-b' },
      { ...original, id: 'z', name: '阿演示', organizationId: 'org-b' },
      { ...original, id: 'last-team', name: '阿演示', organizationId: 'org-c' },
    ];
    data.directory.people.splice(0, 2, ...rows);
    data.context.assignments = [];
    data.directory.organizations.push(
      {
        id: 'org-b',
        name: '演示技术团队',
        shortName: '技术',
        parentId: null,
        hierarchyKnown: false,
      },
      {
        id: 'org-c',
        name: '演示研发团队',
        shortName: '研发',
        parentId: null,
        hierarchyKnown: false,
      },
    );
    data.context.evaluationNodeSubjects = rows.map((row) => ({
      personId: row.id,
      evaluationNodeId: 'node-one',
    }));
    data.context.evaluationRelations = rows.map((row) => ({
      ...data.context.evaluationRelations[0],
      id: 'relation-' + row.id,
      personId: row.id,
    }));
    expect((await trainees(data)).map((row) => row.person.id)).toEqual([
      'z',
      'A',
      'b',
      'last-team',
    ]);
  });

  it('keeps activity unknown with empty or populated raw events, not invented zero or recent dates', async () => {
    const data = snapshot();
    for (const date of [
      '2026-08-28',
      '2026-08-29',
      '2026-09-04',
      '2026-09-05',
    ]) {
      data.events[0].occurredOn = date;
      expect((await trainees(data))[0].activity).toEqual({
        status: 'unknown',
        reason: '近期记录尚未接通',
      });
    }
    data.events = [];
    expect((await trainees(data))[0].activity).toEqual({
      status: 'unknown',
      reason: '近期记录尚未接通',
    });
  });

  it('does not invent a missing account-person greeting or an organization name', async () => {
    const data = snapshot();
    data.context.account.personId = 'missing';
    await expect(workbenchFromData(data)).rejects.toThrow(
      '当前账号人员引用不存在',
    );
    const broken = snapshot();
    broken.directory.people[0].organizationId = 'missing';
    // Sorting a single row need not call a comparator; exercise real sorting.
    broken.context.evaluationRelations.push({
      ...broken.context.evaluationRelations[0],
      id: 'second',
      personId: 'two',
      evaluationNodeId: 'node-two',
    });
    await expect(workbenchFromData(broken)).rejects.toThrow(
      '人员组织引用不存在',
    );
  });
});

describe('native workbench query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: 'account' },
    } as Awaited<ReturnType<typeof requireSession>>);
    vi.mocked(getDatabase).mockReturnValue(
      {} as ReturnType<typeof getDatabase>,
    );
  });

  function nativeSnapshots(data = snapshot()) {
    vi.mocked(loadPersonData).mockResolvedValue(data);
    const current = {
      context: { ...data.context, hrCandidateGrants: [] },
      directory: data.directory,
      staffing: data.staffing,
      facts: {
        evaluationNodes: data.context.evaluationNodes.map((node) => ({
          ...node,
          name: '演示节点',
        })),
        evaluationNodeSubjects: data.context.evaluationNodeSubjects,
        evaluationRelations: data.context.evaluationRelations.map(
          (relation) => ({ ...relation, legacyAssignmentId: null }),
        ),
      },
    };
    vi.mocked(loadEvaluationContext).mockResolvedValue(current);
    return current;
  }

  it('returns the frozen page envelope from the server account and business clock', async () => {
    nativeSnapshots();
    const result = await getWorkbenchForCurrentUser();
    expect(workbenchPageSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      status: 'ok',
      data: { role: 'mentor', asOf: '2026-09-04' },
    });
    expect(loadPersonData).toHaveBeenCalledWith(
      getDatabase(),
      'account',
      '2026-09-04',
    );
    expect(loadEvaluationContext).toHaveBeenCalledWith(
      getDatabase(),
      'account',
      now,
    );
    expect(vi.mocked(loadPersonData).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(loadEvaluationContext).mock.invocationCallOrder[0],
    );
  });

  it('rechecks current node relations after the asynchronous evidence read', async () => {
    const current = nativeSnapshots();
    current.context.evaluationRelations = [];
    expect(await getWorkbenchForCurrentUser()).toMatchObject({
      status: 'ok',
      data: { trainees: { status: 'empty' } },
    });
  });

  it('rechecks grant expiry and current self identity instead of returning the old snapshot', async () => {
    const current = nativeSnapshots(snapshot('manager'));
    current.context.grants = [{ ...current.context.grants[0], validTo: now }];
    expect(await getWorkbenchForCurrentUser()).toEqual({ status: 'forbidden' });
    const renamed = nativeSnapshots(snapshot('hr'));
    renamed.directory.people.find((row) => row.id === 'actor')!.name =
      '演示新名字';
    expect(await getWorkbenchForCurrentUser()).toHaveProperty(
      'data.greeting.displayName',
      '演示新名字',
    );
  });

  it('returns no message or name for forbidden accounts at either loader', async () => {
    for (const loader of [loadPersonData, loadEvaluationContext]) {
      nativeSnapshots();
      vi.mocked(loader).mockRejectedValue(new ForbiddenError());
      expect(await getWorkbenchForCurrentUser()).toEqual({
        status: 'forbidden',
      });
    }
  });

  it('preserves infrastructure failures and safe unavailable results', async () => {
    nativeSnapshots();
    vi.mocked(loadPersonData).mockRejectedValue(new Error('database failed'));
    await expect(getWorkbenchForCurrentUser()).rejects.toThrow(
      'database failed',
    );
    nativeSnapshots();
    vi.mocked(loadEvaluationContext).mockRejectedValue(
      new Error('authorization database failed'),
    );
    await expect(getWorkbenchForCurrentUser()).rejects.toThrow(
      'authorization database failed',
    );
    const mixed = snapshot();
    mixed.context.grants.push({ ...mixed.context.grants[0], role: 'hr' });
    nativeSnapshots(mixed);
    await expect(getWorkbenchForCurrentUser()).rejects.toBeInstanceOf(
      WorkbenchNotConnectedError,
    );
  });
});
