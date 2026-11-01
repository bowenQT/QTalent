'use strict';

// 用版本 Y 的真实数据和 store 验证对人复盘的终态检查：复盘确认时记下当时的事件，之后不论从哪条路径进来的事
// 都不并入已确认的复盘，作为这个人单独的一件待确认的事留在原批次回执里；复盘还没确认时照常并入。演示数据，无真实员工。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const JS = path.join(__dirname, '../y/app/js');
const FILES = ['core.js', 'data-xe6.js', 'data.js', 'data-intake.js', 'store.js', 'intake.js', 'parse.js'];
const SRC = FILES.map((f) => [f, fs.readFileSync(path.join(JS, f), 'utf8')]);

function load(as, mem = new Map(), fresh = true) {
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
  if (fresh) ctx.NT.store.reset();
  return ctx.NT;
}

const ids = (r) => [...r.events.map((e) => e.id)].sort();
// 先把复盘里现有的建议分确认掉，再确认整份复盘
function confirmWhole(st, pid) {
  st.review(pid, 'W8').events.forEach((e) => e.scores.forEach((s, i) => { if (s.p === pid && s.st === 'ai') st.confirmScore(e.id, i, s.ai); }));
  return st.confirmReview(pid, 'W8');
}

// 每一条会往对人复盘里加事件的路径：返回新加进来的事件和它归到的人
const PATHS = {
  // 工作台统一投递：纪要读完后直接整理出一件事（08-28，p-x07）
  '统一投递整理出的事': (NT) => { const d = NT.store.addDemoDrop(); return { pid: 'p-x07', evs: [NT.store.event(`e-${d.id}`)] }; },
  // 人名核对：草稿里的人认出来以后生成的事（p-x07）
  '人名核对后生成的事': (NT) => { NT.store.resolveInbox('i-meng', 'p-x07'); return { pid: 'p-x07', evs: [NT.store.event('e-i-meng')] }; },
  // 说话人核对：挂在批次里的事归到这个人（p-x13）
  '说话人核对后归到人的事': (NT) => { NT.store.resolveInbox('i-spk', 'p-x13'); return { pid: 'p-x13', evs: [NT.store.event('e-d4')] }; },
  // 未知人员核对：挂在批次里的事归到这个人（p-x15）
  '未知人员核对后归到人的事': (NT) => { NT.store.resolveInbox('i-xz', 'p-x15'); return { pid: 'p-x15', evs: [NT.store.event('e-d5')] }; },
  // 图片范围选「整理范围内的行」：每一行按核对当天整理成一件事（统一投递里那张截图，p-x07 一行）；
  // 演示的「今天」在结营之后，这里把核对放在 08-30，让这一行落在 W8 复盘范围里
  '图片范围整理出的行': (NT) => {
    NT.TODAY = '2026-08-30';
    const d = NT.store.addDemoDrop();
    NT.store.removeEvent(`e-${d.id}`);
    NT.store.resolveInbox(`i-${d.id}`, 'rows');
    return { pid: 'p-x07', evs: NT.store.get().events.filter((e) => e.verifyOf === `i-${d.id}` && e.people.includes('p-x07')) };
  },
  // 记一件事：按发生日期落在复盘范围里
  '记一件事（日期在复盘范围内）': (NT) => {
    const { e } = NT.parse.commit({ pid: 'p-x10', date: '2026-08-27', title: '演示：把联调问题整理成清单', act: '联调前把问题列成清单', bg: '', res: '', text: '演示原话', pending: true,
      scores: [{ d: 'mot', ai: 4, v: 4, note: '锚点 4' }] });
    return { pid: 'p-x10', evs: [e] };
  },
  // 复盘里直接补一件事：按当天记日期，但归属这次复盘
  '复盘里直接补的事': (NT) => {
    const { e } = NT.parse.commit({ pid: 'p-x10', review: 'p-x10-W8', title: '演示：复盘时补记的一件事', act: '复盘时补记', bg: '', res: '', text: '演示原话', pending: true,
      scores: [{ d: 'wis', ai: 3, v: 3, note: '锚点 3' }] });
    return { pid: 'p-x10', evs: [e] };
  },
  // 其他直接写事件的入口（例如「值得聊一聊」后的沟通）都走 addEvent
  '直接写入的事件': (NT) => {
    const e = NT.store.addEvent({ id: 'e-demo-direct', kind: 'obs', date: '2026-08-20', recorder: NT.store.me().id, people: ['p-x06'], title: '演示：沟通记录', bg: '', act: '演示', res: '', srcs: [], tags: [],
      scores: [{ p: 'p-x06', d: 'lead', v: 3, st: 'ai', ai: 3, note: '锚点 3' }] });
    return { pid: 'p-x06', evs: [e] };
  },
};

