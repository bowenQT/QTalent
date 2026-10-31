'use strict';
// 地址栏 replaceState 之后，评论请求必须改用规范页面键。不访问外部服务。
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
  addEventListener(k, f) { (this.events[k] ||= []).push(f); }
  async fire(k) { for (const fn of this.events[k] || []) await fn({ target: this, preventDefault() {} }); }
  querySelector(s) { return find(this, e => s.startsWith('[data-thread=') && e.attrs['data-thread'] === s.slice(14, -2)); }
  querySelectorAll() { return []; }
  closest() { return null; }
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

function pageOf(url) {
  return new URL(url, 'http://review.local').searchParams.get('page');
}

function setup() {
  const original = fs.readFileSync(path.join(__dirname, '../worker/client/review.js'), 'utf8').replace(
    /}\)\(\);\s*$/,
    'window.__spec = { begin() { pending = { kind: "element", selector: "#a", label: "甲" }; commentDraft = ""; loadState = "ready"; panel.hidden = false; renderPanel(); } };\n})();',
  );
  const location = {
    pathname: '/y/app/staffing',
    search: '?new=1&tpl=tpl-ts&as=hrbp',
    href: 'http://127.0.0.1/y/app/staffing?new=1&tpl=tpl-ts&as=hrbp',
  };
  const history = {
    pushState(_s, _t, url) { this.replaceState(_s, _t, url); },
    replaceState(_s, _t, url) {
      const u = new URL(url, location.href);
      location.pathname = u.pathname;
      location.search = u.search;
      location.href = u.href;
    },
  };
  const pending = [];
  const fetch = (url, opts = {}) => new Promise((resolve) => {
    const posted = opts.body ? JSON.parse(opts.body) : null;
    pending.push({
      page: posted?.page || pageOf(url),
      method: opts.method || 'GET',
      resolve: (body) => resolve({
        ok: true,
        status: opts.method === 'POST' ? 201 : 200,
        json: async () => (opts.method === 'POST'
          ? { comment: { id: '22222222-2222-4222-8222-222222222222', author: 'reviewer@example.test', body: posted.body, kind: 'element', selector: '#a', label: '甲', resolved: 0, created_at: '2026-10-25T00:00:00.000Z' } }
          : {
            me: 'reviewer@example.test',
            comments: [{
              id: '11111111-1111-4111-8111-111111111111',
              author: 'reviewer@example.test',
              body,
              kind: 'text',
              quote: '原文',
              resolved: 0,
              created_at: '2026-10-25T00:00:00.000Z',
            }],
          }),
      }),
    });
  });
  const listeners = {};
  const document = {
    createElement: (tag) => new El(tag),
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    readyState: 'interactive',
    querySelectorAll: () => [],
    body: new El('body'),
    documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    innerWidth: 1024,
    scrollY: 0,
    dispatch(type) { for (const fn of listeners[type] || []) fn({}); },
  };
  const context = { window, document, fetch, URLSearchParams, URL, location, history,
    MutationObserver: class { observe() {} takeRecords() { return []; } },
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  };
  vm.runInNewContext(original, context, { filename: 'review.js' });
  return { pending, history, location, document, window, spec: context.window.__spec };
}

test('地址变成项目页之后，发表用的也是规范页键', async () => {
  const ui = setup();
  ui.history.replaceState(null, '', 'staffing.html?project=pr-ts');
  ui.pending[0].resolve('入口');
  ui.pending[1].resolve('项目');
  await new Promise((resolve) => setTimeout(resolve, 0));
  ui.spec.begin();
  const box = cls(ui.document.body, 'rv-compose');
  const field = find(box, (e) => e.tag === 'textarea');
  field.value = '记在项目页上';
  await field.fire('input');
  const click = find(box, (e) => e.tag === 'button' && textOf(e) === '发表评论').fire('click');
  const post = ui.pending.find((r) => r.method === 'POST');
  assert.ok(post, '应当发出评论');
  assert.equal(post.page, '/y/app/staffing?project=pr-ts');
  post.resolve();
  await click;
});

test('replaceState 之后改用去掉 html 的项目页键，旧请求不能覆盖', async () => {
  const ui = setup();
  assert.equal(ui.pending.length, 1);
  assert.equal(ui.pending[0].page, '/y/app/staffing?new=1&tpl=tpl-ts');
  ui.history.replaceState(null, '', 'staffing.html?project=pr-ts');
  assert.equal(ui.location.pathname, '/y/app/staffing.html');
  assert.equal(ui.pending.length, 2);
  assert.equal(ui.pending[1].page, '/y/app/staffing?project=pr-ts');
  ui.pending[0].resolve('入口页的讨论');
  ui.pending[1].resolve('项目页的讨论');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await cls(ui.document.body, 'rv-launch').fire('click');
  const shown = textOf(ui.document.body);
  assert.match(shown, /项目页的讨论/);
  assert.doesNotMatch(shown, /入口页的讨论/);
});

test('popstate 后按新的阶段键重新加载', async () => {
  const ui = setup();
  ui.location.pathname = '/architecture';
  ui.location.search = '?phase=spike';
  ui.location.href = 'http://127.0.0.1/architecture?phase=spike';
  ui.pending.length = 0;
  ui.window.dispatch('popstate');
  assert.equal(ui.pending.length, 1);
  assert.equal(ui.pending[0].page, '/architecture?phase=spike');
});
