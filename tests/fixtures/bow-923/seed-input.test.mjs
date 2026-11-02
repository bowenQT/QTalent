import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedIdentities } from './identities.mjs';
import { buildScene } from './scene.mjs';
import { createSeedInput } from './seed-input.mjs';

const here = fileURLToPath(new URL('./', import.meta.url));
const readJson = async (name) =>
  JSON.parse(await fs.readFile(path.join(here, name), 'utf8'));

test('regenerates exact seed facts while refusing to read any expected/computed outcome', async () => {
  const scene = await buildScene();
  Object.defineProperty(scene, 'expected', {
    get() {
      throw new Error('expected data must not feed input');
    },
  });
  for (const unit of scene.cases) {
    Object.defineProperty(unit, 'outcome', {
      enumerable: true,
      get() {
        throw new Error('computed outcome must not feed input');
      },
    });
  }
  const result = createSeedInput(scene);
  const committed = JSON.parse(
    await fs.readFile(new URL('./seed-input.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(result, committed);
  assert.equal(result.fixtureVersion, 'bow-923-v3');
  assert.equal(result.manualComparabilityMarks.length, 1);
  assert(result.cases.every((unit) => !('outcome' in unit)));
  assert(!('counts' in result));
  assert(!('distribution' in result));
});

test('a new generation reuses no identity it owns, so it imports beside the previous one', async () => {
  const previous = await readJson('superseded-identities.json');
  const current = seedIdentities(await readJson('seed-input.json'));
  assert.notEqual(previous.fixtureVersion, current.fixtureVersion);
  assert.deepEqual(Object.keys(current.owned), Object.keys(previous.owned));
  for (const [kind, ids] of Object.entries(current.owned)) {
    assert(ids.length > 0, `no ${kind} identities found`);
    const reused = ids.filter((id) => previous.owned[kind].includes(id));
    assert.deepEqual(reused, [], `${kind} identities reused`);
  }
  // Shared directory/rule facts may be pointed at again, but not renamed.
  for (const [kind, names] of Object.entries(current.shared))
    for (const [id, name] of Object.entries(names))
      if (id in previous.shared[kind])
        assert.equal(name, previous.shared[kind][id], `${kind} ${id} renamed`);
});

test('step two builds from the extract directory it is given, not the committed copies', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bow-923-extract-'));
  try {
    const roster = await readJson('roster.json');
    roster.students[0].name = '改名测试（演示）';
    await fs.writeFile(path.join(dir, 'roster.json'), JSON.stringify(roster));
    await fs.copyFile(
      path.join(here, 'prototype-judgments.json'),
      path.join(dir, 'prototype-judgments.json'),
    );
    const scene = await buildScene(pathToFileURL(dir + '/'));
    assert.equal(scene.cases[0].person.name, '改名测试（演示）');
    assert.equal(scene.frontRows[0][1], '改名测试（演示）');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('extracting the pinned prototype and building from it reproduces every committed file', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'bow-923-rebuild-'));
  const [extract, output, qa] = ['extract', 'output', 'qa'].map((name) =>
    path.join(work, name),
  );
  const repo = path.resolve(here, '../../..');
  try {
    execFileSync(process.execPath, [
      path.join(here, 'extract-roster.mjs'),
      repo,
      extract,
    ]);
    execFileSync(process.execPath, [
      path.join(here, 'build-workbooks.mjs'),
      extract,
      output,
      qa,
    ]);
    for (const name of await fs.readdir(extract))
      assert(
        (await fs.readFile(path.join(extract, name))).equals(
          await fs.readFile(path.join(here, name)),
        ),
        `extracted ${name} differs from the committed copy`,
      );
    const built = await fs.readdir(output);
    assert(built.length >= 14);
    for (const name of built)
      assert(
        (await fs.readFile(path.join(output, name))).equals(
          await fs.readFile(path.join(here, name)),
        ),
        `rebuilt ${name} differs from the committed file`,
      );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});
