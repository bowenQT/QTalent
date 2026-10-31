'use strict';
// 执行版本 Y 真实 suggestCalib；虚构组织、人员和批次。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../y/app/js/store.js'),'utf8');
const method=source.match(/  store\.suggestCalib = \(batch, team, pid, sug\) => \{[\s\S]*?\n  \};/);
assert.ok(method,'找不到真实 suggestCalib');
function setup(){
  let role='lead',saves=0,scope='full';
  const p={id:'p-demo',org:'org-team'};
  const b={id:'b-demo',kind:'inventory',org:'org-root',status:'draft'};
  const S={calibSuggest:{},snaps:[],batches:[b]};
  const store={
    batch:id=>S.batches.find(x=>x.id===id),
    person:id=>id===p.id?p:null,
    role:()=>role,
    scope:()=>scope,
    inOrg:(org,root)=>org==='org-team'&&root==='org-root',
    me:()=>({id:'lead-demo'}),
    save:()=>{saves++;},
  };
  const NT={TODAY:'2026-10-26'};
  vm.runInNewContext(method[0],{store,S,NT},{filename:'Y/store.js'});
  const suggest=()=>store.suggestCalib('b-demo','org-team','p-demo',{pos:[0.3,0.7],reason:'证据说明'});
  return {S,b,p,store,suggest,setRole:x=>{role=x;},setScope:x=>{scope=x;},get saves(){return saves;}};
}
test('管理者对自己范围内未冻结批次正常写建议',()=>{
  const f=setup(),r=f.suggest();
  assert.equal(r.by,'lead-demo');
  assert.equal(f.S.calibSuggest['b-demo:org-team']['p-demo'].reason,'证据说明');
  assert.equal(f.saves,1);
});
test('导师、本人和 HR 不能借建议接口写管理者建议',()=>{
  for(const role of ['mentor','self','hrbp','admin','ceo']){
    const f=setup();f.setRole(role);
    assert.equal(f.suggest(),null);
    assert.equal(f.saves,0);
  }
});
test('项目级可见或无权限的人员不能写校准建议',()=>{
  for(const scope of ['project','mentor',null]){
    const f=setup();f.setScope(scope);
    assert.equal(f.suggest(),null);
    assert.equal(f.saves,0);
  }
});
test('已经冻结的团队不再接收建议',()=>{
  const f=setup();f.S.snaps.push({batch:'b-demo',teams:['org-team']});
  assert.equal(f.suggest(),null);
  assert.equal(f.saves,0);
});
test('已经确认的盘点不再接收建议',()=>{
  const f=setup();f.b.status='confirmed';
  assert.equal(f.suggest(),null);
  assert.equal(f.saves,0);
});
test('跨团队和不存在的人员/批次不能写入',()=>{
  const f=setup();
  assert.equal(f.store.suggestCalib('b-demo','other-team','p-demo',{}),null);
  assert.equal(f.store.suggestCalib('b-other','org-team','p-demo',{}),null);
  assert.equal(f.store.suggestCalib('b-demo','org-team','missing',{}),null);
  assert.equal(f.saves,0);
});
test('训练营批次只允许其中新人在 newcomers 团队提交建议',()=>{
  const f=setup();f.b.kind='landing';f.b.newcomers=[['p-demo','topic',[]]];
  assert.equal(f.store.suggestCalib('b-demo','other','p-demo',{}),null);
  assert.ok(f.store.suggestCalib('b-demo','newcomers','p-demo',{reason:'证据'}));
  assert.equal(f.saves,1);
});
