import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  parseDatabaseConnection,
  databaseIdentity,
  databaseEnvironment,
  databaseErrorExit,
} from './database-connection.mjs';
import { applicationEnvironment, runApplication } from './app-command.mjs';
const pgRequire = createRequire(createRequire(import.meta.url).resolve('pg'));
const pgParse = pgRequire('pg-connection-string').parse;
const roots = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const authority =
  'postgres://postgres.aaaaaaaaaaaaaaaaaaaa:synthetic%24%40%25password@db.example.test:5432/demo';
const expected = {
  origin: 'https://demo.example.test',
  database: {
    host: 'db.example.test',
    port: 5432,
    name: 'demo',
    projectRef: 'aaaaaaaaaaaaaaaaaaaa',
    username: 'postgres.aaaaaaaaaaaaaaaaaaaa',
  },
};
for (const sslmode of ['require', 'verify-ca', 'verify-full']) {
  test(
    'allowed ' +
      sslmode +
      ' gives identical validated, dump, driver and migration command identities',
    () => {
      const base = mkdtempSync(join(tmpdir(), 'qtalent-db-query-'));
      roots.push(base);
      const ca = join(base, 'public-ca.pem');
      writeFileSync(ca, 'synthetic public CA, not a credential');
      const raw =
        authority +
        '?sslrootcert=' +
        encodeURIComponent(ca) +
        '&sslmode=' +
        sslmode;
      const config = parseDatabaseConnection(raw);
      const source = {
        APP_ENV: 'demo',
        NODE_ENV: 'production',
        ACCESS_ENFORCED: 'true',
        BETTER_AUTH_URL: expected.origin,
        DATABASE_URL: raw,
        PGHOST: 'wrong.example.test',
        PGUSER: 'wrong',
        PGPORT: '9999',
        PGDATABASE: 'wrong',
        PGPASSWORD: 'wrong',
        PGSSLMODE: 'disable',
        PGSSLROOTCERT: 'wrong',
      };
      const env = applicationEnvironment(source, expected);
      const actual = pgParse(env.DATABASE_URL);
      assert(Object.isFrozen(config));
      assert.deepEqual(databaseIdentity(config), {
        host: actual.host,
        port: Number(actual.port),
        name: actual.database,
        username: actual.user,
        sslmode: actual.sslmode,
        sslrootcert: actual.sslrootcert,
      });
      assert.equal(actual.password, config.password);
      assert.equal(env.PGHOST, actual.host);
      assert.equal(env.PGUSER, actual.user);
      assert.equal(env.PGPORT, actual.port);
      assert.equal(env.PGDATABASE, actual.database);
      assert.equal(env.PGPASSWORD, actual.password);
      assert.equal(env.PGSSLMODE, actual.sslmode);
      assert.equal(env.PGSSLROOTCERT, actual.sslrootcert);
      const passed = [];
      for (const operation of ['command', 'dump'])
        assert.equal(
          runApplication(
            [JSON.stringify(expected), operation, '/bin/unused', 'db:migrate'],
            source,
            (_file, _args, opts) => {
              passed.push(opts.env);
              return { status: 0 };
            },
          ),
          0,
        );
      assert.deepEqual(passed[0], passed[1]);
      assert.deepEqual(passed[0], env);
    },
  );
}
test('absent root CA clears inherited settings and explicit default port prevents PGPORT fallback', () => {
  const config = parseDatabaseConnection(
    authority.replace(':5432/', '/') + '?sslmode=verify-full',
  );
  const env = databaseEnvironment(config),
    actual = pgParse(env.DATABASE_URL);
  assert.equal(env.PGSSLROOTCERT, '');
  assert.equal(actual.port, '5432');
  assert.equal(databaseIdentity(config).sslrootcert, null);
});
test('malformed authority, credentials and TLS modes fail with no input in error', () => {
  for (const raw of [
    'not-a-url',
    authority + '?sslmode=disable',
    authority + '?sslmode=',
    authority,
    authority.replace('postgres://', 'http://') + '?sslmode=verify-full',
    authority.replace('synthetic%24%40%25password', 'bad%xx') +
      '?sslmode=verify-full',
    authority.replace('/demo', '/') + '?sslmode=verify-full',
    authority.replace('postgres.aaaaaaaaaaaaaaaaaaaa', '') +
      '?sslmode=verify-full',
  ])
    assert.throws(
      () => parseDatabaseConnection(raw),
      (e) =>
        e.message === 'database_mismatch' &&
        !JSON.stringify(e).includes('synthetic'),
    );
  assert.equal(databaseErrorExit(new Error('synthetic')), 1);
});

test('commands refuse a different allowed TLS identity after validation, before executing', () => {
  const original = authority + '?sslmode=verify-full';
  const checked = {
    ...expected,
    databaseIdentity: databaseIdentity(parseDatabaseConnection(original)),
  };
  let calls = 0;
  const source = {
    APP_ENV: 'demo',
    NODE_ENV: 'production',
    ACCESS_ENFORCED: 'true',
    BETTER_AUTH_URL: expected.origin,
    DATABASE_URL: authority + '?sslmode=verify-ca',
  };
  assert.notEqual(
    runApplication(
      [JSON.stringify(checked), 'command', '/bin/unused'],
      source,
      () => {
        calls++;
        return { status: 0 };
      },
    ),
    0,
  );
  assert.equal(calls, 0);
});
