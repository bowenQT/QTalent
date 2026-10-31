'use strict';

// 运行 X/Y 两版实际 store：项目可见范围，以及快照按截止日期冻结组织。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function load(files, search) {
  const context = {
    matchMedia: () => ({ matches: true }),
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    location: { search, href: `http://localhost/${search}` },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { style: {} },
      body: { classList: { add() {} } },
    },
    setTimeout,
    clearTimeout,
    console,
    URLSearchParams,
  };
  context.window = context;
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, {
      filename: file,
    });
  }
  return context.NT.store;
}

const versions = {
  X: ['../app/js/core.js', '../app/js/data.js', '../app/js/store.js'],
  Y: [
    '../y/app/js/core.js',
    '../y/app/js/data-xe6.js',
    '../y/app/js/data.js',
    '../y/app/js/store.js',
  ],
};

test('版本 X：部门负责人和 HRBP 的搜索不再列出范围外项目', () => {
  const lead = load(versions.X, '?as=lead');
  const leadIds = [...lead.search('').projects.map((p) => p.id)].sort();
  assert.deepEqual(leadIds, ['pr-manual', 'pr-ticket']);
  const hr = load(versions.X, '?as=hrbp');
  assert.equal(hr.search('').projects.some((p) => p.id === 'pr-sea'), false);
  const ceo = load(versions.X, '?as=ceo');
  assert.equal(ceo.search('').projects.length, 12);
  const mentor = load(versions.X, '?as=mentor');
  assert.deepEqual(
    [...mentor.search('').projects.map((p) => p.id)].sort(),
    ['pr-attrib', 'pr-kb', 'pr-recall', 'pr-ticket'],
  );
});

test('版本 Y：HR 仍看全部项目，系统管理员搜索不到业务项目', () => {
  const hr = load(versions.Y, '?as=hrbp');
  assert.equal(hr.search('').projects.length, 22);
  const admin = load(versions.Y, '?as=admin');
  assert.equal(admin.search('').projects.length, 0);
  const mentor = load(versions.Y, '?as=mentor');
  assert.equal(mentor.search('').projects.length, 19);
});

test('确认组织方案按证据截止日期冻结当时的组织', () => {
  const st = load(versions.X, '?as=hrbp');
  const batch = st.get().batches.find((b) => b.id === 'b-h2');
  batch.cutoff = '2026-07-01';
  st.confirmOrg(st.get().plans.find((p) => p.id === 'op-h2-1'));
  const snap = st.get().snaps.find((s) => s.batch === 'b-h2');
  assert.equal(snap.entries['p-lin'], undefined);
  assert.equal(snap.entries['p-chenyh'].org, 'gp-cs');
});
