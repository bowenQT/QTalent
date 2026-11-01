import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../client';
import { getEnv } from '../../../env';
import { CanonicalComparisonError } from '../../../modules/evaluation-system';
import {
  importStandardIterationDemo,
  StandardIterationImportError,
} from './import';

/** Explicit operator command. It never creates accounts, grants, nodes or a
 * selection baseline. Not included in db:seed and never invoked at import time.
 */
export async function runStandardIterationImport(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--apply')
    throw new Error('Explicit --apply required');
  const env = getEnv();
  if (env.APP_ENV === 'production')
    throw new Error('Demo import is forbidden in production');
  const connection = createDatabase(env.DATABASE_URL);
  try {
    const result = await importStandardIterationDemo(
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
    await runStandardIterationImport();
  } catch (error) {
    // Raw SQL/connection/parser errors can contain private infrastructure or
    // input values. Keep those out of public job logs; never print cause/stack.
    const code =
      error instanceof StandardIterationImportError ||
      error instanceof CanonicalComparisonError
        ? error.code
        : 'import_failed';
    console.error(JSON.stringify({ status: 'failed', code }));
    process.exitCode = 1;
  }
}
