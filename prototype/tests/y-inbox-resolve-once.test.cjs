'use strict';

// 用版本 Y 的真实 resolveInbox 验证：同一条待核对只生成一条事件。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const storeSrc = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const deskSrc = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/inbox.js'), 'utf8');
const mobSrc = fs.readFileSync(path.join(__dirname, '../y/m/js/pages/inbox.js'), 'utf8');

function load() {
  const add = storeSrc.match(/store\.addEvent = \(e\) => \{[\s\S]*?\};/);
  const resolve = storeSrc.match(/store\.resolveInbox = \(id, choice\) => \{[\s\S]*?\n  \};/);
  const unresolve = storeSrc.match(/store\.unresolveInbox = \(id\) => \{[\s\S]*?\n  \};/);
  const event = storeSrc.match(/store\.event = \(id\) => S\.events\.find\(\(e\) => e\.id === id\);/);
  assert.ok(add && resolve && unresolve && event, '无法从 store.js 提取待核对函数');
  const draft = { date: '2026-08-28', project: 't-scene-b', recorder: 'p-yeqing', title: '演示：小孟先对齐接口', scores: [['prof', 4, '锚点 4'], ['lead', 3, '锚点 3']] };
  const S = {
    events: [{ id: 'e-old', people: ['p-x01'] }],
    inbox: [
      { id: 'i-meng', quote: '小孟这周先画了接口图', src: '导师一对一', at: '10:20', by: 'p-yeqing', draft: { ...draft, scores: draft.scores.map((row) => row.slice()) } },
      { id: 'i-team', quote: '分镜那个组', src: '会议', at: '11:00', by: 'p-yeqing', draft: null },
    ],
  };
  const store = { save() {}, ruleLive: () => ({ v: 'rubric-v1' }) };
  vm.runInNewContext(`${add[0]}\n${resolve[0]}\n${unresolve[0]}\n${event[0]}`, { S, NT: {}, store, Date });
  return { store, S };
}

function ids(S, id) { return S.events.filter((e) => e.id === id); }

test('重复选择候选人只保留一条事件', () => {
  const { store, S } = load();
  store.resolveInbox('i-meng', 'p-x07');
  store.resolveInbox('i-meng', 'p-x11');
  const rows = ids(S, 'e-i-meng');
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows[0].people), '["p-x07"]');
  assert.equal(store.event('e-i-meng'), rows[0]);
  assert.equal(S.inbox[0].done, true);
  assert.equal(S.inbox[0].choice, 'p-x07');
  assert.equal(S.events.some((e) => e.id === 'e-old'), true);
});

test('核对完成后再选稍后处理，不撤销事件也不清空人选', () => {
  const { store, S } = load();
  store.resolveInbox('i-meng', 'p-x07');
  store.resolveInbox('i-meng', 'skip');
  assert.equal(ids(S, 'e-i-meng').length, 1);
  assert.equal(S.inbox[0].done, true);
  assert.equal(S.inbox[0].later, false);
  assert.equal(S.inbox[0].choice, 'p-x07');
});

test('稍后处理本身不生成事件，撤销后可以重新稍后处理', () => {
  const { store, S } = load();
  store.resolveInbox('i-meng', 'skip');
  assert.equal(ids(S, 'e-i-meng').length, 0);
  assert.equal(Boolean(S.inbox[0].done), false);
  assert.equal(S.inbox[0].later, true);
  store.resolveInbox('i-meng', 'p-x07');
  assert.equal(ids(S, 'e-i-meng').length, 1);
  store.unresolveInbox('i-meng');
  assert.equal(ids(S, 'e-i-meng').length, 0);
  assert.equal(Boolean(S.inbox[0].done), false);
  store.resolveInbox('i-meng', 'skip');
  assert.equal(S.inbox[0].later, true);
  assert.equal(ids(S, 'e-i-meng').length, 0);
  assert.equal(S.events.some((e) => e.id === 'e-old'), true);
});

test('没有草稿的项目核对重复点选也不制造事件', () => {
  const { store, S } = load();
  store.resolveInbox('i-team', 't-scene-b');
  store.resolveInbox('i-team', 't-talk-a');
  assert.equal(S.events.length, 1);
  assert.equal(S.inbox[1].choice, 't-scene-b');
});

test('桌面和手机在卡片离场前忽略重复点击', () => {
  assert.match(deskSrc, /if \(!cardEl \|\| cardEl\.dataset\.picking\) return;\s*cardEl\.dataset\.picking = '1';/);
  assert.match(mobSrc, /if \(!cardEl \|\| cardEl\.dataset\.picking\) return;\s*cardEl\.dataset\.picking = '1';/);
});
