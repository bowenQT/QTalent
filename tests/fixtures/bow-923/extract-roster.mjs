import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import * as prettier from 'prettier';

const [repo, outputDir] = process.argv.slice(2);
assert(repo && outputDir, 'usage: node extract-roster.mjs <repo> <output-dir>');
// Prototype Y data on main after the graduation reviewer (s-29) was added.
export const PROTOTYPE_COMMIT = '81e4fd448f11d6c515bf447a81e85606d7b239ff';
const paths = ['prototype/y/app/js/data-xe6.js', 'prototype/y/app/js/data.js'];
const texts = paths.map((file) =>
  execFileSync('git', ['-C', repo, 'show', `${PROTOTYPE_COMMIT}:${file}`], {
    encoding: 'utf8',
  }),
);
const window = { NT: { clone: structuredClone } };
const context = vm.createContext({ window });
for (const text of texts) vm.runInContext(text, context, { timeout: 1000 });
const xe6 = window.NT.XE6;
const seed = window.NT.SEED;
assert(xe6 && seed, 'pinned prototype did not expose expected demo directory');
const judge = seed.JUDGE;
const batch = judge.batches.find((entry) => entry.id === 'jr-xe6');
assert(batch, 'pinned prototype lacks the sixth-cohort comparison batch');
const rows = new Map(judge.xe['jr-xe6'].rows.map((row) => [row.person, row]));

const students = xe6.students.map(({ id, name }) => ({
  id,
  name: `${name}（演示）`,
}));
assert.equal(students.length, 93);
assert.equal(new Set(students.map(({ id }) => id)).size, 93);

// Only identities, original bands, reviewers, team flags and the HR mark.
// Prototype comments are not copied; the fixture writes its own excerpts.
const judgments = students.map(({ id }) => {
  const row = rows.get(id);
  const front = row?.front
    ? {
        evaluatorId: row.front.by,
        grade: row.front.grade,
        items: [...row.front.items],
        team: row.front.team,
      }
    : null;
  const back = row?.back?.grade
    ? { evaluatorId: row.back.by, grade: row.back.grade }
    : null;
  return { personId: id, front, back };
});
const marks = Object.entries(judge.marks).map(([caseId, mark]) => {
  const [batchId, personId, dimension] = caseId.split(':');
  assert(batchId === 'jr-xe6' && dimension === 'overall');
  return { personId, reason: mark.reason, markedBy: mark.by, date: mark.at };
});
const onlyDate = (side) => {
  const dates = new Set(
    [...rows.values()].flatMap((row) =>
      row[side]?.grade ? [row[side].at] : [],
    ),
  );
  assert.equal(dates.size, 1, `${side} judgments must share one review date`);
  return [...dates][0];
};
const chain = judge.chains.find((entry) => entry.id === 'xe');
const map = judge.maps.find((entry) => entry.id === batch.map);
const standard = judge.stds.find((entry) => entry.id === 'xe-select-v1');
const rule = seed.RULES.front.find((entry) => entry.v === 'xe-select-v1');
const reviewers = new Set([
  'p-suwan',
  ...judgments.flatMap(({ front, back }) =>
    [front?.evaluatorId, back?.evaluatorId].filter(Boolean),
  ),
]);
const directory = [...reviewers].sort().map((id) => {
  const person = seed.PEOPLE.find((entry) => entry.id === id);
  assert(person, `demo staff absent from directory: ${id}`);
  return { id, name: `${person.name}（演示）` };
});
assert(
  [...students, ...directory].every(
    ({ id, name }) => typeof id === 'string' && name.endsWith('（演示）'),
  ),
);
assert.equal(seed.ROLES.hrbp.person, 'p-suwan');

const provenance = {
  commit: PROTOTYPE_COMMIT,
  files: paths.map((file, index) => ({
    path: file,
    blob: execFileSync(
      'git',
      ['-C', repo, 'rev-parse', `${PROTOTYPE_COMMIT}:${file}`],
      { encoding: 'utf8' },
    ).trim(),
    sha256: createHash('sha256').update(texts[index]).digest('hex'),
  })),
};
const roster = {
  demo: true,
  provenance: {
    ...provenance,
    fieldsCopied: ['person.id', 'person.name'],
    excluded: '未复制原型里的评语、学校、联系方式或其他人员属性。',
  },
  students,
  directory,
};
const prototypeJudgments = {
  demo: true,
  provenance: {
    ...provenance,
    source: 'NT.SEED.JUDGE（jr-xe6）与 NT.SEED.RULES.front',
    fieldsCopied: [
      'front.by/grade/items/team',
      'back.by/grade',
      'marks.reason/by/at',
      'chain grades',
      'map/std dates',
    ],
    excluded: '未复制原型的前后段评语；夹具另写「演示重建」摘录。',
  },
  scale: {
    front: [...chain.grades],
    back: [...chain.backGrades],
    items: chain.items.map((title) => title),
  },
  dates: {
    standardEffective: rule.effAt,
    standard: standard.at,
    mapping: map.at,
    mappingConfirmedBy: map.by,
    front: onlyDate('front'),
    back: onlyDate('back'),
  },
  judgments,
  marks,
};
for (const { front, back } of judgments) {
  assert(
    !front || (front.grade && front.evaluatorId && front.items.length === 3),
  );
  assert(!back || chain.backGrades.includes(back.grade));
}
const prettierOptions = await prettier.resolveConfig(
  new URL('./roster.json', import.meta.url),
);
const writeJson = async (name, value) =>
  fs.writeFile(
    path.join(outputDir, name),
    await prettier.format(JSON.stringify(value), {
      ...prettierOptions,
      filepath: name,
    }),
  );
await fs.mkdir(outputDir, { recursive: true });
await writeJson('roster.json', roster);
await writeJson('prototype-judgments.json', prototypeJudgments);
console.log(
  JSON.stringify({
    students: students.length,
    directory: directory.length,
    commit: PROTOTYPE_COMMIT,
  }),
);
