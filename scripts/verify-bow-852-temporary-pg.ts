import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Fixed BOW-852 input and test scope; no arbitrary paths or migration sources.
const [targetHead, ...options] = process.argv.slice(2);
const prepareOnly = options.includes('--prepare-only');
if (
  !/^[a-f0-9]{40}$/.test(targetHead ?? '') ||
  options.some((option) => option !== '--prepare-only')
)
  throw new Error(
    'Expected an exact target commit and optional --prepare-only',
  );
const sourceHead = 'f9ca96fd5839a463566ce70f45286cefdd8ddaf3';
const pgFile = 'src/server/modules/staffing/demand/service.integration.test.ts';
const testFiles = [
  pgFile,
  'src/server/modules/staffing/demand/policy.test.ts',
  'src/server/modules/staffing/demand/prompt.test.ts',
  'src/server/modules/staffing/demand/version.test.ts',
  'src/server/usecases/staffing-demand-runtime.test.ts',
  'src/worker/index.test.ts',
  'src/server/queries/staffing-runtime.test.ts',
  'src/server/jobs/runtime.test.ts',
];
const expectedTotal = 56; // 42 unit + 14 real PostgreSQL cases, one coverage run.
const migrationsEnvironment = 'BOW_852_TEST_MIGRATIONS_DIR';
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
    throw new Error(`Target differs from the fixed demand input: ${path}`);
}
const temporary = mkdtempSync(
  join(
    prepareOnly ? tmpdir() : (process.env.RUNNER_TEMP ?? tmpdir()),
    'bow852-',
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
    throw new Error('Expected one temporary BOW-852 migration');
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
        '--coverage',
        '--coverage.include=src/server/modules/staffing/demand/*.ts',
        '--coverage.include=src/server/usecases/staffing-demand-runtime.ts',
        '--coverage.include=src/worker/index.ts',
        '--coverage.include=src/server/queries/staffing-runtime.ts',
        '--coverage.include=src/server/jobs/runtime.ts',
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
      testResults: { name: string; assertionResults: { status: string }[] }[];
    };
    const pgTests =
      report.testResults.find((file) => file.name === join(checkout, pgFile))
        ?.assertionResults ?? [];
    const coverageSummary = JSON.parse(
      readFileSync(join(checkout, 'coverage/coverage-summary.json'), 'utf8'),
    ) as Record<string, { lines: { pct: number }; branches: { pct: number } }>;
    const coverage = coverageSummary.total;
    const artifact = join(root, 'coverage/bow-852-temporary');
    mkdirSync(artifact, { recursive: true });
    cpSync(join(checkout, 'coverage'), artifact, { recursive: true });
    cpSync(reportPath, join(artifact, 'tests.json'));
    console.log(
      JSON.stringify({
        scope: 'bow852_combined_coverage',
        targetHead,
        lines: coverage.lines.pct,
        branches: coverage.branches.pct,
        threshold: 85,
        coverageScope: [
          'src/server/modules/staffing/demand/*.ts',
          'src/server/usecases/staffing-demand-runtime.ts',
          'src/worker/index.ts',
          'src/server/queries/staffing-runtime.ts',
          'src/server/jobs/runtime.ts',
        ],
        files: Object.entries(coverageSummary)
          .filter(([path]) => path !== 'total')
          .map(([path, totals]) => ({
            path: path.replace(checkout + '/', ''),
            lines: totals.lines.pct,
            branches: totals.branches.pct,
          })),
      }),
    );
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
        pg: {
          total: pgTests.length,
          passed: pgTests.filter((test) => test.status === 'passed').length,
        },
        unit: {
          total: report.numTotalTests - pgTests.length,
          passed:
            report.numPassedTests -
            pgTests.filter((test) => test.status === 'passed').length,
        },
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
      report.numTodoTests !== 0 ||
      !testFiles.every((path) =>
        report.testResults.some((file) => file.name === join(checkout, path)),
      ) ||
      pgTests.length !== 14 ||
      pgTests.some((test) => test.status !== 'passed') ||
      !Number.isFinite(coverage.lines.pct) ||
      !Number.isFinite(coverage.branches.pct) ||
      coverage.lines.pct < 85 ||
      coverage.branches.pct < 85
    )
      throw new Error(
        'The fixed BOW-852 unit/PG combination or coverage gate failed',
      );
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
