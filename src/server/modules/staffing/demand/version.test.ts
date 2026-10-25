import { expect, it } from 'vitest';
import { reviseDemand } from './version';
import type { StaffingDemand } from '../../../../contracts/staffing';
const draft: StaffingDemand = { id: 'demand', projectId: 'project', revision: 1,
  inputText: '演示需求', requirements: [{ id: 'r1', text: '工程经验', priority: 'required' }], status: 'draft' };
const confirm = { action: 'confirm' as const, actor: { id: 'actor', name: '演示管理者' }, now: '2026-10-25T00:00:00.000Z' };
it('appends signed confirmation and preserves the original suggestion', () => {
  const confirmed = reviseDemand(draft, 1, confirm);
  expect(confirmed).toMatchObject({ revision: 2, status: 'confirmed', confirmedBy: confirm.actor });
  expect(draft).toMatchObject({ revision: 1, status: 'draft' });
  const edited = reviseDemand(confirmed, 2, { action: 'edit', requirements: [{ id: 'r2', text: '技术沟通', priority: 'bonus' }] });
  expect(edited).toMatchObject({ revision: 3, status: 'draft' });
  expect(edited).not.toHaveProperty('confirmedBy');
  expect(confirmed.requirements).toEqual(draft.requirements);
});
it('rejects stale versions, repeated confirmation and empty edits', () => {
  expect(() => reviseDemand(draft, 2, confirm)).toThrow();
  expect(() => reviseDemand(reviseDemand(draft, 1, confirm), 2, confirm)).toThrow();
  expect(() => reviseDemand(draft, 1, { action: 'edit', requirements: [] })).toThrow();
});
