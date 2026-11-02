import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { buildScene } from './scene.mjs';
import { createSeedInput } from './seed-input.mjs';

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
