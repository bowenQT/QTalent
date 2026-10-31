'use strict';
// 运行版本 Y 真实 setState 页面函数，验证旧撤销不覆盖后续行动状态。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const file = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/actions.js'), 'utf8');
const match = file.match(/  async function setState\(a, s\) \{[\s\S]*?\n  \}/);
assert.ok(match, '找不到版本 Y 的 setState');
function setup(dialogResult = { value:'ok', data:'演示：调整计划' }) {
  const undos = [];
  let saves = 0;
  const NT = { TODAY:'2026-10-25', dialog:async()=>dialogResult, toast:(_msg,opts)=>undos.push(opts.undo) };
  const st = { save:()=>{ saves++; } };
  const html = (parts,...values)=>parts.reduce((s,p,i)=>s+p+(values[i]??''),'');
  const setState = vm.runInNewContext('(' + match[0].trim() + ')', {
    NT, st, html, LABEL:{todo:'待沟通',doing:'进行中',done:'已执行',cancel:'未执行'},
    render:()=>{}, $:()=>null,
  });
  return { setState, undos, get saves(){return saves;} };
}
test('第一次状态修改可以正常撤销', async () => {
  const f=setup(), a={state:'todo'};
  await f.setState(a,'doing');
  assert.equal(a.state,'doing');
  f.undos[0]();
  assert.equal(a.state,'todo');
  assert.equal(f.saves,2);
});
test('旧撤销不能把更新的行动状态回退', async () => {
  const f=setup(), a={state:'todo'};
  await f.setState(a,'doing');
  await f.setState(a,'done');
  const at=a.stateAt, ts=a.stateTs, did=a.did;
  f.undos[0]();
  assert.equal(a.state,'done');
  assert.equal(a.stateAt,at);
  assert.equal(a.stateTs,ts);
  assert.equal(a.did,did);
  assert.equal(f.saves,2);
});
test('同状态连续提交，即使时间戳相同，旧撤销也不能覆盖新操作', async () => {
  const f=setup(), a={state:'todo'};
  await f.setState(a,'doing');
  await f.setState(a,'doing');
  f.undos[0]();
  assert.equal(a.state,'doing');
  assert.equal(f.saves,2);
});
test('最新操作仍可撤销回上一状态', async () => {
  const f=setup(), a={state:'todo'};
  await f.setState(a,'doing');
  await f.setState(a,'done');
  f.undos[1]();
  assert.equal(a.state,'doing');
  assert.equal(f.saves,3);
  f.undos[0]();
  assert.equal(a.state,'doing'); // 旧操作不可在新操作撤销后再次生效
  assert.equal(f.saves,3);
});
test('重复点击同一个撤销不会重复写入', async () => {
  const f=setup(), a={state:'todo'};
  await f.setState(a,'done');
  f.undos[0](); f.undos[0]();
  assert.equal(a.state,'todo');
  assert.equal(f.saves,2);
});
test('未执行的新增原因被本次有效撤销清理，原有原因可恢复', async () => {
  const f=setup(), a={state:'todo', why:'旧原因', did:'2026-10-01'};
  await f.setState(a,'cancel');
  assert.equal(a.why,'演示：调整计划');
  f.undos[0]();
  assert.equal(a.why,'旧原因');
  assert.equal(a.did,'2026-10-01');
});
test('取消填写原因弹窗不保存或创建撤销', async () => {
  const f=setup({value:'cancel'}), a={state:'todo'};
  await f.setState(a,'cancel');
  assert.equal(a.state,'todo');
  assert.equal(f.undos.length,0);
  assert.equal(f.saves,0);
});
