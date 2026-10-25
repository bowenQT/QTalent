'use strict';
// 版本 Y 真实 store.removeRuleSug 回归：仅虚构建议和审批结果。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const method = source.match(/  store\.removeRuleSug = \(id\) => \{[\s\S]*?\n  \};/);
assert.ok(method, '缺少版本 Y store.removeRuleSug');
function setup(state='open') {
  const S = {
    ruleSugs: [
      {id:'s-demo',by:'mentor-demo',state,draft:state==='adopted'?'rubric-v2':undefined},
      {id:'s-other',by:'mentor-demo',state:'open'},
    ],
    rules: { rubric:[{v:'rubric-v2',basis:[{type:'sug',sug:'s-demo'}]}] },
  };
  let me='mentor-demo',allowed=true,saves=0;
  const store={
    canSuggestRule:()=>allowed,
    me:()=>({id:me}),
    save:()=>{saves++;},
  };
  vm.runInNewContext(method[0], {S,store}, {filename:'prototype/y/app/js/store.js'});
  return {S,store,setMe:x=>{me=x;},setAllowed:x=>{allowed=x;},get saves(){return saves;}};
}
test('提交者可以撤回尚未处理的建议',()=>{
  const f=setup();
  assert.equal(f.store.removeRuleSug('s-demo'),true);
  assert.equal(f.S.ruleSugs.some(s=>s.id==='s-demo'),false);
  assert.equal(f.S.ruleSugs.length,1);
  assert.equal(f.saves,1);
});
test('已被 HR 采纳的建议不允许撤回，规则依据保持可追溯',()=>{
  const f=setup('adopted');
  assert.equal(f.store.removeRuleSug('s-demo'),false);
  assert.equal(f.S.ruleSugs[0].id,'s-demo');
  assert.equal(f.S.rules.rubric[0].basis[0].sug,'s-demo');
  assert.equal(f.saves,0);
});
test('已被 HR 拒绝的建议及处理结果不可被旧撤销删除',()=>{
  const f=setup('rejected');
  assert.equal(f.store.removeRuleSug('s-demo'),false);
  assert.equal(f.S.ruleSugs.length,2);
  assert.equal(f.saves,0);
});
test('其他提交者不能撤回他人的建议',()=>{
  const f=setup(); f.setMe('other-demo');
  assert.equal(f.store.removeRuleSug('s-demo'),false);
  assert.equal(f.saves,0);
});
test('无提建议权限的视角不能通过旧撤销删除建议',()=>{
  const f=setup(); f.setAllowed(false);
  assert.equal(f.store.removeRuleSug('s-demo'),false);
  assert.equal(f.saves,0);
});
test('未知建议 ID 不触发保存',()=>{
  const f=setup();
  assert.equal(f.store.removeRuleSug('unknown'),false);
  assert.equal(f.S.ruleSugs.length,2);
  assert.equal(f.saves,0);
});
test('同一建议重复撤回只保存一次',()=>{
  const f=setup();
  assert.equal(f.store.removeRuleSug('s-demo'),true);
  assert.equal(f.store.removeRuleSug('s-demo'),false);
  assert.equal(f.saves,1);
});
test('拒绝已处理建议不影响另一条可正常撤回的建议',()=>{
  const f=setup('adopted');
  assert.equal(f.store.removeRuleSug('s-demo'),false);
  assert.equal(f.store.removeRuleSug('s-other'),true);
  assert.equal(f.S.ruleSugs.length,1);
  assert.equal(f.S.ruleSugs[0].id,'s-demo');
  assert.equal(f.saves,1);
});
