'use strict';
// 版本 Y 真实 store.keepFormal 回归：所有人员/快照均为虚构数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const method = source.match(/  store\.keepFormal = \(pid, why\) => \{[\s\S]*?\n  \};/);
assert.ok(method, '缺少版本 Y store.keepFormal');
function setup() {
  const S = { recalKeeps: {} };
  let role = 'hrbp', saves = 0, currentQ = 'hh';
  const store = {
    formal: () => ({ q:'ll', snap:{ id:'snap-demo' } }),
    refPos: () => ({ q:currentQ, na:false }),
    can: what => what === 'calibrate' && role === 'hrbp',
    me: () => ({ id:'hr-demo' }),
    save: () => { saves++; },
  };
  const NT = { TODAY:'2026-10-26' };
  const snapKey = f => f.snap.id;
  vm.runInNewContext(method[0], { S, store, NT, snapKey }, { filename:'prototype/y/app/js/store.js' });
  return { S,store,setRole:x=>{role=x;},setQ:x=>{currentQ=x;},get saves(){return saves;} };
}
test('首次保持正式位置保存理由、快照和署名', () => {
  const f=setup(); const undo=f.store.keepFormal('p-demo','第一次');
  assert.equal(typeof undo,'function');
  assert.equal(f.S.recalKeeps['p-demo'].why,'第一次');
  assert.equal(f.S.recalKeeps['p-demo'].snap,'snap-demo');
  assert.equal(f.S.recalKeeps['p-demo'].by,'hr-demo');
  assert.equal(f.saves,1);
});
test('正常撤销仅删除本次决定', () => {
  const f=setup(),undo=f.store.keepFormal('p-demo','第一次');
  assert.equal(undo(),true);
  assert.equal(f.S.recalKeeps['p-demo'],undefined);
  assert.equal(f.saves,2);
});
test('撤销较早决定不能删除后来的新决定', () => {
  const f=setup(),old=f.store.keepFormal('p-demo','旧决定');
  f.store.keepFormal('p-demo','新决定');
  assert.equal(old(),false);
  assert.equal(f.S.recalKeeps['p-demo'].why,'新决定');
  assert.equal(f.saves,2);
});
test('撤销最新决定后可恢复之前决定，旧决定仍能被撤销', () => {
  const f=setup(),old=f.store.keepFormal('p-demo','旧决定');
  const latest=f.store.keepFormal('p-demo','新决定');
  assert.equal(latest(),true);
  assert.equal(f.S.recalKeeps['p-demo'].why,'旧决定');
  assert.equal(old(),true);
  assert.equal(f.S.recalKeeps['p-demo'],undefined);
  assert.equal(f.saves,4);
});
test('权限被收回时旧撤销不得修改 HR 决定', () => {
  const f=setup(),undo=f.store.keepFormal('p-demo','正式决定');
  f.setRole('lead');
  assert.equal(undo(),false);
  assert.equal(f.S.recalKeeps['p-demo'].why,'正式决定');
  assert.equal(f.saves,1);
});
test('同一撤销重复执行不会二次保存', () => {
  const f=setup(),undo=f.store.keepFormal('p-demo','正式决定');
  assert.equal(undo(),true);
  assert.equal(undo(),false);
  assert.equal(f.saves,2);
});
test('无理由或参考位置未变化时不写入', () => {
  const f=setup();
  assert.equal(f.store.keepFormal('p-demo',''),null);
  f.setQ('ll');
  assert.equal(f.store.keepFormal('p-demo','无变化'),null);
  assert.equal(f.saves,0);
});
test('不同人员的保持正式位置相互独立', () => {
  const f=setup(),undo=f.store.keepFormal('p-demo','甲');
  f.store.keepFormal('p-other','乙');
  assert.equal(undo(),true);
  assert.equal(f.S.recalKeeps['p-other'].why,'乙');
  assert.equal(f.saves,3);
});
test('队列页把撤销结果如实交给 Toast：失败时显示肯定式的失败文案，不再另弹提示', () => {
  const page = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/queue.js'), 'utf8');
  const call = page.match(/NT\.toast\(`已保持\$\{st\.person\(pid\)\.name\}的正式位置[\s\S]*?\n    \}\);/);
  assert.ok(call, '缺少保持正式位置的 Toast');
  // 取出真实的 undo 包装，确认它把 keepFormal 返回的撤销结果原样交回 Toast（#283：返回 false 显示失败）
  const undoSrc = call[0].match(/undo: (\(\) => \{[^}]*\})/)[1];
  let rendered = 0;
  const wrap = (inner) => vm.runInNewContext(undoSrc, { undo: inner, render: () => { rendered++; }, $: () => null });
  assert.equal(wrap(() => false)(), false, '撤销失败时返回 false');
  assert.equal(wrap(() => true)(), true);
  assert.equal(rendered, 2, '成功和失败都刷新队列');
  const fail = call[0].match(/failText: '([^']+)'/)[1];
  assert.match(fail, /^撤销失败：.*已保留/);
  assert.doesNotMatch(fail, /不能|无权限|没有/);
  assert.equal((call[0].match(/NT\.toast\(/g) || []).length, 1, '失败时不另弹一个 Toast');
});
