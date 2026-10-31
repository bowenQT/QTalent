'use strict';

// 版本 Y：批量导出与档案打印只取当前视角范围内、已确认的事件分；导师和系统管理员不能导出；审计只记动作。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const FILES = ['../y/app/js/core.js', '../y/app/js/data-xe6.js', '../y/app/js/data.js', '../y/app/js/store.js'];

function load(role) {
  const search = `?as=${role}`;
  const context = {
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search, href: `http://localhost/${search}` },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { style: {} },
      body: { classList: { add() {} } },
    },
    setTimeout,
    clearTimeout,
    console,
    URLSearchParams,
  };
  context.window = context;
  vm.createContext(context);
  for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
  return context.NT.store;
}

const COUNTED = ['confirmed', 'calibrated'];

test('HR 导出的每一行都是范围内已确认的分，规则版本不露内部编号', () => {
  const st = load('hrbp');
  const all = st.exportScopes().find((s) => s.id === 'all');
  const { rows, skipped } = st.exportRows(all.people);
  assert.ok(rows.length > 0);
  assert.ok(skipped > 0, '种子里有 AI 建议分或待校准的分，应计入不导出');
  for (const r of rows) {
    assert.equal(st.scope(r.pid), 'full');
    const e = st.event(r.ev);
    assert.ok(e.scores.some((s) => s.p === r.pid && s.v === r.v && COUNTED.includes(s.st)), `${r.ev} 应有已确认的分`);
    assert.match(r.rubric, /^评价规则 v\d+$/);
  }
});

test('新加的 AI 建议分不进导出，只计入不导出的条数', () => {
  const st = load('hrbp');
  const pid = st.exportScopes()[0].people[0];
  const before = st.exportRows([pid]);
  const ev = st.event(before.rows[0].ev);
  ev.scores.push({ p: pid, d: 'prof', v: 5, st: 'ai', ai: 5 });
  const after = st.exportRows([pid]);
  assert.equal(after.rows.length, before.rows.length);
  assert.equal(after.skipped, before.skipped + 1);
});

test('范围外的人不进导出；只有能关注的视角有「我的关注」范围', () => {
  const hr = load('hrbp');
  const outside = hr.people().find((p) => !hr.scope(p.id));
  assert.ok(outside, '种子里应有 HR 范围外的人');
  assert.equal(hr.exportRows([outside.id]).rows.length, 0);
  assert.equal(hr.canExport(outside.id), false);
  assert.ok(!hr.exportScopes().some((s) => s.id === 'follow'));
  const ceo = load('ceo');
  assert.ok(ceo.exportScopes().some((s) => s.id === 'follow'));
});

test('导师和系统管理员不能导出或打印', () => {
  for (const role of ['mentor', 'admin']) {
    const st = load(role);
    assert.equal(st.canExport(), false, role);
    const anyone = st.people().map((p) => p.id);
    assert.equal(st.exportRows(anyone).rows.length, 0, role);
  }
});

test('审计记下操作人、动作和对象', () => {
  const st = load('hrbp');
  assert.equal(st.audits().length, 0);
  st.audit('导出已确认内容', '我负责的人 · 近 12 个月 · 3 人 · 12 条维度分');
  st.audit('拒绝打印', '某人的档案');
  const [last, first] = st.audits();
  assert.equal(last.act, '拒绝打印');
  assert.equal(first.by, st.me().id);
  assert.deepEqual(Object.keys(first).sort(), ['act', 'at', 'by', 'obj']);
});
