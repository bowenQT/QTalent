'use strict';
// 只提取版本 Y 页面真实 visible 谓词，使用虚构人员权限和行动。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const file = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/actions.js'), 'utf8');
const line = file.split('\n').find(x => x.includes('const visible = (a) =>'));
assert.ok(line, '找不到版本 Y 行动列表过滤谓词');
function setup(scope, canJudge = false) {
  const st = {
    judgeBatch: from => from === 'judge-batch' ? { id:from } : null,
    canJudge: () => canJudge,
    scope: () => scope,
    can: (what, person) => what === 'mgmt' && person === 'person-demo' && scope === 'full',
  };
  return vm.runInNewContext(line + '\nvisible;', { st });
}
const personnel = { id:'action-1', from:'staffing-plan', person:'person-demo' };
test('部门负责人仅有跨项目 project 可见范围时不展示管理行动', () => {
  assert.equal(setup('project')(personnel), false);
});
test('仅有导师 mentor 范围不能看到管理行动', () => {
  assert.equal(setup('mentor')(personnel), false);
});
test('只有 self 范围也不能看到管理行动', () => {
  assert.equal(setup('self')(personnel), false);
});
test('完全无权限的人不能看到管理行动', () => {
  assert.equal(setup(null)(personnel), false);
});
test('full 范围管理者仍可看到本范围人员的行动', () => {
  assert.equal(setup('full')(personnel), true);
});
test('判断对照行动仍按 canJudge 判断', () => {
  assert.equal(setup('project', false)({from:'judge-batch',person:'person-demo'}), false);
  assert.equal(setup('project', true)({from:'judge-batch',person:'person-demo'}), true);
});
test('没有具体人员的公共节点行动保持原有展示行为', () => {
  assert.equal(setup('project')({from:'program-node',person:null}), true);
});
