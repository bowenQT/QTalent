'use strict';

// 用版本 Y 的真实数据和 store 验证决赛增补的采集规则：待核对按视角过滤、面评导入只写已确认的行、
// 节点结论等评委确认后由 HR 确认、重新分派遇到已有变化的事以原评价人为准。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const JS = path.join(__dirname, '../y/app/js');
const FILES = ['core.js', 'data-xe6.js', 'data.js', 'data-intake.js', 'store.js', 'intake.js'];
const SRC = FILES.map((f) => [f, fs.readFileSync(path.join(JS, f), 'utf8')]);

// mem 传入同一个存储时，换视角接着上一个视角的演示状态走
function load(as, mem = new Map(), fresh = true) {
  const ctx = {
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    location: { search: `?as=${as}`, href: `http://x/?as=${as}` },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {} }, body: { classList: { add() {} } } },
    setTimeout, clearTimeout, console, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  SRC.forEach(([f, s]) => vm.runInContext(s, ctx, { filename: f }));
  if (fresh) ctx.NT.store.reset();
  return ctx.NT.store;
}

test('导师只看到自己交的材料里的待核对，HR 看全部', () => {
  const hr = load('hrbp'), mentor = load('mentor');
  const all = hr.visibleInbox().map((i) => i.id);
  const mine = mentor.visibleInbox();
  assert.ok(all.includes('i-aze') && all.includes('i-int'));
  assert.ok(mine.length > 0 && mine.length < all.length);
  assert.ok(mine.every((i) => i.by === mentor.me().id));
  assert.ok(!mine.some((i) => i.id === 'i-int'));
});

test('面评导入只写已确认的行，跳过的行和待核对的行留在预览', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const state = (rid) => st.ivRowState(imp.rows.find((r) => r.id === rid));
  assert.equal(state('r3'), 'skip');
  assert.equal(state('r6'), 'dup');
  assert.equal(state('r2'), 'verify');
  st.ivConfirm('imp-1', 'r1', true);
  const res = st.ivImport('imp-1');
  assert.equal(res.n, 1);
  const e = st.event('e-iv-imp-1-r1');
  assert.equal(e.kind, 'hist');
  assert.equal(e.scores.length, 0, '原量表不换算成维度分');
  assert.ok(e.scale.length > 0);
  assert.equal(st.ivBatchState(imp)[0], 'partial', '还有没处理完的行，批次是部分导入');
  res.undo();
  assert.equal(st.event('e-iv-imp-1-r1'), undefined);
  assert.equal(state('r1'), 'confirmed');
});

test('非管理岗的管理能力写非管理岗免评；没读出的分补录前不能确认', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const r2 = imp.rows.find((r) => r.id === 'r2');
  st.resolveInbox(r2.verify, 's-28');
  assert.equal(st.ivRowState(r2), 'unread');
  st.ivFill('imp-1', 'r2', 'B');
  assert.equal(st.ivRowState(r2), 'confirm');
  st.ivConfirm('imp-1', 'r2', true);
  st.ivImport('imp-1');
  const scale = Object.fromEntries(st.event('e-iv-imp-1-r2').scale);
  assert.equal(scale['系统设计'], 'B');
  assert.equal(scale['管理能力'], '非管理岗免评');
});

test('评委没有都确认本人评分时，HR 不能确认节点结论；评委不能确认结论', () => {
  const hr = load('hrbp');
  const pending = hr.conclusions('pg-def:n0').find((c) => hr.judgeStatus(c).some((j) => !j.done));
  assert.ok(pending, '演示数据里应有一位评委未确认的结论');
  hr.confirmConclusion(pending.id, '建议转正', '依据', 'edit');
  assert.equal(pending.versions.length, 0);

  const ready = hr.conclusions('pg-def:n0').find((c) => hr.judgeStatus(c).every((j) => j.done));
  const undo = hr.confirmConclusion(ready.id, '建议转正', '两位评委都已确认本人评分', 'ai');
  assert.equal(ready.versions[0].type, '建议转正');
  undo();
  assert.equal(ready.versions.length, 0);

  const mentor = load('mentor');
  assert.equal(mentor.canConfirmConclusion(), false);
});

