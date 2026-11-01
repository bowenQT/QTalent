import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMigrationState } from './migration-state.mjs';
function clientFixture({
  journal = 'drizzle.__drizzle_migrations',
  version = '170000',
  rows = [],
  fail = false,
} = {}) {
  const calls = [];
  class Client {
    async connect() {
      calls.push('connect');
    }
    async query(sql) {
      calls.push(sql);
      if (fail && sql.startsWith('SELECT'))
        throw new Error('synthetic-private-db-url');
      if (sql.includes('server_version_num')) return { rows: [{ version }] };
      if (sql.includes('to_regclass')) return { rows: [{ journal }] };
      return { rows };
    }
    async end() {
      calls.push('end');
    }
  }
  return { Client, calls };
}
test('reads actual journal metadata in a read-only transaction and closes connection', async () => {
  const f = clientFixture({
    rows: [{ hash: 'a'.repeat(64), created_at: '1792942095377' }],
  });
  const result = await readMigrationState(
    f.Client,
    'postgres://synthetic:password@db.example.test:5432/demo?sslmode=verify-full',
  );
  assert.deepEqual(result, {
    journalExists: true,
    serverVersion: '170000',
    migrations: [{ hash: 'a'.repeat(64), createdAt: '1792942095377' }],
  });
  assert.equal(f.calls[1], 'BEGIN READ ONLY');
  assert.equal(f.calls.at(-1), 'end');
  assert.equal(
    f.calls.some((sql) => /INSERT|UPDATE|DELETE/.test(sql)),
    false,
  );
});
test('reports a missing journal separately from an empty existing journal', async () => {
  const missing = clientFixture({ journal: null });
  assert.deepEqual(
    (
      await readMigrationState(
        missing.Client,
        'postgres://synthetic:password@db.example.test:5432/demo?sslmode=verify-full',
      )
    ).migrations,
    [],
  );
  assert.equal(
    (
      await readMigrationState(
        missing.Client,
        'postgres://synthetic:password@db.example.test:5432/demo?sslmode=verify-full',
      )
    ).journalExists,
    false,
  );
});
test('rolls back and hides raw connection/query errors', async () => {
  const f = clientFixture({ fail: true });
  await assert.rejects(
    readMigrationState(
      f.Client,
      'postgres://synthetic:password@db.example.test:5432/demo?sslmode=verify-full',
    ),
    (error) =>
      error.message === 'migration_probe_failed' &&
      !String(error).includes('private'),
  );
  assert.equal(f.calls.includes('ROLLBACK'), true);
  assert.equal(f.calls.at(-1), 'end');
});
test('refuses malformed version, hash and journal timestamp', async () => {
  for (const options of [
    { version: 'private-value' },
    { rows: [{ hash: 'wrong', created_at: '1' }] },
    { rows: [{ hash: 'a'.repeat(64), created_at: 'private-value' }] },
  ]) {
    const f = clientFixture(options);
    await assert.rejects(
      readMigrationState(
        f.Client,
        'postgres://synthetic:password@db.example.test:5432/demo?sslmode=verify-full',
      ),
      /migration_probe_failed/,
    );
    assert.equal(f.calls.at(-1), 'end');
  }
});

test('standalone probe refuses production before loading a database client', () => {
  const script = fileURLToPath(
    new URL('./migration-state.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      APP_ENV: 'production',
      DATABASE_URL: 'synthetic-private-marker',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    error: 'migration_probe_failed',
  });
  assert.equal(
    (result.stdout + result.stderr).includes('synthetic-private-marker'),
    false,
  );
});

test('standalone migration probe rejects URL query overrides before Client construction', async () => {
  for (const query of [
    'host=other.example.test',
    'user=other',
    'port=6543',
    'sslmode=require&sslmode=verify-full',
  ]) {
    let constructed = 0,
      connected = 0;
    class Client {
      constructor() {
        constructed++;
      }
      async connect() {
        connected++;
      }
      async query(sql) {
        if (sql.includes('server_version_num'))
          return { rows: [{ version: '170000' }] };
        if (sql.includes('to_regclass')) return { rows: [{ journal: null }] };
        return { rows: [] };
      }
      async end() {}
    }
    await assert.rejects(
      readMigrationState(
        Client,
        'postgres://postgres.aaaaaaaaaaaaaaaaaaaa:synthetic@db.example.test:5432/demo?sslmode=verify-full&' +
          query,
      ),
    );
    assert.equal(constructed, 0);
    assert.equal(connected, 0);
  }
});

test('standalone demo probe reports a bounded query error without connecting or exposing its URL', () => {
  const script = fileURLToPath(
    new URL('./migration-state.mjs', import.meta.url),
  );
  for (const [query, error] of [
    ['host=other.example.test', 'database_query_parameter_not_allowed'],
    ['sslmode=require', 'database_query_parameter_duplicate'],
  ]) {
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        APP_ENV: 'demo',
        DATABASE_URL:
          'postgres://synthetic:private-marker@db.example.test:5432/demo?sslmode=verify-full&' +
          query,
      },
      encoding: 'utf8',
      timeout: 2000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { error });
    assert.equal(
      (result.stdout + result.stderr).includes('private-marker'),
      false,
    );
  }
});
