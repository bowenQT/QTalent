'use strict';
// 直接执行版本 Y 真实的规则建议采纳函数；仅虚构 HR、建议和草稿。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = src.match(/  store\.handleRuleSug = \(id, ok, why\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '未找到 Y 的 handleRuleSug');
function setup(initial = 'open', allowed = true) {
  const suggestion = { id: 's-demo', state: initial, rule: 'rubric', by: 'mentor-demo' };
  const draft = { v: 'v2', state: 'draft', basis: [] };
  const S = { ruleSugs: [suggestion] };
  let saves = 0;
  const store = {
    startDraft: () => draft, me: () => ({ id: 'hr-demo' }),
    save: () => { saves++; },
  };
  const NT = { TODAY: '2026-10-25' };
  vm.runInNewContext(found[0], { store, S, NT, isHrbp: () => allowed }, { filename: 'Y/store.js' });
  return { store, S, draft, suggestion, get saves() { return saves; } };
}
test('正常纳入一次只增加一条建议依据', () => {
  const f = setup();
  assert.ok(f.store.handleRuleSug('s-demo', true));
  assert.equal(f.draft.basis.length, 1);
  assert.equal(f.draft.basis[0].sug, 's-demo');
  assert.equal(f.suggestion.state, 'adopted');
  assert.equal(f.saves, 1);
});
test('同一已采纳建议重复纳入不会增加依据和保存', () => {
  const f = setup();
  f.store.handleRuleSug('s-demo', true);
  assert.equal(f.store.handleRuleSug('s-demo', true), null);
  assert.equal(f.draft.basis.length, 1);
  assert.equal(f.saves, 1);
});
test('已拒绝建议不能跳过重新打开直接再次采纳', () => {
  const f = setup('rejected');
  assert.equal(f.store.handleRuleSug('s-demo', true), null);
  assert.equal(f.draft.basis.length, 0);
  assert.equal(f.suggestion.state, 'rejected');
  assert.equal(f.saves, 0);
});
test('已有同一建议依据但状态异常为 open 时不得追加第二份', () => {
  const f = setup();
  f.draft.basis.push({ type: 'sug', sug: 's-demo' });
  assert.equal(f.store.handleRuleSug('s-demo', true), null);
  assert.equal(f.draft.basis.length, 1);
  assert.equal(f.saves, 0);
});
test('无审批权限时不能采纳开放建议', () => {
  const f = setup('open', false);
  assert.equal(f.store.handleRuleSug('s-demo', true), null);
  assert.equal(f.draft.basis.length, 0);
  assert.equal(f.saves, 0);
});
test('拒绝一条开放建议正常，重复拒绝不覆盖处理理由', () => {
  const f = setup();
  f.store.handleRuleSug('s-demo', false, '事实尚不充分');
  assert.equal(f.suggestion.state, 'rejected');
  assert.equal(f.suggestion.why, '事实尚不充分');
  assert.equal(f.store.handleRuleSug('s-demo', false, '不同理由'), null);
  assert.equal(f.suggestion.why, '事实尚不充分');
  assert.equal(f.saves, 1);
});
