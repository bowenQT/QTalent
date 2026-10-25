'use strict';

// 用原型源文件中的真实 setState 函数验证撤销行为，不复制业务实现。
// 所有行动和原因都是虚构演示数据；不调用远端服务。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const SOURCES = {
  X: '../app/js/pages/actions.js',
  Y: '../y/app/js/pages/actions.js',
};

function setup(version, dialogResult = { value: 'ok', data: '演示：项目暂缓' }) {
  const script = fs.readFileSync(path.join(__dirname, SOURCES[version]), 'utf8');
  const match = script.match(/  async function setState\(a, s\) \{[\s\S]*?\n  \}/);
  assert.ok(match, `无法从版本 ${version} 提取 setState`);

  let undo;
  let saves = 0;
  let dialogCalls = 0;
  const NT = {
    TODAY: '2026-10-25',
    dialog: async () => { dialogCalls++; return dialogResult; },
    toast: (_message, options) => { undo = options.undo; },
  };
  const st = { save: () => { saves++; } };
  const html = (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ''), '');
  const setState = vm.runInNewContext(`(${match[0].trim()})`, {
    NT, st, html, LABEL: { todo: '待沟通', cancel: '未执行', done: '已执行待观察' },
    render: () => {}, $: () => null,
  });
  return { setState, undo: () => undo?.(), get saves() { return saves; }, get dialogCalls() { return dialogCalls; } };
}

for (const version of Object.keys(SOURCES)) {
  test(`版本 ${version}：撤销「未执行」删除本次新增的原因`, async () => {
    const ui = setup(version);
    const action = { state: 'todo', due: '2026-10-28' };
    await ui.setState(action, 'cancel');
    assert.equal(action.why, '演示：项目暂缓');
    assert.equal(action.state, 'cancel');
    ui.undo();
    assert.equal(action.state, 'todo');
    assert.equal(Object.hasOwn(action, 'why'), false);
    assert.equal(ui.saves, 2);
  });

  test(`版本 ${version}：撤销还原操作前已有的原因和日期`, async () => {
    const ui = setup(version);
    const action = { state: 'todo', why: '先前留存的演示原因', did: '2026-10-01', stateAt: '2026-10-02', stateTs: 42 };
    await ui.setState(action, 'cancel');
    assert.equal(action.why, '演示：项目暂缓');
    ui.undo();
    assert.equal(action.state, 'todo');
    assert.equal(action.why, '先前留存的演示原因');
    assert.equal(action.did, '2026-10-01');
    assert.equal(action.stateAt, '2026-10-02');
    assert.equal(action.stateTs, 42);
  });

  test(`版本 ${version}：取消弹窗不改变数据或持久化状态`, async () => {
    const ui = setup(version, { value: 'cancel' });
    const action = { state: 'todo', due: '2026-10-28' };
    await ui.setState(action, 'cancel');
    assert.deepEqual(Object.keys(action).sort(), ['due', 'state']);
    assert.equal(action.state, 'todo');
    assert.equal(ui.saves, 0);
  });

  test(`版本 ${version}：其他状态仍可修改并撤销`, async () => {
    const ui = setup(version);
    const action = { state: 'todo' };
    await ui.setState(action, 'done');
    assert.equal(action.state, 'done');
    assert.equal(action.did, '2026-10-25');
    ui.undo();
    assert.equal(action.state, 'todo');
    assert.equal(action.did, undefined);
    assert.equal(Object.hasOwn(action, 'why'), false);
    assert.equal(ui.dialogCalls, 0);
  });
}
