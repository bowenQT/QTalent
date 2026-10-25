'use strict';
const assert = require('node:assert/strict');
// 沙箱里返回的数组属于另一个 realm，先转成本地普通值再做深比较。
const plain = (value) => JSON.parse(JSON.stringify(value));
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// 执行版本 Y 的真实函数；使用虚构评价和账号。
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = src.match(/  store\.setReviewEval = \(pid, week, dim, text, from\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '未找到 setReviewEval');
function setup(editable = true) {
  const S = { reviewEvals: {} };
  let saved = 0;
  const store = {
    canEditReview: () => editable,
    me: () => ({ id: 'demo-reviewer' }),
    save: () => { saved++; },
  };
  const NT = { TODAY: '2026-10-25' };
  vm.runInNewContext(found[0], { S, store, NT }, { filename: 'Y/store.js' });
  const history = (pid = 'p-demo', week = 'W8', dim = 'mot') =>
    (S.reviewEvals[pid + '-' + week]?.[dim] || []).map(e => e.text);
  return { store, S, history, get saved() { return saved; } };
}
test('撤销旧评价不覆盖同一维度较新的更新', () => {
  const f = setup();
  const undoOld = f.store.setReviewEval('p-demo', 'W8', 'mot', '旧评价', 'human');
  f.store.setReviewEval('p-demo', 'W8', 'mot', '新评价', 'human');
  undoOld();
  assert.deepEqual(plain(f.history()), ['新评价']);
  assert.equal(f.S.reviewEvals['p-demo-W8'].mot[0].by, 'demo-reviewer');
});
test('先撤销较新评价，再撤销较旧评价', () => {
  const f = setup();
  const undoOld = f.store.setReviewEval('p-demo', 'W8', 'mot', '旧评价', 'human');
  const undoNew = f.store.setReviewEval('p-demo', 'W8', 'mot', '新评价', 'human');
  undoNew();
  assert.deepEqual(plain(f.history()), ['旧评价']);
  undoOld();
  assert.deepEqual(plain(f.history()), []);
});
test('重复撤销操作不会误删其他更新或多次保存', () => {
  const f = setup();
  const undo = f.store.setReviewEval('p-demo', 'W8', 'mot', '旧评价', 'human');
  f.store.setReviewEval('p-demo', 'W8', 'mot', '新评价', 'human');
  undo();
  const saved = f.saved;
  undo();
  assert.deepEqual(plain(f.history()), ['新评价']);
  assert.equal(f.saved, saved);
});
test('其他人、周次和维度的评价历史保持隔离', () => {
  const f = setup();
  const undo = f.store.setReviewEval('p-demo', 'W8', 'mot', '待撤销', 'human');
  f.store.setReviewEval('p-demo', 'W8', 'grit', '坚毅维度', 'human');
  f.store.setReviewEval('p-other', 'W8', 'mot', '另一人', 'human');
  f.store.setReviewEval('p-demo', 'W7', 'mot', '另一周', 'human');
  undo();
  assert.deepEqual(plain(f.history('p-demo', 'W8', 'grit')), ['坚毅维度']);
  assert.deepEqual(plain(f.history('p-other')), ['另一人']);
  assert.deepEqual(plain(f.history('p-demo', 'W7')), ['另一周']);
});
test('编辑权限不足或只有空白文字不产生记录', () => {
  const f = setup(false);
  assert.equal(f.store.setReviewEval('p-demo', 'W8', 'mot', '无权提交', 'human'), null);
  assert.equal(f.saved, 0);
  const e = setup(true);
  assert.equal(e.store.setReviewEval('p-demo', 'W8', 'mot', '   ', 'human'), null);
  assert.equal(e.saved, 0);
});