test('重新分派：已有变化的事以原评价人为准，接手人获得到最晚截止日的评价关系，可以撤销', () => {
  const st = load('hrbp');
  const items = st.reassignItems();
  assert.ok(items.some((x) => x.race));
  const cands = st.reassignCandidates(items);
  assert.ok(cands.some((c) => !c.ok), '关系已到期的人置灰');
  const to = cands.find((c) => c.ok && c.id !== st.me().id).id;
  const before = st.relations().length;
  const res = st.reassign(items.map((x) => x.id), to);
  assert.equal(res.conflicts.length, items.filter((x) => x.race).length);
  assert.equal(res.done.length, items.length - res.conflicts.length);
  const rel = st.relations().find((r) => r.rater === to && r.label === '接手评价');
  assert.equal(rel.to, res.done.map((x) => x.due).sort().pop());
  assert.equal(st.reassignItems().length, 0);
  res.undo();
  assert.equal(st.relations().length, before);
  assert.equal(st.reassignItems().length, res.done.length);
  assert.equal(load('mentor').reassignItems().length, 0, '重新分派只给 HR');
});

// 同一份演示数据里切换视角（HR 分派后由导师接手）
function loadShared() {
  const mem = new Map();
  const ctx = {
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
    location: { search: '?as=hrbp', href: 'http://x/?as=hrbp' },
    document: { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {} }, body: { classList: { add() {} } } },
    setTimeout, clearTimeout, console, URLSearchParams,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  SRC.forEach(([f, s]) => vm.runInContext(s, ctx, { filename: f }));
  const st = ctx.NT.store;
  st.reset();
  return (as) => { ctx.location.search = `?as=${as}`; return st; };
}

test('重新分派给导师后，导师在有效期内能看这几位学员，待办里列出接手的事；撤销后收回', () => {
  const as = loadShared();
  let st = as('hrbp');
  const items = st.reassignItems().filter((x) => !x.race);
  const yq = st.reassignCandidates(items).find((c) => c.id === 'p-yeqing' && c.ok);
  assert.ok(yq, '叶青是可选的接手人');
  const res = st.reassign(items.map((x) => x.id), 'p-yeqing');
  st = as('mentor');
  for (const x of res.done) assert.equal(st.scope(x.person), 'mentor', `${x.person} 应进入叶青的查看范围`);
  const take = st.todos().filter((t) => t.kind === 'takeover');
  assert.equal(take.length, res.done.length);
  assert.ok(take.every((t) => t.href.startsWith('landing-review.html?id=')), '接手的事指向具体那件事');
  as('hrbp'); res.undo();
  st = as('mentor');
  for (const x of res.done) assert.equal(st.scope(x.person), null);
  assert.equal(st.todos().filter((t) => t.kind === 'takeover').length, 0);
});

test('面评候选人核对到人后，那一行可以确认并导入；选名单外跳过；撤销恢复待认人', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const r7 = imp.rows.find((r) => r.id === 'r7');
  st.ivSend('imp-1', 'r7');
  assert.equal(st.ivRowState(r7), 'sent');
  st.resolveInbox('i-iv-r7', 'p-x12');
  assert.equal(r7.match, 'p-x12');
  // 走到终点：确认这是谁，导入后档案里有这一段面评，撤销导入回到已确认
  assert.equal(st.ivRowState(r7), 'confirm');
  st.ivConfirm('imp-1', 'r7', true);
  const res = st.ivImport('imp-1');
  const e = st.event('e-iv-imp-1-r7');
  assert.deepEqual([...e.people], ['p-x12']);
  assert.equal(e.recorder, 'p-yeqing');
  assert.equal(st.ivRowState(r7), 'imported');
  res.undo();
  assert.equal(st.event('e-iv-imp-1-r7'), undefined);
  st.ivConfirm('imp-1', 'r7', false);
  st.unresolveInbox('i-iv-r7');
  assert.equal(r7.match, null);
  assert.equal(st.ivRowState(r7), 'sent');
  st.resolveInbox('i-iv-r7', 'none');
  assert.equal(st.ivRowState(r7), 'skip');
  st.unresolveInbox('i-iv-r7');
  assert.equal(st.ivRowState(r7), 'sent');
});

