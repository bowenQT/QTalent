'use strict';
// 从版本 Y 源码调用真实分数确认逻辑；检查旧分歧标记不会滞留。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const found = script.match(/  store\.confirmScore = \(evId, idx, v, why\) => \{[\s\S]*?\n  \};/);
assert.ok(found, '找不到版本 Y 的真实分数确认函数');
function setup() {
  const evidence = { id: 'event-demo', date: '2026-10-25', scores: [{ p: 'demo-person', d: 'mot', v: 4, ai: 4, st: 'ai' }] };
  let saves = 0;
  const store = {
    event: id => id === evidence.id ? evidence : null,
    me: () => ({ id: 'demo-reviewer' }),
    save: () => { saves++; },
  };
  const NT = { TODAY: '2026-10-25' };
  vm.runInNewContext(found[0], { store, NT }, { filename: 'Y/store.js' });
  return { evidence, store, get saves() { return saves; } };
}
test('Y: AI 分差两分且无理由时进入人工校准', () => {
  const f = setup();
  f.store.confirmScore('event-demo', 0, 2, '');
  assert.equal(f.evidence.scores[0].bigGap, true);
  assert.equal(f.evidence.scores[0].v, 2);
});
test('Y: 重新确认到和 AI 一致时清除旧分歧', () => {
  const f = setup();
  f.store.confirmScore('event-demo', 0, 2, '');
  f.store.confirmScore('event-demo', 0, 4, '');
  assert.equal(f.evidence.scores[0].bigGap, undefined);
  assert.equal(f.evidence.scores[0].v, 4);
  assert.equal(f.evidence.scores[0].by, 'demo-reviewer');
  assert.equal(f.saves, 2);
});
test('Y: 分差仍大但补充理由后清除待校准标记', () => {
  const f = setup();
  f.store.confirmScore('event-demo', 0, 2, '');
  f.store.confirmScore('event-demo', 0, 2, '引用了新的证据');
  assert.equal(f.evidence.scores[0].bigGap, undefined);
  assert.equal(f.evidence.scores[0].v, 2);
  assert.equal(f.evidence.scores[0].hist[0].why, '引用了新的证据');
});
test('Y: 再次改为无理由的大分差时可重新标记', () => {
  const f = setup();
  f.store.confirmScore('event-demo', 0, 2, '');
  f.store.confirmScore('event-demo', 0, 4, '');
  f.store.confirmScore('event-demo', 0, 1, '');
  assert.equal(f.evidence.scores[0].bigGap, true);
  assert.equal(f.evidence.scores[0].v, 1);
});
