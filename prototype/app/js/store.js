/* Niu-Talent 原型：演示状态与业务规则。
   - 状态：种子数据的可变副本，存在本浏览器 localStorage，各人互不影响，可一键重置。
   - 视角：?as=ceo|hrbp|lead|mentor|self，只是演示手段；这里的权限判断模拟服务端「先过滤再呈现」。
   - 规则：象限参考位置（3.8.2）、变化（3.14，change-v1）、档案版本都从已确认的事件分实时算出。 */
(function () {
  'use strict';
  const NT = window.NT;
  const SEED = NT.SEED;
  const KEY = 'nt-demo';
  const ROLE_KEY = 'nt-role';

  // ---------- 持久化 ----------
  let S = null;
  function fresh() {
    const s = NT.clone({
      v: SEED.version, events: SEED.EVENTS, projects: SEED.PROJECTS, members: SEED.MEMBERS, memberLog: SEED.MEMBER_LOG,
      needs: SEED.NEEDS, plans: SEED.PLANS, actions: SEED.ACTIONS, tracks: SEED.TRACKS, signals: SEED.SIGNALS, inbox: SEED.INBOX,
      tasks: SEED.TASKS, batches: SEED.BATCHES, conclusions: SEED.CONCLUSIONS, tagCands: SEED.TAG_CANDIDATES, taglibAdd: [],
      seen: {}, snaps: [], reviews: {}, corrections: [], selfNotes: [], directions: SEED.DIRECTIONS,
      judgeMarks: {}, judgeAttribs: Object.fromEntries(Object.values(SEED.JUDGE.attribs).map((a) => [a.hyp, a])), pubActions: [{ person: 'p-lin', title: '参加 11 月客户现场轮岗', by: 'p-suwan', at: '2026-10-20', state: 'todo' }],
    });
    S = s;
    s.snaps.push(buildSnap({ id: 's-h1', batch: 'b-h1', label: '2026 H1', org: 'gp', cutoff: '2026-06-20', at: '2026-06-30', by: 'p-suwan' }));
    return s;
  }
  // 演示数据版本变了就从新的种子开始；旧的演示操作先备份到 nt-demo-prev，并提示一次，不静默覆盖
  let upgradedFrom = null;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v === SEED.version) return s;
        localStorage.setItem(`${KEY}-prev`, raw);
        upgradedFrom = s?.v ?? '?';
      }
    } catch (e) { /* 隐私模式或存储被禁用时退回内存状态 */ }
    return fresh();
  }
  const store = (NT.store = {});
  store.save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 存不下时只在本页生效 */ } };
  store.reset = () => { try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ } fresh(); store.save(); };
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
  store.tenure = (p) => { const d = NT.days(p.joined); return d < 60 ? `入职 ${Math.max(1, Math.round(d / 7))} 周` : d < 365 ? `入职 ${Math.round(d / 30)} 个月` : `入职 ${Math.floor(d / 365)} 年`; };

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
      case 'signals': {
        if (!['ceo', 'hrbp', 'lead'].includes(role)) return false;
        if (!pid) return true;
        if (role === 'lead') return PEOPLE.get(pid)?.manager === ROLES.lead.person;
        return sc === 'full';
      }
      case 'changes': return pid ? sc === 'full' && role !== 'mentor' : ['ceo', 'hrbp', 'lead'].includes(role);
      case 'record': return pid ? ['full', 'mentor', 'project'].includes(sc) : role !== 'self';
      case 'calibrate': return ['ceo', 'hrbp'].includes(role);
      case 'quadConfirm': return ['ceo', 'hrbp'].includes(role);
      case 'findOwner': return ['ceo', 'hrbp', 'lead'].includes(role);
      case 'confirmPlan': return ['ceo', 'hrbp'].includes(role);
      case 'approveTags': return ['ceo', 'hrbp'].includes(role);
      case 'review': return ['ceo', 'hrbp', 'lead'].includes(role);
      default: return false;
    }
  };

  // ---------- 对象级权限：先判断视角能不能碰这个对象，页面只负责呈现 ----------
  const myHrbpOrgs = (me) => SEED.PEOPLE.filter((q) => q.hrbp === me).map((q) => q.org);
  const isMentorOf = (projectId, me) => S.members.some((m) => m.project === projectId && m.person === me && !m.to && m.role === '导师')
    || S.batches.some((b) => b.kind === 'landing' && b.newcomers.some(([, topic, mentors]) => topic === projectId && mentors.includes(me)));
  // 项目编辑：创建者、owner、CEO，项目所属组织在本人范围内的 HRBP / 部门负责人，以及被分配到该议题的导师（需求 3.6.3）
  store.canEditProject = (p, role = store.role()) => {
    if (!p) return false;
    const me = ROLES[role].person;
    if (role === 'self') return false;
    if (role === 'ceo' || p.creator === me || p.owner === me) return true;
    if (role === 'hrbp') return myHrbpOrgs(me).some((o) => store.inOrg(o, p.org));
    if (role === 'lead') return store.inOrg(p.org, PEOPLE.get(me).leads);
    if (role === 'mentor') return !!p.batch && isMentorOf(p.id, me);
    return false;
  };
  // 用人需求与方案属于管理受限资料：发起人、CEO、相关 HRBP、范围内的部门负责人
  store.canStaff = (projectId, role = store.role()) => {
    if (!store.can('findOwner', null, role)) return false;
    const p = S.projects.find((x) => x.id === projectId);
    return !p || store.canEditProject(p, role);
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
  // 会议纪要：录入人、该批次的导师、批次学员的归属 HRBP，以及 CEO
  // 能打开某份纪要：有会议权限，或这次录音就是本人录的
  store.canOpenMinutes = (mid, role = store.role()) => store.canMeeting(SEED.MINUTES[mid], role) || S.tasks.some((t) => t.minutes === mid && t.by === ROLES[role].person);
  store.visibleTasks = () => S.tasks.filter((t) => !t.minutes || store.canOpenMinutes(t.minutes));
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
        if (!o.all && !COUNTED.includes(s.st)) return;
        if (o.dim && s.d !== o.dim) return;
        out.push({ ...s, ev: e, date: e.date });
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
    if (profEvents.size < 2) miss.push(profEvents.size ? '专业度缺 1 条事件' : '专业度还没有评分');
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
  store.needsRecal = (pid) => { const f = store.formal(pid); if (!f) return false; const r = store.refPos(pid); return !r.na && r.q !== f.q; };
  store.freeze = (snap) => { S.snaps.push(snap); store.save(); };
  // 部门负责人在校准时的拖动和理由：存成建议，HRBP / CEO 打开同一团队时可以看到并采纳
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
    const base = o.base || 'win'; // win：近 3 个月 vs 之前 9 个月；ver：vs 2026 H1 档案版本
    const role = store.role();
    if (!store.can('changes')) return [];
    const people = store.visiblePeople(role).filter((p) => store.scope(p.id) === 'full');
    const out = [];
    const h1 = S.snaps.find((s) => s.id === 's-h1');
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
      const teams = SEED.ORGS.filter((o) => o.parent === 'gp');
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
          rule: '资料不足 +20 个百分点', sub: `${now.length} 人中 ${naNow} 人资料不足${merged ? ` · 并入的 ${merged} 人还没有本系统的事件` : ''}${newbies ? ` · 另有 ${newbies} 名入职不到 3 个月的新人未计入` : ''}`, merged, newbies });
      });
    }
    return out.sort((a, b) => b.when.localeCompare(a.when)); // 按发生时间，不按幅度
  };
  store.markSeen = (id, on) => { S.seen[id] = on; store.save(); };

  // ---------- 待办（按视角） ----------
  store.todos = () => {
    const role = store.role(), me = ROLES[role].person, list = [];
    const visibleInbox = S.inbox.filter((i) => !i.done && (role === 'hrbp' || role === 'ceo' || i.by === me || (role === 'mentor')));
    if (role !== 'self' && role !== 'lead') visibleInbox.forEach((i) => list.push({ kind: 'verify', badge: '待核对', cls: 'n-badge--ai', icon: 'spark', title: i.q.replace(/？$/, ''), sub: `${i.src} · ${i.at}`, due: '今天', href: `inbox.html#${i.id}` }));
    if (store.can('calibrate')) store.queue().forEach((q) => list.push({ kind: 'calib', badge: q.kindLabel, cls: q.kind === 'conflict' ? 'n-badge--conflict' : '', icon: q.kind === 'conflict' ? 'split' : '', title: q.title, sub: q.sub, due: q.pair, href: `queue.html#${q.id}` }));
    S.tracks.filter((t) => t.state === 'on' && (t.owner === me || t.helper === me) && store.scope(t.person)).forEach((t) => list.push({ kind: 'track', badge: '跟踪到期', title: `${store.person(t.person).name}的观察问题`, sub: t.q, due: NT.md(t.next), href: `person.html?id=${t.person}#track` }));
    S.signals.filter((s) => s.state === 'talk' && s.result?.who === me).forEach((s) => list.push({ kind: 'talk', badge: '待跟进', title: `和${store.person(s.person).name}聊一次`, sub: '来自「值得聊一聊」', due: s.result.when, href: `person.html?id=${s.person}#signal` }));
    if (role === 'mentor') {
      const b = store.batch('b-land3');
      b.newcomers.filter((n) => n[2].includes(me)).forEach(([pid]) => {
        const r = store.review(pid, 'W2');
        if (r.state !== 'confirmed') list.push({ kind: 'review', person: pid, badge: '对人复盘', title: `${store.person(pid).name} · W2 对人复盘`, sub: `${r.confirmed}/${r.total} 项已确认${r.conflicts ? ` · ${r.conflicts} 项在校准队列` : ''}`, due: '10-24', href: `landing-review.html?id=${pid}` });
      });
    }
    S.plans.filter((p) => p.status === 'draft').forEach((p) => {
      if (!store.can('review') && role !== 'lead') return;
      const title = p.kind === 'staffing' ? `项目用人方案 v${p.version}` : `组织调整方案 v${p.version}`;
      const sub = p.kind === 'staffing' ? `${store.project(p.project)?.name || ''} · ${store.person(p.by).name}起草` : `${store.batch(p.batch).name}`;
      if (role === 'self' || role === 'mentor') return;
      list.push({ kind: 'plan', plan: p.id, badge: '待确认', cls: 'n-badge--seal', title, sub, due: p.kind === 'staffing' ? 'CEO' : 'HRBP', href: p.kind === 'staffing' ? `staffing.html?project=${p.project}` : `plan.html?id=${p.batch}` });
    });
    if (role === 'self') {
      S.pubActions.filter((a) => a.person === me).forEach((a) => list.push({ kind: 'pub', badge: '发布给你', title: a.title, sub: `${store.person(a.by).name} · ${NT.md(a.at)}`, due: '待安排', href: 'person.html?id=p-lin#self' }));
    }
    return list;
  };

  // CEO 只留需要本人确认的事（v1.3 3.18），其余在推进的事由 HRBP 和负责人处理
  store.mineToConfirm = (list) => list.filter((t) => t.kind === 'plan' && t.due === 'CEO');

  // ---------- HRBP 校准队列 ----------
  store.queue = () => {
    const q = [];
    S.events.forEach((e) => e.scores.forEach((s, i) => {
      if (!store.scope(s.p) || store.scope(s.p) === 'self') return;
      const name = store.person(s.p).name, dn = store.dim(s.d).name;
      if (s.st === 'conflict') q.push({ id: `${e.id}-${i}`, ev: e, s, i, kind: 'conflict', kindLabel: '待校准', title: `${dn}分差 ${Math.abs(s.raters[0].v - s.raters[1].v)} 分`, sub: `${name} · ${s.raters.map((r) => `${store.person(r.by).name} ${r.v}`).join(' / ')}`, pair: s.raters.map((r) => r.v).join(' / ') });
      else if (s.bigGap && s.st === 'confirmed') q.push({ id: `${e.id}-${i}`, ev: e, s, i, kind: 'gap', kindLabel: '与 AI 分差大', title: `${name} · ${dn}`, sub: `${store.person(s.by).name}确认 ${s.v}，AI 建议 ${s.ai}，没写理由`, pair: `${s.v} / ${s.ai}` });
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
    store.save();
  };

  // ---------- Landing 对人复盘 ----------
  store.review = (pid, week = 'W2') => {
    const b = store.batch('b-land3');
    const w = b.weeks.find((x) => x[0] === week);
    const from = b.from, to = w[4];
    const evs = S.events.filter((e) => e.kind === 'obs' && e.date && e.date >= from && e.date <= to && e.people.includes(pid));
    const key = `${pid}-${week}`;
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
    S.tasks.forEach((t) => { if (t.readyAt && t.state === 'shaping' && Date.now() >= t.readyAt) { t.state = 'partial'; t.note = '9 条事件已整理，3 处待核对'; changed = true; } });
    if (changed) store.save();
  };

  // ---------- 写入 ----------
  store.addEvent = (e) => { S.events.unshift(e); store.save(); return e; };
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
  store.resolveInbox = (id, choice) => {
    const it = S.inbox.find((x) => x.id === id);
    it.done = true; it.choice = choice;
    if (it.draft && choice && choice !== 'skip') {
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
    const musts = (plan.reqs || S.needs.find((n) => n.project === plan.project)?.reqs || []).filter((x) => x.must).map((x) => x.text);
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
      // 行动带上冻结的判断，到期后可以进入任用后复盘
      S.actions.unshift({ id: NT.uid('a'), title: `${name}${r.id === 'owner' ? `接任${p.name} owner` : `加入${p.name}（${r.name}）`}`, from: plan.id, person: pid, owner: 'p-suwan', due: '2026-11-01', state: 'todo', observe: '2027-01-31',
        then: [`目标：${r.id === 'owner' ? `负责${p.name}` : `在${p.name}承担${r.name}`}`, `依据：用人方案 v${plan.version}${musts.length ? `，必须项：${musts.join('、')}` : ''}`, `缺口：${plan.slotNote?.[r.id] || '方案里没有写，复盘时补充'}`] });
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
      S.actions.unshift({ id: NT.uid('a'), title, kind: m.kind, from: plan.id, person: m.person, owner: m.owner || 'p-suwan', due: m.due || '2026-11-15', state: 'todo', observe: m.type === '继续观察' ? null : '2027-02-15', then: m.type === '继续观察' ? null : [`目标：${m.to}`, `依据：${m.basis}`, `缺口：${m.gap || '—'}`] });
    });
    store.save();
    return created;
  };
  store.unresolveInbox = (id) => {
    const it = S.inbox.find((x) => x.id === id);
    it.done = false; it.choice = null;
    S.events = S.events.filter((e) => e.id !== `e-${id}`);
    store.save();
  };
  store.addMember = (m) => {
    S.members.push(m);
    S.memberLog.unshift({ project: m.project, at: NT.TODAY, text: `${store.person(m.person).name}加入：${m.role} · ${m.mode}`, by: store.me().id });
    store.save();
  };
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

  // ---------- 判断复盘（v1.3 3.16）：对照两段判断，归因只作用于评价体系，不写回被评价人 ----------
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
    const list = dims.flatMap((d) => store.scoresOf(pid, { dim: d, from: p.joined, to }));
    const evs = [...new Set(list.map((x) => x.ev.id))];
    if (evs.length < 2) return { na: true, n: list.length, evs, to, miss: list.length ? '只有 1 条事件的已确认分' : '窗口内没有已确认分' };
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
      g.rows.forEach(([pid, by, fr, fnote, bk, bnote], i) => chain.dims.forEach((d) => push({
        person: pid, dim: d.id,
        front: { by, v: fr[d.id] ?? null, r: chain.grades.indexOf(fr[d.id]), note: fnote, std: b.std, src: cell(g.src.front, i + 2, [g.src.cols[d.id], g.src.cols.note], `${d.name} ${fr[d.id] ?? '—'}：${fnote}`, by) },
        back: bk[d.id] ? { by: [g.back], v: bk[d.id], r: chain.grades.indexOf(bk[d.id]), note: bnote, src: cell(g.src.back, i + 2, [g.src.cols[d.id], g.src.cols.note], `${d.name} ${bk[d.id]}：${bnote}`, g.back) } : { by: [g.back], na: true, note: bnote, miss: '训练营评审没有这个维度的等级', src: cell(g.src.back, i + 2, [g.src.cols.note], bnote, g.back) },
      })));
    } else {
      J.hire[batchId].forEach(([pid, by, ev, fr, fnote]) => chain.dims.forEach((d) => {
        const bk = hireBack(pid, map.back[d.id], chain);
        push({ person: pid, dim: d.id,
          front: { by, v: fr[d.id] ?? null, r: fr[d.id] ?? null, note: fnote, std: b.std, ev, miss: fr[d.id] == null ? '面试没有给这个维度的结论' : '' },
          back: bk.na ? { na: true, n: bk.n, evs: bk.evs, miss: bk.miss, to: bk.to } : { by: bk.by, v: bk.v, r: bk.v, mean: bk.mean, n: bk.n, evs: bk.evs, to: bk.to } });
      }));
    }
    return out;
  };
  // 视角：CEO 看汇总与结论；HRBP 看归属范围；部门负责人、导师、员工只在自己是评价人时看到本人的案例
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
  store.hypCheck = (h) => {
    const bids = [...new Set(h.cases.map((cid) => cid.split(':')[0]))];
    const units = bids.flatMap((bid) => store.judgeUnits(bid));
    const byId = new Map(units.map((u) => [u.id, u]));
    // 证据按钮列出的案例不可比或资料不足，或正文统计范围（basis）里有案例被标为不可比，都算依据变化
    const inBasis = (h.basis || []).flatMap((x) => store.judgeUnits(x.batch).filter((u) => (!x.dim || u.dim === x.dim) && (!x.rater || u.front.by === x.rater) && u.state === 'nc').map((u) => u.id));
    const dropped = [...new Set([...h.cases.filter((cid) => !byId.has(cid) || !store.judgeComparable(byId.get(cid))), ...inBasis])];
    const few = !!h.rater && !store.raterStats(units, h.rater).enough;
    return { ok: !dropped.length && !few, dropped, few };
  };
  store.confirmAttrib = (batchId, hyp, a) => {
    if (!store.hypCheck(hyp).ok) return false;
    S.judgeAttribs[hyp.id] = { hyp: hyp.id, batch: batchId, ...a, by: store.me().id, at: NT.TODAY, actions: [] };
    store.save();
    return true;
  };
  store.unmarkJudge = (uid) => { delete S.judgeMarks[uid]; store.save(); };
  store.markJudge = (uid, reason) => { S.judgeMarks[uid] = { reason, by: store.me().id, at: NT.TODAY }; store.save(); };
  // 改进动作沿用「行动与复盘」；修订评价标准要产生新版本，在动作里写明
  store.addJudgeAction = (batchId, hypId, a) => {
    const h = store.judgeHyps(batchId).find((x) => x.id === hypId);
    if (!h || !S.judgeAttribs[hypId] || !store.hypCheck(h).ok) return null;
    const act = { id: NT.uid('a'), from: batchId, person: null, owner: store.me().id, due: NT.addDays(NT.TODAY, 30), state: 'todo', observe: NT.addDays(NT.TODAY, 120), ...a };
    S.actions.unshift(act);
    S.judgeAttribs[hypId].actions.push(act.id);
    store.save();
    return act;
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
  if (upgradedFrom != null) NT.ready(() => setTimeout(() => NT.toast('演示数据已更新到新版本，你之前在本浏览器里做的演示操作已重置，旧数据另存了一份备份'), 600));
  store.save();
})();
