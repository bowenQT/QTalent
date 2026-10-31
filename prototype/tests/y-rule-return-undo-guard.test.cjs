'use strict';
// 执行版本 Y 真实 returnDraft；全部是虚构规则及角色。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const method = source.match(/  store\.returnDraft = \(kind, why, line\) => \{[\s\S]*?\n  \};/);
assert.ok(method, '找不到真实 returnDraft');
function setup() {
  let role='ceo', saves=0;
  const d={v:'rule-v2',state:'pending',why:'原说明',params:{limit:2}};
  const S={rules:{watch:[d]}};
  const store={
    ruleOpen:(kind)=>S.rules[kind].find(x=>['draft','pending','scheduled'].includes(x.state))||null,
    role:()=>role,
    me:()=>({id:'manager-demo'}),
    save:()=>{saves++;},
  };
  const NT={TODAY:'2026-10-26'};
  vm.runInNewContext(method[0],{store,S,NT,isCeo:()=>role==='ceo'},{filename:'Y/store.js'});
  return {store,d,setRole:r=>{role=r;},get saves(){return saves;}};
}
test('正常退回与即时撤销恢复原待审状态',()=>{
  const f=setup(),undo=f.store.returnDraft('watch','补充依据');
  assert.equal(f.d.state,'draft');
  assert.equal(f.d.returned.why,'补充依据');
  assert.equal(undo(),true);
  assert.equal(f.d.state,'pending');
  assert.equal(f.d.returned,undefined);
  assert.equal(f.saves,2);
});
test('旧撤销不允许把 HR 修改过的草稿变成待确认',()=>{
  const f=setup(),undo=f.store.returnDraft('watch','修改');
  f.d.params.limit=3;
  assert.equal(undo(),false);
  assert.equal(f.d.state,'draft');
  assert.equal(f.saves,1);
});
test('旧撤销不允许越过 HR 重新提交的状态',()=>{
  const f=setup(),undo=f.store.returnDraft('watch','修改');
  f.d.state='pending';
  assert.equal(undo(),false);
  assert.equal(f.saves,1);
});
test('旧撤销不能撤销第二次退回',()=>{
  const f=setup(),first=f.store.returnDraft('watch','第一次');
  f.d.state='pending';
  const second=f.store.returnDraft('watch','第二次');
  assert.equal(first(),false);
  assert.equal(f.d.returned.why,'第二次');
  assert.equal(second(),true);
});
test('撤销不可重复执行',()=>{
  const f=setup(),undo=f.store.returnDraft('watch','修改');
  assert.equal(undo(),true);
  assert.equal(undo(),false);
  assert.equal(f.saves,2);
});
test('无权角色不能退回或使用旧撤销',()=>{
  const f=setup(),undo=f.store.returnDraft('watch','修改');
  f.setRole('mentor');
  assert.equal(undo(),false);
  assert.equal(f.d.state,'draft');
  assert.equal(f.store.returnDraft('watch','非法退回'),null);
  assert.equal(f.saves,1);
});
test('草稿被移除后旧撤销不能复活已删除规则',()=>{
  const f=setup(),undo=f.store.returnDraft('watch','修改');
  f.d.state='old';
  assert.equal(undo(),false);
  assert.equal(f.saves,1);
});
