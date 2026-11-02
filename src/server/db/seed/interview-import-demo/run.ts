import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../client';
import { getEnv } from '../../../env';
import {
  importInterviewImportDemo,
  InterviewImportDemoError,
} from './import';

/** Explicit operator command, never part of db:seed: writes the demo interview import
 * batch HR confirms on /import. Replaying it returns `unchanged`. */
export async function runInterviewImportDemo(args = process.argv.slice(2)) {
  if (!(args.length === 1 && args[0] === '--apply'))
    throw new Error('Explicit --apply required');
  const env = getEnv();
  if (env.APP_ENV === 'production')
    throw new Error('Demo import is forbidden in production');
  const connection = createDatabase(env.DATABASE_URL);
  try {
    const result = await importInterviewImportDemo(
      connection.db,
      process.cwd(),
    );
    console.log(JSON.stringify(result));
  } finally {
    await connection.pool.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runInterviewImportDemo();
  } catch (error) {
    // Raw SQL/connection/parser errors can carry infrastructure or input values.
    console.error(
      JSON.stringify({
        status: 'failed',
        code:
          error instanceof InterviewImportDemoError
            ? error.code
            : 'import_failed',
      }),
    );
    process.exitCode = 1;
  }
}
