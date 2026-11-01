import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { createHash } from 'node:crypto';
import {
  ReleaseManager,
  DeploymentError,
  nativeRun,
  validateTarget,
  main,
} from './release.mjs';
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'qtalent-deployment-')));
  roots.push(base);
  const root = join(base, 'qtalent'),
    repo = join(root, 'repository'),
    remote = join(base, 'remote.git');
  for (const path of [
    root,
    repo,
    join(base, 'env'),
    join(base, 'backups'),
    join(base, 'bin'),
  ])
    mkdirSync(path, { recursive: true });
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  execFileSync('git', ['init', '--bare', '-q', remote]);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture User');
  git('config', 'user.email', 'fixture@qtalent.test');
  git('remote', 'add', 'origin', remote);
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({
      name: 'qtalent',
      packageManager: 'pnpm@11.25.0',
      engines: { node: '>=24.0.0 <25' },
    }),
  );
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  mkdirSync(join(repo, 'src/server/db/migrations/meta'), { recursive: true });
  writeFileSync(
    join(repo, 'src/server/db/migrations/meta/_journal.json'),
    JSON.stringify({ entries: [{ tag: '0000_synthetic', when: 1 }] }),
  );
  writeFileSync(
    join(repo, 'src/server/db/migrations/0000_synthetic.sql'),
    '-- synthetic migration\nselect 1;\n',
  );
  const commit = (label) => {
    writeFileSync(join(repo, 'version.txt'), label);
    git('add', '.');
    git(
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      label,
    );
    git('push', '-q', 'origin', 'main');
    return git('rev-parse', 'HEAD');
  };
  const bow897 = commit('contract'),
    bow899 = commit('node-model'),
    first = commit('one');
  for (const role of ['common', 'web', 'worker'])
    writeFileSync(join(base, 'env', role + '.env'), '# Synthetic fixture\n');
  for (const name of ['node', 'pnpm', 'pg_dump'])
    writeFileSync(join(base, 'bin', name), 'fixture executable');
  const target = {
    version: 1,
    id: 'synthetic-demo',
    confirmed: true,
    confirmationRef:
      'https://github.com/bowenQT/QTalent/issues/25#issuecomment-123',
    environment: 'demo',
    hostname: hostname(),
    root,
    repository: repo,
    envDirectory: join(base, 'env'),
    backupDirectory: join(base, 'backups'),
    webOrigin: 'https://demo.example.test',
    nodePath: join(base, 'bin', 'node'),
    pnpmPath: join(base, 'bin', 'pnpm'),
    pgDumpPath: join(base, 'bin', 'pg_dump'),
    database: {
      web: { host: 'pool.example.test', port: 6543, name: 'demo' },
      worker: { host: 'db.example.test', port: 5432, name: 'demo' },
    },
    prerequisites: { bow897, bow899 },
  };
  const state = {
    events: [],
    runtime: [
      { pid: 0, sha: null },
      { pid: 0, sha: null },
    ],
    healthFailures: new Set(),
    restartFailures: 0,
    buildFailure: null,
    emptyBackup: false,
    databaseFailure: false,
    migrations: [
      {
        hash: '31b8e01c9fff66ad19b657b18f54ddc327d511c2d01302000c271c70d57db8ff',
        createdAt: '1',
      },
    ],
  };
  const run = async (file, args, options = {}) => {
    state.events.push({ file, args: [...args], cwd: options.cwd });
    if (file === target.nodePath) return 'v24.21.0';
    if (file === target.pnpmPath) return '11.25.0';
    if (file === 'chown') return '';
    if (file === 'systemctl') {
      const action = args[0];
      if (action === 'restart') {
        const path = realpathSync(join(root, 'current'));
        state.runtime = [
          { pid: 1001, sha: basename(path), path },
          { pid: 1002, sha: basename(path), path },
        ];
        if (state.restartFailures-- > 0)
          throw new Error('synthetic-private-error');
      } else if (action === 'stop')
        state.runtime = [
          { pid: 0, sha: null },
          { pid: 0, sha: null },
        ];
      else if (
        action === 'is-active' &&
        state.runtime.some((actual) => !actual.pid)
      )
        throw new Error('service inactive');
      return '';
    }
    if (file === 'runuser') {
      const command = args.slice(args.indexOf('--') + 1);
      if (command[0] === 'git' || command[0] === 'tar')
        return nativeRun(command[0], command.slice(1), options);
      assert.equal(command[0], '/bin/bash');
      const entry = command.indexOf('qtalent-env');
      const roleCommand = command.slice(entry + 3);
      const operation = roleCommand[3],
        executable = roleCommand[4],
        flags = roleCommand.slice(5);
      if (operation === 'validate') return '';
      if (
        executable === target.nodePath &&
        flags[0]?.endsWith('migration-state.mjs')
      )
        return JSON.stringify({
          journalExists: true,
          serverVersion: '170000',
          migrations: state.migrations,
        });
      if (operation === 'dump') {
        const output = flags[flags.indexOf('--file') + 1];
        writeFileSync(
          output,
          state.emptyBackup ? '' : 'PGDMP synthetic snapshot',
        );
      } else if (executable === target.pnpmPath && flags[0] === 'build') {
        const version = readFileSync(join(options.cwd, 'version.txt'), 'utf8');
        if (state.buildFailure === version)
          throw new Error('synthetic-private-error');
        mkdirSync(join(options.cwd, '.next'));
        writeFileSync(
          join(options.cwd, '.next', 'BUILD_ID'),
          'compiled-' + version,
        );
      } else if (flags[0]?.startsWith('db:') && state.databaseFailure)
        throw new Error('synthetic-private-database-error');
      return '';
    }
    throw new Error('Unexpected command boundary: ' + file);
  };
  let tick = 0;
  const manager = (overrides = {}) =>
    new ReleaseManager(target, target.id, {
      run,
      observe: async (service) => ({
        ...state.runtime[service.startsWith('qtalent-web') ? 0 : 1],
      }),
      health: async () => {
        if (state.healthFailures.has(state.runtime[0].sha))
          throw new DeploymentError('web_health_failed');
      },
      now: () => new Date(Date.UTC(2026, 9, 31) + tick++ * 1000),
      readinessAttempts: 2,
      readinessDelayMs: 0,
      ...overrides,
    });
  const records = () =>
    existsSync(join(root, 'deployment-records'))
      ? readdirSync(join(root, 'deployment-records')).map((name) =>
          JSON.parse(
            readFileSync(join(root, 'deployment-records', name), 'utf8'),
          ),
        )
      : [];
  const latest = () =>
    records()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .at(-1);
  return {
    base,
    root,
    repo,
    target,
    state,
    git,
    commit,
    first,
    manager,
    records,
    latest,
  };
}
test('rejects unconfirmed/production/mismatched target before invoking commands', () => {
  const f = fixture();
  for (const changes of [
    { confirmed: false },
    { environment: 'production' },
    { hostname: 'different-host' },
  ])
    assert.throws(
      () => new ReleaseManager({ ...f.target, ...changes }, f.target.id),
    );
  assert.throws(() =>
    validateTarget({ ...f.target, unexpected: 'value' }, f.target.id),
  );
  assert.equal(f.state.events.length, 0);
});
test('requires actual target prerequisites and excludes unmerged revisions', async () => {
  const f = fixture();
  f.target.prerequisites.bow899 = '0'.repeat(40);
  await assert.rejects(f.manager().deploy(f.first, null, true));
  assert.equal(existsSync(join(f.root, 'current')), false);
  assert.equal(
    f.state.events.some((e) => e.file === 'systemctl'),
    false,
  );
  f.target.prerequisites.bow899 = f.target.prerequisites.bow897;
  f.git('switch', '-qc', 'unmerged');
  writeFileSync(join(f.repo, 'new.txt'), 'unmerged');
  f.git('add', '.');
  f.git(
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'unmerged',
  );
  await assert.rejects(
    f.manager().deploy(f.git('rev-parse', 'HEAD'), null, true),
  );
});
test('deploys an actual archived Git revision and records both observed runtime versions', async () => {
  const f = fixture(),
    manager = f.manager();
  const result = await manager.deploy(f.first, null, true);
  assert.equal(result.sha, f.first);
  assert.equal(manager.active(), f.first);
  assert.equal(
    readFileSync(
      join(f.root, 'releases', f.first, '.next', 'BUILD_ID'),
      'utf8',
    ),
    'compiled-one',
  );
  const record = f.latest();
  assert.equal(record.status, 'succeeded');
  assert.equal(record.runtime.web.sha, f.first);
  assert.equal(record.runtime.worker.sha, f.first);
  assert.equal(record.databaseChanged, false);
  assert.equal(
    f.state.events.some(
      (e) => e.args.includes('db:migrate') || e.args.includes('db:seed'),
    ),
    false,
  );
});
test('build failure leaves the old application and both services untouched', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  const next = f.commit('two');
  f.state.buildFailure = 'two';
  const restarts = f.state.events.filter(
    (e) => e.file === 'systemctl' && e.args[0] === 'restart',
  ).length;
  await assert.rejects(manager.deploy(next, f.first, true));
  assert.equal(manager.active(), f.first);
  assert.equal(
    f.state.events.filter(
      (e) => e.file === 'systemctl' && e.args[0] === 'restart',
    ).length,
    restarts,
  );
  assert.equal(
    readdirSync(join(f.root, 'releases')).some((n) => n.startsWith('.pending')),
    false,
  );
  assert.equal(f.latest().status, 'failed');
  assert.equal(
    JSON.stringify(f.records()).includes('synthetic-private-error'),
    false,
  );
});
test('health failure restores the previous symlink and verifies both old processes', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  const next = f.commit('two');
  f.state.healthFailures.add(next);
  await assert.rejects(manager.deploy(next, f.first, true));
  assert.equal(manager.active(), f.first);
  const record = f.latest();
  assert.equal(record.status, 'failed_rolled_back');
  assert.equal(record.rollback, 'verified');
  assert.equal(record.recoveredRuntime.web.sha, f.first);
  assert.equal(record.recoveredRuntime.worker.sha, f.first);
});
test('failed first deployment restores absence and verifies stopped services', async () => {
  const f = fixture(),
    manager = f.manager();
  f.state.healthFailures.add(f.first);
  await assert.rejects(manager.deploy(f.first, null, true));
  assert.equal(manager.active(), null);
  assert.equal(f.latest().status, 'failed_rolled_back');
  assert.equal(f.latest().recoveredRuntime.web.pid, 0);
  assert.equal(f.latest().recoveredRuntime.worker.pid, 0);
});
test('rollback failure is recorded as failure rather than reported as recovery', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  const next = f.commit('two');
  f.state.restartFailures = 2;
  await assert.rejects(manager.deploy(next, f.first, true));
  assert.equal(f.latest().status, 'failed_rollback_failed');
  assert.equal(f.latest().rollback, 'failed');
  assert.equal(f.latest().recoveredRuntime, undefined);
});
test('explicit application rollback reuses a managed release without running migrations', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  const next = f.commit('two');
  await manager.deploy(next, f.first, true);
  await manager.rollback(f.first, next, true);
  assert.equal(manager.active(), f.first);
  assert.equal(f.latest().runtime.worker.sha, f.first);
  assert.equal(f.latest().databaseChanged, false);
});
test('failed explicit rollback restores the starting version and verifies recovery', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  const next = f.commit('two');
  await manager.deploy(next, f.first, true);
  f.state.healthFailures.add(f.first);
  await assert.rejects(manager.rollback(f.first, next, true));
  assert.equal(manager.active(), next);
  assert.equal(f.latest().status, 'failed_rolled_back');
});
test('requires expected current version, compatibility acknowledgement and serial operations', async () => {
  const f = fixture(),
    manager = f.manager();
  await assert.rejects(
    manager.deploy(f.first, '0'.repeat(40), true),
    /current_changed/,
  );
  await assert.rejects(
    manager.deploy(f.first, null, false),
    /rollback_compatibility_required/,
  );
  mkdirSync(join(f.root, '.deployment-lock'));
  await assert.rejects(
    manager.deploy(f.first, null, true),
    /deployment_in_progress/,
  );
  assert.equal(existsSync(join(f.root, 'current')), false);
});
test('backups are required, bound to a target database, consumed and never auto-restored', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  await assert.rejects(
    manager.database('migrate', f.first, undefined),
    /backup_required/,
  );
  const backup = await manager.backup();
  assert.equal(existsSync(backup.file), true);
  assert.equal(
    backup.sha256,
    createHash('sha256').update(readFileSync(backup.file)).digest('hex'),
  );
  await manager.database('migrate', f.first, backup.file);
  assert.equal(f.latest().databaseChanged, true);
  assert.equal(manager.active(), f.first);
  await assert.rejects(
    manager.database('seed', f.first, backup.file),
    /invalid_backup/,
  );
  const second = await manager.backup();
  f.target.database.worker.host = 'different.example.test';
  await assert.rejects(
    f.manager().database('seed', f.first, second.file),
    /invalid_backup/,
  );
});
test('partial backup and failed migration remain explicit failures with unknown database outcome', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  f.state.emptyBackup = true;
  await assert.rejects(manager.backup(), /empty_backup/);
  f.state.emptyBackup = false;
  const backup = await manager.backup();
  f.state.databaseFailure = true;
  await assert.rejects(manager.database('migrate', f.first, backup.file));
  assert.equal(f.latest().databaseChanged, 'outcome_unknown');
  assert.equal(f.latest().status, 'failed');
  assert.equal(
    JSON.stringify(f.records()).includes('synthetic-private-database-error'),
    false,
  );
  assert.equal(manager.active(), f.first);
});
test('retains three activated releases and never deletes foreign paths', async () => {
  const f = fixture(),
    manager = f.manager();
  let previous = null;
  const versions = [f.first];
  for (const label of ['two', 'three', 'four']) versions.push(f.commit(label));
  for (const sha of versions) {
    await manager.deploy(sha, previous, true);
    previous = sha;
  }
  assert.equal(existsSync(join(f.root, 'releases', versions[0])), false);
  for (const sha of versions.slice(1))
    assert.equal(existsSync(join(f.root, 'releases', sha)), true);
  const foreign = join(f.root, 'releases', 'foreign-directory');
  mkdirSync(foreign);
  const link = join(f.root, 'releases', '0'.repeat(40));
  symlinkSync(f.base, link);
  manager.pruneReleases();
  assert.equal(existsSync(foreign), true);
  assert.equal(existsSync(link), true);
});
test('backup retention does not follow metadata traversal outside its directory', async () => {
  const f = fixture(),
    manager = f.manager();
  const backup = await manager.backup();
  const outside = join(f.base, basename(backup.file));
  writeFileSync(outside, readFileSync(backup.file));
  const metadata = JSON.parse(readFileSync(backup.file + '.json', 'utf8'));
  metadata.file = '../' + basename(backup.file);
  metadata.createdAt = '2020-01-01T00:00:00Z';
  writeFileSync(backup.file + '.json', JSON.stringify(metadata));
  manager.pruneBackups();
  assert.equal(existsSync(outside), true);
});
test('CLI refuses unspecified or unapproved targets without external actions', async () => {
  assert.equal(await main([]), 1);
  assert.equal(await main(['deploy', '--target-id', 'x']), 1);
  assert.equal(
    await main(['deploy', '--target', '/not-present', '--target-id', 'x']),
    1,
  );
});

