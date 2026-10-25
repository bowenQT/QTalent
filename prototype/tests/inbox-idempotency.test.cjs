'use strict';

// 直接提取 X/Y 原型状态库中的真实待核对函数；所有人名、事件和证据均为虚构。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const versions = {
  X: '../app/js/store.js',
  Y: '../y/app/js/store.js',
};

function setup(version) {
  const script = fs.readFileSync(path.join(__dirname, versions[version]), 'utf8');
  const funcs = ['resolveInbox', 'unresolveInbox'].map((name) => {
    const pattern = new RegExp('  store\\.' + name + ' = \\(id(?:, choice)?\\) => \\{[\\s\\S]*?\\n  \\};');
    const found = script.match(pattern);
    assert.ok(found, version + ' missing source implementation: ' + name);
    return found[0];
  });
  const item = {
    id: 'i-demo', done: false, later: false, choice: null,
    src: '虚构音频', at: '10:00', by: 'mentor-demo',
    quote: '虚构记录中的一句话',
    draft: {
      date: '2026-10-25', project: 'project-demo', recorder: 'mentor-demo',
      title: '虚构待核对事件', scores: [['prof', 3, '演示维度证据']],
    },
  };
  const S = { inbox: [item], events: [] };
  let saves = 0;
  const store = {
    save: () => { saves++; },
    addEvent: (event) => {
      S.events.unshift(event);
      store.save();
      return event;
    },
  };
  vm.runInNewContext(funcs.join('\n'), { store, S }, { filename: versions[version] });
  return { store, S, item, get saves() { return saves; } };
}

for (const version of Object.keys(versions)) {
  test('版本 ' + version + '：首次确认只写一条有来源的 AI 待确认事件', () => {
    const { store, S, item } = setup(version);
    store.resolveInbox('i-demo', 'person-a');
    assert.equal(item.done, true);
    assert.equal(item.choice, 'person-a');
    assert.equal(S.events.length, 1);
    assert.equal(S.events[0].id, 'e-i-demo');
    assert.equal(S.events[0].people[0], 'person-a');
    assert.equal(S.events[0].scores[0].st, 'ai');
  });

  test('版本 ' + version + '：重复确认不会重复写入事件或保存', () => {
    const fixture = setup(version);
    const { store, S } = fixture;
    store.resolveInbox('i-demo', 'person-a');
    const saves = fixture.saves;
    store.resolveInbox('i-demo', 'person-a');
    assert.equal(S.events.length, 1);
    assert.equal(fixture.saves, saves);
  });

  test('版本 ' + version + '：已确认不能绕过撤销直接改归属', () => {
    const { store, S, item } = setup(version);
    store.resolveInbox('i-demo', 'person-a');
    store.resolveInbox('i-demo', 'person-b');
    assert.equal(item.choice, 'person-a');
    assert.equal(S.events.length, 1);
    assert.equal(S.events[0].people[0], 'person-a');
  });

  test('版本 ' + version + '：撤销再核对会用原 ID 重建唯一新证据', () => {
    const { store, S, item } = setup(version);
    store.resolveInbox('i-demo', 'person-a');
    store.unresolveInbox('i-demo');
    assert.equal(item.done, false);
    assert.equal(S.events.length, 0);
    store.resolveInbox('i-demo', 'person-b');
    assert.equal(S.events.length, 1);
    assert.equal(S.events[0].id, 'e-i-demo');
    assert.equal(S.events[0].people[0], 'person-b');
  });

  test('版本 ' + version + '：不存在的待核对 ID 不修改任何数据', () => {
    const fixture = setup(version);
    fixture.store.resolveInbox('not-found', 'person-a');
    assert.equal(fixture.S.events.length, 0);
    assert.equal(fixture.item.done, false);
    assert.equal(fixture.saves, 0);
  });
}

test('版本 Y：「稍后处理」保持未完成并可再次确认', () => {
  const { store, S, item } = setup('Y');
  store.resolveInbox('i-demo', 'skip');
  assert.equal(item.done, false);
  assert.equal(item.later, true);
  assert.equal(S.events.length, 0);
  store.resolveInbox('i-demo', 'person-a');
  assert.equal(item.done, true);
  assert.equal(item.later, false);
  assert.equal(S.events.length, 1);
});

test('版本 Y：连续「稍后处理」不会产生证据', () => {
  const { store, S } = setup('Y');
  store.resolveInbox('i-demo', 'skip');
  store.resolveInbox('i-demo', 'skip');
  assert.equal(S.events.length, 0);
});
