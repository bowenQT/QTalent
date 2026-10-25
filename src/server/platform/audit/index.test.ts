import { expect, it, vi } from 'vitest';
import { recordAudit } from './index';
import { auditEvents } from './schema';
import type { DbExecutor } from '../../db/client';
it('records actor/action/resource only in the provided transaction', async () => {
  const values = vi.fn().mockResolvedValue(undefined),
    insert = vi.fn(() => ({ values }));
  await recordAudit({ insert } as unknown as DbExecutor, {
    actorId: 'a',
    action: 'project.create',
    resourceId: 'p',
  });
  expect(insert).toHaveBeenCalledWith(auditEvents);
  expect(values).toHaveBeenCalledWith({
    id: expect.any(String),
    actorId: 'a',
    action: 'project.create',
    resourceId: 'p',
  });
});
it('audit failures propagate for the caller to roll back', async () => {
  const values = vi.fn().mockRejectedValue(new Error('write failure'));
  await expect(
    recordAudit({ insert: () => ({ values }) } as unknown as DbExecutor, {
      actorId: 'a',
      action: 'auth.login',
      resourceId: 's',
    }),
  ).rejects.toThrow('write failure');
});
