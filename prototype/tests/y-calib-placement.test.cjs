'use strict';

// 校准页落位：HR 未冻结的拖动留在本页草稿里；重新给出参考位置才回到参考点。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/calibrate.js'), 'utf8');
const match = src.match(/function placement\(x, opt\) \{[\s\S]*?\n  \}/);
assert.ok(match, '找不到 placement');
const placement = vm.runInNewContext(`(${match[0]})`);

const ref = [0.2, 0.8];
const person = { ref };

test('未冻结的草稿优先于参考位置', () => {
  const draft = { pos: [0.8, 0.2], reason: '演示：这季度带人更明显' };
  const next = placement(person, { draft });
  assert.deepEqual(next.pos, [0.8, 0.2]);
  assert.equal(next.reason, '演示：这季度带人更明显');
  next.pos[0] = 0;
  assert.equal(draft.pos[0], 0.8);
});

test('重新给出参考位置时忽略草稿', () => {
  const next = placement(person, { forceRef: true, draft: { pos: [0.9, 0.1], reason: '先放下' } });
  assert.deepEqual(next.pos, ref);
  assert.equal(next.reason, '');
});

test('不能确认的人在没有草稿时回到自己的建议', () => {
  const next = placement(person, { forceRef: true, mine: true, sug: { pos: [0.7, 0.3], reason: '建议偏高潜' } });
  assert.deepEqual(next.pos, [0.7, 0.3]);
  assert.equal(next.reason, '建议偏高潜');
});

test('没有草稿也没有自己的建议时用参考位置', () => {
  const next = placement(person, { sug: { pos: [0.7, 0.3], reason: '别人的建议' } });
  assert.deepEqual(next.pos, ref);
  assert.equal(next.reason, '');
});

test('重绘会读草稿，重置会清当前团队，确认后不再沿用草稿', () => {
  assert.match(src, /placement\(\{ ref \}, \{ draft: draftOf\(pid\), sug: sugs\[pid\] \}\)/);
  assert.match(src, /if \(forceRef\) forgetTeam\(\)/);
  assert.match(src, /function keep\(x\) \{\n    remember\(x\);/);
  assert.match(src, /forgetTeam\(\);\n    st\.save\(\)/);
  assert.match(src, /intro\(true\)/);
});
