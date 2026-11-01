'use strict';

// 用版本 Y 的真实数据和 store 验证判断对照链「入营选拔 ↔ 结营评审」：两段各回到自己那张表的行、
// 评价人按今天有效的同节点关系授权（左闭右开）、中间档计入门槛但不计入偏差分布、
// 入营选拔标准只能从 HR 已确认含「评价标准」的归因起草，确认发布即对之后新建的期次生效，已绑定的第六期保持旧版。
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
  return { st, as, NT: ctx.NT };
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

test('评价人视角：按今天有效的同节点关系授权，有效期左闭右开', () => {
  const { as, NT } = load();
  const st = as('mentor');
  const mine = st.myJudgeUnits();
  assert.ok(mine.length > 0 && mine.every((u) => u.front.by === 'p-yeqing'));
  const by = (p) => mine.find((u) => u.person === p);
  assert.equal(by('p-x16'), undefined, '前段的代评关系 07-01 起失效，整条不列出');
  assert.equal(st.myJudgeHidden(), 2);
  assert.match(by('p-x58').denied, /08-16 起失效/);
  assert.equal(by('p-x07').denied, undefined);
  assert.ok(!mine.some((u) => u.person === 'p-x30'), '别的评委的判断不出现');
  // 关系的 to 当天已经失效
  const rel = NT.SEED.JUDGE.rels.find((r) => r.node === 'xe6-end' && r.label === '导师');
  const keep = rel.to;
  rel.to = NT.TODAY;
  assert.match(st.myJudgeUnits().find((u) => u.person === 'p-x07').denied, /起失效/);
  rel.to = keep;
});

test('中间档计入评价人的样本门槛，但不计入偏差分布；不到门槛样本不足', () => {
  const { st } = load();
  const us = st.judgeUnits('jr-xe6');
  const chain = st.judgeChain('xe');
  const xu = st.raterStats(us, 's-28');
  assert.ok(xu.enough);
  assert.ok(xu.mid.length > 0 && xu.mid.every((u) => u.front.v === '通过'));
  assert.equal(xu.cases.length, xu.clear.length + xu.mid.length, '门槛按全部可对照案例算');
  const t = xu.tally;
  assert.equal(t.same + t.high + t.low, xu.clear.length, '偏差分布只看最高或最低一档');
  assert.ok(xu.clear.every((u) => st.judgeClear([u], chain).clear.length === 1));
  assert.equal(Object.values(xu.midBack).reduce((a, b) => a + b, 0), xu.mid.length);
  assert.equal(st.raterStats(us, 's-12').enough, false);
  // 只有 1 个最高或最低档、其余都是中间档的评价人，凑够 5 个也达到门槛
  const fake = us.filter((u) => u.front.by === 's-28' && st.judgeComparable(u));
  const pick = [...fake.filter((u) => u.front.v === '通过').slice(0, 4), fake.find((u) => u.front.v !== '通过')];
  assert.equal(st.raterStats(pick, 's-28').enough, true);
});

test('只有 HR 已确认、归因含「评价标准」的结论才能起草入营选拔标准', () => {
  const { as } = load();
  const st = as('hrbp');
  const b = (hyp) => [{ type: 'judge', batch: 'jr-xe6', hyp, dim: '综合判断', n: '演示', cat: '评价标准' }];
  assert.equal(st.startDraft('front', [], 'xe-select'), null, '不带归因不能直接起草');
  assert.equal(st.startDraft('front', b('h-xe6-2'), 'xe-select'), null, '没确认的假设不能起草');
  assert.equal(st.startDraft('front', b('h-xe6-3'), 'xe-select'), null);
  const h2 = st.judgeHyps('jr-xe6').find((h) => h.id === 'h-xe6-2');
  assert.ok(st.confirmAttrib('jr-xe6', h2, { cats: ['method'], reason: '只归因到评价方式' }));
  assert.equal(st.canDraftFrom(b('h-xe6-2')[0]), false, '只归因到评价方式的不能起草');
  assert.equal(st.draftWithBasis('front', b('h-xe6-2'), 'xe-select'), null);
  assert.ok(st.startDraft('front', b('h-xe6-1'), 'xe-select'));
  assert.equal(as('ceo').startDraft('front', b('h-xe6-1'), 'xe-select'), null);
});

