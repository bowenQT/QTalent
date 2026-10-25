import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { prepareReference } from './prepare-reference';
it('materializes only digest-verified baseline bytes and refuses later source drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-reference-'));
  try {
    mkdirSync(join(root, 'tests/fixtures'), { recursive: true });
    mkdirSync(join(root, 'prototype/y'), { recursive: true });
    writeFileSync(
      join(root, 'prototype-reference.json'),
      JSON.stringify({ commit: 'abcdef0' }),
    );
    const bytes = Buffer.from('fixed baseline');
    const sha = createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex');
    writeFileSync(
      join(root, 'tests/fixtures/prototype-manifest.json'),
      JSON.stringify({ files: [{ path: 'prototype/y/test.txt', sha }] }),
    );
    writeFileSync(join(root, 'prototype/y/test.txt'), bytes);
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
