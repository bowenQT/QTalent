import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { EVIDENCE_SOURCES } from '../src/server/db/seed/evidence';
import { prepareReference } from './prepare-reference';

function visualSnapshot(root: string, bytes = Buffer.from('fixed baseline')) {
  mkdirSync(join(root, 'tests/fixtures'), { recursive: true });
  mkdirSync(join(root, 'prototype/y'), { recursive: true });
  writeFileSync(
    join(root, 'prototype-reference.json'),
    JSON.stringify({ commit: 'abcdef0' }),
  );
  const sha = createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
  writeFileSync(
    join(root, 'tests/fixtures/prototype-manifest.json'),
    JSON.stringify({ files: [{ path: 'prototype/y/test.txt', sha }] }),
  );
  writeFileSync(join(root, 'prototype/y/test.txt'), bytes);
}

function evidenceSnapshot(root: string) {
  for (const source of Object.values(EVIDENCE_SOURCES)) {
    const destination = join(root, '.reference-cache/evidence', source.path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(
      join(process.cwd(), '.reference-cache/evidence', source.path),
      destination,
    );
  }
}

it('materializes only digest-verified baseline bytes and refuses later source drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-reference-'));
  try {
    visualSnapshot(root);
    evidenceSnapshot(root);
    expect(prepareReference(root, true)).toBe(1);
    writeFileSync(join(root, 'prototype/y/test.txt'), 'changed working tree');
    expect(
      readFileSync(join(root, '.reference-cache/prototype/y/test.txt'), 'utf8'),
    ).toBe('fixed baseline');
    expect(() => prepareReference(root, true)).toThrow('digest mismatch');
    writeFileSync(
      join(root, 'prototype-reference.json'),
      JSON.stringify({ commit: 'main' }),
    );
    expect(() => prepareReference(root, true)).toThrow('fixed Git commit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('checks immutable evidence before publishing a newer visual cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-reference-evidence-'));
  try {
    visualSnapshot(root);
    evidenceSnapshot(root);
    prepareReference(root, true);
    visualSnapshot(root, Buffer.from('new visual baseline'));
    writeFileSync(
      join(root, '.reference-cache/evidence', EVIDENCE_SOURCES['data.js'].path),
      'throw new Error("tampered evidence must not execute")',
    );
    expect(() => prepareReference(root, true)).toThrow(
      /evidence.*digest mismatch/i,
    );
    expect(
      readFileSync(join(root, '.reference-cache/prototype/y/test.txt'), 'utf8'),
    ).toBe('fixed baseline');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('does not substitute visual bytes when a verified evidence snapshot is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-reference-missing-'));
  try {
    visualSnapshot(root);
    expect(() => prepareReference(root, true)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
