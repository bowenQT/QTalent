'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// 执行版本 Y 的真实函数；数据与用户身份均为虚构。
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = src.match(/  store\.setNodeRetro = \(key, good, improve, from\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '未找到 setNodeRetro');
function setup() {
  const S = { nodeRetros: {} };
  let saved = 0;
  const store = { me: () => ({ id: 'demo-hr' }), save: () => { saved++; } };
  const NT = { TODAY: '2026-10-25' };
  vm.runInNewContext(found[0], { S, store, NT }, { filename: 'Y/store.js' });
  const history = key => (S.nodeRetros[key] || []).map(e => e.good[0]);
  return { S, store, history, get saved() { return saved; } };
}
test('撤销早期复盘不误删后续保存的记录', () => {
  const f = setup();
  const undoOld = f.store.setNodeRetro('pg:n1', ['旧复盘'], [], 'manual');
  f.store.setNodeRetro('pg:n1', ['新复盘'], [], 'manual');
  undoOld();
  assert.deepEqual(f.history('pg:n1'), ['新复盘']);
});
test('倒序撤销各自记录，最后清理空节点键', () => {
  const f = setup();
  const undoOld = f.store.setNodeRetro('pg:n1', ['旧复盘'], [], 'manual');
  const undoNew = f.store.setNodeRetro('pg:n1', ['新复盘'], [], 'manual');
  undoNew();
  assert.deepEqual(f.history('pg:n1'), ['旧复盘']);
  undoOld();
  assert.equal(Object.hasOwn(f.S.nodeRetros, 'pg:n1'), false);
});
test('同一撤销两次不会影响新复盘或多次保存', () => {
  const f = setup();
  const undo = f.store.setNodeRetro('pg:n1', ['旧复盘'], [], 'manual');
  f.store.setNodeRetro('pg:n1', ['新复盘'], [], 'manual');
  undo();
  const before = f.saved;
  undo();
  assert.equal(f.saved, before);
  assert.deepEqual(f.history('pg:n1'), ['新复盘']);
});
test('不同节点的历史不被其他节点撤销误伤', () => {
  const f = setup();
  const undo = f.store.setNodeRetro('pg:n1', ['A'], [], 'manual');
  f.store.setNodeRetro('pg:n2', ['B'], [], 'manual');
  undo();
  assert.deepEqual(f.history('pg:n2'), ['B']);
  assert.equal(Object.hasOwn(f.S.nodeRetros, 'pg:n1'), false);
});
