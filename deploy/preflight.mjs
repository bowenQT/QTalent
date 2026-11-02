import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function command(cwd, executable, args) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      COREPACK_ENABLE_NETWORK: '0',
      COREPACK_ENABLE_AUTO_PIN: '0',
    },
  });
  return { ok: result.status === 0, output: result.stdout?.trim() ?? '' };
}

/** Repository checks only: no fetch, environment-file reads, database or deployment. */
export function inspectCheckout(cwd, revision) {
  const checks = [];
  const report = {
    scope: 'repository_only',
    deploymentAuthorized: false,
    revision: /^[0-9a-f]{40}$/.test(revision ?? '') ? revision : null,
    localMain: null,
    checks,
  };
  const check = (name, passed) => checks.push({ name, passed });
  const finish = () => ({
    ...report,
    passed: checks.every((item) => item.passed),
  });

  check('full_revision', report.revision !== null);
  if (!report.revision) return finish();

  const git = (...args) =>
    command(cwd, 'git', ['--no-optional-locks', ...args]);
  const root = git('rev-parse', '--show-toplevel');
  check('git_checkout', root.ok);
  if (!root.ok) return finish();

  const head = git('rev-parse', 'HEAD');
  check('checkout_matches_revision', head.ok && head.output === revision);
  const main = git('rev-parse', '--verify', 'refs/remotes/origin/main');
  report.localMain =
    main.ok && /^[0-9a-f]{40}$/.test(main.output) ? main.output : null;
  check(
    'revision_in_local_main',
    report.localMain !== null &&
      git('merge-base', '--is-ancestor', revision, report.localMain).ok,
  );
  const status = git('status', '--porcelain');
  check('clean_checkout', status.ok && status.output === '');

  const manifest = git('show', revision + ':package.json');
  let parsed;
  try {
    parsed = JSON.parse(manifest.output);
  } catch {
    parsed = null;
  }
  check('package_manifest', manifest.ok && parsed !== null);
  if (!parsed) return finish();

  check('node_24', process.versions.node.split('.')[0] === '24');
  check('node_engine', parsed.engines?.node === '>=24.0.0 <25');
  const manager = parsed.packageManager;
  const pinned =
    typeof manager === 'string' && /^pnpm@\d+\.\d+\.\d+$/.test(manager);
  check('pinned_pnpm', pinned);
  if (pinned) {
    const actual = command(cwd, 'pnpm', ['--version']);
    check('pnpm_matches_pin', actual.ok && actual.output === manager.slice(5));
  }
  check(
    'tracked_lockfile',
    git('cat-file', '-e', revision + ':pnpm-lock.yaml').ok,
  );
  return finish();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = inspectCheckout(process.cwd(), process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
