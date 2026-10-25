import 'server-only';
import { workbenchSchema, type Workbench } from '../../contracts/workbench';
import { ForbiddenError } from '../usecases/project-context';
import type { PersonData } from './person-data';
import { personRole } from './person-projection';
import { loadCurrentPersonData } from './person-session';
import { peopleFromData } from './people';

export async function workbenchFromData(data: PersonData): Promise<Workbench> {
  const role = personRole(data);
  if (data.context.account.isSystemAdmin || !role) throw new ForbiddenError();
  const me = data.directory.people.find(
    (person) => person.id === data.context.account.personId,
  );
  if (!me) throw new Error('当前账号人员引用不存在');
  const greeting = { displayName: me.name };
  const notConnected = { status: 'not_connected' as const };
  if (role === 'manager') {
    return workbenchSchema.parse({
      role,
      greeting,
      entries: ['people', 'projects', 'find_people'],
      // This is an authorized entry, not a completed staffing result.
      findPeople: { status: 'ready', action: 'find_people' },
      judgmentReminders: notConnected,
      noteworthyPeople: notConnected,
      noteworthyProjects: notConnected,
      myWatch: notConnected,
    });
  }
  if (role === 'hr') {
    return workbenchSchema.parse({
      role,
      greeting,
      entries: ['people', 'projects'],
      changedPeople: notConnected,
      judgmentComparison: notConnected,
      todos: notConnected,
      materialTasks: notConnected,
    });
  }
  // Reuse the authorized projection on the same snapshot; never reconstruct
  // scores, sources or a wider trainee list from workbench-specific tables.
  const trainees = await peopleFromData(data);
  return workbenchSchema.parse({
    role,
    greeting,
    entries: ['people', 'record'],
    trainees: trainees.people.length
      ? { status: 'ready', data: trainees.people }
      : { status: 'empty' },
    todos: notConnected,
    recommendations: notConnected,
    materialTasks: notConnected,
  });
}

export async function getWorkbenchForCurrentUser(): Promise<Workbench> {
  return workbenchFromData(await loadCurrentPersonData());
}
