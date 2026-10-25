'use strict';
// 运行 X/Y 原版确认函数：同名不等于同一来源，不读写真实员工数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const SOURCES = { X: '../app/js/store.js', Y: '../y/app/js/store.js' };
function load(version) {
  const script = fs.readFileSync(path.join(__dirname, SOURCES[version]), 'utf8');
  const found = script.match(/  store\.confirmOrg = \(plan\) => \{[\s\S]*?\n  \};/);
  assert.ok(found, `找不到版本 ${version} 的组织方案确认函数`);
  return found[0];
}
function setup(version) {
  let serial = 0, saves = 0;
  const S = { plans: [], actions: [], batches: [], snaps: [] };
  const NT = { TODAY: '2026-10-25', uid: () => 'demo-action-' + (++serial) };
  const store = {
    me: () => ({ id: 'hrbp-demo' }),
    person: id => ({ id, name: '演示人员' }),
    save: () => saves++,
  };
  const SEED = { PEOPLE: [] };
  vm.runInNewContext(load(version), { NT, S, store, SEED }, { filename: `${version}/store.js` });
  function plan(id, batch, moves) {
    const p = { id, kind: 'org', status: 'draft', batch, moves };
    S.plans.push(p); return p;
  }
  const move = () => ({ person: 'demo-person', type: '负责人安排', from: '原岗位', to: '新岗位' });
  return { S, store, plan, move, get saves() { return saves; } };
}
for (const version of Object.keys(SOURCES)) {
  test(`版本 ${version}：不同方案同名行动各保留一条并分别关联来源`, () => {
    const f = setup(version), a = f.plan('org-a', 'batch-a', [f.move()]), b = f.plan('org-b', 'batch-b', [f.move()]);
    assert.equal(f.store.confirmOrg(a), 1);
    assert.equal(f.store.confirmOrg(b), 1);
    assert.equal(f.S.actions.length, 2);
    assert.deepEqual(f.S.actions.map(x => x.from).sort(), ['org-a', 'org-b']);
  });
  test(`版本 ${version}：同方案重复确认不再生成第二条相同行动`, () => {
    const f = setup(version), p = f.plan('org-a', 'batch-a', [f.move()]);
    assert.equal(f.store.confirmOrg(p), 1);
    assert.equal(f.store.confirmOrg(p), 0);
    assert.equal(f.S.actions.length, 1);
  });
  test(`版本 ${version}：同方案中重复标题不误创建相同来源行动`, () => {
    const f = setup(version), p = f.plan('org-a', 'batch-a', [f.move(), f.move()]);
    assert.equal(f.store.confirmOrg(p), 1);
    assert.equal(f.S.actions.length, 1);
  });
  test(`版本 ${version}：不同方案不同标题不受影响`, () => {
    const f = setup(version), p1 = f.plan('org-a', 'batch-a', [f.move()]);
    const m = f.move(); m.to = '另一个岗位';
    const p2 = f.plan('org-b', 'batch-b', [m]);
    assert.equal(f.store.confirmOrg(p1), 1);
    assert.equal(f.store.confirmOrg(p2), 1);
    assert.equal(f.S.actions.length, 2);
  });
}
