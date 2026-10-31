/* Niu-Talent 原型：采集与评价节点的状态与规则（决赛增补），挂在 NT.store 上。
   - 评价关系：评价人只看本节点、有效期内的人；关系到期后没做完的事交 HR 重新分派。
   - 材料批次与回执：多文件一次投递，文件各自处理；回执列出涉及的人、整理出的事、待核对和待确认；确认只在 Web 上逐条做。
   - 面评导入：HR 在预览里逐行确认「这是谁」；原量表原样保存，只导入已入职的人。
   - 节点结论：HR 依据评委已确认的本人评分和材料确认，评委只确认自己的评分；按版本保存，不生成关键事件。
   在 store.js 之后加载；状态存在演示数据的 intake 字段里，重置演示数据后按种子重来。 */
(function () {
  'use strict';
  const NT = window.NT;
  const st = NT.store;
  const SEED = NT.SEED.INTAKE;

  const I = () => {
    const S = st.get();
    if (!S.intake) {
      S.intake = NT.clone({ drops: SEED.DROPS, held: SEED.HELD, imports: SEED.IMPORTS, reassign: SEED.REASSIGN, conclusions: SEED.CONCLUSIONS, relations: SEED.RELATIONS, coverDone: [] });
    }
    return S.intake;
  };
  const me = () => st.me().id;
  const role = () => st.role();

  // ---------- 评价关系 ----------
  st.relations = () => I().relations;
  st.relation = (id) => I().relations.find((r) => r.id === id);
  st.relActive = (r, date = NT.TODAY) => !!r && r.from <= date && date <= r.to;
  // 评价人对某人在某节点的有效关系
  st.relFor = (rater, pid, node) => I().relations.find((r) => r.rater === rater && r.people.includes(pid) && (!node || r.node === node) && st.relActive(r));

  // ---------- 材料批次与回执 ----------
  st.ENTRY = { web: '统一投递', wecom: '企业微信 · 小犇', mcp: 'Claude Code（MCP）', mobile: '手机网页' };
  st.FILE_STATE = { uploading: ['upload', '上传中'], queued: ['clock', '排队中'], parsing: ['spark', '解析中'], transcribing: ['wave', '转写中'], done: ['check', '已解析'], failed: ['x', '失败'] };
  st.drop = (id) => I().drops.find((d) => d.id === id);
  // 文件按约定时间往下走（演示里新投递的批次）
  st.tickDrops = () => {
    let changed = false;
    I().drops.forEach((d) => d.files.forEach((f) => {
      (f.steps || []).forEach((s) => { if (!s.done && Date.now() >= s.at) { Object.assign(f, s.set); s.done = true; changed = true; } });
    }));
    if (changed) st.save();
    return changed;
  };
  // 一件事在这个批次里的状态：held 待核对后才能归到人；ai 待确认；confirmed 已确认
  const evState = (e) => (e.scores.every((s) => ['confirmed', 'calibrated'].includes(s.st)) ? 'confirmed' : 'ai');
  // 这件事由谁确认：记录人本人，且对这个人在本节点有有效的评价关系（HR 以记录人身份确认自己交的材料）
  st.confirmerOk = (e, who = me()) => e.recorder === who && (st.relFor(who, e.people[0]) || (st.person(who)?.role === 'hrbp' && st.scope(e.people[0], 'hrbp') === 'full'));
  st.dropItems = (d) => {
    const items = st.get().events.filter((e) => e.drop === d.id && !(e.readyAt > Date.now())).map((e) => ({ ev: e, state: evState(e) }));
    // 待核对选了「名单外的人」：这件事只保留在原件里，回执上标为已跳过；在待核对里撤销后回到待核对
    (d.held || []).forEach((id) => {
      if (items.some((x) => x.ev.id === id)) return;
      const verify = d.verify.find((v) => st.get().inbox.find((i) => i.id === v)?.ev === id), it = verify && st.get().inbox.find((i) => i.id === verify);
      items.push({ ev: I().held[id], state: it?.done && it.choice === 'none' ? 'skipped' : 'held', verify });
    });
    return items.map((x) => ({ ...x, mine: ['held', 'skipped'].includes(x.state) ? x.ev.recorder === me() : st.confirmerOk(x.ev) }));
  };
  // 回执上确认一件事：只确认还待确认的维度，已经人工确认或校准过的分保持原样；vals 是改过的分（维度序号 → 分数）。
  // 返回撤销函数，只还原这一次改动的维度，原有的人工判断和历史都保留
  st.receiptConfirm = (evId, vals = new Map(), why = '') => {
    const e = st.event(evId); if (!e) return null;
    const idx = e.scores.map((s, i) => (['confirmed', 'calibrated'].includes(s.st) ? -1 : i)).filter((i) => i >= 0);
    const snaps = idx.map((i) => [i, NT.clone(e.scores[i])]);
    idx.forEach((i) => st.confirmScore(e.id, i, vals.has(i) ? vals.get(i) : (e.scores[i].ai ?? e.scores[i].v), why));
    return () => { snaps.forEach(([i, s]) => { e.scores[i] = NT.clone(s); }); st.save(); };
  };
  st.dropSummary = (d) => {
    const items = st.dropItems(d), inbox = st.get().inbox;
    const verify = d.verify.map((id) => inbox.find((i) => i.id === id)).filter(Boolean);
    return {
      files: d.files.length,
      processing: d.files.filter((f) => ['uploading', 'queued', 'parsing', 'transcribing'].includes(f.state)).length,
      failed: d.files.filter((f) => f.state === 'failed').length,
      people: d.mentions.length,
      events: items.filter((x) => x.state !== 'skipped').length,
      skipped: items.filter((x) => x.state === 'skipped').length,
      verifyOpen: verify.filter((i) => !i.done).length,
      verify,
      toConfirm: items.filter((x) => x.state === 'ai').length,
      mineToConfirm: items.filter((x) => x.state === 'ai' && x.mine).length,
      confirmed: items.filter((x) => x.state === 'confirmed').length,
    };
  };
  // 批次一行的状态：先说还在处理的，再说待核对、待确认，都完成才写已完成
  st.dropState = (d) => {
    if (d.kind === 'interview') {
      const imp = st.importOf(d.import);
      return imp?.state === 'done' ? ['done', '已导入'] : ['confirm', '待逐行确认'];
    }
    const s = st.dropSummary(d);
    if (s.processing) return ['processing', '处理中'];
    if (s.verifyOpen) return ['verify', '待核对'];
    if (s.toConfirm) return ['confirm', '待确认'];
    return ['done', '已完成'];
  };
  // 能看这份回执：提交人、批次里有自己要确认的事的评价人、负责这些人的 HR
  st.canSeeDrop = (d) => !!d && (d.by === me() || (role() === 'hrbp' && (d.mentions.length ? d.mentions.some((p) => st.scope(p) === 'full') : d.by === me())) || st.dropItems(d).some((x) => x.mine));
  st.drops = () => I().drops.filter(st.canSeeDrop);
  st.dropHref = (d) => (d.kind === 'interview' ? `import.html?id=${d.import}` : `receipt.html?id=${d.id}`);
  // 工作台演示：一次拖入三个文件，各自处理，最后出回执
  st.addDemoDrop = () => {
    const now = Date.now(), id = NT.uid('d');
    const iid = `i-${id}`;
    st.get().inbox.push({ id: iid, kind: 'region', drop: id, src: '路演群截图.png', at: '第 1 张图', by: me(), q: '路演群截图里要整理哪几行？', rows: [['p-x07', '服务端的压测报告我放群文件了'], [null, ''], ['p-x06', '下午我把 UI 走查的问题单整理出来']], options: [] });
    const d = { id, title: '本次投递 · 3 个文件', by: me(), entry: 'web', at: `${NT.TODAY} ${new Date().toTimeString().slice(0, 5)}`, node: 'pg-xe6',
      files: [
        { name: 'W8 对人复盘纪要.docx', kind: 'doc', state: 'parsing', meta: '解析中 · 读取 9 段', steps: [{ at: now + 2400, set: { state: 'done', meta: '9 段 · 定位到段落' } }] },
        { name: '路演群截图.png', kind: 'image', state: 'queued', meta: '排队中', steps: [{ at: now + 1500, set: { state: 'parsing', meta: '识别文字和区域' } }, { at: now + 4200, set: { state: 'done', meta: '1 张图 · 定位到区域' } }] },
        { name: '路演现场.heic', kind: 'image', state: 'queued', meta: '排队中', steps: [{ at: now + 1800, set: { state: 'failed', meta: '.heic 格式待转换：转成 JPG 或 PNG 再传' } }] },
      ],
      mentions: ['p-x07', 'p-x06'], evs: [], held: [], verify: [iid] };
    I().drops.unshift(d);
    // 纪要读完后整理出一件事，建议分等交材料的人确认
    st.addEvent({ id: `e-${id}`, kind: 'obs', date: '2026-08-28', project: 't-talk-a', recorder: me(), people: ['p-x07'], title: '主动把任务池同步给全组，下午组员就接上了', bg: 'W8 对人复盘', act: '分工时把任务池同步给全组，组员当天就接上了', res: '', drop: id, readyAt: now + 2400,
      srcs: [{ type: 'doc', label: 'W8 对人复盘纪要.docx', loc: '第 4 段', quote: '孟映雪把任务池同步给了全组，下午组员就接上了' }], tags: [],
      scores: [{ p: 'p-x07', d: 'lead', v: 3, st: 'ai', ai: 3, note: '锚点 3 · 常规情境下稳定表现' }] });
    st.save();
    return d;
  };
  // 真实拖入的文件：读不了的直接失败并写明原因，其余按演示节奏解析
  st.addFilesDrop = (list) => {
    const now = Date.now(), id = NT.uid('d');
    const UNIT = { 页: '定位到页', 段: '定位到段落', 格: '定位到单元格', 时: '定位到时间点', 图: '定位到区域' };
    const d = { id, title: `本次投递 · ${list.length} 个文件`, by: me(), entry: 'web', at: `${NT.TODAY} ${new Date().toTimeString().slice(0, 5)}`,
      files: list.map((f, i) => (f.err ? { name: f.name, kind: f.kind.type || 'doc', state: 'failed', meta: f.err }
        : { name: f.name, kind: f.kind.type, state: 'queued', meta: '排队中', steps: [{ at: now + 600 + i * 400, set: { state: f.kind.unit === '时' ? 'transcribing' : 'parsing', meta: f.kind.unit === '时' ? '转写中' : '解析中 · 识别文字' } }, { at: now + 2600 + i * 600, set: { state: 'done', meta: `${f.kind.label} · ${UNIT[f.kind.unit]}（演示）` } }] })),
      mentions: [], evs: [], held: [], verify: [] };
    I().drops.unshift(d);
    st.save();
    return d;
  };
  // 只有 HEIC 能在演示里转成 JPG 重传；格式不支持、超过大小的文件保持失败，要换一个符合要求的新文件
  st.canConvert = (f) => /\.heic$/i.test(f.name);
  st.retryFile = (dropId, name) => {
    const f = st.drop(dropId)?.files.find((x) => x.name === name); if (!f || f.state !== 'failed' || !st.canConvert(f)) return;
    Object.assign(f, { name: f.name.replace(/\.heic$/i, '.jpg'), state: 'parsing', meta: '解析中 · 识别文字和区域', steps: [{ at: Date.now() + 2200, set: { state: 'done', meta: '1 张图 · 定位到区域' } }] });
    st.save();
  };

  // ---------- 待核对：按视角过滤；新类型的处理结果写回批次和面评导入 ----------
  st.INBOX_KINDS = [['speaker', '说话人'], ['person', '人名'], ['unknown', '未知人员'], ['project', '课题'], ['region', '图片范围'], ['interviewer', '面试官']];
  st.visibleInbox = () => st.get().inbox.filter((i) => role() === 'hrbp' || i.by === me());
  const baseResolve = st.resolveInbox, baseUnresolve = st.unresolveInbox;
  const ivRow = (it) => st.importOf(it.iv[0])?.rows.find((r) => r.id === it.iv[1]);
  st.resolveInbox = (id, choice) => {
    const it = st.get().inbox.find((x) => x.id === id);
    if (!it || it.done) return;
    // 「名单里没有这个人」「整张只作附件」也是处理完成：这一处不入档
    if (choice === 'none' || choice === 'attach' || choice === 'rows') {
      // 候选人不在人员目录里：面评那一行跳过，不导入
      if (it.iv && choice === 'none') { const r = ivRow(it); if (r) r.unknown = false; }
      it.done = true; it.later = false; it.choice = choice; st.save(); return;
    }
    baseResolve(id, choice);
    if (choice === 'skip') return;
    // 说话人、人名对上之后，挂在批次里的那件事归到这个人，进入待确认
    if (it.ev && I().held[it.ev] && !st.event(it.ev)) {
      const e = NT.clone(I().held[it.ev]);
      e.people = [choice]; e.scores.forEach((s) => { s.p = choice; });
      st.addEvent(e);
    }
    // 候选人核对到人后，面评那一行回到「待确认这是谁」
    if (it.iv) { const r = ivRow(it); if (r) { r.match = choice; r.unknown = false; r.joined = st.person(choice)?.joined; } }
    // 面试官关联到目录里的人后，面评那一行可以导入
    if (it.kind === 'interviewer') I().imports.forEach((imp) => imp.rows.forEach((r) => { if (r.verify === id) r.interviewer = choice; }));
    st.save();
  };
  st.unresolveInbox = (id) => {
    const it = st.get().inbox.find((x) => x.id === id); if (!it) return;
    if (it.ev && I().held[it.ev]) st.get().events = st.get().events.filter((e) => e.id !== it.ev);
    if (it.kind === 'interviewer') I().imports.forEach((imp) => imp.rows.forEach((r) => { if (r.verify === id) r.interviewer = null; }));
    if (it.iv) { const r = ivRow(it); if (r && !r.imported) { r.match = null; r.unknown = true; r.ok = false; delete r.joined; } }
    baseUnresolve(id);
  };
  // 面试官只能关联到人员目录里已有的人：目录里是工作人员（导师、助教、评委、HR、管理者）
  st.directory = (q) => NT.SEED.PEOPLE.filter((p) => p.noReview && p.role !== 'admin' && (!q || p.name.includes(q)));

  // ---------- 面评导入 ----------
  st.importOf = (id) => I().imports.find((x) => x.id === id);
  st.ivTemplate = (k) => SEED.TEMPLATES[k];
  // 一行的状态：skip 淘汰或未入职将跳过 · dup 已导入过 · unknown 认不出 · verify 面试官待核对 · unread 有分没读出 · confirm 待确认这是谁 · confirmed 已确认 · imported 已导入
  st.ivRowState = (r) => {
    if (r.imported) return 'imported';
    if (!r.match && !r.unknown) return 'skip';
    if (r.dup) return 'dup';
    if (r.unknown) return r.sent ? 'sent' : 'unknown';
    if (!r.interviewer) return 'verify';
    if (r.unread && !r.filled) return 'unread';
    return r.ok ? 'confirmed' : 'confirm';
  };
  st.ivConfirm = (impId, rid, ok) => { const r = st.importOf(impId).rows.find((x) => x.id === rid); r.ok = ok; st.save(); };
  // 已导入的行只读：补录值已写进档案，改这里不会同步过去
  st.ivFill = (impId, rid, v) => { const r = st.importOf(impId).rows.find((x) => x.id === rid); if (!r || r.imported) return; r.filled = v || null; if (!v) r.ok = false; st.save(); };
  // 认不出的人放进待核对：每行一条，重复点不重复生成
  st.ivSend = (impId, rid) => {
    const imp = st.importOf(impId), r = imp.rows.find((x) => x.id === rid);
    const iid = `i-iv-${rid}`;
    if (!st.get().inbox.some((x) => x.id === iid)) st.get().inbox.push({ id: iid, kind: 'person', iv: [impId, rid], src: imp.file, at: r.pages, by: me(), q: `面评${r.pages}的「${r.name}」是谁？`, quote: `候选人：${r.name} · 北森状态：${r.hr}`, options: [], note: '人员目录里查到 0 个同名的人；北森同步后再核对一次。' });
    r.sent = true; st.save();
  };
  // 导入已确认的行：写成面试段的历史评价，保留原量表；未入职、未确认的行不写
  st.ivImport = (impId) => {
    const imp = st.importOf(impId), rows = imp.rows.filter((r) => st.ivRowState(r) === 'confirmed');
    const added = rows.map((r) => {
      const t = SEED.TEMPLATES[r.tpl];
      const e = { id: `e-iv-${impId}-${r.id}`, kind: 'hist', histType: '面试', date: r.at, recorder: r.interviewer, people: [r.match], title: `${t.name}（北森）`, project: null,
        srcs: [{ type: 'doc', label: imp.file, loc: r.pages, by: r.interviewer, quote: r.note || `面试结论：${r.verdict}` }],
        scale: [...r.scores.map(([k, v]) => [k, v == null ? '不适用' : v === '?' ? (r.filled || '待补录') : v]), ['面试结论', r.verdict]], tags: [], scores: [] };
      st.get().events.unshift(e);
      r.imported = true;
      return e;
    });
    imp.state = imp.rows.some((r) => ['confirm', 'unread', 'verify', 'unknown'].includes(st.ivRowState(r))) ? 'preview' : 'done';
    imp.importedAt = NT.TODAY;
    st.save();
    return { n: added.length, undo: () => { st.get().events = st.get().events.filter((e) => !added.includes(e)); rows.forEach((r) => { delete r.imported; }); imp.state = 'preview'; st.save(); } };
  };

  // ---------- 节点结论 ----------
  st.CONCLUSION_TYPES = SEED.CONCLUSION_TYPES;
  st.conclusions = (nodeKey) => I().conclusions.filter((c) => c.node === nodeKey && st.scope(c.person));
  st.conclusionsOf = (pid) => I().conclusions.filter((c) => c.person === pid && c.versions.length);
  st.conclusion = (id) => I().conclusions.find((c) => c.id === id);
  // 每位评委对这个人的评分是否已由本人确认
  st.judgeStatus = (c) => {
    const node = c.node.split(':')[0];
    return I().relations.filter((r) => r.node === node && r.people.includes(c.person)).map((r) => {
      const evs = c.evs.map(st.event).filter((e) => e && e.recorder === r.rater);
      return { rater: r.rater, label: r.label, evs, done: evs.length > 0 && evs.every((e) => e.scores.every((s) => ['confirmed', 'calibrated'].includes(s.st))) };
    });
  };
  st.canConfirmConclusion = () => role() === 'hrbp';
  st.confirmConclusion = (id, type, why, from) => {
    const c = st.conclusion(id);
    if (!st.canConfirmConclusion() || st.judgeStatus(c).some((j) => !j.done)) return () => {};
    const v = { v: c.versions.length + 1, type, why, by: me(), at: NT.TODAY, from };
    c.versions.unshift(v);
    st.save();
    return () => { const i = c.versions.indexOf(v); if (i >= 0) { c.versions.splice(i, 1); st.save(); } };
  };
  const baseFacts = st.nodeFacts;
  st.nodeFacts = (pgId, node) => {
    if (pgId !== 'pg-def') return baseFacts(pgId, node);
    const list = st.conclusions(st.nodeKey(pgId, node.id));
    const raters = new Set(I().relations.filter((r) => r.node === pgId).map((r) => r.rater));
    return [{ k: '参与', v: `${list.length} 人 · 答辩评委 ${raters.size} 位` }, { k: '节点结论', v: `${list.filter((c) => c.versions.length).length} / ${list.length} 人已确认` }];
  };

  // ---------- 重新分派 ----------
  st.reassignItems = () => (role() === 'hrbp' ? I().reassign.filter((x) => !x.to && !x.gone && st.scope(x.person) === 'full') : []);
  st.reassignDone = () => (role() === 'hrbp' ? I().reassign.filter((x) => x.to || x.gone) : []);
  // 接手人：同期有效的评价人优先，其次是 HR 本人；被评价人本人和关系已到期的人选不了
  st.reassignCandidates = (items) => {
    const people = new Set(items.map((x) => x.person));
    const active = I().relations.filter((r) => r.node === 'pg-xe6' && st.relActive(r));
    const list = active.map((r) => ({ id: r.rater, label: `${r.label} · 本期关系到 ${NT.md(r.to)}`, ok: true }));
    list.push({ id: 'p-suwan', label: 'HR · 我自己', ok: true });
    I().relations.filter((r) => r.node === 'pg-xe6' && !st.relActive(r)).forEach((r) => list.push({ id: r.rater, label: `${r.label} · 关系 ${NT.md(r.to)} 已到期`, ok: false }));
    return list.filter((c) => !people.has(c.id));
  };
  st.reassign = (ids, to) => {
    const S = I(), done = [], conflicts = [];
    ids.forEach((id) => {
      const x = S.reassign.find((r) => r.id === id); if (!x) return;
      if (x.race) { x.gone = x.race; conflicts.push(x); return; }
      x.to = to; x.by = me(); x.at = NT.TODAY; done.push(x);
    });
    // 接手人对这几位学员新增一段评价关系，到这批事里最晚的截止日
    let rel = null;
    if (done.length && to !== me()) {
      rel = { id: NT.uid('rel'), rater: to, label: '接手评价', node: 'pg-xe6', people: [...new Set(done.map((x) => x.person))], from: NT.TODAY, to: done.map((x) => x.due).sort().pop(), from_reassign: true };
      S.relations.push(rel);
    }
    st.save();
    return { done, conflicts, undo: () => { done.forEach((x) => { delete x.to; delete x.by; delete x.at; }); if (rel) S.relations = S.relations.filter((r) => r !== rel); st.save(); } };
  };

  // 接手的事：接手人在有效期内对这几位学员有评价关系，可以打开档案、记录；待办里列出要做的事
  const baseScope = st.scope;
  st.scope = (pid, r = role()) => baseScope(pid, r) || (r === 'mentor' && I().relations.some((x) => x.from_reassign && x.rater === NT.SEED.ROLES.mentor.person && x.people.includes(pid) && st.relActive(x)) ? 'mentor' : null);
  st.takenOver = () => I().reassign.filter((x) => x.to === me());

  // ---------- 节点覆盖提醒 ----------
  st.coverage = () => SEED.COVERAGE.filter((c) => !I().coverDone.includes(c.id) && (c.rater === me() || role() === 'hrbp'))
    .map((c) => ({ ...c, missing: c.people.filter((p) => !st.get().events.some((e) => e.recorder === c.rater && e.people.includes(p) && e.date >= c.due)) }))
    .filter((c) => c.missing.length);

  // ---------- 待办：在原有待办之后补上采集与节点的几组 ----------
  const baseTodos = st.todos;
  st.todos = () => {
    const list = baseTodos();
    if (role() === 'admin' || role() === 'ceo') return list;
    st.tickDrops();
    I().drops.forEach((d) => {
      const s = st.dropSummary(d);
      if (s.mineToConfirm) list.push({ kind: 'confirm', badge: '待确认', cls: 'n-badge--ai', icon: 'spark', title: `${d.title}：${s.mineToConfirm} 件事的建议分待你确认`, sub: `${st.ENTRY[d.entry]}交的材料 · 逐条确认或改分`, due: NT.md(d.at.slice(0, 10)), href: `receipt.html?id=${d.id}#confirm` });
    });
    if (role() === 'hrbp') {
      const ra = st.reassignItems();
      if (ra.length) {
        const r = st.relation(ra[0].rel);
        list.push({ kind: 'reassign', badge: '待重新分派', title: `${st.person(r.rater).name}的评价关系已到期：${ra.length} 件事待接手`, sub: `${r.label} · ${NT.md(r.to)} 到期 · 选接手人`, due: NT.md(ra.map((x) => x.due).sort()[0]), href: 'reassign.html' });
      }
      I().conclusions.filter((c) => !c.versions.length && st.scope(c.person) === 'full').forEach((c) => {
        const js = st.judgeStatus(c), wait = js.filter((j) => !j.done);
        list.push({ kind: 'conclusion', badge: '节点结论', cls: 'n-badge--seal', title: `转正答辩 · ${st.person(c.person).name}的结论待你确认`, sub: wait.length ? `等${wait.map((j) => st.person(j.rater).name).join('、')}确认本人评分` : '评委都已确认本人评分', due: '本人确认', href: `actions.html?node=${c.node}#${c.id}` });
      });
    }
    st.takenOver().forEach((x) => list.push({ kind: 'takeover', badge: '接手', title: `${st.person(x.person).name} · ${x.what}`, sub: `${x.by === me() ? '你自己接手' : `${st.person(x.by).name}分派给你`} · 原评价人的关系已到期`, due: NT.md(x.due), href: `person.html?id=${x.person}` }));
    st.coverage().forEach((c) => list.push({ kind: 'cover', badge: '待补记录', title: `${c.node} · ${c.missing.length} 位学员待补记录`, sub: `${c.missing.map((p) => st.person(p).name).join('、')} · 节点 ${NT.md(c.due)} 已到${c.rater === me() ? '' : ` · 评价人 ${st.person(c.rater).name}`}`, due: NT.md(c.due), href: c.rater === me() ? `person.html?id=${c.missing[0]}` : 'landing.html' }));
    return list;
  };
})();
