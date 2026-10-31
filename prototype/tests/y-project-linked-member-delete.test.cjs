'use strict';
// 使用版本 Y 真实项目数据层方法验证关联资料不能被硬删除；全部为虚构人员项目。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const file = fs.readFileSync(path.join(__dirname, '../y/app/js/store.js'), 'utf8');
const lines = file.split('\n');
const funcs = ['removeProject', 'projectLinked'].map(name => {
  const line = lines.find(x => x.includes('store.' + name + ' ='));
  assert.ok(line, '缺少 ' + name);
  // projectLinked 是单行箭头表达式，不能把后面的无关函数一并提取。
  if (line.trimEnd().endsWith('};') || (line.trimEnd().endsWith(';') && !line.includes('=> {'))) return line;
  const start = lines.indexOf(line);
  const tail = lines.slice(start).findIndex((x, i) => i > 0 && x === '  };');
  assert.ok(tail > 0, '找不到函数结束 ' + name);
  return lines.slice(start, start + tail + 1).join('\n');
});
function setup(patch = {}) {
  const S = {
    projects: [{ id:'demo-project', name:'虚构项目' }],
    members: [], memberLog: [], events: [], plans: [],
    ...patch,
  };
  let saves = 0;
  const store = {
    project: id => S.projects.find(p => p.id === id) || null,
    save: () => { saves++; },
  };
  vm.runInNewContext(funcs.join('\n'), { store, S }, { filename:'Y/store.js' });
  return { S, store, get saves() { return saves; } };
}
test('有当前项目成员时不能删除项目或成员', () => {
  const f = setup({ members: [{ project:'demo-project', person:'person-a', to:null }] });
  assert.equal(f.store.projectLinked('demo-project'), true);
  assert.equal(f.store.removeProject('demo-project'), false);
  assert.equal(f.S.projects.length, 1);
  assert.equal(f.S.members.length, 1);
  assert.equal(f.saves, 0);
});
test('已有退出成员的历史项目也只能归档', () => {
  const f = setup({ members: [{ project:'demo-project', person:'person-a', to:'2026-09-01' }] });
  assert.equal(f.store.projectLinked('demo-project'), true);
  assert.equal(f.store.removeProject('demo-project'), false);
});
test('只有成员变更日志的历史项目不可删除', () => {
  const f = setup({ memberLog: [{ project:'demo-project', at:'2026-09-01', text:'虚构成员退出' }] });
  assert.equal(f.store.projectLinked('demo-project'), true);
  assert.equal(f.store.removeProject('demo-project'), false);
  assert.equal(f.saves, 0);
});
test('事件或用人方案有关联时保持原有禁止删除条件', () => {
  for (const patch of [
    { events: [{ project:'demo-project' }] },
    { plans: [{ project:'demo-project' }] },
  ]) {
    const f = setup(patch);
    assert.equal(f.store.projectLinked('demo-project'), true);
    assert.equal(f.store.removeProject('demo-project'), false);
    assert.equal(f.saves, 0);
  }
});
test('完全无关联的项目可以正常删除并且仅保存一次', () => {
  const f = setup();
  assert.equal(f.store.projectLinked('demo-project'), false);
  assert.equal(f.store.removeProject('demo-project'), true);
  assert.equal(f.S.projects.length, 0);
  assert.equal(f.S.members.length, 0);
  assert.equal(f.saves, 1);
});
test('不存在的项目 ID 不会触发保存或意外修改', () => {
  const f = setup();
  assert.equal(f.store.removeProject('missing-project'), false);
  assert.equal(f.S.projects.length, 1);
  assert.equal(f.saves, 0);
});
