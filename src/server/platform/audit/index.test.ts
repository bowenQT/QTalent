import { expect, it, vi } from 'vitest';
import { recordAudit } from './index';
import { auditEvents } from './schema';
import type { DbExecutor } from '../../db/client';
it('records actor/action/resource only in the provided transaction', async () => {
  const values = vi.fn().mockResolvedValue(undefined),
    insert = vi.fn(() => ({ values }));
  const id = await recordAudit({ insert } as unknown as DbExecutor, {
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
  expect(insert).toHaveBeenCalledTimes(1);
  expect(values).toHaveBeenCalledTimes(1);
  expect(id).toBe(values.mock.calls[0][0].id);
});
it('audit failures propagate for the caller to roll back', async () => {
  const failure = new Error('write failure');
  const values = vi.fn().mockRejectedValue(failure);
  const onSuccess = vi.fn();
  await expect(
    recordAudit({ insert: () => ({ values }) } as unknown as DbExecutor, {
      actorId: 'a',
      action: 'auth.login',
      resourceId: 's',
    }).then(onSuccess),
  ).rejects.toBe(failure);
  expect(onSuccess).not.toHaveBeenCalled();
});

it('returns the inserted id only after the insert resolves', async () => {
  let finishWrite!: () => void;
  const write = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const values = vi.fn<
    (event: typeof auditEvents.$inferInsert) => Promise<void>
  >(() => write);
  const onSuccess = vi.fn();
  const result = recordAudit(
    { insert: () => ({ values }) } as unknown as DbExecutor,
    { actorId: 'a', action: 'auth.login', resourceId: null },
  ).then(onSuccess);

  await Promise.resolve();
  expect(values).toHaveBeenCalledWith({
    id: expect.any(String),
    actorId: 'a',
    action: 'auth.login',
    resourceId: null,
  });
  expect(onSuccess).not.toHaveBeenCalled();

  finishWrite();
  await result;
  expect(onSuccess).toHaveBeenCalledExactlyOnceWith(values.mock.calls[0][0].id);
});

it('preserves validated optional entry metadata and a null resource', async () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const id = await recordAudit(
    { insert: () => ({ values }) } as unknown as DbExecutor,
    {
      actorId: 'a',
      action: 'entry.tool',
      resourceId: null,
      metadata: { channel: 'web', revision: null },
    },
  );
  expect(values).toHaveBeenCalledExactlyOnceWith({
    id,
    actorId: 'a',
    action: 'entry.tool',
    resourceId: null,
    metadata: { channel: 'web', revision: null },
  });
});

it.each([
  { channel: 'web', revision: null, text: 'not allowed' },
  { channel: 'web', revision: 0 },
])('rejects invalid metadata before inserting: %j', async (metadata) => {
  const insert = vi.fn();
  const onSuccess = vi.fn();
  await expect(
    recordAudit({ insert } as unknown as DbExecutor, {
      actorId: 'a',
      action: 'entry.tool',
      resourceId: null,
      metadata: metadata as Parameters<typeof recordAudit>[1]['metadata'],
    }).then(onSuccess),
  ).rejects.toThrow();
  expect(insert).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
});
