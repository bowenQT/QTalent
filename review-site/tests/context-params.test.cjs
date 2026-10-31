'use strict';
// 一次性参数按解码后的原文保存，中文 q 不能在百分号编码半截处被截断。不访问外部服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const SENTENCE = '唐果今天方案被问住了，第二天主动约了客服再访谈一次，周五带着新结构来评审，结构清楚多了。';

class El {
  constructor(tag) {
    this.nodeType = 1; this.tag = tag; this.children = []; this.events = {};
    this.attrs = {}; this.className = ''; this.value = ''; this.hidden = false;
    this.style = {}; this.classList = { add() {}, remove() {}, toggle() {} };
  }
  append(...xs) { this.children.push(...xs); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
}

function load(search) {
  const original = fs.readFileSync(path.join(__dirname, '../worker/client/review.js'), 'utf8');
  const end = /}\)\(\);\s*$/;
  assert.match(original, end);
  const source = original.replace(end, 'window.__spec = { dropped: () => droppedParams() };\n})();');
  const document = {
    createElement: tag => new El(tag), addEventListener() {}, readyState: 'loading',
    querySelectorAll: () => [], body: new El('body'),
    documentElement: { classList: { toggle() {} } },
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const window = { addEventListener() {}, innerWidth: 1024, scrollY: 0 };
  vm.runInNewContext(source, {
    window, document, URLSearchParams,
    location: { search, pathname: '/y/app/workbench.html' },
    fetch: async () => { throw new Error('不应请求'); },
    MutationObserver: class { observe() {} takeRecords() {} },
    NodeFilter: { SHOW_TEXT: 4 },
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  }, { filename: 'review.js' });
  return window.__spec.dropped();
}

test('中文原文参数完整保留，并能写回地址栏', () => {
  const encoded = new URLSearchParams({ q: SENTENCE }).toString();
  assert.ok(encoded.length > 300);
  const params = load(`?${encoded}&as=hrbp`);
  assert.equal(params.q, SENTENCE);
  assert.equal(params.as, undefined);
  const u = new URL('http://review.local/y/app/workbench');
  new URLSearchParams(params).forEach((v, k) => u.searchParams.set(k, v));
  assert.equal(u.searchParams.get('q'), SENTENCE);
  assert.equal([...SENTENCE].length, 44);
});

test('超长原文按码位截断，不按百分号编码截断', () => {
  const q = '字'.repeat(801);
  const params = load(`?q=${encodeURIComponent(q)}`);
  assert.equal(params.q, '字'.repeat(800));
  assert.equal([...params.q].length, 800);
});

test('没有一次性参数时不写入 params', () => {
  assert.equal(load('?as=hrbp&id=p-lin'), undefined);
});
