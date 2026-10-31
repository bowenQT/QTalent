'use strict';
// 取消进行中的发表后，晚到的成功响应不能进入列表，也不能清掉新草稿。不访问外部服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

class El {
  constructor(tag) {
    this.nodeType = 1; this.tag = tag; this.children = []; this.events = {};
    this.attrs = {}; this.className = ''; this.value = ''; this.hidden = false;
    this.style = {}; this.classList = { add() {}, remove() {}, toggle() {} };
  }
  append(...xs) { this.children.push(...xs); }
  replaceChildren(...xs) { this.children = xs; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { (this.events[k] ||= []).push(f); }
  async fire(k) { for (const fn of this.events[k] || []) await fn({ target: this, preventDefault() {} }); }
  querySelector(s) { return find(this, e => s.startsWith('[data-thread=') && e.attrs['data-thread'] === s.slice(14, -2)); }
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
function textOf(node) {
  if (typeof node === 'string') return node;
  if (!(node instanceof El)) return '';
  return node.children.map(textOf).join('');
}
const cls = (root, name) => find(root, e => e.className.split(/\s+/).includes(name));
function button(root, label) {
  return find(root, e => e.tag === 'button' && textOf(e) === label);
}

function setup(honorAbort = true) {
  const original = fs.readFileSync(path.join(__dirname, '../worker/client/review.js'), 'utf8');
  const end = /}\)\(\);\s*$/;
  assert.match(original, end);
  const source = original.replace(end, [
    'window.__spec = {',
    '  begin() { pending = { kind: "text", quote: "演示划线" }; loadState = "ready"; panel.hidden = false; renderPanel(); },',
    '  panel,',
    '  bodies() { return threads.map((t) => t.body); },',
    '  draft() { return commentDraft; },',
    '  posting() { return postingComment; },',
    '};',
    '})();',
  ].join('\n'));
  const calls = [];
  const fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    const posted = opts.body ? JSON.parse(opts.body) : null;
    const rec = { method: opts.method || 'GET', url: String(url), body: posted && posted.body, page: posted && posted.page };
    calls.push(rec);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        rec.aborted = true;
        if (honorAbort) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }
    rec.resolve = () => resolve({
      ok: true,
      status: rec.method === 'POST' ? 201 : 200,
      json: async () => (rec.method === 'POST'
        ? { comment: { id: '33333333-3333-4333-8333-333333333333', author: 'reviewer@example.test', body: posted.body, kind: 'text', quote: '演示划线', resolved: 0, created_at: '2026-10-25T00:00:00.000Z' } }
        : { ok: true }),
    });
  });
  const document = {
    createElement: tag => new El(tag), addEventListener() {}, readyState: 'loading',
    querySelectorAll: () => [], body: new El('body'),
    documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const window = { addEventListener() {}, innerWidth: 1024, scrollY: 0 };
  const context = {
    window, document, fetch, URLSearchParams, AbortController,
    location: { search: '', pathname: '/y/app/people.html' },
    MutationObserver: class { observe() {} takeRecords() { return []; } },
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  };
  vm.runInNewContext(source, context, { filename: 'review.js' });
  return { calls, spec: context.window.__spec, document };
}

function compose(ui, text) {
  ui.spec.begin();
  const box = cls(ui.spec.panel, 'rv-compose');
  const field = find(box, e => e.tag === 'textarea');
  field.value = text;
  return { box, field };
}

test('取消进行中的发表后，中止请求并让新草稿可以立刻再写', async () => {
  const ui = setup();
  const { box, field } = compose(ui, '第一条正在发送');
  await field.fire('input');
  const send = button(box, '发表评论');
  const posting = send.fire('click');
  const post = ui.calls.find(c => c.method === 'POST');
  assert.ok(post);
  assert.equal(post.body, '第一条正在发送');
  assert.equal(send.disabled, true);
  await button(box, '取消').fire('click');
  assert.equal(post.aborted, true);
  const again = compose(ui, '取消之后的新草稿');
  await again.field.fire('input');
  const next = button(again.box, '发表评论');
  assert.ok(next);
  assert.equal(next.disabled, undefined);
  assert.equal(again.field.value, '取消之后的新草稿');
  assert.equal(ui.spec.posting(), false);
  await posting;
  assert.deepEqual(Array.from(ui.spec.bodies()), []);
  assert.equal(ui.spec.draft(), '取消之后的新草稿');
  assert.equal(ui.calls.some(c => c.method === 'DELETE'), false);
});

test('取消之后才返回的成功响应会删掉那条评论，且不清新草稿', async () => {
  const ui = setup(false);
  const { box, field } = compose(ui, '第一条正在发送');
  await field.fire('input');
  const send = button(box, '发表评论');
  const posting = send.fire('click');
  const post = ui.calls.find(c => c.method === 'POST');
  await button(box, '取消').fire('click');
  assert.equal(post.aborted, true);
  const again = compose(ui, '取消之后的新草稿');
  await again.field.fire('input');
  assert.equal(button(again.box, '发表评论').disabled, undefined);
  post.resolve();
  await posting;
  assert.deepEqual(Array.from(ui.spec.bodies()), []);
  assert.equal(ui.spec.draft(), '取消之后的新草稿');
  assert.equal(again.field.value, '取消之后的新草稿');
  const del = ui.calls.find(c => c.method === 'DELETE');
  assert.ok(del);
  assert.equal(del.url, '/api/comments/33333333-3333-4333-8333-333333333333');
});

test('未被取消的发表仍进入列表并清掉草稿', async () => {
  const ui = setup();
  const { box, field } = compose(ui, '已提交意见');
  await field.fire('input');
  const posting = button(box, '发表评论').fire('click');
  ui.calls.find(c => c.method === 'POST').resolve();
  await posting;
  assert.deepEqual(Array.from(ui.spec.bodies()), ['已提交意见']);
  assert.equal(ui.spec.draft(), '');
  compose(ui, '');
  assert.equal(find(cls(ui.spec.panel, 'rv-compose'), e => e.tag === 'textarea').value, '');
});
