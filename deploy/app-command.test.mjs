import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicationEnvironment,
  dumpEnvironment,
  runApplication,
} from './app-command.mjs';
const expected = {
  origin: 'https://demo.example.test',
  database: { host: 'db.example.test', port: 5432, name: 'demo' },
};
const environment = {
  APP_ENV: 'demo',
  NODE_ENV: 'production',
  ACCESS_ENFORCED: 'true',
  BETTER_AUTH_URL: expected.origin,
  WORKER_PORT: '3001',
  DATABASE_URL:
    'postgres://demo:synthetic%40password@db.example.test:5432/demo?sslmode=verify-full',
};
test('checks actual demo, origin and database identity before executing', () => {
  assert.equal(applicationEnvironment(environment, expected).APP_ENV, 'demo');
  for (const change of [
    { APP_ENV: 'production' },
    { NODE_ENV: 'test' },
    { ACCESS_ENFORCED: 'false' },
    { BETTER_AUTH_URL: 'https://other.example.test' },
    { WORKER_PORT: '4001' },
    {
      DATABASE_URL:
        'postgres://demo:test@other.example.test:5432/demo?sslmode=require',
    },
    {
      DATABASE_URL:
        'postgres://demo:test@db.example.test:6543/demo?sslmode=require',
    },
    {
      DATABASE_URL:
        'postgres://demo:test@db.example.test:5432/other?sslmode=require',
    },
    { DATABASE_URL: 'postgres://demo:test@db.example.test:5432/demo' },
    { DATABASE_URL: 'not-a-url' },
  ])
    assert.throws(() =>
      applicationEnvironment({ ...environment, ...change }, expected),
    );
});
test('maps credentials only into libpq environment, never command arguments', () => {
  const env = dumpEnvironment(environment, expected);
  assert.equal(env.PGPASSWORD, 'synthetic@password');
  assert.equal(env.PGUSER, 'demo');
  assert.equal(env.PGDATABASE, 'demo');
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(
    dumpEnvironment(
      {
        ...environment,
        DATABASE_URL:
          environment.DATABASE_URL + '&sslrootcert=%2Ftrusted%2Fca.pem',
      },
      expected,
    ).PGSSLROOTCERT,
    '/trusted/ca.pem',
  );
});
test('validation never invokes a command, and environment mismatch blocks it', () => {
  let calls = 0;
  const execute = () => {
    calls++;
    return { status: 0 };
  };
  assert.equal(
    runApplication(
      [JSON.stringify(expected), 'validate', '/bin/unused'],
      environment,
      execute,
    ),
    0,
  );
  assert.equal(calls, 0);
  assert.equal(
    runApplication(
      [JSON.stringify(expected), 'command', '/bin/unused'],
      {
        ...environment,
        APP_ENV: 'production',
      },
      execute,
    ),
    1,
  );
  assert.equal(calls, 0);
});
test('explicit command/dump operation preserves exit status and rejects malformed commands', () => {
  let received;
  const execute = (file, args, options) => {
    received = { file, args, options };
    return { status: 0 };
  };
  assert.equal(
    runApplication(
      [
        JSON.stringify(expected),
        'dump',
        '/bin/pg_dump',
        '--file',
        '/tmp/demo.dump',
      ],
      environment,
      execute,
    ),
    0,
  );
  assert.deepEqual(received.args, ['--file', '/tmp/demo.dump']);
  assert.equal(received.options.env.PGPASSWORD, 'synthetic@password');
  assert.equal(JSON.stringify(received.args).includes('password'), false);
  assert.equal(
    runApplication(
      [JSON.stringify(expected), 'command', '/bin/false'],
      environment,
      () => ({ status: 4 }),
    ),
    1,
  );
  assert.equal(
    runApplication(
      [JSON.stringify(expected), 'command', 'relative-path'],
      environment,
      execute,
    ),
    1,
  );
  assert.equal(
    runApplication(
      [JSON.stringify(expected), 'unknown', '/bin/test'],
      environment,
      execute,
    ),
    1,
  );
  assert.equal(
    runApplication(
      ['invalid-json', 'command', '/bin/test'],
      environment,
      execute,
    ),
    1,
  );
});

test('standalone command boundary validates before invoking a child', () => {
  const script = fileURLToPath(new URL('./app-command.mjs', import.meta.url));
  const result = spawnSync(
    process.execPath,
    [script, JSON.stringify(expected), 'validate', '/bin/unused'],
    {
      env: { ...process.env, ...environment },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
