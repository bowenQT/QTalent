'use strict';
// 直接运行版本 Y 的真实 confirmOrg，全部使用虚构的批次、方案和人员。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const match = source.match(/  store\.confirmOrg = \(plan\) => \{[\s\S]*?\n  \};/);
assert.ok(match, '找不到真实版本 Y 组织方案确认函数');
function setup({ role = 'hrbp', withBatch = false } = {}) {
  let saves = 0, n = 0;
  const S = { plans: [], batches: withBatch ? [{id:'batch-demo',kind:'inventory',status:'draft',org:'demo-org'}] : [], snaps: [], actions: [] };
  const NT = { TODAY:'2026-10-25', uid:()=> 'demo-action-' + ++n };
  const store = {
    me:()=>({id:role+'-demo'}), can:cap=>cap === 'calibrate' && role === 'hrbp',
    person:id=>({id,name:'虚构人员-'+id}), save:()=>saves++,
  };
  const SEED = { PEOPLE:[] };
  vm.runInNewContext(match[0], {S,NT,store,SEED}, {filename:'Y/store.js'});
  function plan(id, batch = 'batch-demo') {
    const p = {id,kind:'org',batch,status:'draft',version:1,moves:[{person:'person-demo',type:'负责人安排',to:id}]};
    S.plans.push(p);return p;
  }
  return {S,store,plan,get saves(){return saves;}};
}
test('HR 首次确认草稿正常冻结并生成行动',()=>{
  const f=setup(), p=f.plan('org-a');
  assert.equal(f.store.confirmOrg(p),1);
  assert.equal(p.status,'confirmed');
  assert.equal(f.S.actions.length,1);
  assert.equal(f.saves,1);
});
test('已确认方案重复确认不写第二次',()=>{
  const f=setup(),p=f.plan('org-a');
  f.store.confirmOrg(p);
  assert.equal(f.store.confirmOrg(p),null);
  assert.equal(f.S.actions.length,1);
  assert.equal(f.saves,1);
});
test('已被替代的旧版不能反向覆盖最新确认版本',()=>{
  const f=setup(),old=f.plan('org-old'),newer=f.plan('org-new');
  f.store.confirmOrg(old);f.store.confirmOrg(newer);
  assert.equal(old.status,'superseded');
  assert.equal(newer.status,'confirmed');
  assert.equal(f.store.confirmOrg(old),null);
  assert.equal(old.status,'superseded');
  assert.equal(newer.status,'confirmed');
  assert.equal(f.S.actions.length,2);
  assert.equal(f.saves,2);
});
test('不同批次各自的有效草稿可独立确认',()=>{
  const f=setup(),a=f.plan('org-a','batch-a'),b=f.plan('org-b','batch-b');
  assert.equal(f.store.confirmOrg(a),1);
  assert.equal(f.store.confirmOrg(b),1);
  assert.equal(a.status,'confirmed');
  assert.equal(b.status,'confirmed');
  assert.equal(f.saves,2);
});
test('非 HR 不能确认组织方案',()=>{
  const f=setup({role:'lead'}),p=f.plan('org-a');
  assert.equal(f.store.confirmOrg(p),null);
  assert.equal(p.status,'draft');
  assert.equal(f.saves,0);
});
test('盘点已经结束时不能再确认同批次草稿',()=>{
  const f=setup({withBatch:true}),p=f.plan('org-a');
  f.S.batches[0].status='confirmed';
  assert.equal(f.store.confirmOrg(p),null);
  assert.equal(p.status,'draft');
  assert.equal(f.saves,0);
});
test('不存在于存储中的方案不能直接确认',()=>{
  const f=setup(),p={id:'external',kind:'org',batch:'batch-demo',status:'draft',moves:[]};
  assert.equal(f.store.confirmOrg(p),null);
  assert.equal(f.S.plans.length,0);
  assert.equal(f.saves,0);
});
