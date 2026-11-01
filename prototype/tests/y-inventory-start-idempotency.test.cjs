'use strict';
// 版本 Y 原始 startInventory 的幂等性回归；仅模拟批次及规则版本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const file = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = file.match(/  store\.startInventory = \(b\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '未找到版本 Y 的 startInventory');
function setup() {
  let saves=0, activations=0;
  const S = {
    batches: [],
    rules: {
      rubric: [{state:'live',v:'rubric-v1'}],
      place: [{state:'live',v:'place-v1'}],
      watch: [{state:'live',v:'watch-v1'}],
    },
  };
  const store = {
    inventoryLock: () => S.batches.find(x => x.kind === 'inventory' && x.status === 'draft') || null,
    ruleLive: kind => S.rules[kind].find(x=>x.state === 'live'),
    save: () => { saves++; },
  };
  const activate = (kind, draft) => {
    activations++;
    S.rules[kind].filter(r=>r.state==='live').forEach(r=>{r.state='old';});
    draft.state='live';
  };
  vm.runInNewContext(found[0], { S,store,activate }, { filename:'Y/store.js' });
  return {S,store,get saves(){return saves;},get activations(){return activations;}};
}
test('首次启动新盘点，冻结当前生效的锚点和落位版本', () => {
  const f=setup(), b={id:'batch-demo',kind:'inventory',status:'draft'};
  assert.equal(f.store.startInventory(b),b);
  assert.equal(f.S.batches.length,1);
  assert.equal(b.rubric,'rubric-v1');
  assert.equal(b.place,'place-v1');
  assert.equal(f.saves,1);
});
test('同一对象重复启动没有额外保存或重复批次', () => {
  const f=setup(), b={id:'batch-demo',kind:'inventory',status:'draft'};
  f.store.startInventory(b);
  assert.equal(f.store.startInventory(b),null);
  assert.equal(f.S.batches.length,1);
  assert.equal(f.saves,1);
});
test('不同对象但相同 ID 的重复启动也被拒绝', () => {
  const f=setup(), b={id:'batch-demo',kind:'inventory',status:'draft'};
  f.store.startInventory(b);
  assert.equal(f.store.startInventory({id:'batch-demo',kind:'inventory',status:'draft'}),null);
  assert.equal(f.S.batches.length,1);
  assert.equal(f.saves,1);
});
test('重复启动不会再次激活排期中的评价版本', () => {
  const f=setup();
  f.S.rules.rubric.push({state:'scheduled',v:'rubric-v2'});
  f.store.startInventory({id:'batch-demo',kind:'inventory',status:'confirmed'});
  assert.equal(f.activations,1);
  assert.equal(f.store.startInventory({id:'batch-demo',kind:'inventory',status:'confirmed'}),null);
  assert.equal(f.activations,1);
  assert.equal(f.saves,1);
});
test('之前的盘点结束后，不同 ID 的新盘点仍可启动', () => {
  const f=setup(), a={id:'batch-old',kind:'inventory',status:'confirmed'};
  const b={id:'batch-new',kind:'inventory',status:'draft'};
  f.store.startInventory(a);
  assert.equal(f.store.startInventory(b),b);
  assert.equal(f.S.batches.length,2);
  assert.equal(f.saves,2);
});
test('缺失批次或缺失 ID 时不能写入任何数据', () => {
  const f=setup();
  assert.equal(f.store.startInventory(null),null);
  assert.equal(f.store.startInventory({kind:'inventory'}),null);
  assert.equal(f.S.batches.length,0);
  assert.equal(f.saves,0);
});