test('validates each target trust boundary before commands or destructive filesystem work', () => {
  const f = fixture();
  const insideEnv = join(f.repo, 'environment');
  mkdirSync(insideEnv);
  const insideRelease = join(f.root, 'releases', 'backups');
  mkdirSync(insideRelease, { recursive: true });
  const alias = join(f.base, 'alias');
  symlinkSync(f.root, alias);
  const variants = [
    [{ version: 2 }, f.target.id],
    [{ id: 'other-demo' }, f.target.id],
    [
      {
        confirmationRef:
          'https://github.com/other/repo/issues/25#issuecomment-1',
      },
      f.target.id,
    ],
    [{ root: alias }, f.target.id],
    [{ root: f.base }, f.target.id],
    [{ repository: f.base }, f.target.id],
    [{ envDirectory: insideEnv }, f.target.id],
    [{ backupDirectory: insideRelease }, f.target.id],
    [{ webOrigin: 'http://demo.example.test' }, f.target.id],
    [{ nodePath: join(f.base, 'missing-node') }, f.target.id],
    [
      {
        database: {
          ...f.target.database,
          worker: { ...f.target.database.worker, host: 'bad@host' },
        },
      },
      f.target.id,
    ],
    [
      {
        database: {
          ...f.target.database,
          web: { ...f.target.database.web, port: 5432 },
        },
      },
      f.target.id,
    ],
    [
      {
        database: {
          ...f.target.database,
          web: { ...f.target.database.web, name: '../other' },
        },
      },
      f.target.id,
    ],
    [{ prerequisites: { bow897: null, bow899: f.first } }, f.target.id],
  ];
  for (const [change, id] of variants)
    assert.throws(() => validateTarget({ ...f.target, ...change }, id));
  const env = join(f.target.envDirectory, 'web.env');
  rmSync(env);
  symlinkSync(join(f.target.envDirectory, 'common.env'), env);
  assert.throws(() => validateTarget(f.target, f.target.id));
  assert.equal(f.state.events.length, 0);
});
test('prepare is executable independently and status reports initial absence without activating services', async () => {
  const f = fixture(),
    manager = f.manager();
  assert.equal((await manager.status()).sha, null);
  const prepared = await manager.prepareRelease(f.first);
  assert.equal(prepared.sha, f.first);
  assert.equal(existsSync(prepared.recordPath), true);
  assert.equal(manager.active(), null);
  assert.equal(
    f.state.events.some((event) => event.file === 'systemctl'),
    false,
  );
  const builds = f.state.events.filter((event) =>
    event.args.includes('build'),
  ).length;
  await manager.deploy(f.first, null, true);
  assert.equal(
    f.state.events.filter((event) => event.args.includes('build')).length,
    builds,
  );
  assert.equal((await manager.status()).runtime.worker.sha, f.first);
});
test('blocks activation on missing, mismatched or malformed migration readback', async () => {
  for (const mode of ['missing', 'mismatch', 'malformed']) {
    const f = fixture(),
      manager = f.manager();
    const run = manager.run;
    manager.run = async (file, args, options) => {
      if (args.some((arg) => String(arg).endsWith('migration-state.mjs'))) {
        if (mode === 'malformed') return 'not-json';
        return JSON.stringify({
          journalExists: mode !== 'missing',
          serverVersion: '170000',
          migrations:
            mode === 'mismatch'
              ? [{ hash: 'b'.repeat(64), createdAt: '1' }]
              : [],
        });
      }
      return run(file, args, options);
    };
    await assert.rejects(manager.deploy(f.first, null, true));
    assert.equal(manager.active(), null);
    assert.equal(
      f.state.events.some((event) => event.file === 'systemctl'),
      false,
    );
    assert.equal(existsSync(join(f.root, '.deployment-lock')), false);
  }
});
test('refuses a corrupted source migration manifest', async () => {
  const f = fixture(),
    manager = f.manager();
  writeFileSync(
    join(f.repo, 'src/server/db/migrations/meta/_journal.json'),
    JSON.stringify({ entries: [] }),
  );
  const sha = f.commit('invalid-journal');
  await assert.rejects(
    manager.deploy(sha, null, true),
    /invalid_migration_manifest/,
  );
  assert.equal(manager.active(), null);
});
test('a mismatched worker runtime triggers verified recovery rather than success', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.deploy(f.first, null, true);
  const next = f.commit('two'),
    observe = manager.observe;
  manager.observe = async (service) => {
    const value = await observe(service);
    if (service.includes('worker') && value.sha === next) {
      return { ...value, sha: '0'.repeat(40) };
    }
    return value;
  };
  await assert.rejects(
    manager.deploy(next, f.first, true),
    /runtime_version_mismatch/,
  );
  assert.equal(manager.active(), f.first);
  assert.equal(f.latest().status, 'failed_rolled_back');
});
test('preserves unrecognized current/release directories and rejects invalid optimistic versions', async () => {
  const f = fixture(),
    manager = f.manager();
  await assert.rejects(
    manager.deploy(f.first, 'main', true),
    /invalid_expected_current/,
  );
  await assert.rejects(
    manager.rollback(f.first, 'main', true),
    /invalid_expected_current/,
  );
  mkdirSync(join(f.root, 'current'));
  await assert.rejects(manager.deploy(f.first, null, true), /invalid_current/);
  assert.equal(existsSync(join(f.root, 'current')), true);
  rmSync(join(f.root, 'current'), { recursive: true });
  const release = join(f.root, 'releases', f.first);
  mkdirSync(release);
  writeFileSync(join(release, 'foreign.txt'), 'synthetic unrelated file');
  await assert.rejects(manager.deploy(f.first, null, true), /invalid_release/);
  assert.equal(
    readFileSync(join(release, 'foreign.txt'), 'utf8'),
    'synthetic unrelated file',
  );
});
test('rejects a modified backup and removes only recognized backups beyond retention', async () => {
  const f = fixture(),
    manager = f.manager();
  await manager.prepareRelease(f.first);
  const backup = await manager.backup();
  writeFileSync(backup.file, 'changed snapshot');
  await assert.rejects(
    manager.database('seed', f.first, backup.file),
    /invalid_backup/,
  );
  const old = await manager.backup();
  const metadata = JSON.parse(readFileSync(old.file + '.json', 'utf8'));
  metadata.createdAt = '2020-01-01T00:00:00Z';
  writeFileSync(old.file + '.json', JSON.stringify(metadata));
  writeFileSync(
    join(f.target.backupDirectory, 'foreign.dump'),
    'synthetic unrelated backup',
  );
  manager.pruneBackups();
  assert.equal(existsSync(old.file), false);
  assert.equal(existsSync(old.file + '.json'), false);
  assert.equal(existsSync(backup.file), true);
  assert.equal(
    existsSync(join(f.target.backupDirectory, 'foreign.dump')),
    true,
  );
});
test('reads service PID and cwd at the native observation boundary', async () => {
  const f = fixture();
  let queried;
  const manager = new ReleaseManager(f.target, f.target.id, {
    run: async (file, args) => {
      queried = { file, args };
      return '1234';
    },
    processCwd: (path) => {
      assert.equal(path, '/proc/1234/cwd');
      return join(f.root, 'releases', f.first);
    },
  });
  assert.equal(
    (await manager.nativeObserve('qtalent-web.service')).sha,
    f.first,
  );
  assert.equal(queried.file, 'systemctl');
  manager.run = async () => '0';
  assert.deepEqual(await manager.nativeObserve('qtalent-worker.service'), {
    pid: 0,
    sha: null,
  });
});
test('native command runner captures selected output, hides errors and terminates its own timeout group', async () => {
  assert.equal(
    await nativeRun(
      process.execPath,
      ['-e', "process.stdout.write('safe-output')"],
      { capture: true },
    ),
    'safe-output',
  );
  assert.equal(
    await nativeRun(process.execPath, [
      '-e',
      "process.stdout.write('synthetic-private-output')",
    ]),
    '',
  );
  await assert.rejects(
    nativeRun(process.execPath, [
      '-e',
      "process.stderr.write('synthetic-private-output');process.exit(3)",
    ]),
    (error) =>
      error.code === 'command_failed' && !String(error).includes('private'),
  );
  await assert.rejects(nativeRun('/not-an-executable', []), /command_failed/);
  await assert.rejects(
    nativeRun(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeoutMs: 40,
    }),
    /command_timeout/,
  );
});
test('CLI routes explicit commands through the same manager and records all side effects', async () => {
  const f = fixture(),
    manager = f.manager();
  const file = join(f.base, 'target.json');
  writeFileSync(file, JSON.stringify(f.target));
  const options = {
    run: manager.run,
    observe: manager.observe,
    health: manager.health,
    now: manager.now,
  };
  const targetArgs = ['--target', file, '--target-id', f.target.id];
  assert.equal(
    await main(['prepare', ...targetArgs, '--sha', f.first], options),
    0,
  );
  assert.equal(await main(['backup', ...targetArgs], options), 0);
  const backup = join(
    f.target.backupDirectory,
    readdirSync(f.target.backupDirectory).find((name) =>
      name.endsWith('.dump'),
    ),
  );
  assert.equal(
    await main(
      ['migrate', ...targetArgs, '--sha', f.first, '--backup', backup],
      options,
    ),
    0,
  );
  assert.equal(
    await main(
      [
        f.first,
        ...targetArgs,
        '--expected-current',
        'none',
        '--rollback-compatible',
      ],
      options,
    ),
    0,
  );
  assert.equal(await main(['status', ...targetArgs], options), 0);
  assert.equal(
    await main(
      [
        'rollback',
        ...targetArgs,
        '--sha',
        f.first,
        '--expected-current',
        f.first,
        '--rollback-compatible',
      ],
      options,
    ),
    0,
  );
  const seedBackup = await manager.backup();
  assert.equal(
    await main(
      ['seed', ...targetArgs, '--sha', f.first, '--backup', seedBackup.file],
      options,
    ),
    0,
  );
  assert.equal(await main(['unknown', ...targetArgs], options), 1);
  assert.equal(await main(['deploy', '--unknown', 'value'], options), 1);
});

