import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const [repo, output] = process.argv.slice(2);
assert(repo && output, 'usage: node extract-roster.mjs <repo> <output.json>');
const commit = '451ecec0106344cac2e4225a363b5fd3cae92584';
const paths = ['prototype/y/app/js/data-xe6.js', 'prototype/y/app/js/data.js'];
const texts = paths.map((file) =>
  execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`], {
    encoding: 'utf8',
  }),
);
const window = { NT: { clone: structuredClone } };
const context = vm.createContext({ window });
for (const text of texts) vm.runInContext(text, context, { timeout: 1000 });
const xe6 = window.NT.XE6;
const seed = window.NT.SEED;
assert(xe6 && seed, 'pinned prototype did not expose expected demo directory');
const students = xe6.students.map(({ id, name }) => ({
  id,
  name: `${name}（演示）`,
}));
const staffIds = ['p-suwan', 'p-yeqing', 's-01', 's-04', 's-28'];
const directory = staffIds.map((id) => {
  const person = seed.PEOPLE.find((entry) => entry.id === id);
  assert(person, `demo staff absent from directory: ${id}`);
  return { id, name: `${person.name}（演示）` };
});
assert.equal(students.length, 93);
assert.equal(new Set(students.map(({ id }) => id)).size, 93);
assert(
  students.every(
    ({ id, name }) => typeof id === 'string' && name.endsWith('（演示）'),
  ),
);
const roster = {
  demo: true,
  provenance: {
    commit,
    fieldsCopied: ['person.id', 'person.name'],
    excluded: '未复制快照里的评语、评审档位、学校、联系方式或其他人员属性。',
    files: paths.map((file, index) => ({
      path: file,
      blob: execFileSync(
        'git',
        ['-C', repo, 'rev-parse', `${commit}:${file}`],
        { encoding: 'utf8' },
      ).trim(),
      sha256: createHash('sha256').update(texts[index]).digest('hex'),
    })),
  },
  students,
  directory,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(roster, null, 2)}\n`);
console.log(
  JSON.stringify({ students: students.length, staff: directory, commit }),
);
