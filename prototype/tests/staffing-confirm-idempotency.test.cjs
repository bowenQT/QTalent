'use strict';
// 使用原型 X/Y 的真实冻结函数与虚构资料验证重复确认，不复制业务实现。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const SOURCES = { X: '../app/js/store.js', Y: '../y/app/js/store.js' };
function load(version) {
  const script = fs.readFileSync(path.join(__dirname, SOURCES[version]), 'utf8');
  const found = script.match(/  store\.confirmStaffing = \(plan, roles = store\.slotRoles\(plan\)\) => \{[\s\S]*?\n  \};/);
  assert.ok(found, `找不到版本 ${version} 的真实确认函数`);
  return found[0];
}

function setup(version) {
  let saves = 0, ids = 0;
  const S = {
    plans: [], needs: [], members: [], memberLog: [], actions: [],
    projects: [{ id: 'project-demo', name: '演示项目', owner: null }],
  };
  const NT = { TODAY: '2026-10-25', uid: () => 'demo-action-' + (++ids) };
  const store = {
    me: () => ({ id: 'demo-reviewer' }),
    person: id => ({ id, name: id }),
    project: id => S.projects.find(p => p.id === id),
    save: () => saves++,
  };
  vm.runInNewContext(load(version), { NT, S, store }, { filename: `${version}/store.js` });
  const roles = [{ id: 'owner', name: '项目 owner' }];
  function plan(id, version, person) {
    const p = { id, version, project: 'project-demo', slots: { owner: person }, status: 'draft' };
    S.plans.push(p); return p;
  }
  return { S, store, roles, plan, get saves() { return saves; } };
}
for (const version of Object.keys(SOURCES)) {
  test(`版本 ${version}：初次确认写入成员、单条日志和跟进行动`, () => {
    const f = setup(version), p = f.plan('plan-1', 1, 'person-a');
    f.store.confirmStaffing(p, f.roles);
    assert.equal(p.status, 'confirmed');
    assert.equal(f.S.members.length, 1);
    assert.equal(f.S.memberLog.length, 1);
    assert.equal(f.S.actions.length, 1);
    assert.equal(f.saves, 1);
  });
  test(`版本 ${version}：同一已冻结方案重复确认不会增加日志、行动或存储写入`, () => {
    const f = setup(version), p = f.plan('plan-1', 1, 'person-a');
    f.store.confirmStaffing(p, f.roles);
    f.store.confirmStaffing(p, f.roles);
    assert.equal(f.S.memberLog.length, 1);
    assert.equal(f.S.actions.length, 1);
    assert.equal(f.S.members.length, 1);
    assert.equal(f.saves, 1);
  });
  test(`版本 ${version}：已被替代的方案不能再次确认`, () => {
    const f = setup(version), p = f.plan('plan-old', 1, 'person-a');
    p.status = 'superseded';
    f.store.confirmStaffing(p, f.roles);
    assert.equal(p.status, 'superseded');
    assert.equal(f.S.memberLog.length, 0);
    assert.equal(f.S.actions.length, 0);
    assert.equal(f.saves, 0);
  });
  test(`版本 ${version}：新版本草稿依然允许被确认与记录变更`, () => {
    const f = setup(version), old = f.plan('plan-1', 1, 'person-a');
    f.store.confirmStaffing(old, f.roles);
    const next = f.plan('plan-2', 2, 'person-b');
    f.store.confirmStaffing(next, f.roles);
    assert.equal(next.status, 'confirmed');
    assert.equal(old.status, 'superseded');
    assert.equal(f.S.memberLog.length, 2);
    assert.equal(f.S.actions.length, 2);
    assert.equal(f.saves, 2);
  });
}
