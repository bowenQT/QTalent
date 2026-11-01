'use strict';

// 撤销 Toast 如实说结果：undo() 返回 false 显示没撤销，返回字符串显示这段文字，返回 true 或不返回才显示「已撤销」。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function el(tag) {
  const node = {
    tagName: tag, children: [], dataset: {}, attrs: {}, innerHTML: '', className: '',
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...xs) { this.children.push(...xs); },
    prepend(...xs) { this.children.unshift(...xs); },
    remove() { node.removed = true; },
    animate() {},
  };
  return node;
}

function boot() {
  const timers = [];
  const document = {
    readyState: 'loading',
    body: el('body'),
    createElement: el,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
  };
  const window = {};
  const src = fs.readFileSync(path.join(__dirname, '../y/app/js/core.js'), 'utf8');
  vm.runInNewContext(src, {
    window, document,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    addEventListener() {},
  }, { filename: 'prototype/y/app/js/core.js' });
  const NT = window.NT;
  return {
    NT,
    show(opts) {
      NT.toast('已保存', opts);
      const host = document.body.children.at(-1);
      const t = host.children.at(-1);
      const btn = t.children.find((c) => c.className === 'n-toast__undo');
      return { t, click: () => btn.onclick(), lastTimer: () => timers.filter((x) => !x.cleared).at(-1) };
    },
  };
}

test('undo() 不返回时显示 undoneText，按成功处理', () => {
  const { show } = boot();
  const h = show({ undo() {}, undoneText: '已撤销，记录没有保存' });
  h.click();
  assert.match(h.t.innerHTML, /已撤销，记录没有保存/);
  assert.equal(h.t.dataset.state, undefined);
  assert.equal(h.lastTimer().ms, 1600);
});

test('undo() 返回 true 时显示 undoneText；没给 undoneText 时写「已撤销」', () => {
  const { show } = boot();
  const h = show({ undo: () => true });
  h.click();
  assert.match(h.t.innerHTML, /<span>已撤销<\/span>/);
  assert.equal(h.t.dataset.state, undefined);
});

test('undo() 返回 false 时显示没撤销，不显示 undoneText', () => {
  const { show } = boot();
  const h = show({ undo: () => false, undoneText: '已撤销，记录没有保存' });
  h.click();
  assert.doesNotMatch(h.t.innerHTML, /已撤销/);
  assert.match(h.t.innerHTML, /撤销失败，已保留当前内容/);
  assert.equal(h.t.dataset.state, 'fail');
  assert.match(h.t.innerHTML, /#i-info/);
  assert.equal(h.lastTimer().ms, 4000);
});

test('undo() 返回 false 时用调用方给的 failText', () => {
  const { show } = boot();
  const h = show({ undo: () => false, failText: '撤销失败：这条已经被处理' });
  h.click();
  assert.match(h.t.innerHTML, /撤销失败：这条已经被处理/);
});

test('undo() 返回字符串时显示这段文字，并转义', () => {
  const { show } = boot();
  const h = show({ undo: () => '这条已经有了后续处理 <b>', undoneText: '已撤销' });
  h.click();
  assert.match(h.t.innerHTML, /这条已经有了后续处理 &lt;b&gt;/);
  assert.doesNotMatch(h.t.innerHTML, /<span>已撤销<\/span>/);
  assert.equal(h.lastTimer().ms, 4000);
});
