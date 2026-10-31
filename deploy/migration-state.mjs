import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function readMigrationState(Client, connectionString) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const version = await client.query(
      "SELECT current_setting('server_version_num') AS version",
    );
    const serverVersion = String(version.rows[0]?.version);
    if (!/^[0-9]+$/.test(serverVersion))
      throw new Error('invalid_server_version');
    const journal = await client.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS journal",
    );
    const journalExists = journal.rows[0]?.journal !== null;
    const rows = journalExists
      ? (
          await client.query(
            'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id',
          )
        ).rows
      : [];
    const migrations = rows.map((row) => {
      if (
        !/^[0-9a-f]{64}$/.test(row.hash) ||
        !/^[0-9]+$/.test(String(row.created_at))
      )
        throw new Error('invalid_migration_row');
      return { hash: row.hash, createdAt: String(row.created_at) };
    });
    await client.query('COMMIT');
    return { journalExists, serverVersion, migrations };
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is closed below */
    }
    throw new Error('migration_probe_failed');
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.env.APP_ENV !== 'demo') throw new Error('demo_required');
    const require = createRequire(join(process.cwd(), 'package.json'));
    const { Client } = require('pg');
    console.log(
      JSON.stringify(
        await readMigrationState(Client, process.env.DATABASE_URL),
      ),
    );
  } catch {
    console.error(JSON.stringify({ error: 'migration_probe_failed' }));
    process.exitCode = 1;
  }
}