test('只有 HEIC 能转成 JPG 重传；格式不支持的文件保持失败', () => {
  const st = load('hrbp');
  const d = st.addFilesDrop([{ name: 'archive.zip', kind: {}, err: '读不了 .zip 格式，解压后逐个投递' }, { name: '现场.heic', kind: { type: 'image' }, err: '.heic 格式待转换：转成 JPG 或 PNG 再传' }]);
  st.retryFile(d.id, 'archive.zip');
  const zip = st.drop(d.id).files.find((f) => f.name === 'archive.zip');
  assert.equal(zip.state, 'failed');
  assert.match(zip.meta, /zip/);
  assert.equal(st.canConvert(zip), false);
  st.retryFile(d.id, '现场.heic');
  const img = st.drop(d.id).files.find((f) => f.name === '现场.jpg');
  assert.ok(img, 'HEIC 转成 JPG 后重新解析');
  assert.equal(img.state, 'parsing');
});

test('已导入的面评行不能再改补录值', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const r2 = imp.rows.find((r) => r.id === 'r2');
  st.resolveInbox(r2.verify, 's-28');
  st.ivFill('imp-1', 'r2', 'B');
  st.ivConfirm('imp-1', 'r2', true);
  st.ivImport('imp-1');
  st.ivFill('imp-1', 'r2', 'C');
  assert.equal(r2.filled, 'B');
  assert.equal(Object.fromEntries(st.event('e-iv-imp-1-r2').scale)['系统设计'], 'B');
});

test('HR 自己接手的事出现在工作台「接手的事」分组里', () => {
  const st = load('hrbp');
  const items = st.reassignItems().filter((x) => !x.race);
  st.reassign(items.map((x) => x.id), st.me().id);
  const take = st.todos().filter((t) => t.kind === 'takeover');
  assert.equal(take.length, items.length);
  assert.ok(take.every((t) => t.sub.startsWith('你自己接手')));
  const wb = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/workbench.js'), 'utf8');
  const groups = wb.match(/const GROUPS = (\[.*\]);/)[1];
  assert.match(groups, /\['takeover', '接手的事', \['takeover'\]\]/);
});

test('回执上确认一件事，已经人工确认的维度保持原样；撤销只还原这一次确认的维度', () => {
  const st = load('hrbp');
  const e = st.event('e-d1');
  assert.ok(e.scores.length > 1 && e.scores.every((s) => s.st === 'ai'));
  st.confirmScore('e-d1', 0, 2, '评审表写明是两人一起做的');
  const before = JSON.parse(JSON.stringify(e.scores[0]));
  const undo = st.receiptConfirm('e-d1');
  assert.deepEqual(JSON.parse(JSON.stringify(e.scores[0])), before, '人工改过的分没有被 AI 建议分覆盖');
  assert.ok(e.scores.slice(1).every((s) => s.st === 'confirmed' && s.v === s.ai));
  undo();
  assert.deepEqual(JSON.parse(JSON.stringify(e.scores[0])), before, '撤销后原有的人工判断和历史还在');
  assert.ok(e.scores.slice(1).every((s) => s.st === 'ai' && !s.hist));
});

test('待核对选「名单外的人」后，回执上这件事标为已跳过，不计入要确认的事；撤销后回到待核对', () => {
  const st = load('mentor');
  const d = st.drop('d-ms2');
  const item = () => st.dropItems(d).find((x) => x.ev.id === 'e-d5');
  assert.equal(item().state, 'held');
  // 待认人只计入待核对，不算一件事；选名单外以后也不算
  const before = st.dropSummary(d);
  st.resolveInbox('i-xz', 'none');
  assert.equal(item().state, 'skipped');
  assert.equal(st.dropSummary(d).events, before.events);
  assert.equal(st.dropSummary(d).verifyOpen, before.verifyOpen - 1);
  assert.equal(st.dropSummary(d).skipped, 1);
  st.unresolveInbox('i-xz');
  assert.equal(item().state, 'held');
});

