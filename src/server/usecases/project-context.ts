import type { DbExecutor } from '../db/client';
import type { AuthzContext } from '../authz';
import { readDirectory } from '../modules/directory';
import { readProgramScopes } from '../modules/programs';
import { readStaffing } from '../modules/staffing';
export class ForbiddenError extends Error {
  constructor() {
    super('无权限');
    this.name = 'ForbiddenError';
  }
}
export async function loadProjectContext(
  db: DbExecutor,
  accountId: string,
  now: string,
) {
  const directory = await readDirectory(db, accountId);
  if (!directory || directory.account.isSystemAdmin) throw new ForbiddenError();
  const scopes = await readProgramScopes(db);
  const staffing = await readStaffing(db);
  const context: AuthzContext = {
    account: directory.account,
    grants: directory.grants,
    enrollments: scopes.enrollments,
    assignments: scopes.assignments,
    people: directory.people,
    projects: staffing.projects,
    members: staffing.members,
    now,
  };
  return { context, directory, staffing };
}
