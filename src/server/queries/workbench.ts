import 'server-only';
import { workbenchSchema, type Workbench } from '../../contracts/workbench';
import {
  workbenchPageSchema,
  type WorkbenchPage,
} from '../../contracts/page-result';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { activeRoles, isCurrent } from '../authz';
import {
  canReadTalent,
  type TalentAuthorizationContext,
} from '../authz/talent';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { ForbiddenError } from '../usecases/project-context';
import { loadPersonData, type PersonData } from './person-data';
import { byCodePoint, byPinyin, landingOf } from './person-identity';

type WorkbenchData = PersonData & { context: TalentAuthorizationContext };

/** There is no unavailable page variant in the frozen DTO. Do not disguise an
 * unconnected permission projection as an empty or more privileged workbench.
 */
export class WorkbenchNotConnectedError extends Error {
  readonly status = 'not_connected';
  constructor() {
    super('工作台的当前权限读取尚未接通');
    this.name = 'WorkbenchNotConnectedError';
  }
}

export async function workbenchFromData(
  data: WorkbenchData,
): Promise<Workbench> {
  const context = data.context;
  const roles = activeRoles(context);
  if (context.account.isSystemAdmin || roles.length === 0)
    throw new ForbiddenError();
  // 837 has not published the complete-view selector for mixed HR/evaluator
  // scope. Picking the highest role loses or elevates part of that union.
  if (
    !roles.includes('manager') &&
    roles.includes('hr') &&
    roles.includes('mentor')
  )
    throw new WorkbenchNotConnectedError();
  const role = roles.includes('manager')
    ? 'manager'
    : roles.includes('hr')
      ? 'hr'
      : 'mentor';
  const me = data.directory.people.find(
    (person) => person.id === context.account.personId,
  );
  if (!me) throw new Error('当前账号人员引用不存在');
  const shared = {
    greeting: { displayName: me.name },
    asOf: context.now.slice(0, 10),
  };
  const notConnected = { status: 'not_connected' as const };
  if (role === 'manager') {
    return workbenchSchema.parse({
      role,
      ...shared,
      entries: ['record', 'find_people'],
      judgmentReminders: notConnected,
      noteworthyPeople: notConnected,
      noteworthyProjects: notConnected,
      myWatch: notConnected,
    });
  }
  if (role === 'hr') {
    return workbenchSchema.parse({
      role,
      ...shared,
      entries: ['record', 'find_people'],
      changedPeople: notConnected,
      judgmentComparison: notConnected,
      todos: notConnected,
      materialTasks: notConnected,
    });
  }
  if (
    !context.evaluationNodes ||
    !context.evaluationNodeSubjects ||
    !context.evaluationRelations
  )
    throw new WorkbenchNotConnectedError();

  const { evaluationNodes, evaluationNodeSubjects } = context;

  // A legacy assignment with no migrated subject is an incomplete input, not
  // proof of an empty current roster. This check grants no access; the real
  // node policy below is still the only authority for every returned person.
  if (
    context.assignments.some(
      (assignment) =>
        assignment.personId === context.account.personId &&
        isCurrent(assignment, context.now) &&
        !evaluationNodeSubjects.some(
          (subject) =>
            subject.personId === assignment.studentId &&
            evaluationNodes.some(
              (node) =>
                node.id === subject.evaluationNodeId &&
                node.cohortId === assignment.cohortId,
            ),
        ),
    )
  )
    throw new WorkbenchNotConnectedError();

  // Identity authorization uses the real 899 policy with all current node
  // facts. Old mentor assignments never substitute for an evaluation relation.
  const people = data.directory.people.filter((person) =>
    canReadTalent(
      context,
      { personId: person.id, cohortId: null, kind: 'person' },
      'workbench',
    ),
  );
  const teamName = (organizationId: string) => {
    const organization = data.directory.organizations.find(
      (row) => row.id === organizationId,
    );
    if (!organization) throw new Error('人员组织引用不存在');
    return organization.shortName;
  };
  people.sort(
    (a, b) =>
      byPinyin(teamName(a.organizationId), teamName(b.organizationId)) ||
      byPinyin(a.name, b.name) ||
      byCodePoint(a.id, b.id),
  );
  const trainees = people.map((person) => ({
    person: {
      id: person.id,
      name: person.name,
      hue: person.hue,
      photo: person.photo,
    },
    // Consume 837's single batch/landing projection; do not choose a second
    // cohort or reconstruct project authorization inside the workbench.
    topic: landingOf(data, person.id)?.topicName ?? null,
    // records/read does not yet provide the effective-event/withdrawal ledger.
    // Its raw events cannot prove a count, even when the array is empty. The
    // eventual activity window uses occurredOn (asOf-6..asOf), not createdAt.
    activity: { status: 'unknown' as const, reason: '近期记录尚未接通' },
  }));
  return workbenchSchema.parse({
    role,
    ...shared,
    entries: ['record'],
    trainees: trainees.length
      ? { status: 'ready', data: trainees }
      : { status: 'empty' },
    todos: notConnected,
    recommendations: notConnected,
    materialTasks: notConnected,
  });
}

export async function getWorkbenchForCurrentUser(): Promise<WorkbenchPage> {
  const session = await requireSession();
  const clock = createClock(getEnv().APP_ENV);
  const db = getDatabase();
  try {
    const data = await loadPersonData(db, session.user.id, clock.today());
    // Evidence reads may await I/O. Reload server-owned grants, directory and
    // evaluation relationships afterwards; the legacy PersonData context is
    // never the final authority, and the caller cannot supply a role/node list.
    const current = await loadEvaluationContext(
      db,
      session.user.id,
      clock.now().toISOString(),
    );
    current.context.now = clock.now().toISOString();
    return workbenchPageSchema.parse({
      status: 'ok',
      data: await workbenchFromData({ ...data, ...current }),
    });
  } catch (error) {
    if (error instanceof ForbiddenError)
      return workbenchPageSchema.parse({ status: 'forbidden' });
    throw error;
  }
}
