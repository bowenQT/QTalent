import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';
import { getEnv } from '../env';
export async function runMigrations() {
  const env = getEnv();
  if (env.APP_ENV === 'production')
    throw new Error(
      'Production migration requires an explicitly reviewed release procedure',
    );
  const connection = createDatabase(env.DATABASE_URL);
  try {
    await migrate(connection.db, {
      migrationsFolder: 'src/server/db/migrations',
    });
  } finally {
    await connection.pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runMigrations();
