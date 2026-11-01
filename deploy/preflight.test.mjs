import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectCheckout } from './preflight.mjs';

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'qtalent-deploy-preflight-'));
  directories.push(cwd);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture User');
  git('config', 'user.email', 'fixture@qtalent.test');
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({
      packageManager: 'pnpm@11.25.0',
      engines: { node: '>=24.0.0 <25' },
    }),
  );
  writeFileSync(join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-q',
      '-m',
      'Fixture revision',
    );
    return git('rev-parse', 'HEAD');
  };
  const revision = commit();
  git('update-ref', 'refs/remotes/origin/main', revision);
  return { cwd, git, commit, revision };
}

function gate(report, name) {
  return report.checks.find((item) => item.name === name)?.passed;
}

test('accepts an exact clean main revision without authorizing deployment', () => {
  const f = fixture();
  const report = inspectCheckout(f.cwd, f.revision);
  assert.equal(report.passed, true);
  assert.equal(report.scope, 'repository_only');
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(report.localMain, f.revision);
});

test('rejects abbreviated revisions before checking a checkout', () => {
  const report = inspectCheckout('/a/path/that/does/not/exist', 'main');
  assert.equal(report.passed, false);
  assert.deepEqual(report.checks, [{ name: 'full_revision', passed: false }]);
});

test('rejects a revision from an unmerged task branch', () => {
  const f = fixture();
  f.git('switch', '-q', '-c', 'task');
  writeFileSync(join(f.cwd, 'new.txt'), 'Synthetic task change');
  const revision = f.commit();
  const report = inspectCheckout(f.cwd, revision);
  assert.equal(gate(report, 'checkout_matches_revision'), true);
  assert.equal(gate(report, 'revision_in_local_main'), false);
  assert.equal(report.passed, false);
});

test('rejects a checkout that differs from the requested main revision', () => {
  const f = fixture();
  writeFileSync(join(f.cwd, 'new.txt'), 'Synthetic merged change');
  f.git('update-ref', 'refs/remotes/origin/main', f.commit());
  const report = inspectCheckout(f.cwd, f.revision);
  assert.equal(gate(report, 'revision_in_local_main'), true);
  assert.equal(gate(report, 'checkout_matches_revision'), false);
});

test('rejects untracked changes without exposing paths or contents', () => {
  const f = fixture();
  const marker = 'synthetic-private-marker';
  writeFileSync(join(f.cwd, marker), marker);
  const report = inspectCheckout(f.cwd, f.revision);
  assert.equal(gate(report, 'clean_checkout'), false);
  assert.equal(JSON.stringify(report).includes(marker), false);
});

test('requires a locally known origin/main reference', () => {
  const f = fixture();
  f.git('update-ref', '-d', 'refs/remotes/origin/main');
  const report = inspectCheckout(f.cwd, f.revision);
  assert.equal(report.localMain, null);
  assert.equal(gate(report, 'revision_in_local_main'), false);
});

test('rejects a target without a tracked dependency lockfile', () => {
  const f = fixture();
  rmSync(join(f.cwd, 'pnpm-lock.yaml'));
  const revision = f.commit();
  f.git('update-ref', 'refs/remotes/origin/main', revision);
  const report = inspectCheckout(f.cwd, revision);
  assert.equal(gate(report, 'tracked_lockfile'), false);
});

test('rejects an unpinned package manager', () => {
  const f = fixture();
  writeFileSync(
    join(f.cwd, 'package.json'),
    JSON.stringify({
      packageManager: 'pnpm@latest',
      engines: { node: '>=24.0.0 <25' },
    }),
  );
  const revision = f.commit();
  f.git('update-ref', 'refs/remotes/origin/main', revision);
  const report = inspectCheckout(f.cwd, revision);
  assert.equal(gate(report, 'pinned_pnpm'), false);
});

test('fails cleanly outside a Git checkout', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'qtalent-deploy-no-repository-'));
  directories.push(cwd);
  const report = inspectCheckout(cwd, '0'.repeat(40));
  assert.equal(gate(report, 'git_checkout'), false);
  assert.equal(report.passed, false);
});

test('rejects malformed target package metadata without exposing its content', () => {
  const f = fixture();
  const marker = 'synthetic-invalid-manifest';
  writeFileSync(join(f.cwd, 'package.json'), marker);
  const revision = f.commit();
  f.git('update-ref', 'refs/remotes/origin/main', revision);
  const report = inspectCheckout(f.cwd, revision);
  assert.equal(gate(report, 'package_manifest'), false);
  assert.equal(JSON.stringify(report).includes(marker), false);
});

test('CLI returns repository-only JSON and leaves the checkout unchanged', () => {
  const f = fixture();
  const script = new URL('./preflight.mjs', import.meta.url);
  const stdout = execFileSync(
    process.execPath,
    [fileURLToPath(script), f.revision],
    {
      cwd: f.cwd,
      encoding: 'utf8',
    },
  );
  const report = JSON.parse(stdout);
  assert.equal(report.passed, true);
  assert.equal(report.deploymentAuthorized, false);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('CLI rejects a missing revision with a nonzero exit and no stack trace', () => {
  const f = fixture();
  const script = new URL('./preflight.mjs', import.meta.url);
  let failure;
  try {
    execFileSync(process.execPath, [fileURLToPath(script)], {
      cwd: f.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr, '');
  assert.equal(JSON.parse(failure.stdout).passed, false);
});
