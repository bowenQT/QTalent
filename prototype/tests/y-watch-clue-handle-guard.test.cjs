'use strict';
// 版本 Y 真实线索处理方法回归：仅虚构人员和线索，不涉及真实员工。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const verify = source.match(/  store\.verifyClue = \(id, ok, why\) => \{[\s\S]*?\n  \};/);
const unverify = source.match(/  store\.unverifyClue = \(id, expectedToken\) => \{[\s\S]*?\n  \};/) || source.match(/  store\.unverifyClue = .*;/);
assert.ok(verify && unverify,'缺少版本 Y 的线索处理方法');
function setup() {
  const S={watchClues:[{id:'c-demo',person:'p-demo',state:'pending'}]};
  let role='hrbp',scope='full',saves=0,uid=0;
  const NT={TODAY:'2026-10-26',uid:prefix=>prefix+'-'+(++uid)};
  const store={
    role:()=>role,scope:()=>scope,me:()=>({id:role+'-demo'}),
    save:()=>{saves++;},
  };
  vm.runInNewContext(verify[0]+'\n'+unverify[0],{S,store,NT},{filename:'prototype/y/app/js/store.js'});
  return {S,store,setRole:x=>{role=x;},setScope:x=>{scope=x;},get saves(){return saves;}};
}
test('有 full 范围的 HR 可以核实 pending 线索并记录处理版本',()=>{
  const f=setup(),c=f.store.verifyClue('c-demo',true);
  assert.equal(c.state,'verified');
  assert.equal(c.verifiedBy,'hrbp-demo');
  assert.equal(c.handledToken,'vh-1');
  assert.equal(f.saves,1);
});
test('HR 不采纳必须有非空理由并修剪空格',()=>{
  const f=setup();
  assert.equal(f.store.verifyClue('c-demo',false,'   '),null);
  assert.equal(f.saves,0);
  const c=f.store.verifyClue('c-demo',false,'  证据不足  ');
  assert.equal(c.state,'rejected');
  assert.equal(c.rejectWhy,'证据不足');
  assert.equal(f.saves,1);
});
test('导师即使能看到线索也不能代 HR 核实',()=>{
  const f=setup();f.setRole('mentor');
  assert.equal(f.store.verifyClue('c-demo',true),null);
  assert.equal(f.S.watchClues[0].state,'pending');
  assert.equal(f.saves,0);
});
test('HR 对范围外人员不能核实或拒绝',()=>{
  const f=setup();f.setScope(null);
  assert.equal(f.store.verifyClue('c-demo',true),null);
  assert.equal(f.store.verifyClue('c-demo',false,'不采纳'),null);
  assert.equal(f.saves,0);
});
test('已处理线索不能被重复核实或改为拒绝',()=>{
  const f=setup();f.store.verifyClue('c-demo',true);
  assert.equal(f.store.verifyClue('c-demo',true),null);
  assert.equal(f.store.verifyClue('c-demo',false,'重复'),null);
  assert.equal(f.S.watchClues[0].state,'verified');
  assert.equal(f.saves,1);
});
test('只有 HR 能主动撤回已经处理的线索',()=>{
  const f=setup();f.store.verifyClue('c-demo',true);
  f.setRole('lead');
  assert.equal(f.store.unverifyClue('c-demo'),false);
  assert.equal(f.S.watchClues[0].state,'verified');
  f.setRole('hrbp');f.setScope(null);
  assert.equal(f.store.unverifyClue('c-demo'),false);
  assert.equal(f.saves,1);
});
test('HR 可主动将已核实线索恢复待核实并清理元数据',()=>{
  const f=setup(),c=f.store.verifyClue('c-demo',true);
  assert.equal(f.store.unverifyClue('c-demo',c.handledToken),true);
  assert.equal(c.state,'pending');
  assert.equal(c.verifiedBy,undefined);
  assert.equal(c.verifiedTs,undefined);
  assert.equal(c.handledToken,undefined);
  assert.equal(f.saves,2);
});
test('旧 Toast 撤销不能撤回之后重新处理的结果',()=>{
  const f=setup(),c=f.store.verifyClue('c-demo',true),oldToken=c.handledToken;
  assert.equal(f.store.unverifyClue('c-demo'),true);
  f.store.verifyClue('c-demo',false,'二次复核');
  assert.equal(f.store.unverifyClue('c-demo',oldToken),false);
  assert.equal(c.state,'rejected');
  assert.equal(c.rejectWhy,'二次复核');
  assert.equal(f.saves,3);
});
test('不采纳撤回后再核实应清除过时拒绝理由',()=>{
  const f=setup(),c=f.store.verifyClue('c-demo',false,'第一次拒绝');
  assert.equal(f.store.unverifyClue('c-demo',c.handledToken),true);
  f.store.verifyClue('c-demo',true);
  assert.equal(c.rejectWhy,undefined);
  assert.equal(c.state,'verified');
  assert.equal(f.saves,3);
});
test('未知 ID、待核实状态撤回均不保存',()=>{
  const f=setup();
  assert.equal(f.store.verifyClue('missing',true),null);
  assert.equal(f.store.unverifyClue('missing'),false);
  assert.equal(f.store.unverifyClue('c-demo'),false);
  assert.equal(f.saves,0);
});
