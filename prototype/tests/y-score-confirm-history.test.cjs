'use strict';
// 调用版本 Y 原始 confirmScore 函数；检查重复确认不抹除旧审计记录。
const assert = require('node:assert/strict');
// 沙箱里返回的数组属于另一个 realm，先转成本地普通值再做深比较。
const plain = (value) => JSON.parse(JSON.stringify(value));
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const match = src.match(/  store\.confirmScore = \(evId, idx, v, why\) => \{[\s\S]*?\n  \};/);
assert.ok(match, '未找到版本 Y 的真实 confirmScore');
function setup(score) {
  const evidence = { id: 'ev-demo', date: '2026-10-20', scores: [score || { p:'fake',d:'mot',v:4,ai:4,st:'ai' }] };
  let saves = 0;
  const store = { event: () => evidence, me: () => ({ id:'mentor-demo' }), save: () => { saves++; } };
  const NT = { TODAY:'2026-10-25' };
  vm.runInNewContext(match[0], {store,NT}, { filename:'Y/store.js' });
  return { score:evidence.scores[0], store, get saves() { return saves; } };
}
test('两次人工改分均保留分数、理由和唯一 AI 来源', () => {
  const f = setup();
  f.store.confirmScore('ev-demo',0,3,'首次观察');
  f.store.confirmScore('ev-demo',0,5,'复核证据');
  assert.deepEqual(plain(f.score.hist.map(h => h.v)), [5,3,4]);
  assert.deepEqual(plain(f.score.hist.map(h => h.kind)), ['edit','edit','ai']);
  assert.equal(f.score.hist[0].why,'复核证据');
  assert.equal(f.score.hist[1].why,'首次观察');
  assert.equal(f.score.hist.filter(h=>h.kind==='ai').length,1);
  assert.equal(f.score.v,5);
  assert.equal(f.score.by,'mentor-demo');
  assert.equal(f.saves,2);
});
test('更多次确认仍只保留一条原始 AI 建议', () => {
  const f = setup();
  f.store.confirmScore('ev-demo',0,3,'一');
  f.store.confirmScore('ev-demo',0,5,'二');
  f.store.confirmScore('ev-demo',0,4,'三');
  assert.equal(f.score.hist.length,4);
  assert.equal(f.score.hist.filter(h=>h.kind==='ai').length,1);
});
test('已有复核及 AI 来源元信息不会被新确认抹除', () => {
  const score = {p:'fake',d:'mot',v:3,ai:4,st:'confirmed',
    hist:[{v:3,kind:'edit',at:'2026-10-20',by:'hr-old',why:'旧证据'},
          {v:4,kind:'ai',at:'2026-10-18',model:'demo-v1'}]};
  const f = setup(score);
  f.store.confirmScore('ev-demo',0,5,'新证据');
  assert.equal(f.score.hist[1].by,'hr-old');
  assert.equal(f.score.hist[1].why,'旧证据');
  assert.equal(f.score.hist[2].model,'demo-v1');
});
test('无 AI 建议的分数重复确认不会凭空生成 AI 历史', () => {
  const f = setup({p:'fake',d:'mot',v:3,st:'confirmed'});
  f.store.confirmScore('ev-demo',0,3,'人工首次');
  f.store.confirmScore('ev-demo',0,4,'人工复核');
  assert.equal(f.score.hist.length,2);
  assert.equal(f.score.hist.some(h=>h.kind==='ai'),false);
});
