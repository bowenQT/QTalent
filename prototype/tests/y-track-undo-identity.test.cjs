'use strict';
// 从版本 Y 人员档案真实页面提取 startTrack；虚构人员，不读取员工数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const file = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/person.js'), 'utf8');
const match = file.match(/  async function startTrack\(\) \{[\s\S]*?\n  \}/);
assert.ok(match, '找不到版本 Y 的 startTrack');

function setup(dialogResults = [{ why: '演示依据', q: '观察行为' }]) {
  const tracks = [], undos = [];
  let saves = 0, seq = 0, renders = 0;
  const st = {
    get: () => ({ tracks }),
    save: () => { saves++; },
    me: () => ({ id: 'hr-demo' }),
    person: () => ({ name: '虚构员工' }),
  };
  const NT = {
    uid: () => 'track-' + (++seq), TODAY: '2026-10-25',
    toast: (_msg, opts) => { undos.push(opts.undo); },
  };
  const UI = { trackDialog: async () => dialogResults.shift() ?? null };
  const startTrack = vm.runInNewContext('(' + match[0].trim() + ')', {
    st, NT, UI, pid: 'person-demo', render: () => { renders++; }, $: () => null,
  });
  return { tracks, undos, startTrack, get saves() { return saves; }, get renders() { return renders; } };
}
test('首次创建后撤销，只删除本次跟踪', async () => {
  const f = setup();
  await f.startTrack();
  assert.equal(f.tracks.length, 1);
  f.undos[0]();
  assert.equal(f.tracks.length, 0);
  assert.equal(f.saves, 2);
});
test('撤销较早跟踪，不能删除后来创建的跟踪', async () => {
  const f = setup([{ q:'A' }, { q:'B' }]);
  await f.startTrack(); await f.startTrack();
  assert.deepEqual(f.tracks.map(x => x.id), ['track-2','track-1']);
  f.undos[0]();
  assert.deepEqual(f.tracks.map(x => x.id), ['track-2']);
  assert.equal(f.saves, 3);
});
test('其他人的跟踪不受本次撤销影响', async () => {
  const f = setup();
  f.tracks.push({ id:'other-person-track', person:'other-person' });
  await f.startTrack(); f.undos[0]();
  assert.deepEqual(f.tracks.map(x => x.id), ['other-person-track']);
});
test('同一个撤销重复执行不会再次修改或保存', async () => {
  const f = setup();
  await f.startTrack(); f.undos[0](); f.undos[0]();
  assert.equal(f.tracks.length, 0);
  assert.equal(f.saves, 2);
});
test('被其他操作移除后，旧撤销不会删除下一条', async () => {
  const f = setup([{ q:'A' }, { q:'B' }]);
  await f.startTrack();
  f.tracks.shift();
  await f.startTrack();
  f.undos[0]();
  assert.deepEqual(f.tracks.map(x => x.id), ['track-2']);
  assert.equal(f.saves, 2);
});
test('取消跟踪弹窗不会创建记录或写入存储', async () => {
  const f = setup([null]);
  await f.startTrack();
  assert.equal(f.tracks.length, 0);
  assert.equal(f.undos.length, 0);
  assert.equal(f.saves, 0);
});
