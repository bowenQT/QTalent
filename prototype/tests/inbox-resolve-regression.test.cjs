'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8');
  const start = source.indexOf('  store.inboxChoiceOk = ');
  const end = source.indexOf('  store.unresolveInbox = ');
  assert.ok(start > 0 && end > start);
  const S = {
    inbox: [{
      id: 'i-demo', done: false, choice: null,
      src: '演示录音', at: '05:40', by: 'p-recorder', quote: '演示原话',
      draft: { date: '2026-10-21', project: 'pr-demo', recorder: 'p-recorder', title: '演示事件', scores: [['prof', 3, '锚点']] },
    }],
    events: [],
  };
  const store = {
    person: (id) => (id.startsWith('p-') ? { id } : null),
    scope: (id) => (id === 'p-in' ? 'full' : null),
    project: () => null,
    canEditProject: () => false,
    save: () => {},
    addEvent: (e) => { S.events.unshift(e); return e; },
  };
  vm.runInNewContext(source.slice(start, end), { S, store });
  return { store, S };
}

test('同一条待核对确认两次只写入一条事件', () => {
  const { store, S } = load();
  store.resolveInbox('i-demo', 'p-in');
  store.resolveInbox('i-demo', 'p-in');
  assert.equal(S.events.length, 1);
  assert.equal(S.events[0].id, 'e-i-demo');
  assert.equal(S.inbox[0].done, true);
});

test('范围外的人选不会写入事件，条目保持未完成', () => {
  const { store, S } = load();
  store.resolveInbox('i-demo', 'p-out');
  assert.equal(S.events.length, 0);
  assert.equal(S.inbox[0].done, false);
});
