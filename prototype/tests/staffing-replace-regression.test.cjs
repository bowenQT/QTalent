'use strict';

// 用版本 X 的 confirmStaffing 原文验证：换人后原来的在任记录要结束。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadConfirm() {
  const source = fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8');
  const start = source.indexOf('  store.confirmStaffing = ');
  const end = source.indexOf('  store.confirmOrg = ');
  assert.ok(start > 0 && end > start);
  const NT = { TODAY: '2026-10-23', uid: (prefix) => `${prefix}-new` };
  const people = {
    'p-zhouyu': { name: '周屿' },
    'p-chengnuo': { name: '程诺' },
    'p-lin': { name: '林知远' },
    'p-jia': { name: '甲' },
    'p-yi': { name: '乙' },
  };
  const project = { id: 'pr-search', name: '海外搜索', owner: 'p-zhouyu' };
  const S = {
    plans: [],
    members: [
      { project: 'pr-search', person: 'p-zhouyu', role: 'owner', mode: '全职', to: null },
      { project: 'pr-search', person: 'p-lin', role: '前端', mode: '兼职', to: null },
    ],
    memberLog: [],
    actions: [],
    needs: [],
  };
  const store = {
    me: () => ({ id: 'p-cheng' }),
    person: (id) => people[id],
    project: () => project,
    save: () => {},
    slotRoles: () => [{ id: 'owner', name: '项目 owner' }, { id: 'fe', name: '前端' }],
  };
  vm.runInNewContext(source.slice(start, end), { NT, S, store });
  return { store, S, project };
}

test('换上新的 owner 后，原来的 owner 不再在任', () => {
  const { store, S, project } = loadConfirm();
  store.confirmStaffing({
    id: 'sp', project: 'pr-search', version: 3, status: 'draft', reqs: [],
    slots: { owner: 'p-chengnuo', fe: 'p-lin' },
  });
  const openOwners = S.members.filter((m) => m.role === 'owner' && !m.to);
  assert.equal(openOwners.length, 1);
  assert.equal(openOwners[0].person, 'p-chengnuo');
  assert.equal(project.owner, 'p-chengnuo');
  const previous = S.members.find((m) => m.person === 'p-zhouyu');
  assert.equal(previous.to, '2026-10-23');
  assert.equal(S.members.filter((m) => m.person === 'p-lin' && !m.to).length, 1);
});

test('同一个人换角色时只保留一条在任记录', () => {
  const { store, S } = loadConfirm();
  store.confirmStaffing({
    id: 'sp', project: 'pr-search', version: 3, status: 'draft', reqs: [],
    slots: { owner: 'p-chengnuo', fe: 'p-zhouyu' },
  });
  const open = S.members.filter((m) => !m.to);
  assert.deepEqual(open.map((m) => [m.person, m.role]).sort(), [['p-chengnuo', 'owner'], ['p-zhouyu', '前端']]);
  const lin = S.members.find((m) => m.person === 'p-lin');
  assert.equal(lin.to, '2026-10-23');
});

test('两个槽位同名时，两边的人都还在任', () => {
  const { store, S, project } = loadConfirm();
  const roles = [
    { id: 'fe', name: '前端' },
    { id: 'fe2', name: '前端' },
  ];
  store.confirmStaffing({
    id: 'sp', project: 'pr-search', version: 3, status: 'draft', reqs: [],
    slots: { fe: 'p-jia', fe2: 'p-yi' },
  }, roles);
  const open = S.members.filter((m) => m.role === '前端' && !m.to).map((m) => m.person).sort();
  assert.deepEqual(open, ['p-jia', 'p-yi']);
  assert.equal(S.members.find((m) => m.person === 'p-lin').to, '2026-10-23');
  assert.equal(project.owner, 'p-zhouyu');
});

test('owner 槽和名为 owner 的角色不会互相结束', () => {
  const { store, S, project } = loadConfirm();
  const roles = [
    { id: 'owner', name: '项目 owner' },
    { id: 'shadow', name: 'owner' },
  ];
  store.confirmStaffing({
    id: 'sp', project: 'pr-search', version: 3, status: 'draft', reqs: [],
    slots: { owner: 'p-chengnuo', shadow: 'p-zhouyu' },
  }, roles);
  const openOwners = S.members.filter((m) => m.role === 'owner' && !m.to).map((m) => m.person).sort();
  assert.deepEqual(openOwners, ['p-chengnuo', 'p-zhouyu']);
  assert.equal(project.owner, 'p-chengnuo');
});
