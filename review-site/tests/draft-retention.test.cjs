'use strict';
// 无依赖 DOM fixture：直接运行真实 review.js，不访问外部评审服务。
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
const cls = (root, name) => find(root, e => e.className.split(/\s+/).includes(name));
const input = (root, name) => find(cls(root, name), e => e.tag === 'textarea');
function button(root, label) {
  function words(e) { return e.children.map(x => typeof x === 'string' ? x : x instanceof El ? words(x) : '').join(''); }
  return find(root, e => e.tag === 'button' && words(e) === label);
}
const discussion = id => ({
  id, author: 'reviewer@example.test', body: '演示讨论', kind: 'text',
  quote: '演示划线', resolved: 0, created_at: '2026-10-25T00:00:00Z',
});
function setup() {
  const original = fs.readFileSync(path.join(__dirname, '../worker/client/review.js'), 'utf8');
  const end = /}\)\(\);\s*$/;
  assert.match(original, end);
  const inject = [
    'window.__spec = { panel, renderPanel,',
    'begin() { pending = {kind:"text", quote:"演示划线"}; loadState="ready"; panel.hidden=false; },',
    'show(items) { pending=null; threads=items; loadState="ready"; panel.hidden=false; },',
    'filterTo(value) { filter=value; renderPanel(); }, open(value) { toggle(value); } };',
    '})();',
  ].join('\n');
  const document = {
    createElement: tag => new El(tag), addEventListener() {}, readyState: 'loading',
    querySelectorAll: () => [], body: new El('body'),
    documentElement: { classList: { toggle() {} } },
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const window = { addEventListener() {}, innerWidth: 1024, scrollY: 0 };
  let count = 0;
  const fetch = async (_url, opts = {}) => ({
    ok: true, status: 201,
    json: async () => {
      const posted = JSON.parse(opts.body || '{}');
      return { comment: { ...discussion('new-' + (++count)), parent_id: posted.parent_id || null, body: posted.body } };
    },
  });
  vm.runInNewContext(original.replace(end, inject), {
    window, document, fetch, URLSearchParams,
    location: { search: '', pathname: '/y/app/people.html' },
    MutationObserver: class { observe() {} takeRecords() {} },
    NodeFilter: { SHOW_TEXT: 4 },
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  }, { filename: 'review.js' });
  return window.__spec;
}
test('新评论草稿在重绘、切筛选及面板关闭/打开后保留', async () => {
  const ui = setup(); ui.begin(); ui.renderPanel();
  const ta = input(ui.panel, 'rv-compose');
  ta.value = '请核对这个产品判断'; await ta.fire('input');
  ui.filterTo('all');
  assert.equal(input(ui.panel, 'rv-compose').value, ta.value);
  ui.open(false); ui.open(true);
  assert.equal(input(ui.panel, 'rv-compose').value, ta.value);
});
test('两条回复的草稿独立保留，即使切换筛选', async () => {
  const ui = setup(); ui.show([discussion('a'), discussion('b')]); ui.renderPanel();
  const card = id => find(ui.panel, e => e.attrs['data-thread'] === id);
  const a = input(card('a'), 'rv-reply'), b = input(card('b'), 'rv-reply');
  a.value = '对 a 的意见'; await a.fire('input');
  b.value = '对 b 的意见'; await b.fire('input');
  ui.filterTo('done'); ui.filterTo('open');
  assert.equal(input(card('a'), 'rv-reply').value, '对 a 的意见');
  assert.equal(input(card('b'), 'rv-reply').value, '对 b 的意见');
});
test('取消新评论会清空草稿', async () => {
  const ui = setup(); ui.begin(); ui.renderPanel();
  const ta = input(ui.panel, 'rv-compose');
  ta.value = '要取消的建议'; await ta.fire('input');
  await button(cls(ui.panel, 'rv-compose'), '取消').fire('click');
  ui.begin(); ui.renderPanel();
  assert.equal(input(ui.panel, 'rv-compose').value, '');
});
test('成功发表后清除新评论草稿', async () => {
  const ui = setup(); ui.begin(); ui.renderPanel();
  const ta = input(ui.panel, 'rv-compose');
  ta.value = '已提交意见'; await ta.fire('input');
  await button(cls(ui.panel, 'rv-compose'), '发表评论').fire('click');
  ui.begin(); ui.renderPanel();
  assert.equal(input(ui.panel, 'rv-compose').value, '');
});
test('成功回复只清除该讨论的草稿', async () => {
  const ui = setup(); ui.show([discussion('a'), discussion('b')]); ui.renderPanel();
  const card = id => find(ui.panel, e => e.attrs['data-thread'] === id);
  const a = input(card('a'), 'rv-reply'), b = input(card('b'), 'rv-reply');
  a.value = '已回复'; await a.fire('input');
  b.value = '仍在写'; await b.fire('input');
  await button(cls(card('a'), 'rv-reply'), '回复').fire('click');
  ui.filterTo('all');
  assert.equal(input(card('a'), 'rv-reply').value, '');
  assert.equal(input(card('b'), 'rv-reply').value, '仍在写');
});
