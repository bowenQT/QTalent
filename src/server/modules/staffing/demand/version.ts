import {
  staffingDemandSchema,
  type StaffingDemand,
} from '../../../../contracts/staffing';
export class DemandConflictError extends Error {}
export function reviseDemand(
  current: StaffingDemand,
  expectedRevision: number,
  change:
    | { action: 'edit'; requirements: StaffingDemand['requirements'] }
    | { action: 'confirm'; actor: { id: string; name: string }; now: string },
): StaffingDemand {
  if (
    current.revision !== expectedRevision ||
    (change.action === 'confirm' && current.status !== 'draft')
  )
    throw new DemandConflictError('需求已变化，请保留输入并刷新');
  const base = {
    id: current.id,
    projectId: current.projectId,
    revision: current.revision + 1,
    inputText: current.inputText,
    requirements:
      change.action === 'edit' ? change.requirements : current.requirements,
  };
  return staffingDemandSchema.parse(
    change.action === 'edit'
      ? { ...base, status: 'draft' }
      : {
          ...base,
          status: 'confirmed',
          confirmedBy: change.actor,
          confirmedAt: change.now,
        },
  );
}