test('入营选拔标准：确认发布即生效，第六期保持绑定的旧版，第七期建立时用新版；撤销回到待确认', () => {
  const { as } = load();
  let st = as('hrbp');
  const d = st.startDraft('front', [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' }], 'xe-select');
  assert.equal(d.v, 'xe-select-v2');
  assert.equal(d.effect, 'now');
  assert.equal(d.period, undefined, '不按名称记下一期');
  st.setDraft('front', { note: `${d.note}；组队作品写清本人做了哪部分`, why: '优先录取只看作品成品' }, 'xe-select');
  const p = st.previewDraft('front', 'xe-select');
  assert.equal(p.kind, 'front');
  assert.equal(p.next.id, 'pg-xe7', '下一期用稳定的期次 ID');
  assert.equal(JSON.stringify(p.bound.map((g) => [g.id, g.std])), JSON.stringify([['pg-xe6', 'xe-select-v1']]));
  assert.ok(p.keep > 0);
  assert.ok(!JSON.stringify(p).includes('p-x'), '预览里没有名单');
  assert.ok(st.submitDraft('front', 'xe-select'));

  st = as('ceo');
  assert.ok(st.returnDraft('front', '刚过线也写一句', 'xe-select'));
  st = as('hrbp');
  assert.equal(st.ruleOpen('front', 'xe-select').returned.why, '刚过线也写一句');
  assert.ok(st.submitDraft('front', 'xe-select'));
  st = as('ceo');
  const undo = st.confirmDraft('front', 'xe-select');
  assert.equal(st.ruleLive('front', 'xe-select').v, 'xe-select-v2', '确认发布即生效，没有已排期');
  assert.equal(st.ruleVer('xe-select-v1').state, 'old');
  assert.equal(st.ruleOpen('front', 'xe-select'), null);
  assert.equal(st.judgeBatch('jr-xe6').std, 'xe-select-v1', '第六期按期次读取绑定的旧版');
  assert.match(st.nodeFacts('pg-xe7', { id: 'n0' })[0].v, /现在是 xe-select-v2/);
  assert.equal(typeof st.startSelection, 'undefined');

  assert.equal(undo(), true);
  assert.equal(st.ruleLive('front', 'xe-select').v, 'xe-select-v1');
  assert.equal(st.ruleOpen('front', 'xe-select').state, 'pending');
  assert.equal(undo(), false, '同一个撤销只生效一次');
});

test('撤销如实返回成败：起草人已经改过的退回、已不在待确认的提交都返回 false', () => {
  const { as } = load();
  let st = as('hrbp');
  const d = st.startDraft('front', [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' }], 'xe-select');
  st.setDraft('front', { note: `${d.note}；写清本人做了哪部分`, why: '理由' }, 'xe-select');
  st.previewDraft('front', 'xe-select');
  st.submitDraft('front', 'xe-select');
  st = as('ceo');
  const undo = st.confirmDraft('front', 'xe-select');
  st = as('hrbp');
  // 发布之后又起草了下一版：旧的发布撤销不了
  const d3 = st.startDraft('front', [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' }], 'xe-select');
  assert.equal(d3.v, 'xe-select-v3');
  assert.equal(st.withdrawDraft('front', 'xe-select'), null, '草稿不能撤回');
  assert.equal(as('ceo') && undo(), false);
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

test('从判断对照带依据起草：已有草稿就追加并去重，预览作废；已提交时返回 blocked', () => {
  const { as } = load();
  const st = as('hrbp');
  const basis = { type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' };
  const d = st.startDraft('front', [basis], 'xe-select');
  st.setDraft('front', { note: `${d.note}；写清本人做了哪部分`, why: '理由', basis: [] }, 'xe-select');
  st.previewDraft('front', 'xe-select');

  const r = st.draftWithBasis('front', [basis], 'xe-select');
  assert.equal(r.draft, st.ruleOpen('front', 'xe-select'));
  assert.equal(r.added, 1);
  assert.equal(r.draft.basis.length, 1);
  assert.equal(st.draftChecks(r.draft).preview, false, '追加依据后要重新预览');
  assert.equal(st.draftWithBasis('front', [basis], 'xe-select').added, 0, '同一条依据不重复追加');

  st.previewDraft('front', 'xe-select');
  assert.ok(st.submitDraft('front', 'xe-select'));
  const blocked = st.draftWithBasis('front', [basis], 'xe-select');
  assert.equal(blocked.blocked.state, 'pending');
  assert.equal(st.ruleOpen('front', 'xe-select').basis.length, 1, '已提交的修订不被改动');
});

test('「修订入营选拔标准」的动作状态从修订推出来：起草中 → 待确认 → 已生效，撤销确认后回到待确认', () => {
  const { as } = load();
  let st = as('hrbp');
  const basis = [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: '演示', cat: '评价标准' }];
  const a = st.addJudgeAction('jr-xe6', 'h-xe6-1', { title: '修订入营选拔标准', kind: '修订评价标准', rule: { kind: 'front', line: 'xe-select', hyp: 'h-xe6-1' } });
  const label = (s) => s.actionState(s.get().actions.find((x) => x.id === a.id)).label;
  assert.equal(label(st), '还没有修订草稿');
  const d = st.draftWithBasis('front', basis, 'xe-select').draft;
  assert.equal(label(st), '起草中');
  st.setDraft('front', { note: `${d.note}；写清本人做了哪部分`, why: '理由' }, 'xe-select');
  st.previewDraft('front', 'xe-select');
  st.submitDraft('front', 'xe-select');
  assert.equal(label(st), '待确认');
  st = as('ceo');
  const undo = st.confirmDraft('front', 'xe-select');
  assert.equal(label(as('hrbp')), '已生效');
  const stored = as('hrbp').get().actions.find((x) => x.id === a.id);
  assert.equal(stored.state, 'todo', '状态不另存，存的字段不跟着改');
  undo();
  assert.equal(label(as('hrbp')), '待确认');
});

test('入营选拔评委和结营评审不是同一个人；导师视角的结果不变', () => {
  const { as } = load();
  const st = as('hrbp');
  const units = st.judgeUnits('jr-xe6');
  assert.equal(units.filter((u) => u.front && [].concat(u.back.by || []).includes(u.front.by)).length, 0);
  const moved = units.filter((u) => [].concat(u.back.by || []).includes('s-29'));
  assert.ok(moved.length > 0);
  assert.equal(st.person('s-29').name, '孟砚舟');
  // 导师视角：仍按本人在两段的评价关系看，结果和换人前一样
  const m = as('mentor');
  assert.equal(m.myJudgeUnits().filter((u) => !u.denied).length, 10);
  assert.equal(m.myJudgeHidden(), 2);
});