test('导入后人员和面试官关联只读：待核对里不能撤销或改；撤销导入（记审计）后才能改', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1');
  const r2 = imp.rows.find((r) => r.id === 'r2'), r7 = imp.rows.find((r) => r.id === 'r7');
  st.resolveInbox(r2.verify, 's-28');
  st.ivFill('imp-1', 'r2', 'B');
  st.ivSend('imp-1', 'r7');
  st.resolveInbox('i-iv-r7', 'p-x12');
  st.ivConfirm('imp-1', 'r2', true);
  st.ivConfirm('imp-1', 'r7', true);
  const res = st.ivImport('imp-1');
  assert.equal(res.n, 2);
  const it7 = st.get().inbox.find((i) => i.id === 'i-iv-r7'), it2 = st.get().inbox.find((i) => i.id === r2.verify);
  assert.equal(st.inboxLocked(it7), true);
  assert.equal(st.inboxLocked(it2), true);
  assert.equal(st.lockHref(it7), 'import.html?id=imp-1', '更正入口指到这次面评导入');
  assert.equal(st.lockHref(it2), 'import.html?id=imp-1');
  assert.equal(st.unresolveInbox('i-iv-r7'), false, '候选人关联只读');
  assert.equal(st.unresolveInbox(r2.verify), false, '面试官关联只读');
  assert.equal(r7.match, 'p-x12');
  assert.equal(r2.interviewer, 's-28');
  st.ivConfirm('imp-1', 'r7', false);
  assert.equal(st.ivRowState(r7), 'imported', '已导入的行不能改回');
  assert.equal(st.ivAudit('imp-1')[0].act, '导入面评');

  assert.equal(st.ivUndoImport('imp-1'), true);
  assert.equal(st.event('e-iv-imp-1-r7'), undefined);
  assert.equal(st.event('e-iv-imp-1-r2'), undefined);
  const log = st.ivAudit('imp-1');
  assert.equal(log[0].act, '撤销导入');
  assert.equal(log[0].by, 'p-suwan');
  assert.equal(log[0].n, 2);
  assert.equal(res.undo(), false, 'Toast 里的旧撤销如实返回失败');
  assert.equal(st.unresolveInbox('i-iv-r7'), true, '撤销导入后可以改关联');
  assert.equal(r7.match, null);
});

test('批次状态从各行推出来：有行已送待核对时是部分导入，每一行都已导入或跳过才是已导入', () => {
  const st = load('hrbp');
  const imp = st.importOf('imp-1'), drop = st.drops().find((d) => d.import === 'imp-1');
  st.resolveInbox(imp.rows.find((r) => r.id === 'r2').verify, 's-28');
  st.ivFill('imp-1', 'r2', 'B');
  ['r1', 'r2', 'r5'].forEach((rid) => st.ivConfirm('imp-1', rid, true));
  st.ivSend('imp-1', 'r7');
  st.ivImport('imp-1');
  assert.deepEqual([...st.ivBatchState(imp)], ['partial', '部分导入']);
  if (drop) assert.equal(st.dropState(drop)[1], '部分导入');
  st.resolveInbox('i-iv-r7', 'none');
  assert.equal(st.ivBatchState(imp)[0], 'done');
  st.ivUndoImport('imp-1');
  assert.equal(st.ivBatchState(imp)[0], 'confirm');
});

test('接手的事按那件事的实际状态算办完：复盘确认后移出待办，建议分确认后也移出；撤销分派如实返回', () => {
  const st = load('hrbp');
  const items = st.reassignItems().filter((x) => !x.race);
  const res = st.reassign(items.map((x) => x.id), st.me().id);
  const ra1 = res.done.find((x) => x.id === 'ra-1'), ra3 = res.done.find((x) => x.id === 'ra-3');
  assert.match(st.reassignTask(ra1).label, /^W8 对人复盘/);
  assert.match(st.reassignTask(ra3).label, /1 条 AI 建议分待确认 · 日程冲突检测的规则设计/);
  const n = st.todos().filter((t) => t.kind === 'takeover').length;
  assert.ok(st.confirmReview('p-x83', 'W8'));
  assert.equal(st.reassignTask(ra1).done, true);
  assert.equal(st.todos().filter((t) => t.kind === 'takeover').length, n - 1);
  assert.equal(res.undo(), false, '其中一件已经办完，分派不撤销');
  st.confirmScore('e-ra3', 0, 3, '');
  assert.equal(st.reassignTask(ra3).done, true);
  assert.ok(!st.takenOver().includes(ra3));
  assert.ok(st.reassignDone().includes(ra1), '办完的接手记录保留在处理记录里');
});

