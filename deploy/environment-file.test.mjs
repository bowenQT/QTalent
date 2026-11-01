import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseEnvironmentFile,
  loadEnvironmentFiles,
} from './environment-file.mjs';

const cases = [
  ['  # comment\n; comment\n\t\r\n', {}],
  [
    'A=  one two  \r\nEMPTY=\nDUP=first\nDUP=last\n',
    { A: 'one two', EMPTY: '', DUP: 'last' },
  ],
  [
    String.raw`A='$HOME $(touch nowhere) \ literal'` + '\n',
    { A: '$HOME $(touch nowhere) \\ literal' },
  ],
  [
    String.raw`A="$missing $(touch nowhere)"` + '\n',
    { A: '$missing $(touch nowhere)' },
  ],
  [
    String.raw`A="one\q \$two \\ three \"four\""` + '\n',
    { A: 'one\\q $two \\ three "four"' },
  ],
  ['A="one\\\ntwo"\nB=one\\\ntwo\n', { A: 'onetwo', B: 'onetwo' }],
  ['A=\'one\ntwo\'\nB="one\ntwo"\n', { A: 'one\ntwo', B: 'one\ntwo' }],
  [
    String.raw`A=one\ two\ ` + '\nB=one"two\'three # literal\n',
    { A: 'one two ', B: 'one"two\'three # literal' },
  ],
  ['A=\'\'\nB=""\nC=at-eof', { A: '', B: '', C: 'at-eof' }],
];
for (const [index, [source, expected]] of cases.entries())
  test(`EnvironmentFile literal subset case ${index}`, () => {
    assert.deepEqual({ ...parseEnvironmentFile(source) }, expected);
  });
test('rejects unsupported syntax and malformed text without values in errors', () => {
  for (const source of [
    'export KEY=value',
    'invalid',
    'A="unfinished',
    "A='unfinished",
    'A=unfinished\\',
    'A="x"suffix',
    'A="x" # comment',
    'A=\0',
    'A=\ufeff',
    'A=\ufdd0',
    'A=\uffff',
    'A=\ud800',
  ]) {
    assert.throws(() => parseEnvironmentFile(source), {
      message: 'invalid_environment_file',
    });
  }
});
function files() {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-literal-env-'));
  const common = join(root, 'common.env'),
    role = join(root, 'role.env');
  writeFileSync(
    common,
    'LITERAL="synthetic$missing $(touch never)"\nREPLACED=common\n',
    { mode: 0o600 },
  );
  writeFileSync(role, "REPLACED='role'\n", { mode: 0o600 });
  return { root, common, role };
}
test('loads private files in systemd order and preserves inherited process values', () => {
  const f = files();
  try {
    const actual = loadEnvironmentFiles([f.common, f.role], {
      INHERITED: 'kept',
    });
    assert.deepEqual(actual, {
      INHERITED: 'kept',
      LITERAL: 'synthetic$missing $(touch never)',
      REPLACED: 'role',
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('refuses insecure, symlinked, absent, oversized and invalid UTF-8 environment files', () => {
  const f = files();
  try {
    chmodSync(f.role, 0o640);
    assert.throws(() => loadEnvironmentFiles([f.common, f.role], {}), {
      message: 'insecure_env_file',
    });
    rmSync(f.role);
    symlinkSync(f.common, f.role);
    assert.throws(() => loadEnvironmentFiles([f.common, f.role], {}), {
      message: 'invalid_environment_file',
    });
    rmSync(f.role);
    assert.throws(() => loadEnvironmentFiles([f.common, f.role], {}), {
      message: 'invalid_environment_file',
    });
    for (const bad of [
      Buffer.from([0xc3, 0x28]),
      Buffer.from('\ufeffKEY=value'),
      Buffer.alloc(1048577, 65),
    ]) {
      writeFileSync(f.role, bad, { mode: 0o600 });
      assert.throws(() => loadEnvironmentFiles([f.common, f.role], {}), {
        message: 'invalid_environment_file',
      });
    }
    rmSync(f.role);
    mkdirSync(f.role, { mode: 0o700 });
    assert.throws(() => loadEnvironmentFiles([f.common, f.role], {}), {
      message: 'insecure_env_file',
    });
    for (const paths of [null, [], [f.common], [f.common, 'relative']])
      assert.throws(() => loadEnvironmentFiles(paths, {}), {
        message: 'invalid_environment_file',
      });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('standalone helper never logs literal secret values on parse or identity failure', () => {
  const f = files();
  try {
    writeFileSync(f.role, 'bad syntax synthetic-secret-must-not-appear\n', {
      mode: 0o600,
    });
    const script = fileURLToPath(new URL('./app-command.mjs', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        script,
        JSON.stringify({ envFiles: [f.common, f.role] }),
        'validate',
        '/bin/unused',
      ],
      { env: {}, encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('accepted literal fixture matches the target-systemd conformance oracle', () => {
  const source = readFileSync(
    new URL('./fixtures/environment-literals.txt', import.meta.url),
    'utf8',
  );
  const expected = JSON.parse(
    readFileSync(
      new URL('./fixtures/environment-literals.expected.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual({ ...parseEnvironmentFile(source) }, expected);
});

test('recorded systemd conformance proof matches the exact accepted fixture bytes', () => {
  const source = readFileSync(
    new URL('./fixtures/environment-literals.txt', import.meta.url),
  );
  const expected = JSON.parse(
    readFileSync(
      new URL('./fixtures/environment-literals.expected.json', import.meta.url),
      'utf8',
    ),
  );
  const proof = JSON.parse(
    readFileSync(
      new URL('./fixtures/systemd-environment-proof.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    proof.sourceSha256,
  );
  const canonical = Object.entries(expected).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  assert.equal(
    createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    proof.digest,
  );
  assert.equal(proof.unitCollected, true);
  assert.equal(proof.formalServicePidsUnchanged, true);
});
