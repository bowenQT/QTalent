import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadEnvironmentFiles } from './environment-file.mjs';
import {
  parseDatabaseConnection,
  databaseIdentity,
  databaseEnvironment,
  DatabaseConnectionError,
  databaseErrorExit,
} from './database-connection.mjs';

function applicationConfiguration(input, expected) {
  if (
    input.APP_ENV !== 'demo' ||
    input.NODE_ENV !== 'production' ||
    input.ACCESS_ENFORCED !== 'true' ||
    input.BETTER_AUTH_URL !== expected.origin ||
    String(input.WORKER_PORT ?? '3001') !== '3001'
  )
    throw new Error('environment_mismatch');
  const config = parseDatabaseConnection(input.DATABASE_URL);
  if (
    config.host !== expected.database.host ||
    !/^[a-z0-9]{20}$/.test(expected.database.projectRef ?? '') ||
    config.user !== expected.database.username ||
    !expected.database.username.endsWith('.' + expected.database.projectRef) ||
    config.port !== expected.database.port ||
    config.database !== expected.database.name
  )
    throw new Error('database_mismatch');
  const identity = databaseIdentity(config);
  if (
    expected.databaseIdentity &&
    Object.entries(identity).some(
      ([key, value]) => expected.databaseIdentity[key] !== value,
    )
  )
    throw new Error('database_mismatch');
  return { env: { ...input, ...databaseEnvironment(config) }, config };
}
export function applicationEnvironment(input, expected) {
  return applicationConfiguration(input, expected).env;
}
export function dumpEnvironment(input, expected) {
  return applicationEnvironment(input, expected);
}

export function runApplication(args, input = process.env, execute = spawnSync) {
  try {
    const [expectedJson, operation, executable, ...commandArgs] = args;
    const expected = JSON.parse(expectedJson);
    const loaded = expected.envFiles
      ? loadEnvironmentFiles(expected.envFiles, input)
      : input;
    const { env, config } = applicationConfiguration(loaded, expected);
    if (!['command', 'dump', 'validate', 'identity'].includes(operation))
      throw new Error('invalid_operation');
    if (operation === 'validate') return 0;
    if (operation === 'identity') {
      console.log(JSON.stringify(databaseIdentity(config)));
      return 0;
    }
    if (!executable?.startsWith('/')) throw new Error('invalid_executable');
    const result = execute(executable, commandArgs, {
      env,
      stdio: 'inherit',
    });
    return result.status === 0 ? 0 : 1;
  } catch (error) {
    // Only fixed codes cross the boundary; no raw exception or URL is returned.
    if (error instanceof DatabaseConnectionError) {
      console.error(JSON.stringify({ error: error.code }));
      return databaseErrorExit(error);
    }
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
