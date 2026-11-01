'use strict';

// 版本 Y：批量导出与档案打印只取当前视角范围内、已确认的事件分；导师和系统管理员不能导出；审计只记动作。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const FILES = ['../y/app/js/core.js', '../y/app/js/data-xe6.js', '../y/app/js/data.js', '../y/app/js/store.js'];

function load(role, ctx = {}) {
  const search = `?as=${role}`;
  const mem = new Map();
  const context = Object.assign(ctx, {
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
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
  });
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

test('每行带对应版本的行为锚点；待复核的分不导出，复核后取复核结果', () => {
  const st = load('hrbp');
  const pid = 'p-x01';
  const prof = st.exportRows([pid]).rows.find((r) => r.ev === 'e-x01-3' && r.dim === '专业度');
  assert.equal(prof.anchor, '超出本届学员预期');

  // 演示一次不兼容修订后的复核暂停：心性维度的旧分暂停取数，复核确认后按复核结果导出
  const S = st.get();
  S.reviewHolds = [{ ver: 'rubric-v2', from: '2000-01-01', fams: [], potHit: true, at: '2026-09-04' }];
  const held = st.exportRows([pid]);
  assert.ok(held.rows.every((r) => r.dim === '专业度'), '心性维度的旧分待复核，不导出');
  const ev = st.event('e-x01-3'), s = ev.scores.find((x) => x.p === pid && x.d === 'mot');
  s.revs = [{ v: 5, ver: 'rubric-v2', by: 'p-suwan', at: '2026-09-04' }];
  const r = st.exportRows([pid]).rows.find((x) => x.ev === 'e-x01-3' && x.dim === '内生动力');
  assert.equal(r.v, 5);
  assert.equal(r.by, 'p-suwan');
  assert.equal(r.rubric, '评价规则 v2');
  assert.equal(r.anchor, st.anchors('mot', pid, st.ruleVer('rubric-v2')).list[4]);
  assert.equal(held.skipped > 0, true);
});

test('生成时按当前视角再判：角色换成导师就拒绝，范围里没有已确认内容就不生成', () => {
  const ctx = {};
  const st = load('hrbp', ctx);
  const all = st.exportScopes().find((s) => s.id === 'all');
  assert.equal(st.exportCheck(all.people).state, 'ok');

  // 另一个标签页把共享角色切成导师：页面不带 as 参数，生成时读到的是导师
  ctx.location.search = '';
  ctx.location.href = 'http://localhost/';
  st.setRole('mentor');
  const deny = st.exportCheck(all.people);
  assert.equal(deny.state, 'deny');
  assert.equal(deny.rows, undefined, '拒绝时不取数');

  st.setRole('hrbp');
  const outside = st.people().filter((p) => !st.scope(p.id)).map((p) => p.id);
  assert.equal(st.exportCheck(outside).state, 'empty', '范围外的人取不到内容');
  assert.equal(st.exportCheck(all.people, '2099-01-01').state, 'empty', '时间范围里没有事件');
});

test('导出生成回调：拒绝和空结果都不生成文件、不记导出成功', () => {
  const src = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/workbench.js'), 'utf8');
  const body = src.slice(src.indexOf('function runExport('), src.indexOf('function buildCsv('));
  const deny = body.indexOf("r.state === 'deny'"), empty = body.indexOf("r.state === 'empty'");
  const blob = body.indexOf('buildCsv(r.rows'), ok = body.indexOf("st.audit('导出已确认内容'");
  assert.ok(body.includes('st.exportCheck('), '生成时走 exportCheck 再判一次');
  assert.ok(deny > 0 && empty > deny && blob > empty && ok > blob, '先判拒绝、再判空结果，之后才生成文件、记成功');
  const branch = body.slice(deny, blob);
  assert.ok(!branch.includes('createObjectURL') && !branch.includes("'导出已确认内容'"));
  assert.match(branch, /st\.audit\('拒绝导出'/);
});

test('审计、导出和打印的时刻用演示时钟：日期是演示日，每记一条往后一分钟', () => {
  const st = load('hrbp');
  assert.equal(st.clockNow(), '2026-09-04 15:00');
  st.audit('导出已确认内容', '我负责的人');
  assert.equal(st.audits()[0].at, '09-04 15:00');
  assert.equal(st.clockNow(), '2026-09-04 15:01');
  st.audit('拒绝打印', '某人的档案');
  assert.equal(st.audits()[0].at, '09-04 15:01');
});

test('还在评分复核队列里的分不导出、不打印，计入已跳过；复核后再进导出', () => {
  const st = load('hrbp');
  const pid = 'p-x14';
  const ev = st.event('e-x14-3'), s = ev.scores[0];
  assert.ok(st.queue().some((q) => q.kind === 'gap' && q.ev.id === 'e-x14-3'), '种子：改了 AI 的分差大又没写理由，在评分复核队列里');
  const before = st.exportRows([pid]);
  assert.ok(!before.rows.some((r) => r.ev === 'e-x14-3'), '评分复核里的分不导出');
  assert.ok(before.skipped >= 1);
  st.calibrate('e-x14-3', 0, 4, '引用能支撑 4 分');
  assert.equal(st.inScoreReview(s), false);
  const after = st.exportRows([pid]);
  assert.equal(after.rows.filter((r) => r.ev === 'e-x14-3').length, 1, '校准后离开队列，按已校准的分导出');
  assert.equal(after.skipped, before.skipped - 1);

  // 两位评价人分差大、待校准的分同样跳过
  const pending = { p: pid, d: 'grit', st: 'conflict', v: 3, raters: [{ by: 's-09', v: 2 }, { by: 'p-yeqing', v: 5 }] };
  ev.scores.push(pending);
  assert.equal(st.inScoreReview(pending), true);
  const withConflict = st.exportRows([pid]);
  assert.ok(!withConflict.rows.some((r) => r.ev === 'e-x14-3' && r.dim === '坚毅力'));
  assert.equal(withConflict.skipped, after.skipped + 1);
});

test('多来源事件：来源位置取这条分的引用所在的那一处，对不上时列出全部来源', () => {
  const st = load('hrbp');
  const rows = st.exportRows(['p-x01']).rows.filter((r) => r.ev === 'e-x01-2');
  const by = (dim) => rows.find((r) => r.dim === dim);
  assert.equal(by('专业度').src, 'XEngineer 第六期观察表 · W4–W5 · 突出表现 · 第 6 行');
  assert.equal(by('专业度').srcExact, true);
  assert.equal(by('智慧力').src, 'XEngineer 第六期观察表 · W4–W5 · 待改进 · 第 6 行', '引用落在待改进那一处，不再取第一处');

  // 引用的是事件描述，两处来源原文里都没有：关联不足，列出全部来源
  const loose = st.exportRows(['p-x03']).rows.find((r) => r.ev === 'e-x03-1' && r.dim === '专业度');
  assert.equal(loose.srcExact, false);
  assert.equal(loose.src, st.event('e-x03-1').srcs.map((x) => `${x.label} · ${x.loc}`).join('；'));

  // 只有一处来源的事件就是那一处
  const single = st.exportRows(['p-x03']).rows.find((r) => r.ev === 'e-x03-3');
  assert.equal(single.srcExact, true);
  assert.equal(single.src, 'XEngineer 第六期观察表 · W7–W8 · 待改进 · 第 8 行');
});
