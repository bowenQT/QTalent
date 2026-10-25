import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  drizzle: vi.fn(),
  env: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      mocks.pool(options);
    }
  },
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));
vi.mock('../env', () => ({ getEnv: mocks.env }));
it('creates isolated connections explicitly and keeps application singleton lazy', async () => {
  mocks.drizzle.mockReturnValue({ kind: 'db' });
  mocks.env.mockReturnValue({
    DATABASE_URL: 'postgres://localhost/local_test',
  });
  const { createDatabase, getDatabase } = await import('./client');
  expect(mocks.pool).not.toHaveBeenCalled();
  const first = getDatabase();
  expect(getDatabase()).toBe(first);
  expect(mocks.pool).toHaveBeenCalledTimes(1);
  expect(mocks.pool).toHaveBeenCalledWith({
    connectionString: 'postgres://localhost/local_test',
    max: 10,
  });
  const isolated = createDatabase('postgres://localhost/isolated_test');
  expect(isolated.db).toEqual({ kind: 'db' });
  expect(mocks.pool).toHaveBeenCalledTimes(2);
});