test('build keeps dev dependencies and creates the qtalent cache before activation', async () => {
  const f = fixture();
  await f.manager().prepareRelease(f.first);
  assert.ok(existsSync(join(f.root, 'releases', f.first, '.next/cache')));
  const install = f.state.events.find((event) =>
    event.args.includes('install'),
  );
  assert.ok(install.args.includes('--prod=false'));
  assert.ok(
    f.state.events.some(
      (event) =>
        event.file === 'chown' && event.args[1].endsWith('/.next/cache'),
    ),
  );
});
test('startup readiness retries a transient connection failure without rolling back', async () => {
  const f = fixture();
  let probes = 0;
  const manager = f.manager({
    health: async () => {
      if (++probes === 1) throw new DeploymentError('web_health_failed');
    },
  });
  await manager.deploy(f.first, null, true);
  assert.equal(probes, 2);
  assert.equal(manager.active(), f.first);
  assert.equal(f.latest().status, 'succeeded');
  assert.equal(f.latest().rollback, undefined);
});
test('rollback still restores services when writing its phase record fails', async () => {
  const f = fixture();
  const manager = f.manager();
  await manager.deploy(f.first, null, true);
  const second = f.commit('second');
  f.state.healthFailures.add(second);
  const write = manager.writeJson.bind(manager);
  let failedWrite = false;
  manager.writeJson = (path, value) => {
    if (!failedWrite && value.phases?.at(-1) === 'rollback') {
      failedWrite = true;
      throw new Error('synthetic storage boundary failure');
    }
    write(path, value);
  };
  await assert.rejects(manager.deploy(second, f.first, true));
  assert.equal(failedWrite, true);
  assert.equal(manager.active(), f.first);
  assert.ok(f.state.runtime.every((actual) => actual.sha === f.first));
  assert.equal(f.latest().rollback, 'verified');
});
test('environment and backup directories cannot equal the repository or release root', () => {
  const f = fixture();
  mkdirSync(join(f.root, 'releases'));
  for (const key of ['envDirectory', 'backupDirectory']) {
    for (const path of [f.repo, join(f.root, 'releases')]) {
      assert.throws(
        () => validateTarget({ ...f.target, [key]: path }, f.target.id),
        /invalid_target_path/,
      );
    }
  }
});

test('explicit empty prerequisites permit the approved merged main baseline before later chain work', async () => {
  const f = fixture();
  const baseline = f.target.prerequisites.bow897;
  f.target.prerequisites = {};
  const result = await f.manager().prepareRelease(baseline);
  assert.equal(result.sha, baseline);
  assert.ok(existsSync(join(f.root, 'releases', baseline, '.next/BUILD_ID')));
  assert.equal(
    f.state.events.filter((e) => e.args.includes('--is-ancestor')).length,
    1,
  );
});
test('main-only policy still refuses an unmerged revision before preparing or touching services', async () => {
  const f = fixture();
  f.target.prerequisites = {};
  f.git('switch', '-qc', 'unmerged-main-only');
  writeFileSync(join(f.repo, 'new.txt'), 'unmerged');
  f.git('add', '.');
  f.git(
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-qm',
    'unmerged',
  );
  await assert.rejects(
    f.manager().deploy(f.git('rev-parse', 'HEAD'), null, true),
    /command_failed/,
  );
  assert.equal(
    f.state.events.some((e) => e.file === 'systemctl'),
    false,
  );
  assert.equal(existsSync(join(f.root, 'current')), false);
});
