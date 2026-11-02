import { expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client';
import { stampSessionBindingGeneration } from './session-binding';

function fakeDb(rows: { generation: number }[]) {
  const limit = vi.fn(async () => rows);
  const chain = { from: () => chain, where: () => chain, limit };
  return { db: { select: () => chain } as unknown as DbExecutor, limit };
}
it('stamps the bound generation and keeps the other session fields', async () => {
  const { db } = fakeDb([{ generation: 4 }]);
  expect(
    await stampSessionBindingGeneration(db, { userId: 'a', token: 't' }),
  ).toEqual({ data: { userId: 'a', token: 't', bindingGeneration: 4 } });
});
it('stamps null for an unbound account so the entry adapter fails closed', async () => {
  const { db } = fakeDb([]);
  expect(await stampSessionBindingGeneration(db, { userId: 'a' })).toEqual({
    data: { userId: 'a', bindingGeneration: null },
  });
});
