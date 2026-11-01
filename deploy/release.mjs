import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  symlinkSync,
  renameSync,
  unlinkSync,
  rmSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import {
  resolve,
  join,
  dirname,
  basename,
  isAbsolute,
  relative,
} from 'node:path';
import { hostname } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const services = ['qtalent-web.service', 'qtalent-worker.service'];
export class DeploymentError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new DeploymentError(code);
};
function strict(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail('invalid_target');
}
function directory(path) {
  if (
    !isAbsolute(path) ||
    path === '/' ||
    !existsSync(path) ||
    !statSync(path).isDirectory() ||
    realpathSync(path) !== resolve(path)
  )
    fail('invalid_target_path');
}
function environmentFile(path, expectedUid) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) fail('invalid_environment_file');
  if (
    (info.mode & 0o777) !== 0o600 ||
    (expectedUid !== undefined && info.uid !== expectedUid)
  )
    fail('insecure_env_file');
}
const within = (parent, child) => {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
};
export function validateTarget(
  target,
  expectedId,
  actualHostname = hostname(),
) {
  strict(target, [
    'version',
    'id',
    'confirmed',
    'confirmationRef',
    'environment',
    'hostname',
    'root',
    'repository',
    'envDirectory',
    'backupDirectory',
    'webOrigin',
    'nodePath',
    'pnpmPath',
    'pgDumpPath',
    'database',
    'prerequisites',
  ]);
  if (
    target.version !== 1 ||
    target.confirmed !== true ||
    target.environment !== 'demo' ||
    !/^[a-z0-9][a-z0-9-]{2,47}$/.test(target.id) ||
    target.id !== expectedId ||
    target.hostname !== actualHostname ||
    !/^https:\/\/github\.com\/bowenQT\/QTalent\/issues\/25#issuecomment-[0-9]+$/.test(
      target.confirmationRef,
    )
  )
    fail('unconfirmed_target');
  for (const name of ['root', 'repository', 'envDirectory', 'backupDirectory'])
    directory(target[name]);
  if (
    basename(target.root) !== 'qtalent' ||
    !within(target.root, target.repository) ||
    [target.envDirectory, target.backupDirectory].some((path) =>
      [target.repository, join(target.root, 'releases')].some(
        (parent) => path === parent || within(parent, path),
      ),
    )
  )
    fail('invalid_target_path');
  let origin;
  try {
    origin = new URL(target.webOrigin);
  } catch {
    fail('invalid_origin');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== target.webOrigin ||
    origin.username ||
    origin.password
  )
    fail('invalid_origin');
  for (const name of ['nodePath', 'pnpmPath', 'pgDumpPath'])
    if (
      !isAbsolute(target[name]) ||
      !existsSync(target[name]) ||
      !statSync(target[name]).isFile()
    )
      fail('invalid_executable');
  strict(target.database, ['projectRef', 'web', 'worker']);
  if (!/^[a-z0-9]{20}$/.test(target.database.projectRef))
    fail('invalid_database_target');
  for (const role of ['web', 'worker']) {
    const db = target.database[role];
    strict(db, ['host', 'port', 'name', 'username']);
    if (
      !/^[a-zA-Z0-9.-]+$/.test(db.host) ||
      !/^[a-zA-Z0-9_-]+$/.test(db.name) ||
      !/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-z0-9]{20}$/.test(db.username) ||
      !db.username.endsWith('.' + target.database.projectRef) ||
      db.port !== (role === 'web' ? 6543 : 5432)
    )
      fail('invalid_database_target');
    const file = join(target.envDirectory, role + '.env');
    environmentFile(file);
  }
  const common = join(target.envDirectory, 'common.env');
  environmentFile(common);
  const prerequisites = target.prerequisites;
  if (
    !prerequisites ||
    typeof prerequisites !== 'object' ||
    Array.isArray(prerequisites) ||
    Object.keys(prerequisites).some(
      (key) => !['bow897', 'bow899'].includes(key),
    ) ||
    !Object.values(prerequisites).every((sha) => SHA.test(sha))
  )
    fail('invalid_prerequisites');
  return target;
}
export async function nativeRun(executable, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const terminate = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* child already exited */
      }
    };
    let force;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      force = setTimeout(() => terminate('SIGKILL'), 5000);
    }, options.timeoutMs ?? 300000);
    child.stdout.on('data', (chunk) => {
      if (options.capture && output.length < 1048576)
        output += chunk.toString();
    });
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer);
      clearTimeout(force);
      reject(new DeploymentError('command_failed'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(force);
      if (code !== 0 || timedOut)
        reject(
          new DeploymentError(
            timedOut
              ? 'command_timeout'
              : options.databaseConfigurationErrors && code === 64
                ? 'database_query_parameter_not_allowed'
                : options.databaseConfigurationErrors && code === 65
                  ? 'database_query_parameter_duplicate'
                  : 'command_failed',
          ),
        );
      else resolveRun(output.trim());
    });
  });
}
export async function nativeHealth({ webPort = 3000, workerPort = 3001 } = {}) {
  const response = await fetch('http://127.0.0.1:' + webPort + '/login', {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  if (response.status !== 401) fail('web_health_failed');
  await new Promise((resolvePort, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: workerPort });
    socket.setTimeout(10000);
    socket.once('connect', () => {
      socket.destroy();
      resolvePort();
    });
    const failure = () => {
      socket.destroy();
      reject(new DeploymentError('worker_health_failed'));
    };
    socket.once('error', failure);
    socket.once('timeout', failure);
  });
}
function checksum(path) {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.alloc(65536);
  try {
    let size;
    while ((size = readSync(descriptor, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, size));
    return hash.digest('hex');
  } finally {
    closeSync(descriptor);
  }
}
export class ReleaseManager {
  constructor(target, expectedId, options = {}) {
    this.target = structuredClone(
      validateTarget(target, expectedId, options.hostname ?? hostname()),
    );
    this.run = options.run ?? nativeRun;
    this.health = options.health ?? nativeHealth;
    this.observe =
      options.observe ?? ((service) => this.nativeObserve(service));
    this.now = options.now ?? (() => new Date());
    this.processCwd = options.processCwd ?? realpathSync;
    this.readinessAttempts = options.readinessAttempts ?? 30;
    this.readinessDelayMs = options.readinessDelayMs ?? 1000;
    this.releases = join(target.root, 'releases');
    this.records = join(target.root, 'deployment-records');
    this.current = join(target.root, 'current');
  }
  async git(...args) {
    return this.run(
      'runuser',
      [
        '-u',
        'qtalent',
        '--',
        'git',
        '-C',
        this.target.repository,
        '--no-optional-locks',
        ...args,
      ],
      { capture: true },
    );
  }
  async app(
    role,
    operation,
    executable,
    args = [],
    cwd = this.target.repository,
    options = {},
  ) {
    const t = this.target;
    const expected = JSON.stringify({
      origin: t.webOrigin,
      database: { ...t.database[role], projectRef: t.database.projectRef },
      ...(operation !== 'identity' && this.databaseIdentities
        ? { databaseIdentity: this.databaseIdentities[role] }
        : {}),
      envFiles: [
        join(t.envDirectory, 'common.env'),
        join(t.envDirectory, role + '.env'),
      ],
    });
    const command = [
      t.nodePath,
      join(sourceDirectory, 'app-command.mjs'),
      expected,
      operation,
      executable,
      ...args,
    ];
    return this.run('runuser', ['-u', 'qtalent', '--', ...command], {
      cwd,
      ...options,
      databaseConfigurationErrors: true,
    });
  }
  async validateEnvironment() {
    this.databaseIdentities = undefined;
    let serviceUid;
    try {
      serviceUid = await this.run('/usr/bin/id', ['-u', 'qtalent'], {
        capture: true,
      });
    } catch {
      fail('service_user_unavailable');
    }
    if (!/^\d+$/.test(serviceUid) || !Number.isSafeInteger(Number(serviceUid)))
      fail('service_user_unavailable');
    for (const role of ['common', 'web', 'worker'])
      environmentFile(
        join(this.target.envDirectory, role + '.env'),
        Number(serviceUid),
      );
    const identities = {};
    for (const role of ['web', 'worker']) {
      const raw = await this.app(
        role,
        'identity',
        this.target.nodePath,
        [],
        this.target.repository,
        { capture: true },
      );
      try {
        identities[role] = JSON.parse(raw);
        strict(identities[role], [
          'host',
          'port',
          'name',
          'username',
          'sslmode',
          'sslrootcert',
        ]);
      } catch {
        fail('invalid_database_identity');
      }
    }
    this.databaseIdentities = identities;
  }
  async candidate(sha) {
    if (!SHA.test(sha ?? '')) fail('invalid_revision');
    await this.git('fetch', 'origin', 'main');
    await this.git(
      'merge-base',
      '--is-ancestor',
      sha,
      'refs/remotes/origin/main',
    );
    for (const prerequisite of Object.values(this.target.prerequisites))
      await this.git('merge-base', '--is-ancestor', prerequisite, sha);
    const manifest = JSON.parse(await this.git('show', sha + ':package.json'));
    if (
      manifest.name !== 'qtalent' ||
      manifest.engines?.node !== '>=24.0.0 <25' ||
      !/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager)
    )
      fail('invalid_toolchain');
    await this.git('cat-file', '-e', sha + ':pnpm-lock.yaml');
    const node = await this.run(this.target.nodePath, ['--version'], {
      capture: true,
    });
    const pnpm = await this.run(this.target.pnpmPath, ['--version'], {
      capture: true,
    });
    if (!/^v24\./.test(node) || 'pnpm@' + pnpm !== manifest.packageManager)
      fail('invalid_toolchain');
    return manifest;
  }
  initialize() {
    mkdirSync(this.releases, { recursive: true });
    mkdirSync(this.records, { recursive: true });
    directory(this.releases);
    directory(this.records);
    const lock = join(this.target.root, '.deployment-lock');
    try {
      mkdirSync(lock);
    } catch (error) {
      fail(
        error.code === 'EEXIST'
          ? 'deployment_in_progress'
          : 'deployment_lock_unavailable',
      );
    }
    try {
      writeFileSync(
        join(lock, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          targetId: this.target.id,
          hostname: hostname(),
          startedAt: this.now().toISOString(),
        }),
        { mode: 0o600, flag: 'wx' },
      );
    } catch {
      rmSync(lock, { recursive: true });
      fail('lock_metadata_failed');
    }
    return () => rmSync(lock, { recursive: true });
  }
  writeJson(path, value) {
    const temp = path + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temp, path);
  }
  active() {
    if (!existsSync(this.current) && !lstatExists(this.current)) return null;
    if (!lstatSync(this.current).isSymbolicLink()) fail('invalid_current');
    const path = realpathSync(this.current);
    const sha = basename(path);
    if (!SHA.test(sha) || path !== join(this.releases, sha))
      fail('invalid_current');
    this.release(sha);
    return sha;
  }
  release(sha) {
    if (!SHA.test(sha ?? '')) fail('invalid_revision');
    const path = join(this.releases, sha);
    if (
      !existsSync(path) ||
      lstatSync(path).isSymbolicLink() ||
      realpathSync(path) !== path
    )
      fail('invalid_release');
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(join(path, 'release.json'), 'utf8'));
    } catch {
      fail('invalid_release');
    }
    if (
      metadata.sha !== sha ||
      metadata.targetId !== this.target.id ||
      !existsSync(join(path, '.next', 'BUILD_ID')) ||
      !/^[a-f0-9]{7,40}$/.test(metadata.referenceCommit ?? '') ||
      !existsSync(join(path, '.reference-cache/reference.json'))
    )
      fail('invalid_release');
    let reference;
    try {
      reference = JSON.parse(
        readFileSync(join(path, '.reference-cache/reference.json'), 'utf8'),
      );
    } catch {
      fail('invalid_release');
    }
    if (reference.commit !== metadata.referenceCommit) fail('invalid_release');
    return { path, metadata };
  }
  point(sha) {
    if (sha === null) {
      if (lstatExists(this.current)) unlinkSync(this.current);
      return;
    }
    const { path } = this.release(sha);
    const temp = this.current + '.' + randomUUID() + '.tmp';
    symlinkSync(path, temp);
    renameSync(temp, this.current);
  }
  async nativeObserve(service) {
    const pid = Number(
      await this.run(
        'systemctl',
        ['show', service, '--property=MainPID', '--value'],
        { capture: true },
      ),
    );
    if (!Number.isInteger(pid) || pid <= 0) return { pid: 0, sha: null };
    const cwd = this.processCwd('/proc/' + pid + '/cwd');
    return { pid, sha: basename(cwd), path: cwd };
  }
  async runtime(sha) {
    if (sha === null) {
      const [web, worker] = await Promise.all(
        services.map((service) => this.observe(service)),
      );
      if (web.pid || worker.pid) fail('services_still_running');
      return { web, worker };
    }
    await this.run('systemctl', ['is-active', '--quiet', ...services]);
    const [web, worker] = await Promise.all(
      services.map((service) => this.observe(service)),
    );
    for (const actual of [web, worker])
      if (
        !actual.pid ||
        actual.sha !== sha ||
        actual.path !== join(this.releases, sha)
      )
        fail('runtime_version_mismatch');
    await this.health();
    return { web, worker };
  }
  async ready(sha) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.runtime(sha);
      } catch (error) {
        if (attempt + 1 >= this.readinessAttempts) throw error;
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, this.readinessDelayMs),
        );
      }
    }
  }
  async prepareReference(path) {
    const referenceText = readFileSync(
      join(path, 'prototype-reference.json'),
      'utf8',
    );
    const manifestText = readFileSync(
      join(path, 'tests/fixtures/prototype-manifest.json'),
      'utf8',
    );
    const { commit } = JSON.parse(referenceText);
    const { files } = JSON.parse(manifestText);
    if (
      !/^[a-f0-9]{7,40}$/.test(commit ?? '') ||
      !Array.isArray(files) ||
      files.length === 0 ||
      files.some(
        (entry) =>
          typeof entry.path !== 'string' ||
          !entry.path.startsWith('prototype/y/') ||
          entry.path.split('/').some((p) => !p || p === '.' || p === '..'),
      )
    )
      fail('invalid_reference');
    const snapshot = join(path, '.reference-input');
    mkdirSync(snapshot);
    try {
      await this.run('chown', ['qtalent:qtalent', snapshot]);
      const archive = join(snapshot, 'reference.tar');
      await this.git(
        'archive',
        '--format=tar',
        '--output',
        archive,
        commit,
        '--',
        ...files.map((entry) => entry.path),
      );
      await this.run('runuser', [
        '-u',
        'qtalent',
        '--',
        'tar',
        '-xf',
        archive,
        '-C',
        snapshot,
      ]);
      unlinkSync(archive);
      mkdirSync(join(snapshot, 'tests/fixtures'), { recursive: true });
      writeFileSync(join(snapshot, 'prototype-reference.json'), referenceText);
      writeFileSync(
        join(snapshot, 'tests/fixtures/prototype-manifest.json'),
        manifestText,
      );
      await this.app(
        'web',
        'command',
        this.target.nodePath,
        [
          '--import',
          'tsx',
          join(path, 'scripts/prepare-reference.ts'),
          '--verified-snapshot',
        ],
        snapshot,
      );
      const cache = join(snapshot, '.reference-cache');
      if (
        !existsSync(join(cache, 'reference.json')) ||
        JSON.parse(readFileSync(join(cache, 'reference.json'), 'utf8'))
          .commit !== commit
      )
        fail('reference_not_prepared');
      renameSync(cache, join(path, '.reference-cache'));
      return commit;
    } finally {
      rmSync(snapshot, { recursive: true, force: true });
    }
  }
  async prepare(sha, operationId) {
    const final = join(this.releases, sha);
    if (existsSync(final)) return this.release(sha);
    const stage = join(this.releases, '.pending-' + operationId);
    mkdirSync(stage);
    try {
      await this.run('chown', ['qtalent:qtalent', stage]);
      const archive = join(stage, '.release.tar');
      await this.git('archive', '--format=tar', '--output', archive, sha);
      await this.run('runuser', [
        '-u',
        'qtalent',
        '--',
        'tar',
        '-xf',
        archive,
        '-C',
        stage,
      ]);
      unlinkSync(archive);
      await this.app(
        'web',
        'command',
        this.target.pnpmPath,
        ['install', '--frozen-lockfile', '--prod=false', '--ignore-scripts'],
        stage,
      );
      const referenceCommit = await this.prepareReference(stage);
      await this.app('web', 'command', this.target.pnpmPath, ['build'], stage);
      if (!existsSync(join(stage, '.next', 'BUILD_ID'))) fail('missing_build');
      const cache = join(stage, '.next', 'cache');
      mkdirSync(cache, { recursive: true });
      await this.run('chown', ['qtalent:qtalent', cache]);
      this.writeJson(join(stage, 'release.json'), {
        targetId: this.target.id,
        sha,
        referenceCommit,
        preparedAt: this.now().toISOString(),
        activatedAt: null,
      });
      renameSync(stage, final);
      return this.release(sha);
    } finally {
      if (existsSync(stage)) rmSync(stage, { recursive: true });
    }
  }
  async operation(kind, sha, action) {
    const unlock = this.initialize();
    const id = randomUUID();
    const record = {
      id,
      targetId: this.target.id,
      confirmationRef: this.target.confirmationRef,
      operation: kind,
      requestedSha: sha ?? null,
      startedAt: this.now().toISOString(),
      status: 'running',
      phases: [],
      databaseChanged: false,
    };
    const path = join(this.records, id + '.json');
    const phase = (name) => {
      record.phases.push(name);
      this.writeJson(path, record);
    };
    try {
      phase('started');
      const result = await action(record, phase, id);
      record.status = record.warning ? 'succeeded_with_warning' : 'succeeded';
      return {
        ...result,
        recordId: id,
        recordPath: path,
        warnings: record.warning ? [record.warning] : [],
      };
    } catch (error) {
      record.status =
        record.rollback === 'verified'
          ? 'failed_rolled_back'
          : record.rollback === 'failed'
            ? 'failed_rollback_failed'
            : 'failed';
      record.error =
        error instanceof DeploymentError ? error.code : 'operation_failed';
      const failure = new DeploymentError(record.error);
      failure.recordId = id;
      failure.recordPath = path;
      failure.status = record.status;
      throw failure;
    } finally {
      record.finishedAt = this.now().toISOString();
      try {
        this.writeJson(path, record);
      } finally {
        unlock();
      }
    }
  }
  databaseFingerprint() {
    if (!this.databaseIdentities) fail('database_identity_unavailable');
    return createHash('sha256')
      .update(
        JSON.stringify({
          version: 3,
          projectRef: this.target.database.projectRef,
          ...this.databaseIdentities,
        }),
      )
      .digest('hex');
  }
  async migrationState(path) {
    const raw = await this.app(
      'worker',
      'command',
      this.target.nodePath,
      [join(sourceDirectory, 'migration-state.mjs')],
      path,
      { capture: true },
    );
    let state;
    try {
      state = JSON.parse(raw);
    } catch {
      fail('invalid_migration_state');
    }
    if (
      state.journalExists !== true ||
      !/^[0-9]+$/.test(state.serverVersion) ||
      !Array.isArray(state.migrations) ||
      !state.migrations.every(
        (row) =>
          /^[0-9a-f]{64}$/.test(row.hash) && /^[0-9]+$/.test(row.createdAt),
      )
    )
      fail('invalid_migration_state');
    const journal = JSON.parse(
      readFileSync(
        join(path, 'src/server/db/migrations/meta/_journal.json'),
        'utf8',
      ),
    );
    if (!Array.isArray(journal.entries) || !journal.entries.length)
      fail('invalid_migration_manifest');
    const expected = journal.entries.map((entry) => {
      if (
        !/^[a-zA-Z0-9_]+$/.test(entry.tag) ||
        !Number.isSafeInteger(entry.when)
      )
        fail('invalid_migration_manifest');
      return {
        hash: checksum(
          join(path, 'src/server/db/migrations', entry.tag + '.sql'),
        ),
        createdAt: String(entry.when),
      };
    });
    if (
      !expected.every(
        (entry, index) =>
          entry.hash === state.migrations[index]?.hash &&
          entry.createdAt === state.migrations[index]?.createdAt,
      )
    )
      fail('migrations_not_applied');
    return { ...state, targetMigrationsMatched: true };
  }
  async activate(sha, previous, record, phase) {
    try {
      phase('activate');
      this.point(sha);
      phase('restart');
      await this.run('systemctl', ['restart', ...services]);
      phase('health');
      record.runtime = await this.ready(sha);
      const { path, metadata } = this.release(sha);
      this.writeJson(join(path, 'release.json'), {
        ...metadata,
        activatedAt: this.now().toISOString(),
      });
      record.deployedSha = sha;
    } catch (error) {
      try {
        phase('rollback');
      } catch {
        // A record-write failure must not prevent restoring the running version.
      }
      try {
        this.point(previous);
        await this.run('systemctl', [
          previous ? 'restart' : 'stop',
          ...services,
        ]);
        record.recoveredRuntime = await this.ready(previous);
        record.rollback = 'verified';
      } catch {
        record.rollback = 'failed';
      }
      throw error;
    }
  }
  async prepareRelease(sha) {
    return this.operation('prepare', sha, async (record, phase, id) => {
      phase('validate');
      await this.validateEnvironment();
      await this.candidate(sha);
      phase('prepare');
      const release = await this.prepare(sha, id);
      return { sha, path: release.path };
    });
  }
  async deploy(sha, expectedCurrent, rollbackCompatible) {
    if (expectedCurrent !== null && !SHA.test(expectedCurrent ?? ''))
      fail('invalid_expected_current');
    return this.operation('deploy', sha, async (record, phase, id) => {
      phase('validate');
      await this.validateEnvironment();
      await this.candidate(sha);
      const previous = this.active();
      record.previousSha = previous;
      record.expectedCurrentSha = expectedCurrent;
      if (previous !== expectedCurrent) fail('current_changed');
      if (rollbackCompatible !== true) fail('rollback_compatibility_required');
      phase('prepare');
      await this.prepare(sha, id);
      phase('migration_check');
      record.migrations = await this.migrationState(this.release(sha).path);
      await this.activate(sha, previous, record, phase);
      phase('retention');
      try {
        this.pruneReleases();
      } catch {
        record.warning = 'release_retention_failed';
      }
      return { sha, previousSha: previous };
    });
  }
  async rollback(sha, expectedCurrent, rollbackCompatible) {
    if (expectedCurrent !== null && !SHA.test(expectedCurrent ?? ''))
      fail('invalid_expected_current');
    return this.operation('rollback', sha, async (record, phase) => {
      phase('validate');
      await this.validateEnvironment();
      await this.candidate(sha);
      record.previousSha = this.active();
      record.expectedCurrentSha = expectedCurrent;
      if (record.previousSha !== expectedCurrent) fail('current_changed');
      if (rollbackCompatible !== true) fail('rollback_compatibility_required');
      phase('migration_check');
      record.migrations = await this.migrationState(this.release(sha).path);
      await this.activate(sha, record.previousSha, record, phase);
      return { sha, previousSha: record.previousSha };
    });
  }
  pruneReleases() {
    const activated = [];
    for (const name of readdirSync(this.releases)) {
      if (!SHA.test(name)) continue;
      try {
        const release = this.release(name);
        if (release.metadata.activatedAt) activated.push({ name, ...release });
      } catch {
        /* foreign or incomplete directories are never removed */
      }
    }
    activated.sort((a, b) =>
      b.metadata.activatedAt.localeCompare(a.metadata.activatedAt),
    );
    const active = this.active();
    for (const release of activated.slice(3))
      if (release.name !== active) rmSync(release.path, { recursive: true });
  }
  async backup() {
    return this.operation('backup', null, async (record, phase, id) => {
      phase('validate');
      await this.validateEnvironment();
      const file = join(this.target.backupDirectory, 'qtalent-' + id + '.dump');
      phase('dump');
      await this.app('worker', 'dump', this.target.pgDumpPath, [
        '--format=custom',
        '--file',
        file,
      ]);
      if (!existsSync(file) || statSync(file).size === 0) fail('empty_backup');
      const metadata = {
        targetId: this.target.id,
        databaseFingerprint: this.databaseFingerprint(),
        file: basename(file),
        sha256: checksum(file),
        createdAt: this.now().toISOString(),
        consumedBy: null,
      };
      this.writeJson(file + '.json', metadata);
      record.backup = { file: basename(file), sha256: metadata.sha256 };
      phase('retention');
      this.pruneBackups();
      return { file, sha256: metadata.sha256 };
    });
  }
  pruneBackups() {
    for (const name of readdirSync(this.target.backupDirectory)) {
      if (!/^qtalent-[a-f0-9-]+\.dump\.json$/.test(name)) continue;
      const sidecar = join(this.target.backupDirectory, name);
      try {
        if (lstatSync(sidecar).isSymbolicLink()) continue;
        const metadata = JSON.parse(readFileSync(sidecar, 'utf8'));
        if (
          typeof metadata.file !== 'string' ||
          metadata.file !== basename(metadata.file)
        )
          continue;
        const file = join(this.target.backupDirectory, metadata.file);
        if (
          metadata.targetId !== this.target.id ||
          metadata.databaseFingerprint !== this.databaseFingerprint() ||
          basename(file) + '.json' !== name ||
          !existsSync(file) ||
          lstatSync(file).isSymbolicLink() ||
          checksum(file) !== metadata.sha256
        )
          continue;
        if (
          this.now().getTime() - Date.parse(metadata.createdAt) >
          7 * 86400000
        ) {
          unlinkSync(file);
          unlinkSync(sidecar);
        }
      } catch {
        /* unrecognized backups are not ours to delete */
      }
    }
  }
  async database(kind, sha, backupFile) {
    if (!['migrate', 'seed'].includes(kind)) fail('invalid_operation');
    return this.operation(kind, sha, async (record, phase, id) => {
      phase('validate');
      await this.validateEnvironment();
      await this.candidate(sha);
      const { path } = this.release(sha);
      if (
        !backupFile ||
        !existsSync(backupFile) ||
        dirname(resolve(backupFile)) !== this.target.backupDirectory ||
        lstatSync(backupFile).isSymbolicLink() ||
        !statSync(backupFile).isFile() ||
        !existsSync(backupFile + '.json') ||
        lstatSync(backupFile + '.json').isSymbolicLink()
      )
        fail('backup_required');
      let metadata;
      try {
        metadata = JSON.parse(readFileSync(backupFile + '.json', 'utf8'));
      } catch {
        fail('backup_required');
      }
      if (
        metadata.targetId !== this.target.id ||
        metadata.databaseFingerprint !== this.databaseFingerprint() ||
        metadata.file !== basename(backupFile) ||
        metadata.sha256 !== checksum(backupFile) ||
        metadata.consumedBy
      )
        fail('invalid_backup');
      metadata.consumedBy = id;
      this.writeJson(backupFile + '.json', metadata);
      record.backup = { file: metadata.file, sha256: metadata.sha256 };
      record.databaseChanged = 'outcome_unknown';
      phase(kind);
      await this.app(
        'worker',
        'command',
        this.target.pnpmPath,
        ['db:' + kind],
        path,
      );
      record.migrations = await this.migrationState(path);
      record.databaseChanged = true;
      return { sha, operation: kind };
    });
  }
  async status() {
    await this.validateEnvironment();
    const sha = this.active();
    return { targetId: this.target.id, sha, runtime: await this.runtime(sha) };
  }
}
function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
export async function main(args, managerOptions = {}) {
  try {
    if (process.versions.node.split('.')[0] !== '24') fail('node_24_required');
    let action = args.shift();
    if (SHA.test(action ?? '')) {
      args.unshift('--sha', action);
      action = 'deploy';
    }
    const options = {};
    while (args.length) {
      const key = args.shift();
      if (key === '--rollback-compatible') options.rollbackCompatible = true;
      else if (
        [
          '--target',
          '--target-id',
          '--sha',
          '--expected-current',
          '--backup',
        ].includes(key) &&
        args.length &&
        !args[0].startsWith('--') &&
        !Object.hasOwn(options, key)
      )
        options[key] = args.shift();
      else fail('invalid_arguments');
    }
    if (!options['--target'] || !options['--target-id'])
      fail('target_required');
    if (
      ['deploy', 'rollback'].includes(action) &&
      !Object.hasOwn(options, '--expected-current')
    )
      fail('expected_current_required');
    const manager = new ReleaseManager(
      JSON.parse(readFileSync(options['--target'], 'utf8')),
      options['--target-id'],
      managerOptions,
    );
    const expected =
      options['--expected-current'] === 'none'
        ? null
        : options['--expected-current'];
    let result;
    if (action === 'prepare')
      result = await manager.prepareRelease(options['--sha']);
    else if (action === 'deploy')
      result = await manager.deploy(
        options['--sha'],
        expected,
        options.rollbackCompatible,
      );
    else if (action === 'rollback')
      result = await manager.rollback(
        options['--sha'],
        expected,
        options.rollbackCompatible,
      );
    else if (action === 'backup') result = await manager.backup();
    else if (action === 'migrate' || action === 'seed')
      result = await manager.database(
        action,
        options['--sha'],
        options['--backup'],
      );
    else if (action === 'status') result = await manager.status();
    else fail('invalid_operation');
    console.log(JSON.stringify({ ok: true, result }));
    return 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        error:
          error instanceof DeploymentError
            ? error.code
            : 'invalid_target_or_operation',
        ...(error.recordId
          ? {
              recordId: error.recordId,
              recordPath: error.recordPath,
              status: error.status,
            }
          : {}),
      }),
    );
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));
