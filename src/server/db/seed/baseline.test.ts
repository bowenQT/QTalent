import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readPrototypeSeed } from './index';
it('refuses edited prototype data before evaluating it', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-seed-'));
  try {
    mkdirSync(join(root, '.reference-cache/prototype/y/app/js'), {
      recursive: true,
    });
    cpSync(
      join(process.cwd(), 'prototype-reference.json'),
      join(root, 'prototype-reference.json'),
    );
    writeFileSync(
      join(root, '.reference-cache/prototype/y/app/js/data-xe6.js'),
      'throw new Error("must not run")',
    );
    expect(() => readPrototypeSeed(root)).toThrow(/source digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
