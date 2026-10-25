import 'server-only';
import type { ProjectList } from '../../contracts/projects';
import { getDatabase } from '../db/client';
import { requireSession } from '../auth/next';
import { canCreateProject, canReadProject, canReadFullPerson } from '../authz';
import {
  loadProjectContext,
  ForbiddenError,
} from '../usecases/project-context';
import { createClock } from '../../lib/clock';
import { getEnv } from '../env';
export async function listProjectsForCurrentUser(): Promise<ProjectList> {
  const session = await requireSession();
  const now = createClock(getEnv().APP_ENV).today();
  const { context, directory, staffing } = await loadProjectContext(
    getDatabase(),
    session.user.id,
    now,
  );
  const orgName = (id: string) =>
    directory.organizations.find((o) => o.id === id)?.shortName ?? '';
  const person = (id: string) => directory.people.find((p) => p.id === id);
  const active = (m: { validFrom: string; validTo: string | null }) =>
    m.validFrom <= now && (!m.validTo || now < m.validTo);
  return {
    canCreate: canCreateProject(context),
    eligiblePeople: canCreateProject(context)
      ? directory.people
          .filter((p) => canReadFullPerson(context, p.id))
          .map((p) => ({
            id: p.id,
            name: p.name,
            orgName: orgName(p.organizationId),
            hue: p.hue,
            currentProjectCount: staffing.members.filter(
              (m) =>
                m.personId === p.id &&
                active(m) &&
                staffing.projects.some(
                  (project) =>
                    project.id === m.projectId &&
                    !['已结束', '已归档'].includes(project.status) &&
                    canReadProject(context, project),
                ),
            ).length,
          }))
      : [],
    projects: staffing.projects
      .filter((p) => canReadProject(context, p))
      .map((p) => {
        const ended = ['已结束', '已归档'].includes(p.status);
        const projectMembers = staffing.members.filter(
          (m) => m.projectId === p.id && (ended || active(m)),
        );
        const owner = p.ownerId ? person(p.ownerId) : undefined;
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          status: p.status,
          goal: p.goal,
          orgName: orgName(p.organizationId),
          from: p.from,
          to: p.to,
          owner: owner ? { id: owner.id, name: owner.name } : null,
          members: projectMembers.slice(0, 6).map((m) => {
            const row = person(m.personId);
            if (!row) throw new Error('项目成员引用不存在');
            return {
              id: row.id,
              name: row.name,
              hue: row.hue,
              photo: row.photo,
            };
          }),
          memberCount: projectMembers.length,
        };
      }),
  };
}
export async function getProjectsPage(): Promise<
  { status: 'ok'; data: ProjectList } | { status: 'forbidden' }
> {
  try {
    return { status: 'ok', data: await listProjectsForCurrentUser() };
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: 'forbidden' };
    throw error;
  }
}
