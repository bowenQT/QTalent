'use strict';

// 系统管理员不能从桌面壳进入手机版，手机壳也不把管理员改写成导师。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const shellSrc = fs.readFileSync(path.join(__dirname, '../y/app/js/shell.js'), 'utf8');
const mobileSrc = fs.readFileSync(path.join(__dirname, '../y/m/js/mshell.js'), 'utf8');

function piece(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(piece).join('');
  return String(v);
}
function html(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (i < vals.length ? piece(vals[i]) : ''), '');
}

function bootShell(role) {
  const menus = [];
  const mounted = [];
  const st = {
    role: () => role,
    tickTasks() {},
    me: () => ({ id: 'p-demo', name: '演示' }),
    todos: () => [],
    get: () => ({ batches: [] }),
    roles: {
      ceo: { label: '管理者', person: 'p-cheng', scope: '公司层' },
      hrbp: { label: 'HR', person: 'p-suwan', scope: '人才项目' },
      mentor: { label: '导师', person: 'p-yeqing', scope: '所带学员' },
      admin: { label: '系统管理员', person: 'p-xuheng', scope: '系统配置' },
    },
    person: () => ({ name: '演示' }),
    canJudge: () => false,
    isRater: () => false,
    can: () => false,
    canOpenMinutes: () => false,
    search: () => ({ people: [], projects: [] }),
  };
  let ready = () => {};
  const NT = {
    store: st,
    html, icon: () => '', raw: (s) => s,
    mount: (el, content) => { const text = String(content); el.innerHTML = text; mounted.push(text); },
    menu: (_btn, items) => { menus.push(items); },
    $: () => ({ addEventListener() {}, setAttribute() {} }),
    ui: { avatar: () => '', mountIPs() {}, state: (o) => o.title },
    ready: (fn) => { ready = fn; },
    applyRestore() {}, reviewPage() {}, esc: (s) => String(s ?? ''), link: () => '', resetDemo() {},
  };
  const el = () => ({ className: '', innerHTML: '', open: false, setAttribute() {}, addEventListener() {}, append() {}, showModal() {}, close() {}, focus() {}, querySelector: () => el() });
  const document = {
    title: '',
    body: { classList: { add() {} }, append() {} },
    getElementById: () => ({ innerHTML: '' }),
    querySelector: () => null,
    addEventListener() {},
    createElement: el,
  };
  vm.runInNewContext(shellSrc, {
    window: { NT }, NT, document, location: { href: 'http://local/prototype/y/app/admin.html', hash: '', search: '' }, matchMedia: () => ({ matches: false }),
  });
  return { NT, menus, mounted, start: () => ready() };
}

function labels(items) { return items.filter((it) => it && it.label).map((it) => it.label); }

test('管理员的桌面壳没有手机版入口', () => {
  const boot = bootShell('admin');
  boot.NT.shell({ nav: 'admin', title: '系统管理', render() {} });
  boot.start();
  const side = boot.mounted[0];
  assert.equal(side.includes('手机版'), false);
  assert.equal(side.includes('评审导览'), true);
  assert.equal(JSON.stringify(labels(boot.menus[1])), JSON.stringify(['评审导览', '重置演示数据']));
});

test('管理员打开业务页仍被拦住，且没有手机入口', () => {
  const boot = bootShell('admin');
  let rendered = false;
  boot.NT.shell({ nav: 'work', title: '工作台', render() { rendered = true; } });
  boot.start();
  assert.equal(rendered, false);
  assert.equal(boot.mounted.some((t) => t.includes('系统管理员看不到人才数据')), true);
  assert.equal(boot.mounted[0].includes('手机版'), false);
});

test('HR 仍可打开手机版', () => {
  const boot = bootShell('hrbp');
  boot.NT.shell({ nav: 'work', title: '工作台', render() {} });
  boot.start();
  assert.equal(boot.mounted[0].includes('手机版'), true);
  assert.equal(labels(boot.menus[1]).includes('打开手机版'), true);
});

function bootMobile(role, open) {
  let rendered = false;
  const mounted = [];
  const st = { role: () => role, tickTasks() {}, me: () => ({ id: 'p-yeqing', name: '叶青' }), todos: () => [], roles: { mentor: { label: '导师', scope: '所带学员' }, admin: { label: '系统管理员', scope: '系统配置' } } };
  const NT = {
    store: st, html, icon: () => '',
    mount: (_el, content) => { mounted.push(String(content)); },
    $: () => null, $$: () => [],
    ui: { state: (o) => o.title, mountIPs() {}, avatar: () => '' },
    ready: (fn) => fn(),
    applyRestore() {}, reviewPage() {},
  };
  const document = { title: '', body: { classList: { add() {} } }, getElementById: () => ({}), addEventListener() {} };
  vm.runInNewContext(mobileSrc, { window: { NT }, document, location: { hash: '', search: '' }, setTimeout() {} });
  if (open) NT.mshell({ title: '孟逸尘', render() { rendered = true; } });
  return { role: st.role(), rendered, title: document.title, mounted };
}

test('手机壳不把系统管理员改写成导师，也不渲染学员页', () => {
  const page = bootMobile('admin', true);
  assert.equal(page.role, 'admin');
  assert.equal(page.rendered, false);
  assert.equal(page.title, '系统管理员看不到这一页 · Niu-Talent 手机版');
  assert.equal(page.mounted.join('').includes('孟逸尘'), false);
  assert.equal(page.mounted.join('').includes('系统管理员看不到人才数据'), true);
});

test('管理者、HR、导师打开手机版仍进入导师流程', () => {
  for (const role of ['ceo', 'hrbp', 'mentor']) {
    const page = bootMobile(role, false);
    assert.equal(page.role, 'mentor');
  }
});
