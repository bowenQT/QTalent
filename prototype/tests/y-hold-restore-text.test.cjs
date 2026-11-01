'use strict';

// 按住说话：轻点、滑出和取消手势恢复原话，不提交。按够时间并在按钮上松开才写入整段演示稿。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const SCRIPT = '结营前一周组员都在等分工。孟逸尘主动把任务池同步给了全组。';
const PREV = '已经打好的原话';

function boot() {
  let now = 1000;
  let tick = null;
  const listeners = {};
  const classes = new Set();
  const btn = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 80, bottom: 80 }),
    setPointerCapture() {},
  };
  const field = { value: PREV, scrollTop: 0, scrollHeight: 0 };
  const calls = { end: null, cancel: 0, toast: null, start: 0 };
  const st = { role: () => 'hrbp' };
  const NT = {
    store: st, ui: {}, html() { return ''; }, icon() { return ''; }, mount() {}, $() { return null; },
    reduced: false,
    toast(msg) { calls.toast = msg; },
  };
  const src = fs.readFileSync(path.join(__dirname, '../y/m/js/mshell.js'), 'utf8');
  vm.runInNewContext(src, {
    window: { NT }, NT,
    Date: { now: () => now },
    setInterval(fn) { tick = fn; return 1; },
    clearInterval() { tick = null; },
  }, { filename: 'prototype/y/m/js/mshell.js' });
  NT.m.hold(btn, field, SCRIPT, {
    onStart() { calls.start += 1; },
    onEnd(text) { calls.end = text; },
    onCancel() { calls.cancel += 1; },
  });
  const fire = (ev, extra) => listeners[ev].forEach((fn) => fn({ type: ev, preventDefault() {}, pointerId: 1, clientX: 10, clientY: 10, ...extra }));
  return {
    field, calls, classes, fire,
    advance(ms) { now += ms; },
    type(n) { for (let k = 0; k < n; k += 1) tick(); },
    setReduced(v) { NT.reduced = v; },
  };
}

test('轻点恢复按下前的原话，并提示按住', () => {
  const h = boot();
  h.fire('pointerdown');
  h.type(1);
  h.advance(80);
  h.fire('pointerup');
  assert.equal(h.field.value, PREV);
  assert.equal(h.calls.end, null);
  assert.equal(h.calls.cancel, 1);
  assert.equal(h.calls.toast, '按住说话，松开结束');
  assert.equal(h.classes.has('is-on'), false);
});

test('减少动效时短按也不会因为字已经打出而提交', () => {
  const h = boot();
  h.setReduced(true);
  h.fire('pointerdown');
  h.type(8);
  h.advance(40);
  h.fire('pointerup');
  assert.equal(h.field.value, PREV);
  assert.equal(h.calls.end, null);
  assert.equal(h.calls.toast, '按住说话，松开结束');
});

test('滑出按钮或手势取消时恢复原话，不提示也不提交', () => {
  for (const ev of ['pointerleave', 'pointercancel']) {
    const h = boot();
    h.fire('pointerdown');
    h.type(4);
    h.advance(500);
    h.fire(ev);
    assert.equal(h.field.value, PREV, ev);
    assert.equal(h.calls.end, null, ev);
    assert.equal(h.calls.cancel, 1, ev);
    assert.equal(h.calls.toast, null, ev);
  }
});

test('在按钮外松开不提交', () => {
  const h = boot();
  h.fire('pointerdown');
  h.advance(500);
  h.fire('pointerup', { clientX: 200, clientY: 10 });
  assert.equal(h.field.value, PREV);
  assert.equal(h.calls.end, null);
  assert.equal(h.calls.toast, null);
});

test('按够时间并在按钮上松开写入整段演示稿', () => {
  const h = boot();
  h.fire('pointerdown');
  h.type(2);
  h.advance(400);
  h.fire('pointerup');
  assert.equal(h.field.value, SCRIPT);
  assert.equal(h.calls.end, SCRIPT);
  assert.equal(h.calls.cancel, 0);
  assert.equal(h.calls.toast, null);
});

test('键盘按住同样按时间提交，短按恢复原话', () => {
  const held = boot();
  held.fire('keydown', { key: ' ', repeat: false });
  held.advance(400);
  held.fire('keyup', { key: ' ' });
  assert.equal(held.field.value, SCRIPT);
  assert.equal(held.calls.end, SCRIPT);

  const tap = boot();
  tap.fire('keydown', { key: 'Enter', repeat: false });
  tap.type(6);
  tap.advance(100);
  tap.fire('keyup', { key: 'Enter' });
  assert.equal(tap.field.value, PREV);
  assert.equal(tap.calls.end, null);
  assert.equal(tap.calls.toast, '按住说话，松开结束');
});