test('答辩评委在回执里确认本人评分，待办随之消失；两位评委都确认后 HR 才能确认节点结论', () => {
  const mem = new Map();
  const mentor = load('mentor', mem);
  const d = mentor.drop('d-def');
  assert.ok(mentor.canSeeDrop(d), '评委能打开答辩录音的回执');
  const mine = mentor.dropItems(d).filter((x) => x.mine);
  assert.equal(mine.map((x) => x.ev.id).join(','), 'e-def-2,e-def-4', '只有本人评的两件事归他确认');
  assert.ok(mentor.todos().some((t) => t.kind === 'confirm' && t.href === 'receipt.html?id=d-def#confirm'));
  assert.equal(mentor.canConfirmConclusion(), false);

  let hr = load('hrbp', mem, false);
  const glc = hr.conclusion('nc-glc');
  assert.ok(hr.judgeStatus(glc).some((j) => !j.done));
  hr.confirmConclusion('nc-glc', '建议转正', '依据', 'edit');
  assert.equal(glc.versions.length, 0, '评委没确认完，结论确认不了');

  load('mentor', mem, false).receiptConfirm('e-def-4');
  assert.ok(!load('mentor', mem, false).todos().some((t) => t.href === 'receipt.html?id=d-def#confirm'), '确认后这条待办消失');
  hr = load('hrbp', mem, false);
  assert.ok(hr.judgeStatus(hr.conclusion('nc-glc')).every((j) => j.done));
  hr.confirmConclusion('nc-glc', '建议转正', '两位评委都已确认本人评分', 'edit');
  assert.equal(hr.conclusion('nc-glc').versions[0].type, '建议转正');
});

