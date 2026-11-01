import {
  activeGrants,
  canReadProject,
  type AuthzContext,
} from '../../../authz';

export interface DemandAccess {
  projectId: string;
  initiatorAccountId: string;
}
/** Basic project access alone never reveals management-restricted staffing data. */
export function canReadDemand(
  ctx: AuthzContext,
  demand: DemandAccess,
): boolean {
  const project = ctx.projects.find((item) => item.id === demand.projectId);
  if (!project) return false;
  return activeGrants(ctx).some((grant) => {
    if (grant.role === 'mentor') return false;
    if (grant.role === 'manager') return true;
    return (
      demand.initiatorAccountId === ctx.account.id ||
      canReadProject({ ...ctx, grants: [grant] }, project)
    );
  });
}
export const canWriteDemand = canReadDemand;
