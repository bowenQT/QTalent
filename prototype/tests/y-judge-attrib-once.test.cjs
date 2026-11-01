'use strict';
// 版本 Y 的真实判断归因确认函数；测试使用虚构批次、假设和行动。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = source.match(/  store\.confirmAttrib = \(batchId, hyp, a\) => \{[\s\S]*?\n  \};/);
assert.ok(found,'找不到真实版本 Y 判断归因确认函数');
function setup(role='hrbp') {
  const h={id:'hyp-demo'}, S={judgeAttribs:{}};
  let saves=0, valid=true;
  const store={
    role:()=>role,judgeHyps:bid=>bid==='batch-demo'?[h]:[],
    hypCheck:()=>({ok:valid}),me:()=>({id:role+'-demo'}),
    save:()=>saves++,
  };
  vm.runInNewContext(found[0],{S,store,NT:{TODAY:'2026-10-25'}},{filename:'Y/store.js'});
  const input=()=>({cats:['std'],reason:'虚构案例需完善锚点',text:'虚构假设'});
  return {h,S,store,input,setValid:x=>{valid=x;},get saves(){return saves;}};
}
test('HR 首次有效确认写入类别、理由和署名',()=>{
  const f=setup();
  assert.equal(f.store.confirmAttrib('batch-demo',f.h,f.input()),true);
  assert.equal(f.S.judgeAttribs['hyp-demo'].by,'hrbp-demo');
  assert.equal(f.S.judgeAttribs['hyp-demo'].actions.length,0);
  assert.equal(f.saves,1);
});
test('重复确认不覆盖已确认结论及已生成行动',()=>{
  const f=setup();f.store.confirmAttrib('batch-demo',f.h,f.input());
  const before=f.S.judgeAttribs['hyp-demo'];before.actions.push('action-demo');
  assert.equal(f.store.confirmAttrib('batch-demo',f.h,{cats:['rater'],reason:'改写'}),false);
  assert.equal(f.S.judgeAttribs['hyp-demo'],before);
  assert.equal(before.actions[0],'action-demo');
  assert.equal(before.cats[0],'std');
  assert.equal(f.saves,1);
});
test('CEO 视角不能提交 HR 归因',()=>{
  const f=setup('ceo');
  assert.equal(f.store.confirmAttrib('batch-demo',f.h,f.input()),false);
  assert.equal(f.saves,0);
});
test('错误批次的假设不能被写入',()=>{
  const f=setup();
  assert.equal(f.store.confirmAttrib('batch-other',f.h,f.input()),false);
  assert.equal(f.saves,0);
});
test('依据已变更的假设不能确认',()=>{
  const f=setup();f.setValid(false);
  assert.equal(f.store.confirmAttrib('batch-demo',f.h,f.input()),false);
  assert.equal(f.saves,0);
});
test('没有类别或理由时拒绝写入',()=>{
  const f=setup();
  assert.equal(f.store.confirmAttrib('batch-demo',f.h,{cats:[],reason:'理由'}),false);
  assert.equal(f.store.confirmAttrib('batch-demo',f.h,{cats:['std'],reason:'   '}),false);
  assert.equal(f.saves,0);
});
test('不同假设的首次确认互不影响',()=>{
  const f=setup();f.store.confirmAttrib('batch-demo',f.h,f.input());
  const h2={id:'hyp-other'};
  // 当前批次的假设清单确实包含第二条，才允许确认。
  f.store.judgeHyps=bid=>bid==='batch-demo'?[f.h,h2]:[];
  assert.equal(f.store.confirmAttrib('batch-demo',h2,f.input()),true);
  assert.equal(Object.keys(f.S.judgeAttribs).length,2);
  assert.equal(f.saves,2);
});
