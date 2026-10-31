'use strict';
// 页面其它区域更新时，正在输入的回复框保持焦点和同一个节点。不访问外部服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

class El {
  constructor(tag) {
    this.nodeType = 1; this.tag = tag; this.tagName = String(tag).toUpperCase();
    this.children = []; this.events = {}; this.attrs = {}; this.className = '';
    this.value = ''; this.hidden = false; this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  append(...xs) { this.children.push(...xs); }
  replaceChildren(...xs) { this.children = xs; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(k, f) { (this.events[k] ||= []).push(f); }
  async fire(k) { for (const fn of this.events[k] || []) await fn({ target: this, preventDefault() {} }); }
  querySelector(s) { return find(this, e => s.startsWith('[data-thread=') && e.attrs['data-thread'] === s.slice(14, -2)); }
  closest() { return null; }
  contains(node) {
    if (node === this) return true;
    return this.children.some(child => child instanceof El && child.contains(node));
  }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  scrollIntoView() {}
  focus() {}
  remove() {}
}
function find(root, fn) {
  if (!(root instanceof El)) return null;
  if (fn(root)) return root;
  for (const child of root.children) { const hit = find(child, fn); if (hit) return hit; }
  return null;
}
const cls = (root, name) => find(root, e => String(e.className || '').split(/\s+/).includes(name));

function setup() {
  const original = fs.readFileSync(path.join(__dirname, '../worker/client/review.js'), 'utf8');
  const end = /}\)\(\);\s*$/;
  assert.match(original, end);
  const source = original.replace(end, [
    'window.__spec = {',
    '  show(items) { pending = null; threads = items; loadState = "ready"; panel.hidden = false; renderPanel(); },',
    '  panel,',
    '};',
    '})();',
  ].join('\n'));
  let observer = null;
  const timers = [];
  const document = {
    createElement: tag => new El(tag),
    addEventListener() {},
    readyState: 'loading',
    querySelectorAll: () => [],
    querySelector() { return null; },
    body: new El('body'),
    activeElement: null,
    documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const window = { addEventListener() {}, innerWidth: 1280, scrollY: 0, scrollX: 0 };
  vm.runInNewContext(source, {
    window, document, URLSearchParams,
    location: { search: '', pathname: '/y/design-system.html' },
    fetch: async () => { throw new Error('不应请求'); },
    MutationObserver: class {
      constructor(fn) { observer = fn; }
      observe() {}
      takeRecords() { return []; }
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1] = () => {}; },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: true }),
  }, { filename: 'review.js' });
  return {
    spec: window.__spec,
    document,
    tick() { const due = timers.splice(0); for (const fn of due) fn(); },
    mutate() {
      observer([{ target: { closest() { return null; } } }]);
    },
  };
}

const thread = {
  id: 'a', author: 'reviewer@example.test', body: '演示讨论', kind: 'text',
  quote: '演示划线', resolved: 0, created_at: '2026-10-25T00:00:00Z',
};

function replyField(panel) {
  return find(cls(panel, 'rv-reply'), e => e.tag === 'textarea');
}

test('回复框聚焦时，页面更新不换掉这个输入框', async () => {
  const ui = setup();
  ui.spec.show([thread]);
  const field = replyField(ui.spec.panel);
  field.value = '回复草稿应保留';
  await field.fire('input');
  ui.document.activeElement = field;
  ui.mutate();
  ui.tick();
  assert.equal(replyField(ui.spec.panel), field);
  assert.equal(ui.document.activeElement, field);
  assert.equal(field.value, '回复草稿应保留');
});

test('回复框没有焦点时，页面更新仍重绘面板并保留草稿文字', async () => {
  const ui = setup();
  ui.spec.show([thread]);
  const field = replyField(ui.spec.panel);
  field.value = '回复草稿应保留';
  await field.fire('input');
  ui.document.activeElement = ui.document.body;
  ui.mutate();
  ui.tick();
  const next = replyField(ui.spec.panel);
  assert.notEqual(next, field);
  assert.equal(next.value, '回复草稿应保留');
});
