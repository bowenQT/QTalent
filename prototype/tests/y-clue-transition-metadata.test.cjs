'use strict';
// 执行版本 Y 真实的线索状态转换函数，所有数据为合成案例。
// 线索只在待核实时处理，已处理的要先撤回（改回待核实）再重新处理；这里按这条合法流程验证元数据清理。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = src.match(/  store\.verifyClue = \(id, ok, why\) => \{[\s\S]*?\n  \};/);
const undo = src.match(/  store\.unverifyClue = \(id, expectedToken\) => \{[\s\S]*?\n  \};/);
assert.ok(found,'未找到版本 Y 的 verifyClue');
assert.ok(undo,'未找到版本 Y 的 unverifyClue');
function setup() {
  const S = { watchClues: [{id:'clue-demo',person:'p-demo',state:'pending'}] };
  let saves=0, n=0;
  const store={me:()=>({id:'hr-demo'}),role:()=>'hrbp',scope:()=>'full',save:()=>{saves++;}};
  const NT={TODAY:'2026-10-25',uid:(p)=>`${p}-${++n}`};
  vm.runInNewContext(`${found[0]}\n${undo[0]}`,{S,store,NT,Date:{now:()=>3000}},{filename:'Y/store.js'});
  return {S,store,get saves(){return saves;}};
}
// 改回待核实再处理：线索处理的合法状态切换
const redo = (f, ok, why) => { assert.equal(f.store.unverifyClue('clue-demo'), true); return f.store.verifyClue('clue-demo', ok, why); };
test('不采纳后再核实会清除旧拒绝理由', () => {
  const f=setup(), c=f.S.watchClues[0];
  f.store.verifyClue('clue-demo',false,'已有证据不足');
  assert.equal(c.rejectWhy,'已有证据不足');
  redo(f,true);
  assert.equal(c.state,'verified');
  assert.equal(c.rejectWhy,undefined);
  assert.equal(c.verifiedTs,3000);
  assert.equal(c.verifiedBy,'hr-demo');
});
test('先核实再不采纳不会保留旧的核实时间戳', () => {
  const f=setup(), c=f.S.watchClues[0];
  f.store.verifyClue('clue-demo',true);
  redo(f,false,'再核实不采纳');
  assert.equal(c.state,'rejected');
  assert.equal(c.verifiedTs,undefined);
  assert.equal(c.rejectWhy,'再核实不采纳');
  assert.equal(c.verifiedAt,'2026-10-25');
});
test('多次状态切换以最后一次结论为准', () => {
  const f=setup(), c=f.S.watchClues[0];
  f.store.verifyClue('clue-demo',false,'旧理由');
  redo(f,true);
  redo(f,false,'新理由');
  assert.equal(c.rejectWhy,'新理由');
  assert.equal(c.verifiedTs,undefined);
});
test('处理本身也清掉对立结论的旧字段（待核实线索上残留旧数据时）', () => {
  const f=setup(), c=f.S.watchClues[0];
  Object.assign(c, { rejectWhy: '残留的旧理由' });
  f.store.verifyClue('clue-demo',true);
  assert.equal(c.rejectWhy,undefined,'核实时清掉旧的不采纳理由');
  assert.equal(f.store.unverifyClue('clue-demo'),true);
  Object.assign(c, { verifiedTs: 1 });
  f.store.verifyClue('clue-demo',false,'不采纳');
  assert.equal(c.verifiedTs,undefined,'不采纳时清掉旧的核实时刻');
});
test('不存在的线索 ID 不写入数据或保存', () => {
  const f=setup();
  assert.equal(f.store.verifyClue('missing',true),null);
  assert.equal(f.S.watchClues.length,1);
  assert.equal(f.saves,0);
});
