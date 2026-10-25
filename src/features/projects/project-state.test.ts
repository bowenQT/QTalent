import { describe, expect, it } from 'vitest';
import {
  filterProjects,
  formatProjectDate,
  submissionFromForm,
} from './project-state';
describe('project UI state', () => {
  it('preserves server order and filters by exact status', () => {
    const projects = [
      { id: 'b', status: '进行中' },
      { id: 'a', status: '筹备中' },
      { id: 'c', status: '进行中' },
    ];
    expect(filterProjects(projects, 'all')).toBe(projects);
    expect(filterProjects(projects, '进行中').map((p) => p.id)).toEqual([
      'b',
      'c',
    ]);
    expect(filterProjects(projects, '已归档')).toEqual([]);
  });
  it('keeps the submission key across retry, trims input and preserves multiple members', () => {
    const form = new FormData();
    form.set('name', '  控制台测试项目  ');
    form.set('type', '业务项目');
    form.set('status', '进行中');
    form.set('goal', ' ');
    form.set('ownerId', '');
    form.append('memberIds', 'person-a');
    form.append('memberIds', 'person-b');
    expect(submissionFromForm(form, 'same-request')).toEqual({
      requestId: 'same-request',
      name: '控制台测试项目',
      type: '业务项目',
      status: '进行中',
      goal: '',
      ownerId: null,
      memberIds: ['person-a', 'person-b'],
    });
    expect(submissionFromForm(form, 'same-request').requestId).toBe(
      'same-request',
    );
    form.set('ownerId', 'person-b');
    expect(submissionFromForm(form, 'same-request').ownerId).toBe('person-b');
  });
  it('retains absent form values for boundary validation', () => {
    expect(submissionFromForm(new FormData(), 'request')).toEqual({
      requestId: 'request',
      name: '',
      type: '',
      status: '',
      goal: '',
      ownerId: null,
      memberIds: [],
    });
  });
  it('uses the prototype month/day representation without timezone conversions', () => {
    expect(formatProjectDate('2026-09-04')).toBe('09-04');
    expect(formatProjectDate('2026-12-31')).toBe('12-31');
  });
});
