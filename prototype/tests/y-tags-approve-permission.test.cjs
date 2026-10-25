'use strict';
// 实际加载版本 Y 标签页，通过假的用户角色/DOM 操作验证可见性及事件处理。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/tags.js'), 'utf8');
function setup(allowed, alreadyDone = true) {
  let can = allowed, saves = 0, markup = '', config;
  const item = { name: '演示标签', def: '演示定义', why: '待确认', count: 0, people: 0,
    at: '2026-10-20', events: [], ...(alreadyDone ? { done: 'add', by: 'hr-demo', doneAt: '2026-10-20' } : {}) };
  const S = { tagCands: [item], taglibAdd: alreadyDone ? [['技术方向', '演示标签']] : [] };
  const st = {
    get: () => S, tagCounts: () => ({}), can: () => can,
    person: () => ({ name: '虚构 HR' }), me: () => ({ id: 'hr-demo' }), save: () => { saves++; },
  };
  const html = (parts, ...values) => parts.reduce((s, p, i) => s + p + String(values[i] ?? ''), '');
  const NT = { store: st, ui: {}, html, icon: () => '', md: x => x,
    clone: x => JSON.parse(JSON.stringify(x)), TODAY: '2026-10-25',
    SEED: { TAGLIB: [{group:'技术方向',tags:[]},{group:'做事方式',tags:[]},{group:'其他',tags:[]},{group:'第四组',tags:[]}] },
    shell: x => { config = x; }, mount: (_main, html) => { markup = html; }, toast() {},
  };
  vm.runInNewContext(source, { window: { NT } }, { filename: 'Y/tags.js' });
  const main = { querySelector: () => null };
  config.render(main);
  const act = async (operation) => {
    const btn = { dataset: { [operation]: '0' } };
    main.onclick({ target: { closest: () => btn } });
  };
  return { S, config, get markup() { return markup; }, get saves() { return saves; },
    allow: value => { can = value; }, act };
}
test('无审批权限的部门负责人能浏览但不能看到撤销按钮', () => {
  const f = setup(false);
  assert.equal(f.config.allow('lead'), true);
  assert.equal(f.markup.includes('data-undo="0"'), false);
});
test('无权限时即使模拟发送撤销点击也不能改写标签库', async () => {
  const f = setup(false);
  await f.act('undo');
  assert.equal(f.S.tagCands[0].done, 'add');
  assert.equal(f.S.taglibAdd.length, 1);
  assert.equal(f.saves, 0);
});
test('页面渲染后权限被收回，不允许使用旧按钮审批', async () => {
  const f = setup(true, false);
  f.allow(false);
  await f.act('add');
  assert.equal(f.S.tagCands[0].done, undefined);
  assert.equal(f.saves, 0);
});
test('有权限的 HR 可收录并撤销已收录标签', async () => {
  const f = setup(true, false);
  await f.act('add');
  assert.equal(f.S.tagCands[0].done, 'add');
  assert.equal(f.S.taglibAdd.length, 1);
  await f.act('undo');
  assert.equal(f.S.tagCands[0].done, undefined);
  assert.equal(f.S.taglibAdd.length, 0);
  assert.equal(f.saves, 2);
});
test('有权限时仍可以选择并入或不收录', async () => {
  for (const op of ['merge', 'drop']) {
    const f = setup(true, false);
    await f.act(op);
    assert.equal(f.S.tagCands[0].done, op);
    assert.equal(f.saves, 1);
  }
});
