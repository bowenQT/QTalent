'use strict';
// 用版本 Y 真正的 confirmReview 方法验证复盘确认前置条件，无真实员工数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const file = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = file.match(/  store\.confirmReview = \(pid, week\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '找不到版本 Y 的真实 confirmReview');
function setup(initial = {}) {
  const S = { reviews: {} };
  let allowed = initial.allowed ?? true;
  let ai = initial.ai ?? 0;
  let conflicts = initial.conflicts ?? 0;
  let saves = 0;
  let role = initial.role ?? 'mentor-demo';
  const store = {
    canEditReview: () => allowed,
    review: (pid, week) => {
      const key = pid + '-' + week;
      return { key, state: S.reviews[key]?.state || 'draft', ai, conflicts, total: 2 };
    },
    me: () => ({ id: role }),
    save: () => { saves++; },
  };
  const NT = { TODAY:'2026-10-25' };
  vm.runInNewContext(found[0], { store, S, NT }, { filename:'Y/store.js' });
  return {
    store, S,
    setAllowed: x => { allowed = x; },
    setAi: x => { ai = x; },
    setConflicts: x => { conflicts = x; },
    get saves() { return saves; },
  };
}
test('正常导师在全部确认后可以完成整份复盘并署名', () => {
  const f = setup();
  const result = f.store.confirmReview('p-demo','W8');
  assert.equal(result.state, 'confirmed');
  assert.equal(result.by, 'mentor-demo');
  assert.equal(f.S.reviews['p-demo-W8'].at,'2026-10-25');
  assert.equal(f.saves, 1);
});
test('无编辑权限不能确认复盘', () => {
  const f = setup({ allowed:false });
  assert.equal(f.store.confirmReview('p-demo','W8'),null);
  assert.equal(f.S.reviews['p-demo-W8'],undefined);
  assert.equal(f.saves,0);
});
test('存在 AI 待确认项时不能确认复盘', () => {
  const f = setup({ ai:2 });
  assert.equal(f.store.confirmReview('p-demo','W8'),null);
  assert.equal(f.S.reviews['p-demo-W8'],undefined);
  assert.equal(f.saves,0);
});
test('存在待校准冲突时不能确认复盘', () => {
  const f = setup({ conflicts:1 });
  assert.equal(f.store.confirmReview('p-demo','W8'),null);
  assert.equal(f.S.reviews['p-demo-W8'],undefined);
  assert.equal(f.saves,0);
});
test('页面渲染之后新增冲突或取消权限，提交时必须重新检查', () => {
  const f = setup();
  f.setConflicts(1);
  assert.equal(f.store.confirmReview('p-demo','W8'),null);
  f.setConflicts(0);
  f.setAllowed(false);
  assert.equal(f.store.confirmReview('p-demo','W8'),null);
  assert.equal(f.saves,0);
});
test('已确认复盘重复提交不改签名也不额外保存', () => {
  const f = setup();
  f.store.confirmReview('p-demo','W8');
  const old = f.S.reviews['p-demo-W8'];
  assert.equal(f.store.confirmReview('p-demo','W8'),null);
  assert.equal(f.S.reviews['p-demo-W8'],old);
  assert.equal(f.saves,1);
});
test('各人和周次的确认互相独立', () => {
  const f = setup();
  f.store.confirmReview('p-demo','W8');
  f.store.confirmReview('p-demo','W7');
  f.store.confirmReview('p-other','W8');
  assert.equal(Object.keys(f.S.reviews).length,3);
  assert.equal(f.saves,3);
});
