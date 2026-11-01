import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { EVIDENCE_SOURCES } from './evidence';
import { readPrototypeSeed, mapPrototypeSeed } from './index';

it('refuses edited immutable evidence before evaluating it', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-seed-'));
  try {
    mkdirSync(join(root, '.reference-cache/evidence/prototype/y/app/js'), {
      recursive: true,
    });
    writeFileSync(
      join(root, '.reference-cache/evidence/prototype/y/app/js/data-xe6.js'),
      'throw new Error("must not run")',
    );
    expect(() => readPrototypeSeed(root)).toThrow(/source digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps seed mapping and source identity independent of visual data and reference', () => {
  const root = mkdtempSync(join(tmpdir(), 'qtalent-seed-visual-'));
  try {
    for (const source of Object.values(EVIDENCE_SOURCES)) {
      const destination = join(root, '.reference-cache/evidence', source.path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(
        join(process.cwd(), '.reference-cache/evidence', source.path),
        destination,
      );
      const visual = join(root, '.reference-cache', source.path);
      mkdirSync(dirname(visual), { recursive: true });
      writeFileSync(
        visual,
        'throw new Error("visual source must not execute")',
      );
    }
    writeFileSync(
      join(root, 'prototype-reference.json'),
      JSON.stringify({ commit: '81e4fd448f11d6c515bf447a81e85606d7b239ff' }),
    );
    const baseline = readPrototypeSeed(process.cwd());
    const actual = readPrototypeSeed(root);
    expect(actual).toEqual(baseline);
    expect(mapPrototypeSeed(actual)).toEqual(mapPrototypeSeed(baseline));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
