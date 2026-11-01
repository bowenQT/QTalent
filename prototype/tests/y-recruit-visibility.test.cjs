'use strict';

// 用版本 Y 的真实数据和 store 验证面评导入后的可见性：面评作为「招聘评估」进档案，导师在档案、时间线、
// visibleEvents、速览里都看不到；HR 和管理者照常能看到。过滤按来源类别，不按类型名。演示数据，无真实员工。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const JS = path.join(__dirname, '../y/app/js');
const FILES = ['core.js', 'data-xe6.js', 'data.js', 'data-intake.js', 'store.js', 'intake.js', 'ui.js'];
const SRC = FILES.map((f) => [f, fs.readFileSync(path.join(JS, f), 'utf8')]);

function load(as, mem = new Map(), fresh = true) {
  const ctx = {
    matchMedia: () => ({ matches: false }), addEventListener() {},
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    location: { search: `?as=${as}`, href: `http://x/?as=${as}`, pathname: '/y/app/person.html' },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {} }, body: { classList: { add() {} } } },
    setTimeout, clearTimeout, console, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  SRC.forEach(([f, s]) => vm.runInContext(s, ctx, { filename: f }));
  if (fresh) ctx.NT.store.reset();
  return ctx.NT;
}

// HR 确认并导入 imp-1 / r5（p-x10 的面评），其余视角接着同一份演示状态
function imported() {
  const mem = new Map();
  const hr = load('hrbp', mem).store;
  hr.ivConfirm('imp-1', 'r5', true);
  assert.equal(hr.ivImport('imp-1').n, 1);
  return { mem, id: 'e-iv-imp-1-r5', row: hr.importOf('imp-1').rows.find((r) => r.id === 'r5') };
}

test('面评导入的历史类型是「招聘评估」，按来源类别标为招聘资料', () => {
  const { mem, id } = imported();
  const st = load('hrbp', mem, false).store;
  const e = st.event(id);
  assert.equal(e.histType, '招聘评估');
  assert.equal(st.isRecruit(e), true);
});

test('导师在 visibleEvents、档案取数和速览里都看不到 HR 面评的原量表、动机和结论', () => {
  const { mem, id, row } = imported();
  const NT = load('mentor', mem, false), st = NT.store;
  assert.equal(st.me().name, '叶青');
  assert.equal(st.scope('p-x10'), 'mentor', '导师能看这位学员的档案');
  const { events } = st.visibleEvents('p-x10');
  assert.ok(!events.some((e) => e.id === id), '档案和时间线的事件里没有面评');
  assert.ok(events.length > 0, '其他能看的事件照常显示');
  const peek = String(NT.ui.peekPerson('p-x10'));
  [row.note, `面试结论：${row.verdict}`, '求职动机', '原量表 · 单独保存'].forEach((t) => assert.ok(!peek.includes(t), `速览里没有「${t}」`));
  // AI 摘要按视角能看到的事件取，面评不在里面
  assert.ok(!st.visibleEvents('p-x10').events.some((e) => st.isRecruit(e)));
});

test('HR 和管理者照常能看到面评原文', () => {
  const { mem, id } = imported();
  ['hrbp', 'ceo'].forEach((as) => {
    const st = load(as, mem, false).store;
    const e = st.visibleEvents('p-x10').events.find((x) => x.id === id);
    assert.ok(e, `${as} 能看到面评`);
    assert.ok(e.scale.some(([k]) => k === '求职动机'));
    assert.ok(e.scale.some(([k]) => k === '面试结论'));
  });
});

test('导师过滤按来源类别排除：类型名写法不同的招聘资料同样看不到，其他历史资料照常可见', () => {
  const mem = new Map();
  const hr = load('hrbp', mem).store;
  hr.addEvent({ id: 'e-demo-recruit', kind: 'hist', histType: '社招面试评价表', cat: 'recruit', date: '2026-06-01', recorder: 'p-suwan', people: ['p-x10'], title: '演示面评', srcs: [], scale: [['面试结论', '通过']], tags: [], scores: [] });
  hr.addEvent({ id: 'e-demo-camp', kind: 'hist', histType: '训练营评审', date: '2026-06-02', recorder: 'p-suwan', people: ['p-x10'], title: '演示评审', srcs: [], scale: [['作品分', '86']], tags: [], scores: [] });
  const m = load('mentor', mem, false).store;
  const seen = m.visibleEvents('p-x10').events.map((e) => e.id);
  assert.ok(!seen.includes('e-demo-recruit'), '招聘类别的资料导师看不到');
  assert.ok(seen.includes('e-demo-camp'), '训练营评审照常可见');
});

test('档案页和手机档案的时间线只从 visibleEvents 取事件；「原量表 · 单独保存」按招聘类别显示', () => {
  const desk = fs.readFileSync(path.join(JS, 'pages/person.js'), 'utf8');
  const mob = fs.readFileSync(path.join(__dirname, '../y/m/js/pages/person.js'), 'utf8');
  assert.match(desk, /const \{ events, hidden: hiddenN \} = st\.visibleEvents\(pid\)/);
  assert.match(mob, /const \{ events, hidden \} = st\.visibleEvents\(pid\)/);
  assert.match(desk, /st\.isRecruit\(e\) \? html`<span class="n-scale__tag">原量表 · 单独保存<\/span>`/);
  [desk, mob].forEach((s) => assert.doesNotMatch(s, /histType === '面试'/));
});
