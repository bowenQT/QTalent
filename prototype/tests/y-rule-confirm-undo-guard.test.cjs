'use strict';
// 运行版本 Y 原始规则发布函数的撤销闭包；所有版本与复核暂停均为虚构数据。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../y/app/js/store.js'),'utf8');
const found=source.match(/  store\.confirmDraft = \(kind, line\) => \{[\s\S]*?\n  \};/);
assert.ok(found,'找不到真实版本 Y confirmDraft');
function setup(effect='now'){
  let saves=0,can=true;
  const old={v:'watch-v1',state:'live'},pending={v:'watch-v2',state:'pending',effect};
  const S={rules:{watch:[old,pending]},reviewHolds:[]};
  const store={
    ruleOpen:()=>S.rules.watch.find(r=>r.state==='pending'||r.state==='scheduled')||null,
    ruleLive:()=>S.rules.watch.find(r=>r.state==='live')||null,
    lockBlocks:()=>false,me:()=>({id:'ceo-demo'}),save:()=>saves++,
  };
  const NT={TODAY:'2026-10-25',clone:x=>JSON.parse(JSON.stringify(x))};
  const activate=(kind,d)=>{
    const live=store.ruleLive(kind);
    if(live)live.state='old';
    d.state='live';
  };
  vm.runInNewContext(found[0],{S,store,NT,isCeo:()=>can,activate},{filename:'Y/store.js'});
  return {S,store,old,pending,setCan:x=>{can=x;},get saves(){return saves;}};
}
test('立即发布后状态未变时可以正常撤销',()=>{
  const f=setup(),undo=f.store.confirmDraft('watch');
  assert.equal(f.pending.state,'live');
  assert.equal(f.old.state,'old');
  assert.equal(undo(),true);
  assert.equal(f.S.rules.watch.filter(x=>x.state==='live').length,1);
  assert.equal(f.S.rules.watch.find(x=>x.state==='live').v,'watch-v1');
  assert.equal(f.S.rules.watch.find(x=>x.state==='pending').v,'watch-v2');
  assert.equal(f.saves,2);
});
test('同一撤销闭包只能成功一次',()=>{
  const f=setup(),undo=f.store.confirmDraft('watch');
  assert.equal(undo(),true);
  assert.equal(undo(),false);
  assert.equal(f.saves,2);
});
test('新版本生效后旧 Toast 不能恢复过时的旧版本',()=>{
  const f=setup(),undo=f.store.confirmDraft('watch');
  f.pending.state='old';
  f.S.rules.watch.push({v:'watch-v3',state:'live'});
  assert.equal(undo(),false);
  assert.deepEqual(f.S.rules.watch.filter(x=>x.state==='live').map(x=>x.v),['watch-v3']);
  assert.equal(f.saves,1);
});
test('新草稿已基于本次发布版本起草时不能撤销其依据',()=>{
  const f=setup(),undo=f.store.confirmDraft('watch');
  f.S.rules.watch.push({v:'watch-v3',state:'draft',base:'watch-v2'});
  assert.equal(undo(),false);
  assert.equal(f.S.rules.watch.find(x=>x.v==='watch-v2').state,'live');
  assert.equal(f.saves,1);
});
test('撤销不能截断发布之后新增的其他复核暂停',()=>{
  const f=setup(),undo=f.store.confirmDraft('watch');
  const unrelated={ver:'rubric-v3'};
  f.S.reviewHolds.push(unrelated);
  assert.equal(undo(),true);
  assert.equal(f.S.reviewHolds.length,1);
  assert.equal(f.S.reviewHolds[0],unrelated);
});
test('已排期发布可撤销回待确认，旧版本继续生效',()=>{
  const f=setup('next'),undo=f.store.confirmDraft('watch');
  assert.equal(f.pending.state,'scheduled');
  assert.equal(f.old.state,'live');
  assert.equal(undo(),true);
  assert.equal(f.S.rules.watch.find(x=>x.v==='watch-v2').state,'pending');
  assert.equal(f.S.rules.watch.find(x=>x.v==='watch-v1').state,'live');
});
test('已排期版本被盘点启动激活后不能用旧 Toast 撤销',()=>{
  const f=setup('next'),undo=f.store.confirmDraft('watch');
  f.old.state='old';f.pending.state='live';
  assert.equal(undo(),false);
  assert.equal(f.pending.state,'live');
  assert.equal(f.saves,1);
});
test('未授权的发布不写入且不生成撤销闭包',()=>{
  const f=setup();f.setCan(false);
  assert.equal(f.store.confirmDraft('watch'),null);
  assert.equal(f.pending.state,'pending');
  assert.equal(f.saves,0);
});
