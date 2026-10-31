import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnv } from '../env';
export function createDatabase(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 10_000,
  });
  return { db: drizzle(pool), pool };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;
let connection: ReturnType<typeof createDatabase> | undefined;
export function getDatabase() {
  return (connection ??= createDatabase(getEnv().DATABASE_URL)).db;
}
