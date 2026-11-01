import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvironmentFiles } from './environment-file.mjs';

export function applicationEnvironment(input, expected) {
  if (
    input.APP_ENV !== 'demo' ||
    input.NODE_ENV !== 'production' ||
    input.ACCESS_ENFORCED !== 'true' ||
    input.BETTER_AUTH_URL !== expected.origin ||
    String(input.WORKER_PORT ?? '3001') !== '3001'
  )
    throw new Error('environment_mismatch');
  let url;
  try {
    url = new URL(input.DATABASE_URL);
  } catch {
    throw new Error('database_mismatch');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== expected.database.host ||
    !/^[a-z0-9]{20}$/.test(expected.database.projectRef ?? '') ||
    decodeURIComponent(url.username) !== expected.database.username ||
    !expected.database.username.endsWith('.' + expected.database.projectRef) ||
    Number(url.port || '5432') !== expected.database.port ||
    decodeURIComponent(url.pathname.slice(1)) !== expected.database.name ||
    !['require', 'verify-ca', 'verify-full'].includes(
      url.searchParams.get('sslmode'),
    )
  )
    throw new Error('database_mismatch');
  return { ...input };
}

export function dumpEnvironment(input, expected) {
  const env = applicationEnvironment(input, expected);
  const url = new URL(env.DATABASE_URL);
  return {
    ...env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode'),
    ...(url.searchParams.get('sslrootcert')
      ? { PGSSLROOTCERT: url.searchParams.get('sslrootcert') }
      : {}),
  };
}

export function runApplication(args, input = process.env, execute = spawnSync) {
  try {
    const [expectedJson, operation, executable, ...commandArgs] = args;
    const expected = JSON.parse(expectedJson);
    const loaded = expected.envFiles
      ? loadEnvironmentFiles(expected.envFiles, input)
      : input;
    const env =
      operation === 'dump'
        ? dumpEnvironment(loaded, expected)
        : applicationEnvironment(loaded, expected);
    if (!['command', 'dump', 'validate'].includes(operation))
      throw new Error('invalid_operation');
    if (operation === 'validate') return 0;
    if (!executable?.startsWith('/')) throw new Error('invalid_executable');
    const result = execute(executable, commandArgs, {
      env,
      stdio: 'inherit',
    });
    return result.status === 0 ? 0 : 1;
  } catch {
    // No raw exception, environment value, URL or provider output is returned.
    return 1;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  process.exitCode = runApplication(process.argv.slice(2));
}
