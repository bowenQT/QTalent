import { describe, expect, it } from 'vitest';
import {
  createProjectInputSchema,
  createProjectResultSchema,
} from './projects';
const input = {
  requestId: 'b29dbe20-1e6c-452b-8713-41f25808353d',
  name: ' 项目 ',
  type: '业务项目',
  status: '进行中',
  goal: ' ',
  ownerId: null,
  memberIds: [],
};
describe('serializable project contracts', () => {
  it('normalizes only prototype-defined defaults', () => {
    expect(createProjectInputSchema.parse(input)).toEqual({
      ...input,
      name: '项目',
      goal: '目标待补充',
    });
  });
  it('rejects forged fields, blank name, unsupported state and duplicate members', () => {
    for (const value of [
      { ...input, name: ' ' },
      { ...input, status: '已结束' },
      { ...input, organizationId: 'outside' },
      { ...input, memberIds: ['p', 'p'] },
      { ...input, ownerId: '' },
    ])
      expect(createProjectInputSchema.safeParse(value).success).toBe(false);
  });
  it('keeps validation inputs and replay results explicit', () => {
    const result = {
      status: 'validation_error',
      fieldErrors: { name: ['请输入项目名称'] },
      input,
    };
    expect(createProjectResultSchema.parse(result)).toEqual(result);
    expect(
      createProjectResultSchema.parse({
        status: 'success',
        projectId: 'p',
        replayed: true,
      }),
    ).toEqual({ status: 'success', projectId: 'p', replayed: true });
  });
});
