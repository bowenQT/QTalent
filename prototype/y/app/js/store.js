/* Niu-Talent 原型：演示状态与业务规则。
   - 状态：种子数据的可变副本，存在本浏览器 localStorage，各人互不影响，可一键重置。
   - 视角：?as=ceo|hrbp|lead|mentor|self，只是演示手段；这里的权限判断模拟服务端「先过滤再呈现」。
   - 规则：象限参考位置（3.8.2）、变化（3.14，change-v1）、档案版本都从已确认的事件分实时算出。 */
(function () {
  'use strict';
  const NT = window.NT;
  const SEED = NT.SEED;
  const KEY = 'nty-demo';
  const ROLE_KEY = 'nty-role';

  // ---------- 持久化 ----------
  let S = null;
  function fresh() {
    const s = NT.clone({
      v: SEED.version, events: SEED.EVENTS, projects: SEED.PROJECTS, members: SEED.MEMBERS, memberLog: SEED.MEMBER_LOG,
      needs: SEED.NEEDS, plans: SEED.PLANS, actions: SEED.ACTIONS, tracks: SEED.TRACKS, signals: SEED.SIGNALS, inbox: SEED.INBOX,
      tasks: SEED.TASKS, batches: SEED.BATCHES, conclusions: SEED.CONCLUSIONS, tagCands: SEED.TAG_CANDIDATES, taglibAdd: [],
      seen: {}, snaps: [], reviews: {}, reviewEvals: {}, corrections: [], selfNotes: [], directions: SEED.DIRECTIONS,
      watchClues: SEED.WATCH_CLUES, follows: SEED.FOLLOWS, rules: SEED.RULES, ruleSugs: SEED.RULE_SUGS, reviewHolds: [],
      recalKeeps: {}, nodeRetros: SEED.NODE_RETROS, judgeMarks: {}, judgeAttribs: Object.fromEntries(Object.values(SEED.JUDGE.attribs).map((a) => [a.hyp, a])),
    });
    S = s;
    // 每件事固定保存时生效的维度与锚点版本（v1.6 3.35.6）；之后补日期、确认分数都按这一版。种子只有 rubric-v1 生效过
    s.events.forEach((e) => { e.rubric ??= store.ruleLive('rubric').v; });
    s.snaps.push(buildSnap({ id: 's-mid', batch: 'b-xe6-mid', label: '中期', org: 'xe6', cutoff: '2026-08-07', at: '2026-08-10', by: 'p-suwan' }));
    return s;
  }
  // 演示数据版本变了就从新的种子开始；旧的演示操作先备份到 nty-demo-prev，并提示一次，不静默覆盖
  // 备份写不进去（存储已满）时不覆盖旧数据：新版本只在本页内存里运行，旧数据原样留在 nty-demo
  let upgradedFrom = null, keepOld = false;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === SEED.version) return s;
        upgradedFrom = s?.v ?? '?';
        try { localStorage.setItem(`${KEY}-prev`, raw); } catch (e) { keepOld = true; }
      }
    } catch (e) { /* 隐私模式或存储被禁用时退回内存状态 */ }
    return fresh();
  }
  const store = (NT.store = {});
  store.save = () => {
    if (!keepOld) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 存不下时只在本页生效 */ } }
    if (NT.refreshNav) NT.refreshNav(); // 待办数等随数据变化的导航角标
  };
  store.reset = () => { keepOld = false; try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ } fresh(); store.save(); };
  store.get = () => S;

  // ---------- 基础查询 ----------
  const PEOPLE = new Map(SEED.PEOPLE.map((p) => [p.id, p]));
  const ORGS = new Map(SEED.ORGS.map((o) => [o.id, o]));
  store.dims = SEED.DIMS;
  store.dim = (id) => SEED.DIMS.find((d) => d.id === id);
  store.person = (id) => PEOPLE.get(id);
  store.people = () => SEED.PEOPLE;
  store.org = (id) => ORGS.get(id);
  store.orgs = () => SEED.ORGS;
  store.orgPath = (id) => { const o = ORGS.get(id); if (!o) return ''; const p = o.parent && ORGS.get(o.parent); return p && !p.group ? `${p.name} / ${o.name}` : o.name; };
  store.orgShort = (id) => ORGS.get(id)?.name || '';
  store.inOrg = (orgId, root) => { let o = ORGS.get(orgId); while (o) { if (o.id === root) return true; o = ORGS.get(o.parent); } return false; };
  store.orgAt = (p, date) => { const h = p.orgHist.find(([, from, to]) => from <= date && (!to || date < to)); return h ? h[0] : null; };
  store.project = (id) => S.projects.find((p) => p.id === id);
  store.event = (id) => S.events.find((e) => e.id === id);
  store.batch = (id) => S.batches.find((b) => b.id === id);
  store.plan = (id) => S.plans.find((p) => p.id === id);
  store.membersOf = (projectId, all) => S.members.filter((m) => m.project === projectId && (all || !m.to));
  store.projectsOf = (personId, all) => S.members.filter((m) => m.person === personId && (all || !m.to)).map((m) => ({ ...m, p: store.project(m.project) })).filter((m) => m.p);
  store.landingOf = (pid) => { const b = S.batches.find((x) => x.kind === 'landing' && x.newcomers.some((n) => n[0] === pid)); return b ? { batch: b, row: b.newcomers.find((n) => n[0] === pid) } : null; };
  store.tenure = (p) => { const d = NT.days(p.joined), w = p.landing ? '入营' : '入职'; return d < 60 ? `${w} ${Math.max(1, Math.round(d / 7))} 周` : d < 365 ? `${w} ${Math.round(d / 30)} 个月` : `${w} ${Math.floor(d / 365)} 年`; };

  // ---------- 视角与权限（演示） ----------
  const ROLES = SEED.ROLES;
  store.roles = ROLES;
  store.role = () => {
    const q = NT.param('as');
    if (q && ROLES[q]) { try { localStorage.setItem(ROLE_KEY, q); } catch (e) { /* 忽略 */ } return q; }
    try { const r = localStorage.getItem(ROLE_KEY); if (r && ROLES[r]) return r; } catch (e) { /* 忽略 */ }
    return 'hrbp';
  };
  store.setRole = (r) => { try { localStorage.setItem(ROLE_KEY, r); } catch (e) { /* 忽略 */ } };
  store.me = () => PEOPLE.get(ROLES[store.role()].person);
  const MENTOR_OF = (mid) => {
    const set = new Set();
    S.batches.filter((b) => b.kind === 'landing').forEach((b) => b.newcomers.forEach(([pid, , mentors]) => { if (mentors.includes(mid)) set.add(pid); }));
    return set;
  };
  // 返回 'full' | 'project' | 'mentor' | 'self' | null
  store.scope = (pid, role = store.role()) => {
    const p = PEOPLE.get(pid); if (!p) return null;
    const me = ROLES[role].person;
    if (role === 'ceo') return 'full';
    if (role === 'hrbp') return p.hrbp === me ? 'full' : null;
    if (role === 'lead') {
      const lead = PEOPLE.get(me);
      if (store.inOrg(p.org, lead.leads)) return 'full';
      const owned = S.projects.filter((x) => x.owner === me).map((x) => x.id);
      return S.members.some((m) => m.person === pid && owned.includes(m.project)) ? 'project' : null;
    }
    if (role === 'mentor') return MENTOR_OF(me).has(pid) ? 'mentor' : pid === me ? 'self' : null;
    if (role === 'self') return pid === me ? 'self' : null;
    return null;
  };
  store.visiblePeople = (role = store.role()) => SEED.PEOPLE.filter((p) => store.scope(p.id, role) && !p.noReview);
  // 能力开关，对应需求 3.5.3
  store.can = (what, pid, role = store.role()) => {
    const sc = pid ? store.scope(pid, role) : null;
    switch (what) {
      case 'scores': return pid ? ['full', 'mentor', 'project'].includes(sc) : role !== 'self';
      case 'quad': return pid ? sc === 'full' && role !== 'mentor' : ['ceo', 'hrbp', 'lead'].includes(role);
      case 'mgmt': return pid ? sc === 'full' && role !== 'mentor' : ['ceo', 'hrbp', 'lead'].includes(role);
      // 整理档案（写管理判断、采纳 AI 摘要）由 HR 汇总各方意见后做；管理者是公司层视角，只读
      case 'curate': return role === 'hrbp' && (!pid || sc === 'full');
      case 'signals': {
        if (!['ceo', 'hrbp', 'lead'].includes(role)) return false;
        if (!pid) return true;
        if (role === 'lead') return PEOPLE.get(pid)?.manager === ROLES.lead.person;
        return sc === 'full';
      }
      case 'changes': return pid ? sc === 'full' && role !== 'mentor' : ['ceo', 'hrbp', 'lead'].includes(role);
      case 'record': return pid ? ['full', 'mentor', 'project'].includes(sc) : role !== 'self';
      // 校准、象限确认、标签收录、留用与落位方案由 HR 确认，管理者只读
      case 'calibrate': return role === 'hrbp';
      case 'quadConfirm': return role === 'hrbp';
      case 'findOwner': return ['ceo', 'hrbp', 'lead'].includes(role);
      case 'confirmPlan': return ['ceo', 'hrbp'].includes(role);
      case 'approveTags': return role === 'hrbp';
      case 'review': return ['ceo', 'hrbp', 'lead'].includes(role);
      default: return false;
    }
  };

  // ---------- 对象级权限：先判断视角能不能碰这个对象，页面只负责呈现 ----------
  const myHrbpOrgs = (me) => SEED.PEOPLE.filter((q) => q.hrbp === me).map((q) => q.org);
  const isMentorOf = (projectId, me) => S.members.some((m) => m.project === projectId && m.person === me && !m.to && m.role === '导师')
    || S.batches.some((b) => b.kind === 'landing' && b.newcomers.some(([, topic, mentors]) => topic === projectId && mentors.includes(me)));
  // 项目编辑：创建者、owner、管理者，项目所属组织在本人范围内的 HR，以及被分配到该课题的导师（需求 3.6.3）
  store.canEditProject = (p, role = store.role()) => {
    if (!p) return false;
    const me = ROLES[role].person;
    if (role === 'self') return false;
    if (role === 'ceo' || p.creator === me || p.owner === me) return true;
    if (role === 'hrbp') return true; // HR 负责全部人才项目
    if (role === 'lead') return store.inOrg(p.org, PEOPLE.get(me).leads);
    if (role === 'mentor') return !!p.batch && isMentorOf(p.id, me);
    return false;
  };
  // 用人需求与方案属于管理受限资料：发起人、管理者、相关 HR、范围内的部门负责人
  store.canStaff = (projectId, role = store.role()) => {
    if (!store.can('findOwner', null, role)) return false;
    const p = S.projects.find((x) => x.id === projectId);
    return !p || store.canEditProject(p, role);
  };
  // 某个人（不限演示视角）能不能为这个项目找人：推动「任用讨论」指派负责人前校验，避免生成打不开的待办
  store.canStaffAs = (pid, projectId) => {
    const p = S.projects.find((x) => x.id === projectId), q = PEOPLE.get(pid);
    if (!p) return true;
    if (!q || p.creator === pid || p.owner === pid) return !!q;
    const hrOrgs = myHrbpOrgs(pid);
    if (hrOrgs.length) return hrOrgs.some((o) => store.inOrg(o, p.org));
    return !!q.leads && store.inOrg(p.org, q.leads);
  };
  // 盘点批次：范围内至少有一个本视角能完整查看的人
  store.canBatch = (b, role = store.role()) => !!b && store.can('review', null, role)
    && SEED.PEOPLE.some((q) => !q.noReview && store.inOrg(q.org, b.org) && store.scope(q.id, role) === 'full');
  // 组织调整方案里本视角能看到的动作：涉及的人在完整范围内；人选待定的动作，部门负责人只看本部门项目的
  store.canSeeMove = (m, role = store.role()) => {
    if (m.person) return store.scope(m.person, role) === 'full' && role !== 'mentor';
    if (role !== 'lead') return ['ceo', 'hrbp'].includes(role);
    const proj = m.pending && S.projects.find((x) => x.id === m.pending);
    return !!proj && store.inOrg(proj.org, PEOPLE.get(ROLES[role].person).leads);
  };
  store.canSeePlan = (plan, role = store.role()) => (plan.kind === 'org'
    ? store.canBatch(S.batches.find((b) => b.id === plan.batch), role)
    : plan.by === ROLES[role].person || store.canStaff(plan.project, role));
  // 会议纪要：录入人、该批次的导师、批次学员的归属 HR，以及管理者
  // 能打开某份纪要：有会议权限，或这次录音就是本人录的
  store.canOpenMinutes = (mid, role = store.role()) => store.canMeeting(SEED.MINUTES[mid], role) || S.tasks.some((t) => t.minutes === mid && t.by === ROLES[role].person);
  // 任务按视角过滤：会议纪要任务看纪要权限；录入人本人的任务本人可见；没有录入人的材料任务（评审表等）给 HR 和管理者，
  // 导师只看到文件名里点名的学员属于自己所带范围的那几条
  store.visibleTasks = () => {
    const role = store.role(), me = ROLES[role].person;
    return S.tasks.filter((t) => {
      if (t.minutes) return store.canOpenMinutes(t.minutes);
      if (t.by) return t.by === me || ['ceo', 'hrbp'].includes(role);
      if (['ceo', 'hrbp', 'lead'].includes(role)) return true;
      return role === 'mentor' && SEED.PEOPLE.some((p) => t.name.includes(p.name) && store.scope(p.id, role) === 'mentor');
    });
  };
  store.canMeeting = (m, role = store.role()) => {
    if (!m || role === 'self') return false;
    const me = ROLES[role].person;
    if (role === 'ceo' || m.by === me) return true;
    const b = S.batches.find((x) => x.id === m.batch);
    if (!b || !b.newcomers) return false;
    return b.newcomers.some(([pid, , mentors]) => mentors.includes(me) || (role === 'hrbp' && PEOPLE.get(pid)?.hrbp === me));
  };

  // ---------- 分数 ----------
  const COUNTED = ['confirmed', 'calibrated'];
  // 一个人的事件分（已确认 + 已校准），可限定时间窗。
  // 给人看的地方传 visible: true，只算当前视角能看到的事件；参考位置等服务端计算用全量
  store.scoresOf = (pid, o = {}) => {
    const out = [];
    const seen = o.visible ? new Set(store.visibleEvents(pid).events.map((e) => e.id)) : null;
    S.events.forEach((e) => {
      if (!e.date || e.kind !== 'obs') return;
      if (seen && !seen.has(e.id)) return;
      if (o.from && e.date < o.from) return;
      if (o.to && e.date > o.to) return;
      e.scores.forEach((s) => {
        if (s.p !== pid || s.v == null) return;
        // 不兼容修订生效后，旧版本下的分待按新版本复核：原分保留，复核前不参与当前版本的取数（v1.6 3.35.5）。
        // 判断对照按原版本对照证据，传 anyVer: true
        if (!o.anyVer && store.heldBy(e, s)) return;
        if (!o.all && !COUNTED.includes(s.st)) return;
        if (o.dim && s.d !== o.dim) return;
        // 按新版本复核过的分，当前取数用复核后的值、版本与确认人；原分和原版本保留在事件上，判断对照按原分
        const rev = !o.anyVer && lastRev(s);
        out.push({ ...s, v: rev ? rev.v : s.v, by: rev ? rev.by : s.by, ver: rev ? rev.ver : e.rubric, ev: e, date: e.date });
      });
    });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  };
  store.eventsOf = (pid, o = {}) => S.events.filter((e) => (e.people.includes(pid) || (e.group && e.project && S.members.some((m) => m.project === e.project && m.person === pid)))
    && (!o.kind || e.kind === o.kind)).sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  store.mean = mean;

  // ---------- 象限参考位置（rubric-v1 / 3.8.2） ----------
  const QN = { hh: '双高', hl: '高潜待练', lh: '专业骨干', ll: '待观察' };
  store.QN = QN;
  const frac = (m) => (m < 3.5 ? 0.5 * (m - 1) / 2.5 : 0.5 + 0.5 * (m - 3.5) / 1.5);
  const hashJ = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ((h % 100) / 100 - 0.5) * 0.06; };
  store.refPos = (pid, until = NT.TODAY) => {
    const from = NT.addDays(until, -365);
    const sc = store.scoresOf(pid, { from, to: until });
    const by = (d) => sc.filter((s) => s.d === d);
    const prof = by('prof');
    const core = ['mot', 'wis', 'grit'].map((d) => ({ d, list: by(d) }));
    const coreScored = core.filter((c) => c.list.length);
    const potEvents = new Set(core.flatMap((c) => c.list.map((s) => s.ev.id)));
    const profEvents = new Set(prof.map((s) => s.ev.id));
    const miss = [];
    if (profEvents.size < 2) miss.push(profEvents.size ? '专业度缺 1 条事件' : '专业度待评分');
    if (potEvents.size < 2) miss.push(potEvents.size ? '潜力轴缺 1 条事件' : '潜力轴缺 2 条事件');
    else if (coreScored.length < 2) miss.push(`潜力核心只有${store.dim(coreScored[0].d).name}有分`);
    const px = mean(prof.map((s) => s.v));
    const py = coreScored.length ? mean(coreScored.map((c) => mean(c.list.map((s) => s.v)))) : null;
    const bonus = ['lead', 'open'].some((d) => { const m = mean(by(d).map((s) => s.v)); return m != null && m >= 4; });
    const dims = {};
    SEED.DIMS.forEach((d) => { const l = by(d.id); dims[d.id] = { n: l.length, m: mean(l.map((s) => s.v)) }; });
    if (miss.length) return { na: true, miss: miss.join('，'), dims, n: sc.length };
    const q = (py >= 3.5 ? 'h' : 'l') + (px >= 3.5 ? 'h' : 'l');
    // 同分的人略微错开，避免头像重叠；错开不越过十字线，参考象限不变
    const spread = (base, j) => { const v = Math.min(0.94, Math.max(0.06, base + j)); return base >= 0.5 ? Math.max(0.58, v) : Math.min(0.42, v); };
    return { q, x: spread(frac(px), hashJ(pid)), y: spread(1 - frac(py) - (py >= 3.5 ? 0.001 : 0), hashJ(pid + 'y')), px, py, bonus, dims, n: sc.length };
  };

  // ---------- 档案快照与正式位置 ----------
  function buildSnap(o) {
    const entries = {};
    SEED.PEOPLE.forEach((p) => {
      if (p.noReview) return;
      const org = store.orgAt(p, o.cutoff);
      if (!org || !store.inOrg(org, o.org)) return;
      const r = store.refPos(p.id, o.cutoff);
      const ov = SEED.H1_OVERRIDE[p.id];
      entries[p.id] = { q: r.na ? null : (ov?.q || r.q), x: r.x, y: r.y, ref: r.q || null, na: !!r.na, miss: r.miss || '', reason: ov?.reason || '', dims: r.dims, n: r.n, py: r.py, bonus: !!r.bonus, org };
    });
    return { ...o, entries };
  }
  store.snaps = () => S.snaps;
  store.formal = (pid) => { // 最近一次冻结的正式位置
    for (let i = S.snaps.length - 1; i >= 0; i--) { const e = S.snaps[i].entries[pid]; if (e && e.q) return { ...e, snap: S.snaps[i] }; }
    return null;
  };
  store.formalHistory = (pid) => S.snaps.filter((s) => s.entries[pid]?.q).map((s) => ({ ...s.entries[pid], snap: s }));
  // 参考位置离开了正式象限：HR 可以去象限校准里调整，也可以写明理由保持正式位置。
  // 保持只对这一次冻结、这一个参考象限有效；参考位置再移到别的象限，或有了新的冻结，会重新提示
  const snapKey = (f) => f.snap.id || f.snap.at;
  const keptFor = (pid, f, r) => { const k = S.recalKeeps?.[pid]; return k && k.snap === snapKey(f) && k.refQ === r.q ? k : null; };
  store.needsRecal = (pid) => { const f = store.formal(pid); if (!f) return false; const r = store.refPos(pid); return !r.na && r.q !== f.q && !keptFor(pid, f, r); };
  store.recalKept = (pid) => { const f = store.formal(pid); if (!f) return null; const r = store.refPos(pid); return r.na || r.q === f.q ? null : keptFor(pid, f, r); };
  store.recalKeptList = () => Object.keys(S.recalKeeps || {}).filter((pid) => store.scope(pid) === 'full' && store.recalKept(pid)).map((pid) => ({ person: pid, ...S.recalKeeps[pid] }));
  store.keepFormal = (pid, why) => {
    const f = store.formal(pid), r = store.refPos(pid);
    if (!store.can('calibrate') || !f || r.na || r.q === f.q || !why) return null;
    S.recalKeeps = S.recalKeeps || {};
    const prev = S.recalKeeps[pid];
    S.recalKeeps[pid] = { snap: snapKey(f), q: f.q, refQ: r.q, why, by: store.me().id, at: NT.TODAY, ts: Date.now() };
    store.save();
    return () => { if (prev) S.recalKeeps[pid] = prev; else delete S.recalKeeps[pid]; store.save(); };
  };
  store.freeze = (snap) => { S.snaps.push(snap); store.save(); };
  // 部门负责人在校准时的拖动和理由：存成建议，HR /管理者打开同一团队时可以看到并采纳
  store.calibSuggestions = (batch, team) => S.calibSuggest?.[`${batch}:${team}`] || {};
  store.suggestCalib = (batch, team, pid, sug) => {
    S.calibSuggest = S.calibSuggest || {};
    const k = `${batch}:${team}`;
    (S.calibSuggest[k] = S.calibSuggest[k] || {})[pid] = { ...sug, by: store.me().id, at: NT.TODAY };
    store.save();
  };

  // ---------- 变化（change-v1 / 3.14） ----------
  const RECENT = NT.addDays(NT.TODAY, -90);
  const BASE_FROM = NT.addDays(NT.TODAY, -365);
  store.changes = (o = {}) => {
    const base = o.base || 'win'; // win：近 3 个月 vs 之前 9 个月；ver：vs 中期档案版本
    const role = o.role || store.role(); // o.role：评价体系的影响预览按全公司口径算
    if (!store.can('changes', null, role)) return [];
    const people = store.visiblePeople(role).filter((p) => store.scope(p.id, role) === 'full');
    const out = [];
    const h1 = S.snaps.find((s) => s.id === 's-mid');
    people.forEach((p) => {
      // ① 能力走向
      SEED.DIMS.forEach((d) => {
        const recent = store.scoresOf(p.id, { dim: d.id, from: RECENT });
        const before = base === 'win' ? store.scoresOf(p.id, { dim: d.id, from: BASE_FROM, to: NT.addDays(RECENT, -1) }) : store.scoresOf(p.id, { dim: d.id, from: NT.addDays(h1.cutoff, -365), to: h1.cutoff });
        if (recent.length < 2 || !before.length) return; // 资料从无到有不算上升
        const a = mean(before.map((s) => s.v)), b = mean(recent.map((s) => s.v));
        if (Math.abs(b - a) < 1.5) return;
        out.push({ id: `trend-${p.id}-${d.id}`, t: 'trend', hit: true, person: p.id, dim: d.id, what: `${d.name}${b > a ? '走高' : '走低'}`, from: a, to: b, up: b > a,
          n: recent.length, thin: recent.length < 2, when: recent[0].date, rule: '均值变化 ≥ 1.5', before: before.slice(0, 4), after: recent.slice(0, 4) });
      });
      // ② 活跃度：90 天没有新事件（从来没有事件的人不算变化，属于资料不足）
      const obs = S.events.filter((e) => e.kind === 'obs' && e.date && e.people.includes(p.id)).sort((x, y) => y.date.localeCompare(x.date));
      if (obs.length && obs[0].date < RECENT) {
        const lastProj = store.projectsOf(p.id, true).sort((x, y) => y.from.localeCompare(x.from))[0];
        out.push({ id: `idle-${p.id}`, t: 'activity', hit: true, person: p.id, what: '90 天没有新事件', when: NT.addDays(obs[0].date, 90), rule: '90 天无新事件',
          sub: `最近一条：${NT.md(obs[0].date)} ${obs[0].title}${lastProj ? ` · 最近加入的项目：${lastProj.p.name}（${NT.md(lastProj.from)}）` : ''}`, last: obs[0] });
      }
      // ③ 象限偏移
      const f = store.formal(p.id), r = store.refPos(p.id);
      if (f && !r.na && f.q !== r.q) {
        const after = store.scoresOf(p.id, { from: NT.addDays(f.snap.cutoff, 1) });
        out.push({ id: `quad-${p.id}`, t: 'quad', hit: true, person: p.id, what: '参考位置离开正式象限', when: after[0]?.date || NT.TODAY, rule: '参考位置跨象限',
          sub: `正式位置：${QN[f.q]}（${f.snap.label} 校准）→ 参考位置：${QN[r.q]} · 之后新增 ${new Set(after.map((s) => s.ev.id)).size} 条事件`, fq: f.q, rq: r.q });
      }
    });
    // 活跃度：项目进出、调岗（记录层面的变化，不命中规则）
    S.memberLog.filter((l) => l.at >= RECENT).forEach((l, i) => {
      const m = S.members.find((x) => x.project === l.project && l.text.startsWith(store.person(x.person)?.name || '#'));
      if (!m || !people.some((p) => p.id === m.person)) return;
      out.push({ id: `mem-${i}-${l.at}`, t: 'activity', hit: false, person: m.person, what: l.text.replace(store.person(m.person).name, ''), when: l.at, sub: `${store.project(l.project).name} · 成员记录 · ${store.person(l.by).name}` });
    });
    // ④ 团队分布：资料不足比例
    {
      const teams = SEED.ORGS.filter((o) => o.parent === 'xe6');
      teams.forEach((t) => {
        // 入职不到 3 个月的新人本来就资料不足，不计入比例，另行说明
        const all = SEED.PEOPLE.filter((p) => !p.noReview && p.org === t.id && store.scope(p.id) === 'full');
        const now = all.filter((p) => p.merged || NT.days(p.joined) >= 90);
        if (!now.length) return;
        const prev = Object.entries(h1.entries).filter(([, e]) => e.org === t.id);
        const naNow = now.filter((p) => store.refPos(p.id).na).length;
        const rNow = naNow / now.length, rPrev = prev.length ? prev.filter(([, e]) => e.na).length / prev.length : 0;
        if (rNow - rPrev < 0.2) return;
        const merged = now.filter((p) => p.merged).length;
        const newbies = all.length - now.length;
        out.push({ id: `team-${t.id}`, t: 'team', hit: true, team: t.id, what: '资料不足比例上升', from: Math.round(rPrev * 100), to: Math.round(rNow * 100), unit: '%', when: merged ? '2026-10-20' : NT.TODAY,
          rule: '资料不足 +20 个百分点', sub: `${now.length} 人中 ${naNow} 人资料不足${merged ? ` · 并入的 ${merged} 人事件待补录` : ''}${newbies ? ` · 入职 3 个月内的 ${newbies} 名新人另计` : ''}`, merged, newbies });
      });
    }
    return out.sort((a, b) => b.when.localeCompare(a.when)); // 按发生时间，不按幅度
  };
  store.markSeen = (id, on) => { S.seen[id] = on; store.save(); };

  // ---------- 待办（按视角） ----------
  store.todos = () => {
    const role = store.role(), me = ROLES[role].person, list = [];
    const visibleInbox = S.inbox.filter((i) => !i.done && (role === 'hrbp' || i.by === me || (role === 'mentor')));
    if (role !== 'self' && role !== 'lead') visibleInbox.slice().sort((a, b) => (a.later ? 1 : 0) - (b.later ? 1 : 0)).forEach((i) => list.push({ kind: 'verify', badge: '待核对', cls: 'n-badge--ai', icon: 'spark', title: i.q.replace(/？$/, ''), sub: `${i.src} · ${i.at}${i.later ? ' · 已选稍后处理' : ''}`, due: i.later ? '稍后' : '今天', href: `inbox.html#${i.id}` }));
    if (store.can('calibrate')) store.queue().forEach((q) => list.push({ kind: 'calib', badge: q.kindLabel, cls: q.kind === 'conflict' ? 'n-badge--conflict' : '', icon: q.kind === 'conflict' ? 'split' : '', title: q.title, sub: q.sub, due: q.pair, href: `queue.html#${q.id}` }));
    S.tracks.filter((t) => t.state === 'on' && (t.owner === me || t.helper === me) && store.scope(t.person)).forEach((t) => list.push({ kind: 'track', badge: '跟踪到期', title: `${store.person(t.person).name}的观察问题`, sub: t.q, due: NT.md(t.next), href: `person.html?id=${t.person}#track` }));
    S.signals.filter((s) => s.state === 'talk' && s.result?.who === me).forEach((s) => list.push({ kind: 'talk', badge: '待跟进', title: `和${store.person(s.person).name}聊一次`, sub: '来自「值得聊一聊」', due: s.result.when, href: `person.html?id=${s.person}#signal` }));
    if (role === 'mentor') {
      const b = store.batch('b-xe6');
      b.newcomers.filter((n) => n[2][0] === me).forEach(([pid]) => {
        const r = store.review(pid, 'W8');
        if (r.state !== 'confirmed') list.push({ kind: 'review', person: pid, badge: '对人复盘', title: `${store.person(pid).name} · ${r.week} 对人复盘`, sub: `${store.reviewProgress(r)}${r.conflicts ? ` · ${r.conflicts} 项在校准队列` : ''}`, due: NT.md(NT.TODAY), href: `landing-review.html?id=${pid}` });
      });
    }
    S.plans.filter((p) => p.status === 'draft').forEach((p) => {
      if (!store.can('review') && role !== 'lead') return;
      const title = p.kind === 'staffing' ? `项目用人方案 v${p.version}` : `${p.title || '组织调整方案'} v${p.version}`;
      const sub = p.kind === 'staffing' ? `${store.project(p.project)?.name || ''} · ${store.person(p.by).name}起草` : `${store.batch(p.batch).name}`;
      // 组织调整（留用与落位）方案由 HR 在方案页确认，管理者只读，不进管理者的待办
      if (role !== 'hrbp' || p.kind !== 'org') return;
      list.push({ kind: 'plan', plan: p.id, badge: '待确认', cls: 'n-badge--seal', title, sub, due: '本人确认', href: `plan.html?id=${p.batch}` });
    });
    // 评分人本人：旧版本下给的分待按新版本复核
    if (role !== 'hrbp') { const mine = store.myHeldScores(); if (mine.length) list.push({ kind: 'rulereview', badge: '按新版本复核', title: `${mine.length} 条你的评分待按 ${mine[0].ver} 复核`, sub: '原分保留；你确认前这些分暂停参与取数，你不在时由 HR 代确认', href: 'rules.html?r=rubric' }); }
    if (role === 'hrbp') {
      store.reviewHolds().forEach((h) => list.push({ kind: 'rulereview', badge: '按新版本复核', title: `${h.ver}：${h.n} 条旧分待按新版本复核`, sub: `涉及 ${h.people} 人、${h.raters} 位评分人；复核确认前暂停参与取数`, due: NT.md(h.at), href: 'rules.html?r=rubric' }));
      S.ruleSugs.filter((x) => x.state === 'open').forEach((x) => list.push({ kind: 'rulesug', sug: x.id, badge: '修订建议', title: `${store.sugLabel(x)}：${store.person(x.by).name}的建议`, sub: `「${x.text}」`, due: NT.md(x.at), href: `rules.html?r=${x.rule}#sugs` }));
      Object.keys(S.rules).forEach((k) => S.rules[k].filter((r) => r.state === 'draft' && r.returned && r.by === me).forEach((r) => list.push({ kind: 'ruleback', badge: '管理者退回', cls: 'n-badge--seal', title: `${store.ruleKindName(k)} ${r.v} 退回到草稿`, sub: `「${r.returned.why}」`, due: NT.md(r.returned.at), href: `rules.html?r=${k}${r.line ? `&line=${r.line}` : ''}` })));
      store.watchPending().forEach((c) => list.push({ kind: 'clue', clue: c.id, badge: '待核实', cls: 'n-badge--ai', icon: 'spark', title: `${store.person(c.person).name}：${c.why}`, sub: c.dir ? `${store.person(c.by).name}推荐${store.fitText(c.dir)} · 核实后进入档案的发展方向和「值得关注的人」` : `${c.by === 'ai' ? 'AI 线索' : `${store.person(c.by).name}提名`} · 核实后进入「值得关注的人」`, due: NT.md(c.at), href: `person.html?id=${c.person}` }));
    }
    return list;
  };

  // ---------- HR 校准队列 ----------
  store.queue = () => {
    const q = [];
    S.events.forEach((e) => e.scores.forEach((s, i) => {
      if (!store.scope(s.p) || store.scope(s.p) === 'self') return;
      const name = store.person(s.p).name, dn = store.dim(s.d).name;
      if (s.st === 'conflict') q.push({ id: `${e.id}-${i}`, ev: e, s, i, kind: 'conflict', kindLabel: '待校准', title: `${dn}分差 ${Math.abs(s.raters[0].v - s.raters[1].v)} 分`, sub: `${name} · ${s.raters.map((r) => `${store.person(r.by).name} ${r.v}`).join(' / ')}`, pair: s.raters.map((r) => r.v).join(' / ') });
      else if (s.bigGap && s.st === 'confirmed' && !lastRev(s)) q.push({ id: `${e.id}-${i}`, ev: e, s, i, kind: 'gap', kindLabel: '与 AI 分差大', title: `${name} · ${dn}`, sub: `${store.person(s.by).name}确认 ${s.v}，AI 建议 ${s.ai}，没写理由`, pair: `${s.v} / ${s.ai}` });
    }));
    store.visiblePeople().filter((p) => store.scope(p.id) === 'full' && store.needsRecal(p.id)).forEach((p) => {
      const f = store.formal(p.id), r = store.refPos(p.id);
      q.push({ id: `recal-${p.id}`, person: p.id, kind: 'recal', kindLabel: '可能需要重新校准', title: `${p.name} · 参考位置从${QN[f.q]}移到${QN[r.q]}`, sub: '正式位置不会自动移动', pair: '去象限' });
    });
    return q;
  };
  store.calibrate = (evId, idx, v, why) => {
    const e = store.event(evId), s = e.scores[idx];
    const me = store.me().id;
    s.hist = [{ v, kind: 'calib', by: me, at: NT.TODAY, why }, ...(s.raters || []).map((r) => ({ v: r.v, kind: 'confirm', by: r.by, at: e.date, why: r.why })), ...(s.hist || []).filter((h) => h.kind !== 'calib'), ...(s.ai != null && !s.raters ? [{ v: s.v, kind: 'confirm', by: s.by, at: e.date }] : [])];
    s.st = 'calibrated'; s.v = v; s.by = me; delete s.bigGap;
    // 按新版本复核过的分以最近一条复核参与取数：校准值同时记到那一版上，取数和校准历史一致
    const rev = lastRev(s); if (rev) s.revs.push({ v, ver: rev.ver, by: me, at: NT.TODAY, calib: true });
    store.save();
  };

  // ---------- Landing 对人复盘 ----------
  store.review = (pid, week = 'W8') => {
    const b = store.landingOf(pid)?.batch || store.batch('b-xe6');
    const w = b.weeks.find((x) => x[0] === week);
    const from = b.from, to = w[4];
    const key = `${pid}-${week}`;
    // 复盘里直接补的事件按当天记日期，但归属这次复盘
    const evs = S.events.filter((e) => e.kind === 'obs' && e.people.includes(pid) && (e.review === key || (e.date && e.date >= from && e.date <= to)));
    const saved = S.reviews[key] || {};
    const rows = SEED.DIMS.map((d) => {
      const items = [];
      evs.forEach((e) => e.scores.forEach((s, i) => { if (s.p === pid && s.d === d.id) items.push({ e, s, i }); }));
      let state = 'unknown';
      if (items.some((x) => x.s.st === 'conflict')) state = 'conflict';
      else if (items.some((x) => x.s.st === 'ai')) state = 'ai';
      else if (items.some((x) => COUNTED.includes(x.s.st))) state = 'confirmed';
      else if (items.length) state = 'unknown';
      else state = d.core ? 'unknown' : 'absent';
      return { d, items, state };
    });
    const relevant = rows.filter((r) => r.items.length);
    return { key, week, from, to, events: evs, rows, total: relevant.length, confirmed: relevant.filter((r) => r.state === 'confirmed').length,
      conflicts: rows.filter((r) => r.state === 'conflict').length, ai: rows.filter((r) => r.state === 'ai').length, state: saved.state || 'draft', by: saved.by, at: saved.at };
  };
  store.confirmReview = (pid, week) => { S.reviews[`${pid}-${week}`] = { state: 'confirmed', by: store.me().id, at: NT.TODAY }; store.save(); };
  // 对人复盘每一维的评价：AI 草拟只作参考，HR 和所带导师可以采用、改写、修正；每次保存署名，旧版本保留
  store.canEditReview = (pid, role = store.role()) => (role === 'hrbp' && store.scope(pid, role) === 'full') || (role === 'mentor' && store.scope(pid, role) === 'mentor');
  store.reviewEvalHist = (pid, week, dim) => S.reviewEvals?.[`${pid}-${week}`]?.[dim] || [];
  store.reviewEval = (pid, week, dim) => store.reviewEvalHist(pid, week, dim)[0] || null;
  store.setReviewEval = (pid, week, dim, text, from) => {
    if (!store.canEditReview(pid) || !text?.trim()) return null;
    S.reviewEvals ??= {};
    const m = (S.reviewEvals[`${pid}-${week}`] ??= {}), prev = m[dim] || [];
    m[dim] = [{ text: text.trim(), by: store.me().id, at: NT.TODAY, from }, ...prev]; store.save();
    return () => { m[dim] = prev; store.save(); };
  };
  // AI 草拟：按这一维的事件和分数（已确认的用确认分，否则用 AI 建议分）对上锚点；没有分数就不草拟
  store.reviewEvalDraft = (pid, row) => {
    const scored = row?.items.filter(({ s }) => (s.v ?? s.ai) != null) || [];
    if (!scored.length) return '';
    const v = Math.round(mean(scored.map(({ s }) => s.v ?? s.ai)));
    const list = store.anchors(row.d.id, pid, store.eventRubric(scored[0].e) || undefined).list;
    const titles = [...new Set(scored.map(({ e }) => e.title))];
    return `${titles.slice(0, 2).map((t) => `「${t}」`).join('、')}${titles.length > 2 ? ` 等 ${titles.length} 件事` : ''}显示，${row.d.name}接近锚点 ${v}：${list[v - 1]}。`;
  };
  // 对人复盘的进度：还有几项没确认，或者逐项都确认了、只差整份确认
  store.reviewProgress = (r) => {
    if (r.state === 'confirmed') return '已确认';
    if (!r.total) return '待记录事件';
    const left = r.total - r.confirmed;
    return left > 0 ? `还有 ${left} 项待确认` : '逐项已确认，待整份确认';
  };

  // 采纳的 AI 摘要记下它依据的事件和是否含象限信息；换到看不到这些内容的视角时不复用，改由 AI 按新视角重写
  store.adoptSummary = (pid, text, quad) => {
    S.summaries = S.summaries || {};
    S.summaries[pid] = { text, by: store.me().id, at: NT.TODAY, ids: store.visibleEvents(pid).events.map((e) => e.id), quad: !!quad };
    store.save();
  };
  store.summaryFor = (pid) => {
    const saved = S.summaries?.[pid];
    if (!saved || !saved.ids) return null;
    if (saved.quad && !store.can('quad', pid)) return null;
    const seen = new Set(store.visibleEvents(pid).events.map((e) => e.id));
    return saved.ids.every((id) => seen.has(id)) ? saved : null;
  };

  // 档案里这个视角能看到的事件：导师看不到管理观察和管理受限资料；项目负责人只看自己项目相关的
  store.visibleEvents = (pid) => {
    const role = store.role(), scope = store.scope(pid), land = store.landingOf(pid);
    let events = store.eventsOf(pid), hidden = 0;
    if (role === 'mentor') {
      const team = land ? land.row[2] : [];
      const keep = (e) => (e.kind === 'obs' && (team.includes(e.recorder) || e.recorder === store.me().id)) || (e.kind === 'hist' && !e.restricted && e.histType !== '招聘评估') || e.kind === 'self';
      hidden = events.filter((e) => !keep(e)).length; events = events.filter(keep);
    } else if (scope === 'project') {
      const owned = S.projects.filter((x) => x.owner === store.me().id).map((x) => x.id);
      hidden = events.filter((e) => !owned.includes(e.project)).length; events = events.filter((e) => owned.includes(e.project));
    }
    if (!store.can('mgmt', pid)) { hidden += events.filter((e) => e.restricted).length; events = events.filter((e) => !e.restricted); }
    return { events, hidden };
  };

  // 刚录完的录音在后台整理：约定时间一到，任务变成「部分完成」，结果回到工作台
  store.tickTasks = () => {
    let changed = false;
    S.tasks.forEach((t) => { if (t.readyAt && t.state === 'shaping' && Date.now() >= t.readyAt) { const mi = t.minutes && SEED.MINUTES[t.minutes]; t.state = 'partial'; t.note = mi ? `${mi.events.length} 条事件已整理，${S.inbox.filter((i) => i.src === mi.title && !i.done).length} 处待核对` : '整理完成'; changed = true; } });
    if (changed) store.save();
  };

  // ---------- 写入 ----------
  // ts：同一天内的先后；rubric：保存时生效的维度与锚点版本，之后确认分数也按这一版（v1.6 3.35.6）
  store.addEvent = (e) => { e.ts ??= Date.now(); e.rubric ??= store.ruleLive('rubric').v; S.events.unshift(e); store.save(); return e; };
  store.removeEvent = (id) => { S.events = S.events.filter((e) => e.id !== id); store.save(); };
  store.confirmScore = (evId, idx, v, why) => {
    const e = store.event(evId), s = e.scores[idx];
    const me = store.me().id;
    const prev = s.ai ?? s.v;
    s.hist = [{ v, kind: v !== prev && s.ai != null ? 'edit' : 'confirm', by: me, at: NT.TODAY, why }, ...(s.ai != null ? [{ v: s.ai, kind: 'ai', at: e.date }] : [])];
    s.v = v; s.st = 'confirmed'; s.by = me;
    if (s.ai != null && Math.abs(s.ai - v) >= 2 && !why) s.bigGap = true;
    store.save();
  };
  store.unconfirmScore = (evId, idx) => { const s = store.event(evId).scores[idx]; s.st = 'ai'; s.v = s.ai; delete s.by; delete s.hist; delete s.bigGap; store.save(); };
  // 选「都不是，稍后处理」不算核对完成：条目留在待核对里，标记为稍后（later），待办数照旧计入
  store.resolveInbox = (id, choice) => {
    const it = S.inbox.find((x) => x.id === id);
    if (!it) return;
    if (choice === 'skip') { it.later = true; it.choice = null; store.save(); return; }
    it.done = true; it.later = false; it.choice = choice;
    if (it.draft && choice) {
      const d = it.draft;
      store.addEvent({ id: `e-${id}`, kind: 'obs', date: d.date, project: d.project, recorder: d.recorder, people: [choice], title: d.title,
        bg: '', act: it.quote, res: '', srcs: [{ type: 'audio', label: it.src, loc: it.at, by: it.by, quote: it.quote }], tags: [],
        scores: d.scores.map(([dim, v, note]) => ({ p: choice, d: dim, v, st: 'ai', ai: v, note })) });
    }
    store.save();
  };
  // 确认项目用人方案：冻结版本，写入成员与 owner，生成行动；组织调整方案里等这个人选的那一条随之填上
  store.slotRoles = (plan) => S.needs.find((n) => n.id === plan.need)?.roles || Object.keys(plan.slots).map((id) => ({ id, name: id === 'owner' ? '项目 owner' : id }));
  store.confirmStaffing = (plan, roles = store.slotRoles(plan)) => {
    const me = store.me().id, p = store.project(plan.project);
    S.plans.filter((x) => x.project === plan.project && x.status === 'confirmed' && x !== plan).forEach((x) => { x.status = 'superseded'; });
    Object.assign(plan, { status: 'confirmed', confirmedBy: me, confirmedAt: NT.TODAY });
    roles.forEach((r) => {
      const pid = plan.slots[r.id]; if (!pid) return;
      const name = store.person(pid).name;
      const role = r.id === 'owner' ? 'owner' : r.name, mode = r.id === 'owner' ? '全职' : '兼职';
      const cur = S.members.find((m) => m.project === plan.project && m.person === pid && !m.to);
      if (r.id === 'owner') p.owner = pid;
      if (cur && cur.role === role) { S.memberLog.unshift({ project: plan.project, at: NT.TODAY, text: `${name}：${r.name}写入方案 v${plan.version}`, by: me }); return; }
      if (cur) {
        // 已在项目里的人换了角色：成员记录同步改，原角色写进成员历史
        const was = cur.role;
        Object.assign(cur, { role, mode });
        S.memberLog.unshift({ project: plan.project, at: NT.TODAY, text: `${name}：${was} → ${role}：来自项目用人方案 v${plan.version}`, by: me });
      } else {
        S.members.push({ project: plan.project, person: pid, role, mode, from: NT.TODAY, to: null, by: me });
        S.memberLog.unshift({ project: plan.project, at: NT.TODAY, text: `${name}${r.id === 'owner' ? '成为 owner' : `加入：${r.name}`}：来自项目用人方案 v${plan.version}`, by: me });
      }
      // 每个人选生成一条跟进行动，执行情况在项目复盘里跟进
      S.actions.unshift({ id: NT.uid('a'), at: NT.TODAY, ts: Date.now(), title: `${name}${r.id === 'owner' ? `接任${p.name} owner` : `加入${p.name}（${r.name}）`}`, from: plan.id, person: pid, owner: 'p-suwan', due: '2026-11-01', state: 'todo', observe: '2027-01-31' });
    });
    // 只回填还能改的草稿；已确认的组织方案是冻结快照，人选由上面生成的行动跟进
    S.plans.filter((x) => x.kind === 'org' && x.status === 'draft').forEach((op) => op.moves.forEach((m) => { if (m.pending === plan.project && !m.person && plan.slots.owner) { m.person = plan.slots.owner; m.will = '未知 · 待沟通'; } }));
    store.save();
  };
  // 确认组织调整方案：冻结版本，每条动作生成一条行动
  store.confirmOrg = (plan) => {
    const me = store.me().id;
    S.plans.filter((x) => x.kind === 'org' && x.batch === plan.batch && x.status === 'confirmed' && x !== plan).forEach((x) => { x.status = 'superseded'; });
    Object.assign(plan, { status: 'confirmed', confirmedBy: me, confirmedAt: NT.TODAY });
    // 方案确认是盘点的最后一步：同时确认批次，并为范围内还没有快照的人补齐档案版本（未校准的人只冻结参考位置）
    const b = S.batches.find((x) => x.id === plan.batch);
    if (b && b.status !== 'confirmed') {
      let sn = S.snaps.find((x) => x.batch === b.id);
      if (!sn) { sn = { id: `s-${b.id}`, batch: b.id, label: b.name.match(/\d{4} H\d/)?.[0] || b.name, org: b.org, cutoff: b.cutoff, at: NT.TODAY, by: me, entries: {}, teams: [] }; S.snaps.push(sn); }
      SEED.PEOPLE.forEach((p) => {
        if (p.noReview || sn.entries[p.id] || !store.inOrg(p.org, b.org)) return;
        const r = store.refPos(p.id, b.cutoff);
        sn.entries[p.id] = { q: null, ref: r.na ? null : r.q, na: !!r.na, miss: r.miss || '', uncal: true, dims: r.dims, n: r.n, py: r.py, bonus: !!r.bonus, org: p.org };
      });
      Object.assign(b, { status: 'confirmed', confirmedAt: NT.TODAY, confirmedBy: me });
    }
    let created = 0;
    plan.moves.forEach((m) => {
      const title = m.type === '继续观察' ? `${store.person(m.person)?.name || ''}：${m.next}` : `${m.person ? store.person(m.person).name : '人选待定'}${m.type === '负责人安排' ? `接任${m.to}` : `：${m.from ? `${m.from} → ` : ''}${m.to}`}`;
      if (S.actions.some((a) => a.title === title)) return;
      created += 1;
      S.actions.unshift({ id: NT.uid('a'), at: NT.TODAY, ts: Date.now(), title, kind: m.kind, from: plan.id, person: m.person, owner: m.owner || 'p-suwan', due: m.due || '2026-11-15', state: 'todo', observe: m.type === '继续观察' ? null : '2027-02-15' });
    });
    store.save();
    return created;
  };
  store.unresolveInbox = (id) => {
    const it = S.inbox.find((x) => x.id === id);
    if (!it) return;
    it.done = false; it.later = false; it.choice = null;
    S.events = S.events.filter((e) => e.id !== `e-${id}`);
    store.save();
  };
  // 重试失败的任务：整理出的人名问题进入收件箱（每个任务一条，重复重试不重复生成），任务变成「部分待核对」，去核对的入口指向它
  const RETRY_INBOX = {
    'tk-1on1': { kind: 'person', src: '导师一对一', at: '10:20', by: 'p-yeqing', q: '录音里的「小周」指的是谁？', quote: '小周这周先画了接口图，再去找后端对齐，顺序是对的。',
      options: [['p-x15', '分镜工厂 · 二组 · 可能性高'], ['p-x11', '分镜工厂 · 二组']], draft: null },
  };
  store.finishTask = (id) => {
    const t = S.tasks.find((x) => x.id === id); if (!t) return null;
    const tpl = RETRY_INBOX[id];
    if (!tpl) { Object.assign(t, { state: 'done', note: '整理完成' }); store.save(); return t; }
    const iid = `i-${id}`;
    if (!S.inbox.some((x) => x.id === iid)) S.inbox.push({ id: iid, ...NT.clone(tpl) });
    Object.assign(t, { state: 'partial', note: '提取完成，1 处人名待核对', link: `inbox.html#${iid}` });
    store.save();
    return t;
  };
  // 项目成员：参数不全、项目或人不存在、已在项目里都不写入，返回 null；成功返回这条成员记录
  store.addMember = (m) => {
    if (!m || !m.person || !m.project || !store.person(m.person) || !store.project(m.project)) return null;
    if (S.members.some((x) => x.project === m.project && x.person === m.person && !x.to)) return null;
    S.members.push(m);
    S.memberLog.unshift({ project: m.project, at: NT.TODAY, text: `${store.person(m.person).name}加入：${m.role} · ${m.mode}`, by: store.me().id });
    store.save();
    return m;
  };
  // 一个人在项目里的参与：当前几个、历史上参与过几个（含已结束的）
  store.projectLoad = (pid) => ({ cur: store.projectsOf(pid).length, ever: store.projectsOf(pid, true).length });
  store.endMember = (projectId, pid, why) => {
    const m = S.members.find((x) => x.project === projectId && x.person === pid && !x.to);
    if (!m) return;
    m.to = NT.TODAY;
    S.memberLog.unshift({ project: projectId, at: NT.TODAY, text: `${store.person(pid).name}退出${why ? `：${why}` : ''}`, by: store.me().id });
    store.save();
  };
  store.addProject = (p) => { S.projects.unshift(p); store.save(); return p; };
  store.removeProject = (id) => { S.projects = S.projects.filter((p) => p.id !== id); S.members = S.members.filter((m) => m.project !== id); store.save(); };
  store.projectLinked = (id) => S.events.some((e) => e.project === id) || S.plans.some((p) => p.project === id);

  // ---------- 标签 ----------
  store.tagCounts = () => {
    const c = {};
    S.events.forEach((e) => (e.tags || []).forEach((t) => { c[t] = (c[t] || 0) + 1; }));
    return c;
  };

  // ---------- 发展方向（v1.3 3.15.1）：本人意愿与管理判断分开记录、分开呈现，不打分、不排序 ----------
  store.channels = SEED.CHANNELS;
  store.channel = (id) => SEED.CHANNELS.find((c) => c.id === id);
  // 本人意愿：能看到这个人的视角都能看；管理判断：员工和导师看不到
  store.directions = (pid, role = store.role()) => {
    const sc = store.scope(pid, role);
    if (!sc) return null;
    const all = S.directions.filter((d) => d.person === pid).sort((a, b) => b.at.localeCompare(a.at));
    const mgmt = sc === 'full' && role !== 'mentor';
    return { self: all.filter((d) => d.kind === 'self'), mgmt: mgmt ? all.filter((d) => d.kind === 'mgmt') : null };
  };
  store.addDirection = (d) => { S.directions.unshift({ ...d, at: NT.TODAY }); store.save(); };

  // ---------- 目标角色模板（v1.3 3.15.2） ----------
  store.templates = () => SEED.TEMPLATES;
  store.template = (id) => SEED.TEMPLATES.find((t) => t.id === id);
  store.tplVersion = (t, v) => (v ? t.versions.find((x) => x.v === v) : t.versions[t.versions.length - 1]);

  // ---------- 判断对照（需求里的「判断复盘」，v1.3 3.16）：对照两段判断，归因只作用于评价体系，不写回被评价人 ----------
  const J = SEED.JUDGE;
  const RATER_MIN = 5; // 评价人可对照案例的门槛，少于它只显示「样本不足」
  store.RATER_MIN = RATER_MIN;
  store.judgeChain = (id) => J.chains.find((c) => c.id === id);
  store.judgeMap = (id) => J.maps.find((m) => m.id === id);
  store.judgeStd = (id) => J.stds.find((x) => x.id === id);
  store.judgeBatch = (id) => J.batches.find((b) => b.id === id);
  store.judgeBatches = (chain) => J.batches.filter((b) => !chain || b.chain === chain);
  // 社招后段：对照窗口内、对应维度已确认分的均值所在档；至少 2 条来自不同事件
  const hireBack = (pid, dims, chain) => {
    const p = PEOPLE.get(pid);
    const to = [NT.addDays(p.joined, chain.window), NT.TODAY].sort()[0];
    const list = dims.flatMap((d) => store.scoresOf(pid, { dim: d, from: p.joined, to, anyVer: true }));
    const evs = [...new Set(list.map((x) => x.ev.id))];
    if (evs.length < 2) return { na: true, n: list.length, evs, to, miss: list.length ? '只有 1 条事件的已确认分' : '资料不足：窗口内缺已确认分' };
    const m = store.mean(list.map((x) => x.v));
    return { v: Math.round(m), mean: m, n: list.length, evs, to, by: [...new Set(list.map((x) => x.by))] };
  };
  // 一个对照单元 = 人 × 维度：前后两段的评价人、标准版本、结论、证据，和五种差异状态之一
  store.judgeUnits = (batchId) => {
    const b = store.judgeBatch(batchId), chain = store.judgeChain(b.chain), map = store.judgeMap(b.map);
    const out = [];
    const push = (u) => {
      const id = `${batchId}:${u.person}:${u.dim}`;
      const mark = S.judgeMarks[id];
      let state;
      if (u.front.v == null || u.back.na) state = 'na';
      else if (mark) state = 'nc';
      else state = u.front.r === u.back.r ? 'same' : u.front.r > u.back.r ? 'high' : 'low';
      out.push({ ...u, id, batch: batchId, dimName: chain.dims.find((d) => d.id === u.dim).name, state, gap: state === 'high' || state === 'low' ? Math.abs(u.front.r - u.back.r) : 0, mark });
    };
    if (chain.scale === 'grade') {
      const g = J.xe[batchId];
      // 两段都能回到原始表格：等级在维度列，评语在评语列
      const cell = ([label, sheet, at], row, cols, quote, by) => ({ type: 'sheet', label, loc: `「${sheet}」表 ${cols.map((c) => `${c}${row}`).join('、')} · ${at}`, quote, by });
      const bg = chain.backGrades || chain.grades;
      g.rows.forEach(([pid, by, fr, fnote, bk, bnote, backBy], i) => chain.dims.forEach((d) => push({
        person: pid, dim: d.id,
        front: { by, v: fr[d.id] ?? null, r: chain.grades.indexOf(fr[d.id]), note: fnote, std: b.std, src: cell(g.src.front, i + 2, [g.src.cols[d.id], g.src.cols.note], `${d.name} ${fr[d.id] ?? '—'}：${fnote}`, by) },
        back: bk[d.id] ? { by: [backBy || g.back], v: bk[d.id], r: bg.indexOf(bk[d.id]), note: bnote, src: cell(g.src.back, i + 2, [g.src.cols[d.id], g.src.cols.note], `${d.name} ${bk[d.id]}：${bnote}`, backBy || g.back) } : { by: [backBy || g.back], na: true, note: bnote, miss: '结营评审未体现这个维度', src: cell(g.src.back, i + 2, [g.src.cols.note], bnote, backBy || g.back) },
      })));
    } else {
      J.hire[batchId].forEach(([pid, by, ev, fr, fnote]) => chain.dims.forEach((d) => {
        const bk = hireBack(pid, map.back[d.id], chain);
        push({ person: pid, dim: d.id,
          front: { by, v: fr[d.id] ?? null, r: fr[d.id] ?? null, note: fnote, std: b.std, ev, miss: fr[d.id] == null ? '面试评价未体现这个维度' : '' },
          back: bk.na ? { na: true, n: bk.n, evs: bk.evs, miss: bk.miss, to: bk.to } : { by: bk.by, v: bk.v, r: bk.v, mean: bk.mean, n: bk.n, evs: bk.evs, to: bk.to } });
      }));
    }
    return out;
  };
  // 视角：管理者看汇总与结论；HR 看归属范围；部门负责人、导师、员工只在自己是评价人时看到本人的案例
  store.canJudge = (role = store.role()) => ['ceo', 'hrbp'].includes(role);
  store.judgeScope = (u, role = store.role()) => role === 'ceo' || (role === 'hrbp' && store.scope(u.person, role) === 'full');
  store.myJudgeUnits = (role = store.role()) => {
    const me = ROLES[role].person;
    return J.batches.flatMap((b) => store.judgeUnits(b.id)).filter((u) => u.front.by === me);
  };
  store.isRater = (role = store.role()) => store.myJudgeUnits(role).length > 0;
  store.canSeeRater = (rater, role = store.role()) => role === 'hrbp' || (role !== 'ceo' && ROLES[role].person === rater);
  const COMPARABLE = ['same', 'high', 'low'];
  store.judgeComparable = (u) => COMPARABLE.includes(u.state);
  store.judgeTally = (units) => {
    const t = { same: 0, high: 0, low: 0, nc: 0, na: 0 };
    units.forEach((u) => { t[u.state] += 1; });
    return t;
  };
  store.raterStats = (units, rater) => {
    const mine = units.filter((u) => u.front.by === rater);
    const cases = mine.filter(store.judgeComparable);
    return { units: mine, cases, enough: cases.length >= RATER_MIN, tally: store.judgeTally(cases) };
  };
  store.judgeHyps = (batchId) => J.hyps[batchId] || [];
  store.judgeAttrib = (hypId) => S.judgeAttribs[hypId] || null;
  // 假设的依据会随标注变化：引用的案例被标为不可比或资料不足、涉及的评价人可对照案例跌破门槛时，
  // 这条假设不能再按原文确认，已确认的结论也不能再生成新动作，要先复核
  // 假设正文的统计是按生成时的数据写的。依据范围 = 列出的证据案例 + basis 声明的统计范围；
  // 记下种子数据下这个范围的指纹（状态、差几档、后段用到的事件），之后标注、事件或分数一变就要求复核
  const hypScope = (h) => {
    const bids = [...new Set([...h.cases.map((cid) => cid.split(':')[0]), ...(h.basis || []).map((x) => x.batch)])];
    const units = bids.flatMap((bid) => store.judgeUnits(bid));
    const inBasis = (u) => (h.basis || []).some((x) => u.batch === x.batch && (!x.dim || u.dim === x.dim) && (!x.rater || u.front.by === x.rater));
    return { units, scope: units.filter((u) => h.cases.includes(u.id) || inBasis(u)) };
  };
  const hypPrint = (h) => hypScope(h).scope.map((u) => `${u.id}:${u.state}:${u.gap}:${(u.back.evs || []).join(',')}`).sort().join('|');
  let hypBase = null;
  const baseOf = (h) => {
    if (!hypBase) {
      const cur = S;
      fresh(); // 临时换成种子数据算基线，算完换回
      hypBase = Object.fromEntries(Object.values(J.hyps).flat().map((x) => [x.id, hypPrint(x)]));
      S = cur;
    }
    return hypBase[h.id];
  };
  store.hypCheck = (h) => {
    const { units, scope } = hypScope(h);
    const byId = new Map(units.map((u) => [u.id, u]));
    const dropped = [...new Set([...h.cases.filter((cid) => !byId.has(cid) || !store.judgeComparable(byId.get(cid))), ...scope.filter((u) => u.state === 'nc').map((u) => u.id)])];
    const few = !!h.rater && !store.raterStats(units, h.rater).enough;
    const changed = hypPrint(h) !== baseOf(h);
    return { ok: !dropped.length && !few && !changed, dropped, few, changed };
  };
  store.confirmAttrib = (batchId, hyp, a) => {
    if (!store.hypCheck(hyp).ok) return false;
    S.judgeAttribs[hyp.id] = { hyp: hyp.id, batch: batchId, ...a, by: store.me().id, at: NT.TODAY, actions: [] };
    store.save();
    return true;
  };
  store.unmarkJudge = (uid) => { delete S.judgeMarks[uid]; store.save(); };
  store.markJudge = (uid, reason) => { S.judgeMarks[uid] = { reason, by: store.me().id, at: NT.TODAY }; store.save(); };
  // 改进动作挂到人才项目复盘里产生这次对照的节点下；修订评价标准要产生新版本，在动作里写明
  store.addJudgeAction = (batchId, hypId, a) => {
    const h = store.judgeHyps(batchId).find((x) => x.id === hypId);
    if (!h || !S.judgeAttribs[hypId] || !store.hypCheck(h).ok) return null;
    const act = { id: NT.uid('a'), at: NT.TODAY, ts: Date.now(), from: batchId, person: null, owner: store.me().id, due: NT.addDays(NT.TODAY, 30), state: 'todo', observe: NT.addDays(NT.TODAY, 120), ...a };
    S.actions.unshift(act);
    S.judgeAttribs[hypId].actions.push(act.id);
    store.save();
    return act;
  };

  // ---------- 项目复盘：按人才项目的关键节点回看一件事做得怎么样 ----------
  // 结果从现有数据算；复盘由 HR 写并署名，AI 草拟只作参考；改进事项是挂在节点下的行动
  const XE = NT.XE6;
  const tally = (list, keys, f) => keys.map((k) => [k, list.filter((x) => f(x) === k).length]).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');
  store.programNodes = (pgId) => {
    const g = SEED.PROGRAMS.find((x) => x.id === pgId);
    return SEED.RETRO_NODES[pgId] || g.nodes.map(([at, name], i) => ({ id: `n${i}`, at, name }));
  };
  store.nodeKey = (pgId, nodeId) => `${pgId}:${nodeId}`;
  store.nodeRetroHist = (key) => S.nodeRetros?.[key] || [];
  store.nodeRetro = (key) => store.nodeRetroHist(key)[0] || null;
  // 进行中：节点还没到结束点（留用与落位以方案确认为结束）；未开始：日期在今天之后
  store.nodeState = (pgId, node) => {
    if (node.id === 'place') { const op = S.plans.find((p) => p.kind === 'org' && p.batch === 'b-xe6-end' && p.status === 'confirmed'); if (!op) return 'doing'; }
    else if (node.at > NT.TODAY) return 'future';
    return store.nodeRetro(store.nodeKey(pgId, node.id)) ? 'done' : 'todo';
  };
  // 节点下的行动：显式挂上的，或由节点产生的盘点、判断对照、方案生成的
  store.actionNode = (a) => {
    if (a.node) return a.node;
    const src = [a.from, store.plan(a.from)?.batch].filter(Boolean);
    for (const [pg, nodes] of Object.entries(SEED.RETRO_NODES)) { const n = nodes.find((x) => x.from?.some((f) => src.includes(f))); if (n) return store.nodeKey(pg, n.id); }
    return null;
  };
  const judgeLine = () => {
    const us = store.judgeUnits('jr-xe6'), c = store.judgeClear(us, store.judgeChain('xe'));
    return `前段评为最高或最低一档的 ${c.clear.length} 人里，${c.diff.length} 人和结营结论不一致`;
  };
  // 每条结果：k 是看什么，v 是数，href 可以回到来源页面
  store.nodeFacts = (pgId, node) => {
    const g = SEED.PROGRAMS.find((x) => x.id === pgId), S6 = XE.students, T = XE.teams;
    if (pgId !== 'pg-xe6') return g.people.length ? [{ k: '参与', v: `${g.people.length} 人` }] : [];
    if (node.id === 'w4') {
      const miss = S6.filter((x) => !x.front).length;
      return [{ k: '交了周评', v: `${S6.length - miss} / ${S6.length} 人${miss ? `，${miss} 人缺记录` : ''}` },
        { k: '三档分布', v: tally(S6, ['表现突出', '正常发挥', '需关注'], (x) => x.front) },
        ...(store.canJudge() ? [{ k: '到结营时看', v: judgeLine(), href: 'judge.html?id=jr-xe6' }] : [])];
    }
    if (node.id === 'mid') {
      const E = Object.values(S.snaps.find((x) => x.batch === 'b-xe6-mid')?.entries || {});
      const acts = S.actions.filter((a) => store.actionNode(a) === store.nodeKey(pgId, 'mid'));
      return [{ k: '盘点', v: `${E.length} 人，${E.filter((e) => e.q).length} 人正式落位，${E.filter((e) => e.na).length} 人资料不足` }, { k: '在营调整', v: `${acts.length} 项` }];
    }
    if (node.id === 'ms') {
      const avg = (k) => { const v = T.map((t) => t.ms[k]).filter((x) => x != null); return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1); };
      return [{ k: '课题组', v: `${T.length} 个，公开路演 ${T.filter((t) => t.live === '公开路演').length} 个` },
        { k: '各组平均分', v: ['MS1', 'MS2', 'MS3', 'MS4'].map((k) => `${k} ${avg(k)}`).join(' · ') },
        { k: 'MS4 低于 MS3', v: `${T.filter((t) => t.ms.MS4 < t.ms.MS3).length} 个组` }];
    }
    if (node.id === 'end') {
      const miss = S6.filter((x) => !x.backJ).length;
      return [{ k: '结营结论', v: tally(S6, ['建议留用', '继续观察', '不建议'], (x) => x.backJ) + (miss ? `，${miss} 人缺结论` : '') },
        { k: '去向', v: tally(S6, ['应届 · 正式 offer 提前锁定', '应届 · 继续实习观察', '非应届 · 实习 offer', '不建议 offer'], (x) => x.final) }];
    }
    if (node.id === 'place') {
      const keep = S6.filter((x) => x.final && x.final !== '不建议 offer');
      const op = S.plans.filter((p) => p.kind === 'org' && p.batch === 'b-xe6-end').sort((a, b) => b.version - a.version)[0];
      return [{ k: '留用沟通', v: `${keep.length} 人：${tally(keep, ['接受', '拒绝'], (x) => x.accept).replace('拒绝', '未接受')}${keep.filter((x) => !x.accept).length ? ` · 待沟通 ${keep.filter((x) => !x.accept).length}` : ''}` },
        { k: '部门待定', v: `${S6.filter((x) => x.dest === '待定部门').length} 人` },
        ...(op ? [{ k: '方案', v: `${op.title} v${op.version} · ${op.status === 'confirmed' ? '已确认' : '草稿'}`, href: 'plan.html?id=b-xe6-end' }] : [])];
    }
    return [];
  };
  // AI 草拟：只从上面的结果里取数，写成做得好 / 要改进两组；没有可用的结果就不草拟
  store.nodeDraft = (pgId, node) => {
    if (pgId !== 'pg-xe6') return null;
    const T = XE.teams, S6 = XE.students;
    if (node.id === 'ms') {
      const drop = T.filter((t) => t.ms.MS4 < t.ms.MS3).length;
      const avg = (k) => T.reduce((a, t) => a + t.ms[k], 0) / T.length, a1 = avg('MS1'), a4 = avg('MS4');
      return { good: [`${T.filter((t) => t.live === '公开路演').length} 个组走到了公开路演`, ...(a4 > a1 ? [`各组平均分从 MS1 的 ${a1.toFixed(1)} 到 MS4 的 ${a4.toFixed(1)}，收尾比起步好`] : [])], improve: [`${drop} 个组 MS4 比 MS3 低，要看是课题收尾还是带教跟进的问题`] };
    }
    if (node.id === 'end') {
      const miss = S6.filter((x) => !x.backJ).length;
      return { good: ['结营结论和导师留用建议在同一张表里，对得上'], improve: [`${judgeLine()}，先在判断对照里归因`, ...(miss ? [`${miss} 人缺结营结论，补齐后再定去向`] : [])] };
    }
    return null;
  };
  store.canWriteRetro = (role = store.role()) => role === 'hrbp';
  store.setNodeRetro = (key, good, improve, from) => {
    S.nodeRetros ||= {};
    const list = (S.nodeRetros[key] ||= []);
    list.unshift({ good, improve, by: store.me().id, at: NT.TODAY, from });
    store.save();
    return () => { list.shift(); if (!list.length) delete S.nodeRetros[key]; store.save(); };
  };
  store.addNodeAction = (key, title, due) => {
    const a = { id: NT.uid('a'), at: NT.TODAY, ts: Date.now(), title, node: key, person: null, owner: store.me().id, due, state: 'todo' };
    S.actions.unshift(a);
    store.save();
    return () => { S.actions = S.actions.filter((x) => x !== a); store.save(); };
  };

  // ---------- 值得关注（v1.4 3.20，watch-v1）：按写明的规则入选，按触发时间排，不按分数挑人，不显示分数 ----------
  // 规则文字随生效中的 watch 版本（v1.6 3.35.2）：阈值、时间窗来自版本参数
  const watchRulesOf = (ver) => {
    const P = ver.params;
    return {
      N1: { cat: 'new', text: `资料从无到有，近 ${P.n1Days} 天同一维度有 ${P.n1Count} 件不同的事印证（${P.n1Min} 分及以上）` },
      N2: { cat: 'new', text: 'AI 从材料里发现的线索，经 HR 核实' },
      T1: { cat: 'top', text: '能力走向走高（与「变化」同口径）' },
      T2: { cat: 'top', text: ver.t2 },
      I1: { cat: 'act', text: '能力走向走低（与「变化」同口径）' },
      I2: { cat: 'act', text: `「值得聊一聊」打开 ${P.i2Days} 天以上，仍待处理` },
      I3: { cat: 'act', text: '重点跟踪过了约定日期，仍待更新' },
    };
  };
  store.watchRulesOf = watchRulesOf;
  Object.defineProperty(store, 'WATCH_RULES', { get: () => watchRulesOf(store.ruleLive('watch')) });
  Object.defineProperty(store, 'WATCH_VER', { get: () => store.ruleLive('watch').v });
  store.WATCH_CATS = [['new', '新发现'], ['top', '突出表现'], ['act', '需要介入']];
  // 部门负责人看本团队（完整查看范围内）的值得关注（v1.5 D-57）
  store.canWatch = (role = store.role()) => ['ceo', 'hrbp', 'lead'].includes(role);
  const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
  store.watch = () => {
    const role = store.role();
    if (!store.canWatch(role)) return [];
    return watchFor(role, store.ruleLive('watch'));
  };
  // 按某个 watch 版本算一个视角的值得关注；影响预览用同一套计算比较新旧两版
  function watchFor(role, ver) {
    const P = ver.params, RULES = watchRulesOf(ver);
    const people = store.visiblePeople(role).filter((p) => store.scope(p.id, role) === 'full');
    const ids = new Set(people.map((p) => p.id));
    const hits = [];
    const from = NT.addDays(NT.TODAY, -P.n1Days);
    people.forEach((p) => {
      // N1：此前没有已确认分，时间窗内同一维度有足够多的不同的事、分数达到门槛
      if (store.scoresOf(p.id, { to: NT.addDays(from, -1) }).length) return;
      const recent = store.scoresOf(p.id, { from });
      SEED.DIMS.forEach((d) => {
        const strong = recent.filter((s) => s.d === d.id && s.v >= P.n1Min);
        const evs = [...new Set(strong.map((s) => s.ev.id))].map(store.event).sort(byDate);
        if (evs.length < P.n1Count) return;
        // 简述举一件最有代表性的事：同维度分最高；同分取证据最丰富的（这件事里达到门槛的维度最多），再取最近；不写分数
        const rich = (e) => (e.scores || []).filter((x) => x.p === p.id && x.st === 'confirmed' && x.v >= P.n1Min).length;
        const rep = strong.slice().sort((a, b) => b.v - a.v || rich(b.ev) - rich(a.ev) || (b.ev.date || '').localeCompare(a.ev.date || ''))[0].ev;
        hits.push({ person: p.id, rule: 'N1', when: evs[0].date, ts: evs[0].ts, why: `${d.name}已有 ${evs.length} 件事印证，例如「${rep.title}」`, evs: evs.map((e) => e.id) });
      });
    });
    store.changes({ role }).filter((c) => c.t === 'trend' && ids.has(c.person)).forEach((c) => hits.push({
      person: c.person, rule: c.up ? 'T1' : 'I1', when: c.when, ts: c.after[0]?.ev?.ts, why: `${store.dim(c.dim).name}近 3 个月明显${c.up ? '走高' : '走低'}，有 ${c.n} 件事`, evs: c.after.map((s) => s.ev.id),
    }));
    S.signals.filter((g) => g.state === 'open' && g.since && NT.days(g.since) >= P.i2Days && ids.has(g.person)).forEach((g) => hits.push({
      person: g.person, rule: 'I2', when: NT.addDays(g.since, P.i2Days), why: `${g.items.filter((i) => i.src === 'fact').map((i) => i.text).join('，')}；「值得聊一聊」打开 ${NT.days(g.since)} 天，还没有约谈记录`, signal: true,
    }));
    // I3：过了约定日期，且上次回看之后没有任何新的观察（与跟踪卡「上次之后新增」同口径）
    const updated = (t) => S.events.some((e) => e.kind === 'obs' && e.date && e.date > t.since && e.people.includes(t.person));
    S.tracks.filter((t) => t.state === 'on' && t.next < NT.TODAY && !updated(t) && ids.has(t.person)).forEach((t) => hits.push({
      person: t.person, rule: 'I3', when: t.next, why: `${store.person(t.owner).name}的重点跟踪过了 ${NT.md(t.next)} 回看日，还没有新观察；在看：${t.q.replace(/？$/, '')}`, track: t.id,
    }));
    S.watchClues.filter((c) => c.state === 'verified' && ids.has(c.person)).forEach((c) => hits.push({
      person: c.person, rule: c.rule, when: c.verifiedAt, ts: c.verifiedTs, why: c.dir ? `${store.person(c.by).name}推荐${store.fitText(c.dir)}：${c.why}` : c.by === 'ai' ? `AI 线索，${store.person(c.verifiedBy)?.name || 'HR'}已核实：${c.why}` : `${store.person(c.by).name}提名：${c.why}`,
      brief: c.dir ? `${store.fitText(c.dir)}：${c.why}` : c.why, evs: c.evs, srcs: c.srcs, by: c.by, verifiedBy: c.verifiedBy, clue: c.id, dir: c.dir,
    }));
    // 同一个人只出现一次，归到最近触发的那一类，其余命中的规则并列写出
    const byPerson = new Map();
    hits.sort((a, b) => b.when.localeCompare(a.when) || (b.ts || 0) - (a.ts || 0)).forEach((h) => {
      const cur = byPerson.get(h.person);
      if (!cur) byPerson.set(h.person, { ...h, id: `w-${h.person}`, cat: RULES[h.rule].cat, ver: ver.v, also: [] });
      else if (cur.rule !== h.rule) cur.also.push(h);
    });
    return [...byPerson.values()].map((w) => ({ ...w, doing: store.doingFor(w.person, role) }));
  }
  // 已经在做的事：重点跟踪、行动，按视角过滤
  // 行动是管理资料，只给能看管理资料的视角；导师只看到自己负责或协助的跟踪
  store.doingFor = (pid, role = store.role()) => {
    const out = [], me = ROLES[role].person, mgmt = store.can('mgmt', pid, role);
    S.tracks.filter((t) => t.person === pid && t.state === 'on' && (mgmt || t.owner === me || t.helper === me)).forEach((t) => out.push(`${store.person(t.owner).name}在重点跟踪 · ${NT.md(t.next)} 回看`));
    // 行动：还在推进的，或已执行、还在观察期里的（v1.4 3.20.2）
    if (mgmt) S.actions.filter((x) => x.person === pid && (['todo', 'doing'].includes(x.state) || (x.state === 'done' && x.observe && x.observe >= NT.TODAY))).forEach((x) => out.push(`行动：${x.title} · ${store.person(x.owner).name}负责 · ${x.state === 'done' ? `已执行，观察到 ${NT.md(x.observe)}` : x.state === 'todo' ? '待沟通' : '进行中'}`));
    return out;
  };
  // 行内的一行新进展：7 天内新生成的行动、新开始的重点跟踪，取最近一条
  store.freshFor = (pid) => {
    const since = NT.addDays(NT.TODAY, -7), out = [];
    S.actions.filter((a) => a.person === pid && a.at).forEach((a) => out.push({ at: a.at, ts: a.ts, kind: 'action', text: `行动：${a.title} · ${store.person(a.owner).name}负责` }));
    S.tracks.filter((t) => t.person === pid && t.state === 'on' && t.since).forEach((t) => out.push({ at: t.since, ts: t.ts, kind: 'track', text: `${store.person(t.owner).name}开始重点跟踪 · ${NT.md(t.next)} 回看` }));
    // 同一天的多条按记录时刻（ts）取最新；演示种子没有 ts，排在当天新记录之后
    return out.filter((x) => x.at >= since).sort((a, b) => b.at.localeCompare(a.at) || (b.ts || 0) - (a.ts || 0))[0] || null;
  };
  store.watchPending = () => S.watchClues.filter((c) => c.state === 'pending' && store.scope(c.person) === 'full');
  // 已处理的线索留在 HR 视图里：核实的、不采纳的连同理由（v1.4 3.20.3），管理者不经过这里
  store.watchHandled = () => (store.role() === 'hrbp' ? S.watchClues.filter((c) => ['verified', 'rejected'].includes(c.state) && store.scope(c.person) === 'full').sort((a, b) => (b.verifiedAt || '').localeCompare(a.verifiedAt || '')) : []);
  store.verifyClue = (id, ok, why) => {
    const c = S.watchClues.find((x) => x.id === id); if (!c) return null;
    Object.assign(c, ok ? { state: 'verified', verifiedBy: store.me().id, verifiedAt: NT.TODAY, verifiedTs: Date.now() } : { state: 'rejected', rejectWhy: why, verifiedBy: store.me().id, verifiedAt: NT.TODAY });
    store.save();
    return c;
  };
  store.unverifyClue = (id) => { const c = S.watchClues.find((x) => x.id === id); c.state = 'pending'; delete c.verifiedBy; delete c.verifiedAt; delete c.verifiedTs; delete c.rejectWhy; store.save(); };

  // ---------- 推荐方向（v1.5 3.31）：带目标角色的提名，走值得关注的核实流程 ----------
  // 「适合做 FDE」「适合做产品架构师」：中英文之间留空格，中文之间不留
  store.fitText = (dir) => { const n = store.template(dir)?.name || ''; return `适合做${/^[A-Za-z]/.test(n) ? ' ' : ''}${n}`; };
  store.canRecommend = (pid, role = store.role()) => {
    const sc = store.scope(pid, role);
    return (role === 'mentor' && sc === 'mentor') || (['lead', 'hrbp'].includes(role) && sc === 'full');
  };
  // 可以引用的证据：本视角能看到、已确认的关键事件（有本人的已确认或已校准分，与 COUNTED 同口径）
  store.recoEvidence = (pid) => store.visibleEvents(pid).events.filter((e) => e.kind === 'obs' && e.date && e.scores.some((x) => x.p === pid && COUNTED.includes(x.st)));
  // 同一个人、同一方向已有核实中或已核实的推荐：不再重复提交
  store.recoExists = (pid, dir) => S.watchClues.some((c) => c.dir === dir && c.person === pid && ['pending', 'verified'].includes(c.state));
  store.addReco = (pid, dir, why, evs) => {
    const ok = store.canRecommend(pid) && store.template(dir) && why && new Set(evs).size >= 2 && evs.every((id) => store.recoEvidence(pid).some((e) => e.id === id));
    if (!ok || store.recoExists(pid, dir)) return null;
    const me = store.me().id, self = store.role() === 'hrbp'; // HR 本人提交的直接视为已核实
    const c = { id: NT.uid('wc'), person: pid, rule: 'T2', by: me, dir, at: NT.TODAY, why, evs: [...new Set(evs)], state: self ? 'verified' : 'pending', ...(self ? { verifiedBy: me, verifiedAt: NT.TODAY, verifiedTs: Date.now() } : {}) };
    S.watchClues.unshift(c); store.save();
    return c;
  };
  store.removeReco = (id) => { S.watchClues = S.watchClues.filter((c) => c.id !== id); store.save(); };
  store.myRecos = () => S.watchClues.filter((c) => c.dir && c.by === store.me().id).sort((a, b) => b.at.localeCompare(a.at));
  // 档案与速览里的推荐方向：已核实的，按权限；推荐人能看到自己提交的那条
  store.recosFor = (pid, role = store.role()) => S.watchClues.filter((c) => c.dir && c.person === pid && c.state === 'verified'
    && (['ceo', 'hrbp', 'lead'].includes(role) ? store.scope(pid, role) === 'full' : c.by === ROLES[role].person));

  // ---------- 我的关注（v1.5 3.26.2）：个人的观察名单，只对本人可见，不产生分数 ----------
  store.canFollow = (pid, role = store.role()) => role === 'ceo' || (role === 'lead' && (!pid || store.scope(pid, role) === 'full'));
  store.followList = () => {
    if (!store.canFollow()) return [];
    const me = store.me().id;
    return S.follows.filter((f) => f.by === me && store.canFollow(f.person)).sort((a, b) => b.at.localeCompare(a.at));
  };
  store.isFollowing = (pid) => store.followList().some((f) => f.person === pid);
  store.follow = (pid, via) => {
    if (!store.canFollow(pid) || store.isFollowing(pid)) return null;
    const f = { by: store.me().id, person: pid, at: NT.TODAY, ...(via ? { via } : {}) };
    S.follows.unshift(f); store.save();
    return f;
  };
  store.unfollow = (pid) => {
    const me = store.me().id, i = S.follows.findIndex((f) => f.by === me && f.person === pid);
    if (i < 0) return null;
    const [f] = S.follows.splice(i, 1); store.save();
    // 撤销时如果这期间已经重新关注过，就不再补一条，关注关系按人唯一
    return () => { if (!S.follows.some((x) => x.by === f.by && x.person === f.person)) { S.follows.splice(Math.min(i, S.follows.length), 0, f); store.save(); } };
  };
  // 关注动态：关注之后、本人有权限看到的已确认进展；不含未核实线索、分数和象限变化
  store.followFeed = (pid) => {
    const me = store.me().id, out = [];
    const watch = Object.fromEntries(store.watch().map((w) => [w.person, w]));
    store.followList().filter((f) => !pid || f.person === pid).forEach((f) => {
      const p = f.person;
      store.visibleEvents(p).events.filter((e) => e.kind === 'obs' && e.date && e.date >= f.at && !e.scores.some((x) => x.p === p && x.st === 'ai'))
        .forEach((e) => out.push({ person: p, at: e.date, ts: e.ts, kind: 'event', text: e.title, ev: e.id, by: e.recorder }));
      const w = watch[p];
      if (w && w.when >= f.at) out.push({ person: p, at: w.when, ts: w.ts, kind: 'watch', text: `进入值得关注：${w.why}`, cat: w.cat });
      // 行动（管理资料）：新生成的和状态变化；重点跟踪：开始、改观察问题、停止
      const ALABEL = { todo: '待沟通', doing: '进行中', done: '已执行', cancel: '未执行', reviewed: '已复盘' };
      if (store.can('mgmt', p)) S.actions.filter((a) => a.person === p).forEach((a) => {
        if (a.at && a.at >= f.at) out.push({ person: p, at: a.at, ts: a.ts, kind: 'action', text: `新行动：${a.title}`, by: a.owner });
        if (a.stateAt && a.stateAt >= f.at) out.push({ person: p, at: a.stateAt, ts: a.stateTs, kind: 'action', text: `行动「${a.title}」${ALABEL[a.state] || ''}`, by: a.owner });
      });
      S.tracks.filter((t) => t.person === p && (store.can('mgmt', p) || t.owner === me || t.helper === me)).forEach((t) => {
        if (t.since >= f.at) out.push({ person: p, at: t.since, ts: t.ts, kind: 'track', text: `开始重点跟踪：${t.q}`, by: t.owner });
        if (t.editedAt && t.editedAt >= f.at) out.push({ person: p, at: t.editedAt, ts: t.editedTs, kind: 'track', text: `重点跟踪改了观察问题：${t.q}`, by: t.owner });
        if (t.state !== 'on' && t.stoppedAt && t.stoppedAt >= f.at) out.push({ person: p, at: t.stoppedAt, ts: t.stoppedTs, kind: 'track', text: '停止重点跟踪', by: t.owner });
      });
      store.recosFor(p).filter((c) => c.verifiedAt >= f.at).forEach((c) => out.push({ person: p, at: c.verifiedAt, ts: c.verifiedTs, kind: 'reco', text: `${store.person(c.by).name}推荐${store.fitText(c.dir)}`, by: c.verifiedBy }));
    });
    // 同一天按记录时刻（ts）从新到旧，同一天的同一件事只留一条
    const seen = new Set();
    return out.sort((a, b) => b.at.localeCompare(a.at) || (b.ts || 0) - (a.ts || 0)).filter((x) => { const k = `${x.person}|${x.at}|${x.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };

  // 不一致的口径：只看前段给了明确判断（最高档或最低档）的人，后段结论和它不同才算不一致。
  // 前段落在中间档时没有表态，后段走向哪边都不算矛盾，单独列出；分数制的对照每一条都算明确判断
  store.judgeClear = (units, chain) => {
    const comp = units.filter((u) => ['same', 'high', 'low'].includes(u.state));
    const top = chain.scale === 'grade' ? chain.grades.length - 1 : null;
    const clear = top == null ? comp : comp.filter((u) => u.front.r === 0 || u.front.r === top);
    return { clear, diff: clear.filter((u) => u.state !== 'same'), mid: comp.filter((u) => !clear.includes(u)) };
  };
  // ---------- 判断提醒：管理者只读的批次级信号 ----------
  store.judgeSignals = () => {
    if (!store.canJudge()) return [];
    return J.batches.filter((b) => b.status === 'open').map((b) => {
      const units = store.judgeUnits(b.id), chain = store.judgeChain(b.chain);
      const dims = chain.dims.map((d) => {
        const us = units.filter((u) => u.dim === d.id), t = store.judgeTally(us), c = store.judgeClear(us, chain);
        return { id: d.id, name: d.name, n: us.length, comp: t.same + t.high + t.low, high: t.high, low: t.low, clear: c.clear.length, diff: c.diff.length,
          diffHigh: c.diff.filter((u) => u.state === 'high').length, diffLow: c.diff.filter((u) => u.state === 'low').length };
      }).filter((d) => d.diff >= 2);
      const hyps = store.judgeHyps(b.id), open = hyps.filter((h) => !store.judgeAttrib(h.id)).length;
      return { b, chain, dims, attrib: open ? 'open' : 'done', open };
    }).filter((x) => x.dims.length);
  };
  // 待管理者确认的评价规则修订：判断提醒里的一行
  store.rulesToConfirm = () => Object.keys(S.rules).flatMap((k) => S.rules[k].filter((r) => r.state === 'pending').map((r) => ({ kind: k, r, href: `rules.html?r=${k}${r.line ? `&line=${r.line}` : ''}` })));

  // ---------- 值得关注的项目：人才项目按期次，一期一行，按时间排 ----------
  // 入选：14 天内刚过关键节点、有人新进入「值得关注的人」、还有留用或落位没有确认
  const PROG_DAYS = 14;
  store.watchPrograms = () => {
    if (!store.canWatch()) return { list: [], quiet: [] };
    const since = NT.addDays(NT.TODAY, -PROG_DAYS), watch = store.watch();
    const draft = S.plans.find((p) => p.kind === 'org' && p.status === 'draft');
    const rows = SEED.PROGRAMS.map((g) => {
      const why = [];
      g.nodes.filter(([d]) => d >= since && d <= NT.TODAY).forEach(([d, t]) => why.push({ at: d, text: `${NT.md(d)} ${t}` }));
      const fresh = watch.filter((w) => g.people.includes(w.person) && w.when >= since);
      if (fresh.length) why.push({ at: fresh.map((w) => w.when).sort().pop(), text: `${fresh.length} 人新进入值得关注的人`, people: fresh.map((w) => w.person) });
      if (g.pending === 'plan' && draft) {
        const n = draft.moves.filter((m) => g.people.includes(m.person) && m.type !== '未接受').length;
        if (n) why.push({ at: draft.at, text: `留用与落位 ${n} 人待 HR 确认`, href: `plan.html?id=${draft.batch}` });
      }
      if (g.todo) why.push({ at: g.nodes[g.nodes.length - 1][0], text: g.todo });
      const at = why.map((x) => x.at).sort().pop() || g.nodes[g.nodes.length - 1][0];
      return { ...g, why, at };
    });
    const byAt = (a, b) => b.at.localeCompare(a.at);
    return { list: rows.filter((g) => g.why.length).sort(byAt), quiet: rows.filter((g) => !g.why.length).sort(byAt) };
  };

  // ---------- 评价体系（v1.6 3.35）：规则按版本保存，修订走 草稿 → 待确认 → 已排期 / 生效中 → 已替代 ----------
  // 不改写历史：已确认的分数、快照、档案版本保留原来的版本标记，这里只决定新的评价按哪一版
  const OPEN = ['draft', 'pending', 'scheduled'];
  store.RULE_KINDS = [
    ['rubric', '维度与锚点', '每个维度 1–5 分各代表什么行为；记录打分、AI 建议分都按它'],
    ['place', '象限落位', '取多长时间的证据、分界线和落位门槛，决定参考位置和「资料不足」'],
    ['watch', '值得关注', '谁会出现在首页「值得关注」里，按哪几条规则入选'],
    ['front', '前段评价标准与对应表', '社招面试、入营选拔怎么评，和入职后的维度怎么对照'],
    ['tpl', '目标角色与发展通道', '找人和发展方向用到的角色模板：职责、必须与加分要求'],
    ['tags', '标签库', '档案和找人里能用的标签：收录、并入、停用'],
  ];
  store.ruleKindName = (k) => store.RULE_KINDS.find((x) => x[0] === k)?.[1] || k;
  store.FRONT_LINES = [['xe-weekly', 'XEngineer 周评标准'], ['map-xe', '周评与结营评审对应表']];
  const FAM = new Map(SEED.FAMILIES);
  store.families = SEED.FAMILIES;
  store.familyOf = (pid) => PEOPLE.get(pid)?.family || 'biz';
  store.familyName = (f) => FAM.get(f) || '';
  store.ruleVers = (kind, line) => (S.rules[kind] || []).filter((r) => !line || r.line === line);
  store.ruleLive = (kind, line) => store.ruleVers(kind, line).filter((r) => r.state === 'live').pop() || null;
  store.ruleOpen = (kind, line) => store.ruleVers(kind, line).find((r) => OPEN.includes(r.state)) || null;
  store.ruleVer = (v) => Object.values(S.rules).flat().find((r) => r.v === v) || null;
  store.ruleKind = (v) => Object.keys(S.rules).find((k) => S.rules[k].some((r) => r.v === v));
  // 盘点进行中：该批次用到的维度与锚点、象限落位锁定（3.35.6）
  store.inventoryLock = () => S.batches.find((b) => b.kind === 'inventory' && b.status === 'draft') || null;
  store.lockedKinds = ['rubric', 'place'];
  // 1–5 分锚点：心性维度全公司一套；专业度按这个人的岗位族，生效版本里没有该族时用通用的一套（3.36）
  store.anchors = (dimId, pid, ver = store.ruleLive('rubric')) => {
    const c = ver.content;
    if (dimId !== 'prof') return { list: c.pot, fam: null, v: ver.v };
    const f = pid ? store.familyOf(pid) : null;
    return c.prof[f] ? { list: c.prof[f], fam: f, v: ver.v } : { list: c.prof.all, fam: null, v: ver.v };
  };

  const isHrbp = () => store.role() === 'hrbp', isCeo = () => store.role() === 'ceo';
  const nextV = (v) => v.replace(/(\d+)$/, (n) => +n + 1);
  // 起草：从生效中的版本复制一份；同一类规则同时只有一份在修订中
  store.startDraft = (kind, basis = []) => {
    if (!isHrbp()) return null;
    const open = store.ruleOpen(kind); if (open) return open;
    const live = store.ruleLive(kind);
    const d = { ...NT.clone(live), v: nextV(live.v), state: 'draft', base: live.v, by: store.me().id, at: NT.TODAY, effect: 'now', compat: 'ok', why: '', basis: NT.clone(basis), preview: null };
    delete d.confirmedBy; delete d.effAt; delete d.demo; delete d.from;
    if (store.inventoryLock() && store.lockedKinds.includes(kind)) d.effect = 'next';
    S.rules[kind].push(d); store.save();
    return d;
  };
  const draftOf = (kind) => { const d = store.ruleOpen(kind); return d && d.state === 'draft' && isHrbp() ? d : null; };
  // 改动后预览作废：确认人看到的必须是按当前草稿算出来的那一份（3.35.4）
  const touch = (d) => { d.preview = null; store.save(); };
  store.setDraft = (kind, patch) => { const d = draftOf(kind); if (!d) return null; Object.assign(d, patch); if (!('why' in patch) && !('basis' in patch)) d.preview = null; store.save(); return d; };
  store.setDraftParam = (kind, key, val) => { const d = draftOf(kind); if (!d) return null; d.params = { ...d.params, [key]: val }; touch(d); return d; };
  store.setDraftAnchor = (kind, set, i, text) => {
    const d = draftOf(kind); if (!d) return null;
    const c = d.content, arr = set === 'pot' ? c.pot : c.prof[set];
    arr[i] = text;
    // 岗位族锚点首次启用、或心性锚点改了等级含义，都要复核：首次启用强制不兼容
    touch(d); return d;
  };
  // 删除草稿：纳入这份草稿的修订建议回到待处理；返回撤销函数，期间又起草了新的一份时保持删除
  store.deleteDraft = (kind) => {
    const d = draftOf(kind); if (!d) return null;
    const sugs = S.ruleSugs.filter((x) => x.draft === d.v && x.state === 'adopted'), snaps = NT.clone(sugs);
    sugs.forEach((x) => { x.state = 'open'; delete x.handledBy; delete x.handledAt; delete x.draft; });
    S.rules[kind] = S.rules[kind].filter((r) => r !== d); store.save();
    return () => {
      if (store.ruleOpen(kind)) return false;
      S.rules[kind].push(d); snaps.forEach((sn) => Object.assign(S.ruleSugs.find((x) => x.id === sn.id), sn)); store.save();
      return true;
    };
  };
  // 移除草稿的一条依据；修订建议类依据同时把那条建议恢复为待处理，撤销时两边一起恢复
  store.removeBasis = (kind, i) => {
    const d = draftOf(kind); if (!d || !d.basis?.[i]) return null;
    const [b] = d.basis.splice(i, 1);
    const sug = b.type === 'sug' ? S.ruleSugs.find((x) => x.id === b.sug && x.state === 'adopted' && x.draft === d.v) : null, snap = sug && NT.clone(sug);
    if (sug) { sug.state = 'open'; delete sug.handledBy; delete sug.handledAt; delete sug.draft; }
    store.save();
    return () => {
      if (draftOf(kind) !== d) return false;
      d.basis.splice(Math.min(i, d.basis.length), 0, b);
      if (snap) { const x = S.ruleSugs.find((y) => y.id === snap.id); if (x && x.state === 'open') Object.assign(x, snap); }
      store.save(); return true;
    };
  };
  // 与生效版本相比改了什么：参数、锚点逐条
  store.ruleChanges = (d, base = store.ruleVer(d.base)) => {
    const out = [];
    if (!base) return out;
    if (d.params) Object.keys(d.params).forEach((k) => { if (d.params[k] !== base.params[k]) out.push({ key: k, from: base.params[k], to: d.params[k] }); });
    if (d.t2 && d.t2 !== base.t2) out.push({ key: 't2', from: base.t2, to: d.t2 });
    if (d.content?.pot && base.content?.pot) {
      d.content.pot.forEach((t, i) => { if (t !== base.content.pot[i]) out.push({ key: `pot.${i}`, set: 'pot', level: i + 1, from: base.content.pot[i], to: t }); });
      // 两版岗位族的并集：新增的族记为首次启用，去掉的族记为停用
      [...new Set([...Object.keys(base.content.prof), ...Object.keys(d.content.prof)])].forEach((f) => {
        const was = base.content.prof[f], now = d.content.prof[f];
        if (!was) out.push({ key: `prof.${f}`, set: f, first: true, to: now });
        else if (!now) out.push({ key: `prof.${f}`, set: f, removed: true, from: was });
        else now.forEach((t, i) => { if (t !== was[i]) out.push({ key: `prof.${f}.${i}`, set: f, level: i + 1, from: was[i], to: t }); });
      });
    }
    if (d.note && base.note && d.note !== base.note) out.push({ key: 'note', from: base.note, to: d.note });
    return out;
  };
  // 岗位族锚点首次启用（或停用）属于不兼容（3.35.5），兼容声明锁定
  store.forcedBreak = (d) => store.ruleChanges(d).some((c) => c.first || c.removed);

  // 影响预览：值得关注按新旧两版各算一次（全公司口径），HR 能展开名单，管理者只看人数与团队分布
  function watchImpact(d) {
    const base = store.ruleVer(d.base), a = watchFor('ceo', base), b = watchFor('ceo', d);
    const A = new Map(a.map((w) => [w.person, w])), B = new Map(b.map((w) => [w.person, w]));
    const row = (w) => ({ person: w.person, team: PEOPLE.get(w.person).org, rule: w.rule, why: w.why });
    const enter = b.filter((w) => !A.has(w.person)).map(row), leave = a.filter((w) => !B.has(w.person)).map(row);
    const teams = {};
    enter.forEach((x) => { teams[x.team] = (teams[x.team] || 0) + 1; });
    leave.forEach((x) => { teams[x.team] = (teams[x.team] || 0) - 1; });
    return {
      kind: 'watch', at: NT.TODAY, key: JSON.stringify(d.params), from: a.length, to: b.length,
      cats: store.WATCH_CATS.map(([id, name]) => ({ id, name, from: a.filter((w) => w.cat === id).length, to: b.filter((w) => w.cat === id).length })),
      enter, leave, teams: Object.entries(teams).filter(([, n]) => n).map(([team, n]) => ({ team, n })),
    };
  }
  // 锚点文字：取数窗口内用到这些锚点的事件数与评分人；不兼容时每条旧分生成一条复核任务
  function rubricImpact(d) {
    const ch = store.ruleChanges(d), win = NT.addDays(NT.TODAY, -store.ruleLive('place').content.window);
    const potHit = ch.some((c) => c.set === 'pot'), fams = [...new Set(ch.filter((c) => c.set !== 'pot').map((c) => c.set))];
    const hit = (s) => (s.d === 'prof' ? fams.includes(store.familyOf(s.p)) || (fams.includes('all') && !d.content.prof[store.familyOf(s.p)]) : potHit);
    const scores = [];
    // 已在复核暂停里的旧分也算：它们按上一版复核之后，仍要对照这一版（held 单独计数）
    S.events.forEach((e) => { if (e.kind === 'obs' && e.date && e.date >= win) e.scores.forEach((s) => { if (s.v != null && COUNTED.includes(s.st) && hit(s)) scores.push({ ...s, ev: e.id, held: !!store.heldBy(e, s) }); }); });
    const raters = {};
    scores.forEach((s) => { const by = s.by || (s.raters ? s.raters[0].by : null); if (by) raters[by] = (raters[by] || 0) + 1; });
    const brk = d.compat === 'break' || store.forcedBreak(d);
    return { kind: 'rubric', at: NT.TODAY, key: JSON.stringify(d.content), events: new Set(scores.map((s) => s.ev)).size, scores: scores.length, people: new Set(scores.map((s) => s.p)).size,
      raters: Object.entries(raters).map(([id, n]) => ({ id, n })), tasks: brk ? scores.length : 0, held: scores.filter((s) => s.held).length, fams, potHit };
  }
  // 复核暂停按版本判断：一条分所在事件的版本早于某个已生效的不兼容版本，并落在它改动的范围里（心性维度，或某个岗位族的专业度），
  // 复核确认（最近一条复核记到该版本或更新）之前不参与当前版本的取数；生效后才确认的旧事件分同样适用
  const verIdx = (v) => S.rules.rubric.findIndex((r) => r.v === v);
  store.heldBy = (e, s) => {
    if (!S.reviewHolds.length || s.v == null) return null;
    const vi = verIdx(store.eventRubric(e).v);
    const rev = lastRev(s);
    return S.reviewHolds.find((h) => vi < verIdx(h.ver) && e.date >= h.from && !(rev && verIdx(rev.ver) >= verIdx(h.ver))
      && (s.d === 'prof' ? h.fams.includes(store.familyOf(s.p)) : h.potHit)) || null;
  };
  // 某个复核暂停里待复核的已确认旧分
  store.heldScores = (ver) => {
    const out = [];
    S.events.forEach((e) => { if (e.kind === 'obs' && e.date) e.scores.forEach((s, i) => { if (COUNTED.includes(s.st) && store.heldBy(e, s)?.ver === ver) out.push({ e, i, s }); }); });
    return out;
  };
  // 按新版本复核：AI 按新锚点给建议分，确认后追加到 s.revs（每版一条，保留历次结论），按最近一条参与当前取数；原分与原版本保留。返回撤销函数
  const lastRev = (s) => s.revs?.[s.revs.length - 1] || null;
  // ver：这一行所属的复核暂停版本；连续两版不兼容时先按前一版复核，之后的版本继续暂停
  store.reviewScore = (evId, i, v, ver) => {
    const e = store.event(evId), s = e?.scores[i];
    if (!s || !(isHrbp() || s.by === store.me().id) || store.heldBy(e, s)?.ver !== ver) return null;
    const rev = { v, ver, by: store.me().id, at: NT.TODAY };
    (s.revs = s.revs || []).push(rev); store.save();
    return () => { s.revs = s.revs.filter((x) => x !== rev); if (!s.revs.length) delete s.revs; store.save(); };
  };
  // 原评分人待复核的本人评分（v1.6 3.35.5：原评分人确认，不在时由 HR 代确认）
  store.myHeldScores = (role = store.role()) => {
    const me = ROLES[role]?.person, out = [];
    if (!S.reviewHolds.length || !me) return out;
    S.events.forEach((e) => { if (e.kind === 'obs' && e.date) e.scores.forEach((s, i) => { if (COUNTED.includes(s.st) && s.by === me && store.heldBy(e, s)) out.push({ e, i, s, ver: store.heldBy(e, s).ver }); }); });
    return out;
  };
  // 每个复核暂停当前覆盖的已确认旧分（给待办和规则页写人数、条数）
  store.reviewHolds = () => S.reviewHolds.map((h) => {
    const list = [];
    S.events.forEach((e) => { if (e.kind === 'obs' && e.date) e.scores.forEach((s) => { if (COUNTED.includes(s.st) && store.heldBy(e, s) === h) list.push(s); }); });
    return { ...h, n: list.length, people: new Set(list.map((s) => s.p)).size, raters: new Set(list.map((s) => s.by).filter(Boolean)).size };
  }).filter((h) => h.n);
  store.previewDraft = (kind) => {
    const d = draftOf(kind); if (!d) return null;
    if (store.forcedBreak(d)) d.compat = 'break';
    d.preview = kind === 'watch' ? watchImpact(d) : rubricImpact(d);
    store.save();
    return d.preview;
  };
  // 提交前四项：改了至少一处、写了理由、参数在允许范围内、预览按当前草稿算过（3.39）
  store.WATCH_RANGE = { n1Days: [30, 180], n1Count: [2, 5], n1Min: [3, 5], i2Days: [7, 60] };
  store.paramOk = (k, v) => { const r = store.WATCH_RANGE[k]; return !r || (Number.isInteger(v) && v >= r[0] && v <= r[1]); };
  // 盘点进行中，维度与锚点、象限落位只能从下一个盘点批次开始（AC-79）；提交和确认时都按当时的状态再查一次
  store.lockBlocks = (d, kind = store.ruleKind(d.v)) => d.effect === 'now' && store.lockedKinds.includes(kind) && !!store.inventoryLock();
  store.draftChecks = (d) => {
    const ch = store.ruleChanges(d);
    const key = d.params ? JSON.stringify(d.params) : JSON.stringify(d.content);
    return {
      lock: !store.lockBlocks(d),
      changed: ch.length > 0,
      why: !!(d.why || '').trim(),
      range: !d.params || Object.entries(d.params).every(([k, v]) => store.paramOk(k, v)),
      preview: !!d.preview && d.preview.key === key,
    };
  };
  store.submitDraft = (kind) => {
    const d = draftOf(kind); if (!d) return null;
    const c = store.draftChecks(d);
    if (!c.lock || !c.changed || !c.why || !c.range || !c.preview) return null;
    Object.assign(d, { state: 'pending', submittedAt: NT.TODAY }); delete d.returned;
    store.save(); return d;
  };
  // 待确认、已排期都可以撤回到草稿；已排期的撤回后要重新提交确认（3.35.3）
  store.withdrawDraft = (kind) => {
    const d = store.ruleOpen(kind); if (!d || !isHrbp() || !['pending', 'scheduled'].includes(d.state)) return null;
    Object.assign(d, { state: 'draft' }); delete d.confirmedBy; delete d.confirmedAt;
    store.save(); return d;
  };
  store.returnDraft = (kind, why, line) => {
    const d = store.ruleOpen(kind, line); if (!d || !isCeo() || d.state !== 'pending') return null;
    Object.assign(d, { state: 'draft', returned: { why, by: store.me().id, at: NT.TODAY } });
    store.save(); return d;
  };
  // 确认发布：立即生效的替代旧版本；从下一个盘点批次开始的进入已排期，旧版本继续生效（AC-77）
  store.confirmDraft = (kind, line) => {
    const d = store.ruleOpen(kind, line); if (!d || !isCeo() || d.state !== 'pending' || store.lockBlocks(d, kind)) return null;
    const live = store.ruleLive(kind, line), snap = NT.clone({ d, live }), holds = S.reviewHolds.length;
    Object.assign(d, { confirmedBy: store.me().id, confirmedAt: NT.TODAY });
    if (d.effect === 'now') activate(kind, d); else d.state = 'scheduled';
    store.save();
    return () => {
      const i = S.rules[kind].indexOf(d); S.rules[kind][i] = snap.d;
      if (live) S.rules[kind][S.rules[kind].indexOf(live)] = snap.live;
      S.reviewHolds.length = holds;
      store.save();
    };
  };
  // 生效：替代旧版本；不兼容的维度与锚点版本为受影响的旧分建立复核暂停
  function activate(kind, d) {
    const live = store.ruleLive(kind, d.line);
    if (kind === 'rubric' && (d.compat === 'break' || store.forcedBreak(d))) {
      // 范围：改了心性锚点，或这些岗位族的专业度锚点（通用锚点的改动落到还没有自己锚点的族）
      const ch = store.ruleChanges(d), fs = new Set(ch.filter((c) => c.set && c.set !== 'pot').map((c) => c.set));
      const fams = SEED.FAMILIES.map(([f]) => f).filter((f) => fs.has(f) || (fs.has('all') && !d.content.prof[f]));
      // from：生效时的取数窗口起点，与影响预览同一范围
      S.reviewHolds.push({ ver: d.v, base: d.base, at: NT.TODAY, from: NT.addDays(NT.TODAY, -store.ruleLive('place').content.window), potHit: ch.some((c) => c.set === 'pot'), fams });
    }
    d.state = 'live'; d.effAt = NT.TODAY;
    if (live) live.state = 'old';
  }
  // 发起盘点：已排期的版本在下一个盘点批次开始时生效，并固定为这个批次所用的版本。
  // 原型简化：还有别的盘点在进行时，那个批次锁定的版本保持不变，已排期的版本继续等待
  store.startInventory = (b) => {
    const busy = !!store.inventoryLock();
    if (!busy) Object.keys(S.rules).forEach((k) => S.rules[k].filter((r) => r.state === 'scheduled').forEach((r) => activate(k, r)));
    Object.assign(b, { rubric: store.ruleLive('rubric').v, place: store.ruleLive('place').v });
    S.batches.unshift(b); store.save();
    return b;
  };
  // 一件事按保存时生效的维度与锚点版本（种子在 fresh() 里、新事件在 addEvent 里写入 e.rubric）
  store.eventRubric = (e) => store.ruleVer(e.rubric);

  // 修订信号：入职半年内、同一维度已有足够的事印证，但第一件事早于 N1 时间窗、被排除在「新发现」之外的人
  store.watchGap = () => {
    const P = store.ruleLive('watch').params, from = NT.addDays(NT.TODAY, -P.n1Days);
    return SEED.PEOPLE.filter((p) => !p.noReview && NT.days(p.joined) <= 183 && store.scoresOf(p.id, { to: NT.addDays(from, -1) }).length).filter((p) => {
      const all = store.scoresOf(p.id, {});
      return SEED.DIMS.some((d) => new Set(all.filter((x) => x.d === d.id && x.v >= P.n1Min).map((x) => x.ev.id)).size >= P.n1Count);
    });
  };
  // 修订建议（3.35.8）：负责人、导师 / 助教在锚点处提，进 HR 待办；不改分数，也不自动形成草稿
  store.canSuggestRule = (role = store.role()) => ['lead', 'mentor'].includes(role);
  // 建议针对的锚点：专业度写明岗位族（或通用），并带提交时的锚点版本；早先的建议没有记录就不写
  store.sugLabel = (s) => `${store.dim(s.dim).name}${s.dim === 'prof' && s.fam ? ` · ${s.fam === 'all' ? '通用' : `${store.familyName(s.fam)}族`}` : ''}锚点 ${s.level} 分${s.ver ? `（${s.ver}）` : ''}`;
  store.addRuleSug = (o) => {
    if (!store.canSuggestRule()) return null;
    const s = { id: NT.uid('rs'), rule: 'rubric', state: 'open', by: store.me().id, at: NT.TODAY, ...o };
    S.ruleSugs.unshift(s); store.save(); return s;
  };
  store.removeRuleSug = (id) => { S.ruleSugs = S.ruleSugs.filter((s) => s.id !== id); store.save(); };
  store.ruleSugs = (o = {}) => S.ruleSugs.filter((s) => (!o.state || s.state === o.state) && (!o.by || s.by === o.by));
  // HR 处理：纳入草稿（作为依据挂到草稿上）或不采纳（写理由）
  store.handleRuleSug = (id, ok, why) => {
    const s = S.ruleSugs.find((x) => x.id === id); if (!s || !isHrbp()) return null;
    if (ok) {
      const d = store.startDraft(s.rule);
      if (d.state !== 'draft') return null;
      d.basis = [...(d.basis || []), { type: 'sug', sug: s.id }];
      Object.assign(s, { state: 'adopted', handledBy: store.me().id, handledAt: NT.TODAY, draft: d.v });
    } else Object.assign(s, { state: 'rejected', handledBy: store.me().id, handledAt: NT.TODAY, why });
    store.save(); return s;
  };
  store.unhandleRuleSug = (id) => {
    const s = S.ruleSugs.find((x) => x.id === id); if (!s) return;
    if (s.draft) { const d = store.ruleVer(s.draft); if (d) d.basis = (d.basis || []).filter((b) => b.sug !== id); }
    s.state = 'open'; delete s.handledBy; delete s.handledAt; delete s.why; delete s.draft; store.save();
  };

  // ---------- 全局搜索 ----------
  store.search = (q) => {
    const people = store.visiblePeople().filter((p) => !q || p.name.includes(q) || store.orgShort(p.org).includes(q) || p.title.includes(q));
    const role = store.role();
    const projects = S.projects.filter((p) => {
      if (role === 'self') return S.members.some((m) => m.project === p.id && m.person === store.me().id);
      if (role === 'mentor') return p.batch || S.members.some((m) => m.project === p.id && m.person === store.me().id);
      return true;
    }).filter((p) => !q || p.name.includes(q));
    return { people, projects };
  };

  S = load();
  if (upgradedFrom != null) NT.ready(() => setTimeout(() => NT.toast(keepOld
    ? '演示数据已更新到新版本。浏览器存储已满，旧数据备份失败，为了保留它，这次的操作只在本页生效。要保存，请先清理本站存储'
    : '演示数据已更新到新版本，你之前在本浏览器里做的演示操作已重置，旧数据另存了一份备份'), 600));
  store.save();
})();
