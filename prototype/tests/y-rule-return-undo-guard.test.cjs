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
  const NT={TODAY:'2026-10-26',clone:(o)=>JSON.parse(JSON.stringify(o))};
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
test('第二次退回写了同样的理由，旧撤销也认得出不是同一次退回', () => {
  const f=setup(),first=f.store.returnDraft('watch','补充依据');
  // HR 原样重新提交，管理者同一天用同一句理由再退回：草稿内容和第一次退回后一模一样
  f.d.state='pending'; delete f.d.returned;
  const second=f.store.returnDraft('watch','补充依据');
  assert.equal(first(),false,'旧撤销只认自己写入的那次退回');
  assert.equal(f.d.state,'draft');
  assert.equal(second(),true);
  assert.equal(f.d.state,'pending');
});
test('规则页把退回的撤销结果如实交给 Toast，失败提示用肯定式', () => {
  const page = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/rules.js'), 'utf8');
  const block = page.match(/const undo = st\.returnDraft\(k, v\.data, L\);[\s\S]*?\n    \}\);/)[0];
  const undoSrc = block.match(/undo: (\(\) => \{[^}]*\})/)[1];
  let drawn = 0;
  const wrap = (ok) => vm.runInNewContext(undoSrc, { undo: () => ok, rerender: () => { drawn++; } });
  assert.equal(wrap(false)(), false, '草稿已有后续处理时返回 false，Toast 显示失败');
  assert.equal(wrap(true)(), true);
  assert.equal(drawn, 2);
  const texts = [...block.matchAll(/(?:NT\.toast\(|failText: )[`']([^`']+)[`']/g)].map((m) => m[1]);
  assert.ok(texts.some((t) => t.startsWith('撤销失败：')), '有撤销失败的文案');
  for (const t of texts) assert.doesNotMatch(t, /不能|未执行|没有|无法/, `${t} 用肯定式`);
});
