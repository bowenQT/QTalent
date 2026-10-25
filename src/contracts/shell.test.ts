import { expect, it } from 'vitest';
import { shellSchema } from './shell';
it('represents missing integrations without misleading zero badges', () => {
  const value = {
    account: {
      id: 'demo',
      name: '演示',
      email: 'demo@qtalent.test',
      roles: ['manager'],
      hue: 212,
      roleLabel: '管理者',
      scopeLabel: '公司',
    },
    navigation: [],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: true,
    isAdmin: false,
    role: 'manager',
  };
  expect(shellSchema.parse(value)).toEqual(value);
  expect(shellSchema.safeParse({ ...value, counts: { work: 0 } }).success).toBe(
    false,
  );
});
