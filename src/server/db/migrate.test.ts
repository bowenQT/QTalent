import { beforeEach, expect, it, vi } from 'vitest';
import { runMigrations } from './migrate';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  create: vi.fn(),
  migrate: vi.fn(),
  end: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: mocks.env }));
vi.mock('./client', () => ({ createDatabase: mocks.create }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: mocks.migrate,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockReturnValue({
    APP_ENV: 'test',
    DATABASE_URL: 'postgres://localhost/local_test',
  });
  mocks.create.mockReturnValue({ db: {}, pool: { end: mocks.end } });
  mocks.migrate.mockResolvedValue(undefined);
});
it('does not implicitly migrate production', async () => {
  mocks.env.mockReturnValue({ APP_ENV: 'production' });
  await expect(runMigrations()).rejects.toThrow('reviewed release');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('executes versioned migration folder and closes its own connection', async () => {
  await runMigrations();
  expect(mocks.migrate).toHaveBeenCalledWith(
    {},
    { migrationsFolder: 'src/server/db/migrations' },
  );
  expect(mocks.end).toHaveBeenCalledOnce();
});
it('migration failure remains a failure and still closes pool', async () => {
  mocks.migrate.mockRejectedValue(new Error('migration failed'));
  await expect(runMigrations()).rejects.toThrow('migration failed');
  expect(mocks.end).toHaveBeenCalledOnce();
});
