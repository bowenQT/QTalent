import { describe, expect, it, vi } from 'vitest';
import { workbenchSchema } from '../../contracts/workbench';
import { fixture } from './person-test-helpers';
import { loadCurrentPersonData } from './person-session';
import { getWorkbenchForCurrentUser, workbenchFromData } from './workbench';

vi.mock('./person-session', () => ({ loadCurrentPersonData: vi.fn() }));

describe('authorized workbench reads', () => {
  it('returns the manager entry, not fabricated observations', async () => {
    const result = await workbenchFromData(fixture('manager'));
    expect(workbenchSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual({
      role: 'manager',
      greeting: { displayName: 'Synthetic actor' },
      entries: ['people', 'projects', 'find_people'],
      findPeople: { status: 'ready', action: 'find_people' },
      judgmentReminders: { status: 'not_connected' },
      noteworthyPeople: { status: 'not_connected' },
      noteworthyProjects: { status: 'not_connected' },
      myWatch: { status: 'not_connected' },
    });
  });
  it('keeps HR future blocks disconnected rather than empty', async () => {
    expect(await workbenchFromData(fixture('hr'))).toEqual({
      role: 'hr',
      greeting: { displayName: 'Synthetic actor' },
      entries: ['people', 'projects'],
      changedPeople: { status: 'not_connected' },
      judgmentComparison: { status: 'not_connected' },
      todos: { status: 'not_connected' },
      materialTasks: { status: 'not_connected' },
    });
  });
  it('reads mentor quick views without restricted fields', async () => {
    const result = await workbenchFromData(fixture('mentor'));
    expect(workbenchSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      role: 'mentor',
      entries: ['people', 'record'],
      trainees: {
        status: 'ready',
        data: [
          {
            role: 'mentor',
            person: { id: 'one' },
            summary: { status: 'ready' },
            capabilityProfile: { status: 'ready' },
            projects: { status: 'empty' },
          },
        ],
      },
      todos: { status: 'not_connected' },
      recommendations: { status: 'not_connected' },
      materialTasks: { status: 'not_connected' },
    });
    expect(result).toHaveProperty('trainees.data.length', 1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /referencePosition|managementObservations|hiddenN|totalScore|confidence/,
    );
    expect(serialized).not.toContain('Synthetic two');
  });
  it('keeps real empty trainees distinct from future sections', async () => {
    const data = fixture('mentor');
    data.context.assignments[0].validTo = data.context.now;
    expect(await workbenchFromData(data)).toMatchObject({
      trainees: { status: 'empty' },
      todos: { status: 'not_connected' },
    });
    data.context.assignments[0].validTo = null;
    data.directory.people[0].noReview = true;
    expect(await workbenchFromData(data)).toHaveProperty(
      'trainees.status',
      'empty',
    );
  });
  it('unions current mentor grants without duplicate trainees', async () => {
    const data = fixture('mentor');
    const grant = data.context.grants[0];
    data.context.grants.push({ ...grant, cohortId: 'second' }, { ...grant });
    data.context.enrollments.push({
      ...data.context.enrollments[0],
      personId: 'two',
      cohortId: 'second',
    });
    data.context.assignments.push(
      { ...data.context.assignments[0] },
      {
        ...data.context.assignments[0],
        studentId: 'two',
        cohortId: 'second',
      },
    );
    const result = await workbenchFromData(data);
    expect(result).toHaveProperty('trainees.data.length', 2);
    if (result.role !== 'mentor' || result.trainees.status !== 'ready')
      throw new Error('Expected mentor trainees');
    expect(result.trainees.data.map((row) => row.person.id)).toEqual([
      'one',
      'two',
    ]);
    data.context.grants[1].revokedAt = data.context.now;
    expect(await workbenchFromData(data)).toHaveProperty(
      'trainees.data.length',
      1,
    );
  });
  it('filters shared management sources before mentor values', async () => {
    const data = fixture('mentor');
    data.statements[0].kind = 'management_observation';
    data.statements[0].text = 'Restricted synthetic observation';
    const result = await workbenchFromData(data);
    expect(result).toHaveProperty('trainees.data.0.summary.data.length', 1);
    expect(result).toHaveProperty(
      'trainees.data.0.capabilityProfile.data.length',
      2,
    );
    expect(JSON.stringify(result)).not.toContain(
      'Restricted synthetic observation',
    );
    expect(JSON.stringify(result)).not.toContain('fragment-0');
  });
  it('rejects admin, absent and expired business grants', async () => {
    await expect(workbenchFromData(fixture('admin'))).rejects.toThrow(
      '无权限',
    );
    const data = fixture('hr');
    data.context.grants[0].validTo = data.context.now;
    await expect(workbenchFromData(data)).rejects.toThrow('无权限');
    data.context.grants = [];
    await expect(workbenchFromData(data)).rejects.toThrow('无权限');
  });
  it('uses existing role precedence for complete grant union', async () => {
    const data = fixture('mentor');
    data.context.grants.push({ ...data.context.grants[0], role: 'hr' });
    expect(await workbenchFromData(data)).toHaveProperty('role', 'hr');
    data.context.grants.push({
      ...data.context.grants[0],
      role: 'manager',
      scope: 'company',
      cohortId: null,
    });
    expect(await workbenchFromData(data)).toHaveProperty('role', 'manager');
  });
  it('loads one snapshot and preserves infrastructure failures', async () => {
    vi.mocked(loadCurrentPersonData).mockReset();
    vi.mocked(loadCurrentPersonData).mockResolvedValue(fixture('mentor'));
    expect(await getWorkbenchForCurrentUser()).toHaveProperty('role', 'mentor');
    expect(loadCurrentPersonData).toHaveBeenCalledTimes(1);
    vi.mocked(loadCurrentPersonData).mockRejectedValue(
      new Error('database failed'),
    );
    await expect(getWorkbenchForCurrentUser()).rejects.toThrow(
      'database failed',
    );
  });
  it('does not invent a missing account-person greeting', async () => {
    const data = fixture('manager');
    data.context.account.personId = 'missing';
    await expect(workbenchFromData(data)).rejects.toThrow();
  });
});
