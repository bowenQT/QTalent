'use strict';

// 用版本 Y 的真实数据和 store 验证决赛增补的采集规则：待核对按视角过滤、面评导入只写已确认的行、
// 节点结论等评委确认后由 HR 确认、重新分派遇到已有变化的事以原评价人为准。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const JS = path.join(__dirname, '../y/app/js');
const FILES = ['core.js', 'data-xe6.js', 'data.js', 'data-intake.js', 'store.js', 'intake.js'];
const SRC = FILES.map((f) => [f, fs.readFileSync(path.join(JS, f), 'utf8')]);

function load(as) {
  const mem = new Map();
  const ctx = {
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    location: { search: `?as=${as}`, href: `http://x/?as=${as}` },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {} }, body: { classList: { add() {} } } },
    setTimeout, clearTimeout, console, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  SRC.forEach(([f, s]) => vm.runInContext(s, ctx, { filename: f }));
  ctx.NT.store.reset();
  return ctx.NT.store;
}

test('导师只看到自己交的材料里的待核对，HR 看全部', () => {
  const hr = load('hrbp'), mentor = load('mentor');
  const all = hr.visibleInbox().map((i) => i.id);
  const mine = mentor.visibleInbox();
  assert.ok(all.includes('i-aze') && all.includes('i-int'));
  assert.ok(mine.length > 0 && mine.length < all.length);
  assert.ok(mine.every((i) => i.by === mentor.me().id));
  assert.ok(!mine.some((i) => i.id === 'i-int'));
});

test('面评导入只写已确认的行，跳过的行和待核对的行留在预览', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const state = (rid) => st.ivRowState(imp.rows.find((r) => r.id === rid));
  assert.equal(state('r3'), 'skip');
  assert.equal(state('r6'), 'dup');
  assert.equal(state('r2'), 'verify');
  st.ivConfirm('imp-1', 'r1', true);
  const res = st.ivImport('imp-1');
  assert.equal(res.n, 1);
  const e = st.event('e-iv-imp-1-r1');
  assert.equal(e.kind, 'hist');
  assert.equal(e.scores.length, 0, '原量表不换算成维度分');
  assert.ok(e.scale.length > 0);
  assert.equal(imp.state, 'preview');
  res.undo();
  assert.equal(st.event('e-iv-imp-1-r1'), undefined);
  assert.equal(state('r1'), 'confirmed');
});

test('非管理岗的管理能力写不适用；没读出的分补录前不能确认', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const r2 = imp.rows.find((r) => r.id === 'r2');
  st.resolveInbox(r2.verify, 's-28');
  assert.equal(st.ivRowState(r2), 'unread');
  st.ivFill('imp-1', 'r2', 'B');
  assert.equal(st.ivRowState(r2), 'confirm');
  st.ivConfirm('imp-1', 'r2', true);
  st.ivImport('imp-1');
  const scale = Object.fromEntries(st.event('e-iv-imp-1-r2').scale);
  assert.equal(scale['系统设计'], 'B');
  assert.equal(scale['管理能力'], '不适用');
});

test('评委没有都确认本人评分时，HR 不能确认节点结论；评委不能确认结论', () => {
  const hr = load('hrbp');
  const pending = hr.conclusions('pg-def:n0').find((c) => hr.judgeStatus(c).some((j) => !j.done));
  assert.ok(pending, '演示数据里应有一位评委未确认的结论');
  hr.confirmConclusion(pending.id, '建议转正', '依据', 'edit');
  assert.equal(pending.versions.length, 0);

  const ready = hr.conclusions('pg-def:n0').find((c) => hr.judgeStatus(c).every((j) => j.done));
  const undo = hr.confirmConclusion(ready.id, '建议转正', '两位评委都已确认本人评分', 'ai');
  assert.equal(ready.versions[0].type, '建议转正');
  undo();
  assert.equal(ready.versions.length, 0);

  const mentor = load('mentor');
  assert.equal(mentor.canConfirmConclusion(), false);
});

test('重新分派：已有变化的事以原评价人为准，接手人获得到最晚截止日的评价关系，可以撤销', () => {
  const st = load('hrbp');
  const items = st.reassignItems();
  assert.ok(items.some((x) => x.race));
  const cands = st.reassignCandidates(items);
  assert.ok(cands.some((c) => !c.ok), '关系已到期的人置灰');
  const to = cands.find((c) => c.ok && c.id !== st.me().id).id;
  const before = st.relations().length;
  const res = st.reassign(items.map((x) => x.id), to);
  assert.equal(res.conflicts.length, items.filter((x) => x.race).length);
  assert.equal(res.done.length, items.length - res.conflicts.length);
  const rel = st.relations().find((r) => r.rater === to && r.label === '接手评价');
  assert.equal(rel.to, res.done.map((x) => x.due).sort().pop());
  assert.equal(st.reassignItems().length, 0);
  res.undo();
  assert.equal(st.relations().length, before);
  assert.equal(st.reassignItems().length, res.done.length);
  assert.equal(load('mentor').reassignItems().length, 0, '重新分派只给 HR');
});
