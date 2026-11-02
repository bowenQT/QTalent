import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../client';
import { getEnv } from '../../../env';
import { CanonicalComparisonError } from '../../../modules/evaluation-system';
import { SelectionLifecycleError } from '../../../modules/evaluation-system/selection-standard';
import {
  importStandardIterationDemo,
  StandardIterationImportError,
} from './import';
import { initializeStandardIterationDemo } from './init';
import { StandardIterationFactError } from './input';

/** Explicit operator command, never part of db:seed. `--apply` imports the
 * fixed facts onto an already initialized background; `--init --as <account>`
 * idempotently establishes that background (nodes, baseline, sixth-cohort
 * binding) as a current manager and then imports. It never creates accounts,
 * grants or the seventh cohort. */
export async function runStandardIterationImport(args = process.argv.slice(2)) {
  const init =
    args.length === 3 && args[0] === '--init' && args[1] === '--as'
      ? args[2]
      : null;
  if (!(args.length === 1 && args[0] === '--apply') && !init?.trim())
    throw new Error('Explicit --apply or --init --as <accountId> required');
  const env = getEnv();
  if (env.APP_ENV === 'production')
    throw new Error('Demo import is forbidden in production');
  const connection = createDatabase(env.DATABASE_URL);
  try {
    const result = init
      ? await initializeStandardIterationDemo(
          connection.db,
          process.cwd(),
          init,
        )
      : await importStandardIterationDemo(connection.db, process.cwd());
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
      error instanceof StandardIterationFactError ||
      error instanceof CanonicalComparisonError
        ? error.code
        : error instanceof SelectionLifecycleError
          ? `selection_${error.status}`
          : 'import_failed';
    const fields =
      error instanceof StandardIterationImportError ? error.fields : undefined;
    // A fixture error names only the constant fixture file, never a path.
    const file =
      error instanceof StandardIterationFactError ? error.file : undefined;
    console.error(
      JSON.stringify({
        status: 'failed',
        code,
        ...(fields && { fields }),
        ...(file && { file }),
      }),
    );
    process.exitCode = 1;
  }
}
