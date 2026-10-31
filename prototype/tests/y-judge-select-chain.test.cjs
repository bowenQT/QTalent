'use strict';

// 用版本 Y 的真实数据和 store 验证判断对照链「入营选拔 ↔ 结营评审」：两段各回到自己那张表的行、
// 评价人按节点关系与有效期过滤、评价人只算极端档、入营选拔标准修订对下一期生效且第六期保持旧版。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const JS = path.join(__dirname, '../y/app/js');
const SRC = ['core.js', 'data-xe6.js', 'data.js', 'store.js'].map((f) => [f, fs.readFileSync(path.join(JS, f), 'utf8')]);

function load() {
  const mem = new Map();
  const ctx = {
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    location: { search: '?as=hrbp', href: 'http://x/' },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {} }, body: { classList: { add() {} } } },
    setTimeout, clearTimeout, console, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  SRC.forEach(([f, s]) => vm.runInContext(s, ctx, { filename: f }));
  const st = ctx.NT.store;
  st.reset();
  const as = (r) => { ctx.location.search = `?as=${r}`; return st; };
  return { st, as };
}

test('两段出处各自回到自己那张表的行', () => {
  const { st } = load();
  const us = st.judgeUnits('jr-xe6');
  const u = us.find((x) => x.person === 'p-x60');
  assert.match(u.front.src.label, /作品评审表/);
  assert.match(u.back.src.label, /结营评审表/);
  const row = (loc) => +/第 (\d+) 行/.exec(loc)[1];
  assert.notEqual(row(u.front.src.loc), row(u.back.src.loc), '补录学员不在作品评审表里，两张表行号不同');
  const late = us.find((x) => x.person === 'p-x47');
  assert.equal(late.front.v, null);
  assert.equal(late.state, 'na');
});

test('组队作品标同队，预置的不可比不算依据变化', () => {
  const { st } = load();
  const us = st.judgeUnits('jr-xe6');
  assert.ok(['p-x12', 'p-x13', 'p-x15'].every((p) => us.find((x) => x.person === p).front.team === '七号队'));
  assert.equal(us.find((x) => x.person === 'p-x42').state, 'nc');
  st.judgeHyps('jr-xe6').forEach((h) => assert.equal(st.hypCheck(h).ok, true, h.id));
});

test('评价人视角：前段要有覆盖那次判断的关系，后段跨节点或关系到期显示无权限', () => {
  const { as } = load();
  const st = as('mentor');
  const mine = st.myJudgeUnits();
  assert.ok(mine.length > 0 && mine.every((u) => u.front.by === 'p-yeqing'));
  const by = (p) => mine.find((u) => u.person === p);
  assert.match(by('p-x16').denied, /没有评价关系/);
  assert.match(by('p-x58').denied, /08-15 到期/);
  assert.equal(by('p-x07').denied, undefined);
  assert.ok(!mine.some((u) => u.person === 'p-x30'), '别的评委的判断不出现');
});

test('评价人只算前段最高或最低一档的案例，不到门槛样本不足', () => {
  const { st } = load();
  const us = st.judgeUnits('jr-xe6');
  const chain = st.judgeChain('xe');
  const xu = st.raterStats(us, 's-28');
  assert.ok(xu.enough);
  assert.ok(xu.cases.every((u) => st.judgeClear([u], chain).clear.length === 1));
  assert.equal(st.raterStats(us, 's-12').enough, false);
});

test('入营选拔标准：退回、确认后排期到第七期，选拔开始时生效，第六期保持旧版，可以撤销', () => {
  const { as } = load();
  let st = as('hrbp');
  const d = st.startDraft('front', [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' }], 'xe-select');
  assert.equal(d.v, 'xe-select-v2');
  assert.equal(d.effect, 'next');
  st.setDraft('front', { note: `${d.note}；组队作品写清本人做了哪部分`, why: '优先录取只看作品成品' }, 'xe-select');
  const p = st.previewDraft('front', 'xe-select');
  assert.equal(p.kind, 'front');
  assert.ok(p.keep > 0 && p.next.name.includes('第七期'));
  assert.ok(!JSON.stringify(p).includes('p-x'), '预览里没有名单');
  assert.ok(st.submitDraft('front', 'xe-select'));

  st = as('ceo');
  assert.ok(st.returnDraft('front', '刚过线也写一句', 'xe-select'));
  st = as('hrbp');
  assert.equal(st.ruleOpen('front', 'xe-select').returned.why, '刚过线也写一句');
  assert.ok(st.submitDraft('front', 'xe-select'));
  st = as('ceo');
  const undoConfirm = st.confirmDraft('front', 'xe-select');
  assert.equal(st.ruleOpen('front', 'xe-select').state, 'scheduled');
  assert.equal(st.ruleLive('front', 'xe-select').v, 'xe-select-v1');
  assert.equal(typeof undoConfirm, 'function');

  st = as('hrbp');
  const undo = st.startSelection();
  assert.equal(st.ruleLive('front', 'xe-select').v, 'xe-select-v2');
  assert.equal(st.ruleVer('xe-select-v1').state, 'old');
  assert.equal(st.judgeBatch('jr-xe6').std, 'xe-select-v1', '第六期的判断对照保持旧版');
  assert.equal(undo(), true);
  assert.equal(st.ruleLive('front', 'xe-select').v, 'xe-select-v1');
  assert.equal(st.ruleOpen('front', 'xe-select').state, 'scheduled');
});

test('入营选拔标准：预览后增删依据，预览作废，要重新预览才能提交', () => {
  const { as } = load();
  const st = as('hrbp');
  const d = st.startDraft('front', [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' }], 'xe-select');
  st.setDraft('front', { note: `${d.note}；组队作品写清本人做了哪部分`, why: '优先录取只看作品成品' }, 'xe-select');
  assert.equal(st.previewDraft('front', 'xe-select').basis.length, 1);

  const undo = st.removeBasis('front', 0, 'xe-select');
  assert.equal(st.draftChecks(st.ruleOpen('front', 'xe-select')).preview, false);
  assert.equal(st.submitDraft('front', 'xe-select'), null);
  assert.equal(st.previewDraft('front', 'xe-select').basis.length, 0);
  assert.ok(st.draftChecks(st.ruleOpen('front', 'xe-select')).preview);

  undo();
  assert.equal(st.draftChecks(st.ruleOpen('front', 'xe-select')).preview, false, '撤销移除也改变了依据');
  st.setDraft('front', { basis: [...st.ruleOpen('front', 'xe-select').basis, { type: 'note', text: '补一条说明' }] }, 'xe-select');
  const p = st.previewDraft('front', 'xe-select');
  assert.equal(p.basis.length, 1);
  assert.equal(p.notes, 1);
  assert.ok(st.submitDraft('front', 'xe-select'));
});
