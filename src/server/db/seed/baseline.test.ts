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
it('loads only the two pinned sources and never executes store.js', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-evidence-seed-'));
  try {
    const destination = join(root, '.reference-cache/prototype/y/app/js');
    mkdirSync(destination, { recursive: true });
    cpSync(
      join(process.cwd(), 'prototype-reference.json'),
      join(root, 'prototype-reference.json'),
    );
    for (const file of ['data-xe6.js', 'data.js'])
      cpSync(
        join(process.cwd(), '.reference-cache/prototype/y/app/js', file),
        join(destination, file),
      );
    writeFileSync(
      join(destination, 'store.js'),
      'throw new Error("store execution is forbidden")',
    );
    expect(readPrototypeSeed(root).EVENTS.length).toBeGreaterThan(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
