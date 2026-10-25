'use strict';
// 使用 Y 的真实撤销处理函数检查操作当下的 HR 权限和状态。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = src.match(/  store\.unhandleRuleSug = \(id\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '未找到 Y 的 unhandleRuleSug');
function setup(role='hrbp', state='adopted') {
  let currentRole = role, saves = 0;
  const sug = {id:'s-demo',state,rule:'rubric',draft:state === 'adopted' ? 'v2' : undefined,handledBy:'hr-demo',handledAt:'2026-10-25',why:state === 'rejected' ? '无依据' : undefined};
  const draft = {v:'v2',state:'draft',basis:state === 'adopted' ? [{type:'sug',sug:'s-demo'}] : []};
  const S = {ruleSugs:[sug]};
  const store = {ruleVer: () => draft,save:()=>{saves++;}};
  vm.runInNewContext(found[0],{store,S,isHrbp:()=>currentRole==='hrbp'},{filename:'Y/store.js'});
  return {store,S,draft,sug,setRole:role=>{currentRole=role;},get saves(){return saves;}};
}
test('无审批权限的负责人不能撤销已采纳建议', () => {
  const f=setup('lead');
  assert.equal(f.store.unhandleRuleSug('s-demo'),null);
  assert.equal(f.sug.state,'adopted');
  assert.equal(f.draft.basis.length,1);
  assert.equal(f.saves,0);
});
test('初始有权而调用时角色切换，权限重新校验', () => {
  const f=setup('hrbp');
  f.setRole('lead');
  assert.equal(f.store.unhandleRuleSug('s-demo'),null);
  assert.equal(f.draft.basis.length,1);
  assert.equal(f.saves,0);
});
test('HR 撤销已采纳建议使其恢复待处理且移除草稿关联', () => {
  const f=setup();
  f.store.unhandleRuleSug('s-demo');
  assert.equal(f.sug.state,'open');
  assert.equal(f.sug.draft,undefined);
  assert.equal(f.sug.handledBy,undefined);
  assert.equal(f.draft.basis.length,0);
  assert.equal(f.saves,1);
});
test('HR 可正常撤销不采纳并清除旧拒绝理由', () => {
  const f=setup('hrbp','rejected');
  f.store.unhandleRuleSug('s-demo');
  assert.equal(f.sug.state,'open');
  assert.equal(f.sug.why,undefined);
  assert.equal(f.saves,1);
});
test('已是待处理或不存在的建议不反复存储', () => {
  const f=setup('hrbp','open');
  assert.equal(f.store.unhandleRuleSug('s-demo'),null);
  assert.equal(f.store.unhandleRuleSug('missing'),null);
  assert.equal(f.saves,0);
});