for (const [name, run] of Object.entries(PATHS)) {
  test(`${name}：复盘已确认后进来的内容不并入复盘，单独待确认；确认后照常进档案`, () => {
    const NT = load('hrbp'), st = NT.store;
    const pid = { '统一投递整理出的事': 'p-x07', '人名核对后生成的事': 'p-x07', '图片范围整理出的行': 'p-x07', '说话人核对后归到人的事': 'p-x13', '未知人员核对后归到人的事': 'p-x15', '直接写入的事件': 'p-x06' }[name] || 'p-x10';
    assert.ok(confirmWhole(st, pid), '复盘可以确认');
    const before = st.review(pid, 'W8');
    const { evs } = run(NT);
    assert.ok(evs.length && evs.every(Boolean), '这条路径加进了事件');
    const after = st.review(pid, 'W8');
    assert.equal(after.state, 'confirmed', '复盘状态不变');
    assert.equal(after.ai, 0, '复盘里没有混进待确认的分');
    assert.equal(after.conflicts, before.conflicts);
    assert.deepEqual(ids(after), ids(before), '复盘里的事不变');
    assert.deepEqual(after.rows.map((r) => r.state), before.rows.map((r) => r.state), '每一维的状态不变');
    evs.forEach((e) => {
      assert.deepEqual([...st.lateReviews(e)], [`${pid}-W8`], '这件事落在已确认复盘的范围里，单独列出');
      assert.equal(st.lateNote(e), 'W8 对人复盘已确认，这件事单独待确认');
      assert.equal(st.reviewLockOf(e, e.scores[0]), null, '这件事的分不跟着已确认的复盘冻结，可以单独确认');
      e.scores.forEach((s, i) => { if (s.st === 'ai') st.confirmScore(e.id, i, s.ai); });
      assert.equal(st.lateNote(e), 'W8 对人复盘已确认，这件事单独记入档案');
      assert.ok(st.scoresOf(pid).some((s) => s.ev.id === e.id), '确认后照常进档案取数');
    });
    const done = st.review(pid, 'W8');
    assert.equal(done.state, 'confirmed');
    assert.deepEqual(ids(done), ids(before), '确认以后也不并入已确认的复盘');
  });

  test(`${name}：复盘还没确认时照常并入复盘`, () => {
    const NT = load('hrbp'), st = NT.store;
    const { pid, evs } = run(NT);
    const r = st.review(pid, 'W8');
    assert.equal(r.state, 'draft');
    evs.forEach((e) => {
      assert.ok(r.events.includes(e), '并入复盘');
      assert.deepEqual([...st.lateReviews(e)], []);
      assert.equal(st.lateNote(e), null);
    });
    assert.ok(r.ai >= 1, '待确认的分在复盘里，复盘要等它确认');
    assert.equal(st.confirmReview(pid, 'W8'), null);
  });
}

test('统一投递（连接器复现）：确认整份 W8 后投递，复盘仍是 confirmed / ai 0 / 4 件事', () => {
  const st = load('hrbp').store;
  assert.ok(st.confirmReview('p-x07', 'W8'));
  const d = st.addDemoDrop();
  st.event(`e-${d.id}`).readyAt = 0;
  const r = st.review('p-x07', 'W8');
  assert.equal(r.state, 'confirmed');
  assert.equal(r.ai, 0);
  assert.equal(r.events.length, 4);
  assert.ok(!r.events.some((e) => e.id === `e-${d.id}`));
  // 这件事留在这次投递的回执里，单独待确认
  const x = st.dropItems(d).find((y) => y.ev.id === `e-${d.id}`);
  assert.ok(x && x.state === 'ai', '回执里单独一件待确认的事');
});

test('撤销复盘确认后，确认之后进来的事照常并入复盘', () => {
  const st = load('hrbp').store;
  assert.ok(st.confirmReview('p-x07', 'W8'));
  const d = st.addDemoDrop();
  const e = st.event(`e-${d.id}`);
  assert.ok(!st.review('p-x07', 'W8').events.includes(e));
  delete st.get().reviews['p-x07-W8'];
  const r = st.review('p-x07', 'W8');
  assert.equal(r.state, 'draft');
  assert.ok(r.events.includes(e));
  assert.equal(st.lateNote(e), null);
});

test('确认复盘时记下当时的事件；复盘范围外的事不受影响', () => {
  const st = load('hrbp').store;
  const before = st.review('p-x07', 'W8');
  const saved = st.confirmReview('p-x07', 'W8');
  assert.deepEqual([...saved.events].sort(), ids(before));
  // 复盘范围之后发生的事不属于这份复盘，也不算单独列出
  const e = st.addEvent({ id: 'e-demo-after', kind: 'obs', date: '2026-09-03', recorder: st.me().id, people: ['p-x07'], title: '演示', bg: '', act: '', res: '', srcs: [], tags: [], scores: [] });
  assert.deepEqual([...st.lateReviews(e)], []);
  assert.equal(st.lateNote(e), null);
});

test('终态检查只放在复盘归入事件的那一处：各入口不再逐个标记', () => {
  const intake = fs.readFileSync(path.join(JS, 'intake.js'), 'utf8');
  const store = fs.readFileSync(path.join(JS, 'store.js'), 'utf8');
  assert.doesNotMatch(intake, /markLate|\.late\s*=/, '入口不逐个标记');
  assert.doesNotMatch(store, /e\.late\b/);
  assert.match(store, /saved\.events\.includes\(e\.id\)/, '复盘按确认时记下的事件取');
});
