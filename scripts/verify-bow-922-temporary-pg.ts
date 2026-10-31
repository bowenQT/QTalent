import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Only two fixed card inputs; no arbitrary test paths or migration sources.
const [targetHead, ...options] = process.argv.slice(2);
const selection = options.includes('--bow-918');
const prepareOnly = options.includes('--prepare-only');
if (
  !/^[a-f0-9]{40}$/.test(targetHead ?? '') ||
  options.some((option) => !['--bow-918', '--prepare-only'].includes(option))
)
  throw new Error('Expected an exact target commit and fixed card options');
const sourceHead = selection
  ? '94515c88c9f5981aef5d4ef2bb7d082b3bf0cd38'
  : '806c1af1942a081c746dca25db6e0d736d652deb';
const testFiles = selection
  ? [
      'src/server/modules/evaluation-system/selection/postgres.integration.test.ts',
    ]
  : [
      'src/server/modules/evaluation-system/applicability.integration.test.ts',
      'src/server/modules/evaluation-system/rule-versions.integration.test.ts',
      'src/server/db/seed/demo-import.integration.test.ts',
    ];
const expectedTotal = selection ? 14 : 55;
const migrationsEnvironment = selection
  ? 'BOW_918_TEST_MIGRATIONS_DIR'
  : 'BOW_922_TEST_MIGRATIONS_DIR';
if (!prepareOnly) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true')
    throw new Error(
      'PG execution is restricted to the existing GitHub Actions job',
    );
  let database: URL;
  try {
    database = new URL(process.env.TEST_DATABASE_URL ?? '');
  } catch {
    throw new Error('The existing CI job must supply TEST_DATABASE_URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
    !database.pathname.endsWith('_test')
  )
    throw new Error('The existing loopback _test CI database is required');
}
const root = process.cwd();
const git = (args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git(['merge-base', '--is-ancestor', sourceHead, targetHead]);
for (const path of [
  'src',
  'tests/fixtures',
  'package.json',
  'pnpm-lock.yaml',
  'drizzle.config.ts',
  'vitest.config.ts',
  'vitest.integration.config.ts',
  'prototype-reference.json',
]) {
  if (
    git(['rev-parse', `${sourceHead}:${path}`]) !==
    git(['rev-parse', `${targetHead}:${path}`])
  )
    throw new Error(
      `Target differs from the fixed rule-iteration input: ${path}`,
    );
}
const temporary = mkdtempSync(
  join(
    prepareOnly ? tmpdir() : (process.env.RUNNER_TEMP ?? tmpdir()),
    selection ? 'bow918-' : 'bow922-',
  ),
);
const checkout = join(temporary, 'checkout');
const migrations = join(temporary, 'migrations');
let added = false;
const run = (args: string[]) =>
  execFileSync('pnpm', args, { cwd: checkout, stdio: 'inherit' });
try {
  git(['worktree', 'add', '--detach', checkout, targetHead]);
  added = true;
  run(['install', '--frozen-lockfile', '--ignore-scripts']);
  run(['reference:prepare']);
  cpSync(join(checkout, 'src/server/db/migrations'), migrations, {
    recursive: true,
  });
  const originalSql = readdirSync(migrations).filter((name) =>
    name.endsWith('.sql'),
  );
  const config = join(temporary, 'drizzle.config.ts');
  writeFileSync(
    config,
    `export default ${JSON.stringify({
      dialect: 'postgresql',
      schema: join(checkout, 'src/server/**/schema.ts'),
      out: '../migrations',
      strict: true,
      verbose: false,
    })};\n`,
  );
  run(['exec', 'drizzle-kit', 'generate', '--config', config]);
  const generatedSql = readdirSync(migrations).filter(
    (name) => name.endsWith('.sql') && !originalSql.includes(name),
  );
  if (generatedSql.length !== 1)
    throw new Error('Expected one temporary rule-iteration migration');
  console.log(
    JSON.stringify({
      scope: 'temporary_pg_combination',
      sourceHead,
      targetHead,
      mode: prepareOnly ? 'prepare_only_no_pg' : 'real_pg',
      temporarySqlSha256: createHash('sha256')
        .update(readFileSync(join(migrations, generatedSql[0])))
        .digest('hex'),
      finalMigration: false,
    }),
  );
  if (!prepareOnly) {
    const reportPath = join(temporary, 'pg-results.json');
    const result = spawnSync(
      'pnpm',
      [
        'test:integration',
        ...testFiles,
        '--maxWorkers=2',
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ],
      {
        cwd: checkout,
        stdio: 'inherit',
        env: { ...process.env, [migrationsEnvironment]: migrations },
      },
    );
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      numTotalTests: number;
      numPassedTests: number;
      numFailedTests: number;
      numPendingTests: number;
      numTodoTests: number;
      testResults: { name: string }[];
    };
    console.log(
      JSON.stringify({
        scope: 'temporary_pg_combination',
        targetHead,
        files: report.testResults.length,
        total: report.numTotalTests,
        passed: report.numPassedTests,
        failed: report.numFailedTests,
        pending: report.numPendingTests,
        todo: report.numTodoTests,
      }),
    );
    if (
      result.error ||
      result.status !== 0 ||
      report.testResults.length !== testFiles.length ||
      report.numTotalTests !== expectedTotal ||
      report.numPassedTests !== expectedTotal ||
      report.numFailedTests !== 0 ||
      report.numPendingTests !== 0 ||
      report.numTodoTests !== 0
    )
      throw new Error('The fixed card real PG combination failed');
  }
  if (
    execFileSync(
      'git',
      ['status', '--porcelain', '--', 'src/server/db/migrations'],
      {
        cwd: checkout,
        encoding: 'utf8',
      },
    ).trim()
  )
    throw new Error('Committed migration directory must remain untouched');
} finally {
  try {
    if (added) git(['worktree', 'remove', '--force', checkout]);
  } finally {
    rmSync(resolve(temporary), { recursive: true, force: true });
  }
}
