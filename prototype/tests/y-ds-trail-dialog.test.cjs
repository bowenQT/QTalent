'use strict';

// 设计系统页：轨迹的 data-open 是展开状态，点标题不能去找 #true / #false。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '../y/design-system.html'), 'utf8');

function binder() {
  const mark = "$$('[data-open]').forEach";
  const at = src.indexOf(mark);
  assert.ok(at > 0, '应保留 data-open 绑定');
  const end = src.indexOf("$$('.n-dialog')", at);
  assert.ok(end > at);
  return src.slice(at, end);
}

test('轨迹标题的点击绑定只打开 dialog', () => {
  const snippet = binder();
  assert.equal(snippet.includes(".showModal()"), true);
  assert.equal(snippet.includes("tagName === 'DIALOG'"), true);
  assert.equal(src.includes("t.dataset.open = open"), true);

  const calls = [];
  const nodes = {
    true: { id: 'true', tagName: 'DIV', showModal() { calls.push('true'); } },
    false: { id: 'false', tagName: 'DIV', showModal() { calls.push('false'); } },
    'dlg-delete': { id: 'dlg-delete', tagName: 'DIALOG', showModal() { calls.push('dlg-delete'); } },
    'not-dialog': { id: 'not-dialog', tagName: 'DIV', showModal() { calls.push('not-dialog'); } },
  };
  const buttons = [
    { dataset: { open: 'true' }, addEventListener(ev, fn) { this.fn = fn; this.ev = ev; } },
    { dataset: { open: 'false' }, addEventListener(ev, fn) { this.fn = fn; } },
    { dataset: { open: 'dlg-delete' }, addEventListener(ev, fn) { this.fn = fn; } },
    { dataset: { open: 'not-dialog' }, addEventListener(ev, fn) { this.fn = fn; } },
    { dataset: { open: 'missing' }, addEventListener(ev, fn) { this.fn = fn; } },
  ];
  const $$ = (sel) => {
    assert.equal(sel, '[data-open]');
    return buttons;
  };
  const document = { getElementById: (id) => nodes[id] || null };
  vm.runInNewContext(snippet, { $$, document }, { filename: 'design-system-dialog-binder.js' });
  buttons.forEach((b) => b.fn());
  assert.deepEqual(calls, ['dlg-delete']);
});
