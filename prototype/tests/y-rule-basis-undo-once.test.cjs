'use strict';
// 直接执行版本 Y 的依据移除及其撤销函数，演示资料不会进入真实存储。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = src.match(/  store\.removeBasis = \(kind, i\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '未找到 Y 的 removeBasis');
function setup(basis = [{ type: 'note', text: '演示依据 A' }], sug = null) {
  const draft = { state: 'draft', v: 'v2', basis: basis.slice() };
  const S = { ruleSugs: sug ? [sug] : [] };
  let saves = 0, current = draft;
  const store = { save: () => { saves++; } };
  const NT = { clone: x => JSON.parse(JSON.stringify(x)) };
  vm.runInNewContext(found[0], { store, S, NT, draftOf: () => current }, { filename: 'Y/store.js' });
  return { store, draft, S, changeDraft: d => { current = d; }, get saves() { return saves; } };
}
test('移除依据并撤销一次，原内容恢复', () => {
  const f = setup();
  const undo = f.store.removeBasis('rubric', 0);
  assert.equal(f.draft.basis.length, 0);
  assert.equal(undo(), true);
  assert.equal(f.draft.basis.length, 1);
  assert.equal(f.draft.basis[0].text, '演示依据 A');
});
test('同一个撤销第二次不再追加或保存', () => {
  const f = setup();
  const undo = f.store.removeBasis('rubric', 0);
  undo();
  const saves = f.saves;
  assert.equal(undo(), false);
  assert.equal(f.draft.basis.length, 1);
  assert.equal(f.saves, saves);
});
test('撤销过期旧草稿的操作不能改变新草稿', () => {
  const f = setup();
  const undo = f.store.removeBasis('rubric', 0);
  f.changeDraft({ v: 'v3', state: 'draft', basis: [] });
  assert.equal(undo(), false);
  assert.equal(f.draft.basis.length, 0);
  assert.equal(f.saves, 1);
});
test('建议依据的撤销只恢复本次建议状态一次', () => {
  const sug = { id:'s-demo', state:'adopted', draft:'v2', handledBy:'hr-demo', handledAt:'2026-10-25' };
  const f = setup([{ type:'sug', sug:'s-demo' }], sug);
  const undo = f.store.removeBasis('rubric', 0);
  assert.equal(sug.state, 'open');
  assert.equal(undo(), true);
  assert.equal(sug.state, 'adopted');
  assert.equal(f.draft.basis.length, 1);
  const saves = f.saves;
  assert.equal(undo(), false);
  assert.equal(f.saves, saves);
  assert.equal(f.draft.basis.length, 1);
});
test('两条不同依据分别移除后独立撤销，不产生重复', () => {
  const f = setup([{ type:'note', text:'A' }, { type:'note', text:'B' }]);
  const undoA = f.store.removeBasis('rubric', 0);
  const undoB = f.store.removeBasis('rubric', 0);
  assert.equal(f.draft.basis.length, 0);
  assert.equal(undoB(), true);
  assert.equal(undoA(), true);
  assert.equal(f.draft.basis.length, 2);
  assert.equal(f.draft.basis[0].text, 'A');
  assert.equal(f.draft.basis[1].text, 'B');
});