test('回到工作台：之前投递、还没处理完的批次接着按时推进，处理完就停', () => {
  const mem = new Map();
  load('hrbp', mem).addDemoDrop();
  // 刷新或离开后回来：同一份演示数据重新加载，再跑一遍工作台的投递区初始化
  const st = load('hrbp', mem, false);
  const d = st.drops().find((x) => x.title.startsWith('本次投递'));
  assert.ok(d.files.some((f) => f.steps?.some((s) => !s.done)), '批次还有没走完的步骤');
  const wb = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/workbench.js'), 'utf8');
  const src = wb.match(/  function wireUpload\(\) \{[\s\S]*?\n  \}\n/)[0];
  const timers = [];
  let rendered = 0;
  const el = { addEventListener() {}, classList: { add() {}, remove() {} } };
  const ctx = {
    st, UI: { ATT_MAX: 5 }, NT: { toast() {} }, html: () => '', mount() {}, icon: () => '',
    $: () => el, document: { body: { contains: () => true } },
    renderTasks: () => { rendered += 1; },
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: (id) => { timers[id - 1] = null; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${src}; wireUpload();`, ctx);
  assert.equal(timers.filter(Boolean).length, 1, '初始化时恢复了轮询');
  // 约定时间都过去了：轮询推进到处理完，刷新任务列表，然后停下
  d.files.forEach((f) => (f.steps || []).forEach((s) => { s.at = 0; }));
  timers[0]();
  assert.ok(rendered > 0);
  assert.ok(d.files.every((f) => !f.steps || f.steps.every((s) => s.done)));
  assert.equal(timers.filter(Boolean).length, 0, '都处理完以后停止轮询');
});

test('回执确认后只在 5 秒内可以撤销：只还原这一次确认的维度，超过撤销窗口后只读', () => {
  const st = load('mentor');
  const before = JSON.stringify(st.event('e-d1').scores);
  const undo = st.receiptConfirm('e-d1');
  assert.ok(st.event('e-d1').scores.every((x) => ['confirmed', 'calibrated'].includes(x.st)));
  assert.equal(undo(), true, '5 秒内可以撤销');
  assert.equal(JSON.stringify(st.event('e-d1').scores), before, '回到确认前');
  assert.equal(undo(), false, '同一次确认只撤销一次');
  const late = st.receiptConfirm('e-d1');
  st.RECEIPT_UNDO_MS = -1;
  assert.equal(late(), false, '超过撤销窗口后只读');
  assert.ok(st.event('e-d1').scores.every((x) => ['confirmed', 'calibrated'].includes(x.st)));
  assert.equal(st.RECEIPT_UNDO_MS !== undefined && typeof st.receiptRevert, 'undefined', '回执上没有长期的「改回待确认」');
  for (const f of ['../y/app/js/ui.js', '../y/m/js/pages/confirm.js', '../y/app/js/pages/receipt.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, f), 'utf8'), /改回待确认|data-rc-undo/, `${f} 不再有长期的改回待确认`);
  }
});

test('面评待认人的那一行在待核对里可以选「名单外的人」，这一行收进跳过的行', () => {
  const src = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/inbox.js'), 'utf8');
  assert.match(src, /i\.kind === 'unknown' \|\| i\.iv \? html`<button class="n-choice" type="button" data-v="none">/);
  // 待核对页的条目和规则层用的是同一条：选「名单外的人」后这一行跳过
  const hr = load('hrbp');
  hr.ivSend('imp-1', 'r7');
  const it = hr.get().inbox.find((i) => i.id === 'i-iv-r7');
  assert.ok(it.iv && it.kind === 'person' && !it.options.length, '面评待认人条目没有候选，只能搜索或选名单外');
  hr.resolveInbox(it.id, 'none');
  assert.equal(hr.ivRowState(hr.importOf('imp-1').rows.find((r) => r.id === 'r7')), 'skip');
});

test('回执计数：「件事」只算身份已确定的事，待认人只计入待核对，认出人以后才算一件事', () => {
  const st = load('mentor');
  const d = st.drop('d-ms2');
  const s0 = st.dropSummary(d);
  assert.equal(s0.events, st.dropItems(d).filter((x) => x.mine && !['held', 'skipped'].includes(x.state)).length);
  assert.equal(s0.verifyOpen, st.visibleInbox().filter((i) => d.verify.includes(i.id) && !i.done).length, '和待核对页的计数对得上');
  const it = st.get().inbox.find((i) => i.id === 'i-spk');
  st.resolveInbox('i-spk', it.options[0][0]);
  const s1 = st.dropSummary(d);
  assert.equal(s1.events, s0.events + 1, '认出人以后算一件事');
  assert.equal(s1.verifyOpen, s0.verifyOpen - 1);
  const m = fs.readFileSync(path.join(__dirname, '../y/m/js/pages/confirm.js'), 'utf8');
  assert.match(m, /const left = s\.mineToConfirm/, '手机回执的角标和「件待你确认」同一个数');
});

test('回执不给被权限隐藏的数量：有隐藏时只标 hidden，页面写一句「部分内容已按权限隐藏」', () => {
  const mentor = load('mentor');
  const d = mentor.drop('d-def');
  const s = mentor.dropSummary(d);
  assert.equal(s.events, 2, '只算本人要确认的两件事');
  assert.equal(s.people, 0, '查看范围外的人不计数');
  assert.equal(s.hidden, true);
  const hr = load('hrbp');
  assert.equal(hr.dropSummary(hr.drop('d-def')).events, 4);
  assert.equal(hr.dropSummary(hr.drop('d-def')).hidden, false);
  for (const f of ['../y/app/js/pages/receipt.js', '../y/m/js/pages/confirm.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.doesNotMatch(src, /已隐藏。|属于其他评价人/, `${f} 不再写被隐藏的数量`);
    assert.match(src, /部分内容已按权限隐藏/);
  }
});

test('核对结果的撤销截止到依赖它的草稿被确认：确认后只读，5 秒内撤销确认后才能撤销核对', () => {
  const st = load('mentor');
  const it = st.get().inbox.find((i) => i.id === 'i-spk');
  st.resolveInbox('i-spk', it.options[0][0]);
  assert.equal(st.inboxLockReason(it), null);
  const undo = st.receiptConfirm(it.ev);
  assert.equal(st.inboxLockReason(it), 'confirmed');
  assert.equal(st.lockHref(it), null, '确认锁只读，不给更正入口');
  assert.equal(st.unresolveInbox('i-spk'), false);
  assert.ok(st.event(it.ev), '撤销被拒，这件事和确认的分都还在');
  assert.equal(undo(), true, '提示条上 5 秒内撤销确认');
  assert.equal(st.inboxLockReason(it), null);
  assert.equal(st.unresolveInbox('i-spk'), true);
});

test('确认后 HR 又校准了：撤销确认被拒，校准的分保留，身份核对仍只读', () => {
  const st = load('mentor');
  const it = st.get().inbox.find((i) => i.id === 'i-spk');
  st.resolveInbox('i-spk', it.options[0][0]);
  const undo = st.receiptConfirm(it.ev);
  st.calibrate(it.ev, 0, 2, '评审表写明是两人一起做的');
  assert.equal(undo(), false, '这一维之后又被处理过，撤销被拒');
  assert.equal(st.event(it.ev).scores[0].v, 2, '校准的分保留');
  assert.equal(st.inboxLockReason(it), 'confirmed');
  assert.equal(st.lockHref(it), null);
  assert.equal(st.unresolveInbox('i-spk'), false);
});

test('所属对人复盘已确认后，撤销回执上的确认被拒', () => {
  const st = load('hrbp');
  const undos = [];
  st.review('p-x62', 'W8').events.forEach((e) => { if (e.scores.some((x) => x.st === 'ai')) undos.push(st.receiptConfirm(e.id)); });
  assert.equal(st.review('p-x62', 'W8').ai, 0);
  assert.ok(st.confirmReview('p-x62', 'W8'), '复盘可以确认');
  assert.ok(undos.length && undos.every((u) => u() === false), '复盘确认后，撤销确认被拒');
  const r2 = st.review('p-x62', 'W8');
  assert.equal(r2.state, 'confirmed');
  assert.equal(r2.ai, 0, '已确认的复盘里没有待确认的分');
});

test('图片范围选「整理范围内的行」：每一行整理成一件待确认的事，回到原批次的回执；撤销后一起撤回', () => {
  const st = load('hrbp');
  const d = st.drop('d-hr'), s0 = st.dropSummary(d);
  st.resolveInbox('i-region', 'rows');
  const evs = st.get().events.filter((e) => e.verifyOf === 'i-region');
  assert.equal(evs.map((e) => e.people[0]).sort().join(','), 'p-x62,p-x63,p-x65', '范围内的三行各一件');
  assert.ok(evs.every((e) => e.drop === 'd-hr' && e.srcs[0].type === 'image' && e.srcs[0].label === '评审群截图.png' && e.scores.every((x) => x.st === 'ai')));
  const s1 = st.dropSummary(d);
  assert.equal(s1.events, s0.events + 3, '回执里多出 3 件事');
  assert.equal(s1.toConfirm, s0.toConfirm + 3);
  assert.equal(s1.verifyOpen, s0.verifyOpen - 1);
  assert.equal(s1.people, s0.people + 1, '截图里新出现的人也算进涉及的人');
  assert.ok(st.dropItems(d).filter((x) => x.ev.verifyOf === 'i-region').every((x) => x.mine), '交材料的 HR 在回执里确认');
  assert.equal(st.unresolveInbox('i-region'), true);
  assert.equal(st.get().events.filter((e) => e.verifyOf === 'i-region').length, 0);
  assert.equal(st.dropSummary(d).events, s0.events);
  assert.equal(st.dropSummary(d).people, s0.people);
  st.resolveInbox('i-region', 'rows');
  st.receiptConfirm(evs[0].id);
  assert.equal(st.inboxLockReason(st.get().inbox.find((i) => i.id === 'i-region')), 'confirmed', '确认其中一件后，范围选择只读');
  assert.equal(st.unresolveInbox('i-region'), false);
  // 连接器给的路径：工作台投递演示材料，再选整理范围内的 2 行
  const m = load('mentor');
  const d2 = m.addDemoDrop();
  m.resolveInbox(`i-${d2.id}`, 'rows');
  const got = m.dropItems(d2).filter((x) => x.ev.verifyOf);
  assert.equal(got.length, 2);
  assert.ok(got.every((x) => x.mine && x.state === 'ai'));
});

test('手机回执页：批次还在处理时继续轮询，整理结果就绪后刷新确认列表，处理完停下', () => {
  const st = load('mentor');
  const d = st.addDemoDrop();
  const timers = [];
  let cfg, items = 0;
  const NTs = { store: st, ui: { receiptItem: () => { items += 1; return ''; }, wireReceipt() {}, state: () => '' },
    html: () => '', icon: () => '', mount() {}, $: () => ({}), param: () => d.id, mshell: (c) => { cfg = c; } };
  const ctx = { window: { NT: NTs }, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: (id) => { if (id) timers[id - 1] = null; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../y/m/js/pages/confirm.js'), 'utf8'), ctx);
  cfg.render({});
  assert.equal(items, 0, '纪要还没读完，没有可确认的事');
  assert.equal(timers.filter(Boolean).length, 1, '批次没处理完，继续轮询');
  d.files.forEach((f) => (f.steps || []).forEach((x) => { x.at = 0; }));
  st.get().events.filter((e) => e.drop === d.id).forEach((e) => { e.readyAt = 0; });
  items = 0;
  timers.find(Boolean)();
  assert.ok(items > 0, '整理结果就绪后刷新了确认列表');
  assert.equal(timers.filter(Boolean).length, 0, '处理完以后停止轮询');
});

test('课题核对可以选「明确无课题」', () => {
  const st = load('mentor');
  const it = st.get().inbox.find((i) => i.kind === 'project' && !i.done);
  st.resolveInbox(it.id, 'none');
  assert.equal(it.done, true);
  assert.equal(st.noneText(it), '明确无课题');
  const src = fs.readFileSync(path.join(__dirname, '../y/app/js/pages/inbox.js'), 'utf8');
  assert.match(src, /明确无课题|st\.noneText/);
});

test('对人复盘确认后才核对出来的事：已确认的复盘不变，这件事单独留在回执里待确认，确认后照常进档案', () => {
  const mem = new Map();
  const hr = load('hrbp', mem);
  // 连接器的路径：HR 先确认 p-x13 的现有评分和 W8 复盘，再把录音里的「说话人 2」核对成 p-x13
  hr.review('p-x13', 'W8').events.forEach((e) => { if (e.scores.some((x) => x.st === 'ai')) hr.receiptConfirm(e.id); });
  assert.ok(hr.confirmReview('p-x13', 'W8'), '复盘可以确认');
  const before = hr.review('p-x13', 'W8');
  const it = hr.get().inbox.find((i) => i.id === 'i-spk');
  hr.resolveInbox('i-spk', 'p-x13');
  const e = hr.event(it.ev);
  assert.ok(e && e.people[0] === 'p-x13', '核对后这件事归到 p-x13');
  const after = hr.review('p-x13', 'W8');
  assert.equal(after.state, 'confirmed', '已确认的复盘状态不变');
  assert.equal(after.ai, 0, '已确认的复盘里没有混进待确认的分');
  assert.equal(after.events.length, before.events.length, '复盘里的事不变');
  assert.ok(!after.events.includes(e));
  assert.equal(hr.lateNote(e), 'W8 对人复盘已确认，这件事单独待确认');
  assert.equal(hr.inboxLateNote(it), 'W8 对人复盘已确认，这件事单独待确认', '「已核对」里写清为什么单独列出');
  // 这件事留在原批次的回执里，由记录人在回执里确认
  const m = load('mentor', mem, false);
  const x = m.dropItems(m.drop('d-ms2')).find((y) => y.ev.id === it.ev);
  assert.ok(x && x.state === 'ai' && x.mine, '回执里单独一件待确认的事');
  assert.ok(m.receiptConfirm(it.ev));
  assert.ok(m.event(it.ev).scores.every((s) => s.st === 'confirmed'), '确认后计入档案');
  assert.equal(m.lateNote(m.event(it.ev)), 'W8 对人复盘已确认，这件事单独记入档案');
  const r = m.review('p-x13', 'W8');
  assert.equal(r.state, 'confirmed');
  assert.equal(r.ai, 0);
  assert.ok(m.scoresOf('p-x13').some((s) => s.ev.id === it.ev), '确认后照常进档案取数');
});

test('对人复盘还没确认时，核对出来的事照常并入复盘', () => {
  const st = load('hrbp');
  const before = st.review('p-x13', 'W8');
  const it = st.get().inbox.find((i) => i.id === 'i-spk');
  st.resolveInbox('i-spk', 'p-x13');
  const e = st.event(it.ev);
  assert.equal(e.late, undefined);
  assert.equal(st.lateNote(e), null);
  const after = st.review('p-x13', 'W8');
  assert.ok(after.events.includes(e), '并入复盘');
  assert.equal(after.state, before.state);
  assert.ok(after.ai >= before.ai);
});
