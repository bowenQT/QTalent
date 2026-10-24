/* 找人活文档：一句话 → 建项目、生成需求卡 → 候选人逐项核对证据 → 拖进方案的角色槽位 → 确认后写入项目成员。
   候选卡逐项列出要求和证据状态，不出现总分；列表按「必须项支持了几条」排列，不按分数排序。「未知」和「不满足」分开。
   结果是脚本化的 mock：预置，但按真实节奏出现。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;

  // ---------- 预置的场景 ----------
  const SCEN = {
    newconv: {
      project: { id: 'pr-newconv', name: '新转化团队', type: '业务项目', org: 'gp-conv', status: '筹备中', from: '2026-11-01', to: '2027-06-30', goal: 'SDR 与 SMB 并入后组建新的转化团队：首次联系客户的人对客户负责三个月，不换手。' },
      say: '新转化团队要找一个能带 SDR 和 SMB 的 owner，11 月到岗', pool: 41,
      roles: [{ id: 'owner', name: '团队 owner' }],
      reqs: [
        { id: 'r1', text: '带过销售或转化团队', must: true, alt: '带过 3 人以上的团队' },
        { id: 'r2', text: '熟悉 SMB 客户的首次跟进', must: true, alt: '熟悉线索转化的全流程' },
        { id: 'r3', text: '11 月能到岗', must: true, alt: '12 月前能到岗' },
        { id: 'r4', text: '有跨部门协作经验', must: false },
      ],
      cands: {
        'p-xieling': { r1: ['yes', '带两名新人跑通 SMB 首单', 'e-xl-1'], r1alt: ['unknown', '只带过 2 名新人，没有 3 人以上的记录'], r2: ['yes', '转化漏斗复盘：首次跟进超时是主因', 'e-xl-3'], r2alt: ['yes', '转化漏斗复盘覆盖了线索到成单', 'e-xl-3'], r3: ['unknown', '本人意愿未知，还没问过'], r3alt: ['unknown', '本人意愿未知'], r4: ['yes', '主动整理 SDR 交接清单', 'e-xl-5'],
          will: ['未知 · 还没问过', true], release: '客户转化部：需要找人接手 2 个大客户', now: '没有在进行的项目', next: '和她确认意愿与交接', dims: ['lead', 'wis'] },
        'p-heyn': { r1: ['unknown', '没有带团队的记录'], r1alt: ['unknown', '没有带团队的记录'], r2: ['conflict', '做过转化分析，但近 3 个月两次客户场景判断失误', 'e-he-6'], r2alt: ['yes', '埋点治理里拆清了转化链路', 'e-he-2'], r3: ['unknown', '在海外加速搜索体验兼职，可否释放未知'], r3alt: ['yes', '海外加速搜索体验 12 月阶段收尾', null], r4: ['yes', '埋点治理里协调各团队排期', 'e-he-2'],
          will: ['未知', true], release: '海外加速搜索体验：兼职顾问', now: '1 个项目', next: '先看智慧力走低的原因', dims: ['lead', 'wis'] },
        'p-duheng': { r1: ['unknown', '原系统里的带人记录还没有补录'], r1alt: ['unknown', '原系统里的带人记录还没有补录'], r2: ['unknown', '并入前的客户跟进记录在原系统'], r2alt: ['unknown', '并入前的记录在原系统'], r3: ['yes', '已在客户转化部，无需调动', null], r3alt: ['yes', '已在客户转化部', null], r4: ['unknown', '资料不足'],
          will: ['未知', true], release: '不涉及', now: '—', next: '补录原系统里的客户跟进记录', dims: ['lead'] },
        'p-lin': { r1: ['no', '入职 3 个月，没有带团队经历'], r1alt: ['no', '没有带团队经历'], r2: ['unknown', '没有转化相关事件'], r2alt: ['unknown', '没有转化相关事件'], r3: ['unknown', 'Landing 第三期 11-02 结营'], r3alt: ['yes', '11-02 结营后可以调整', null], r4: ['yes', '周会主动认领联调文档，被两个团队采用', 'e-lin-2'],
          will: ['本人说过想离客户近一点（09-28 自述）', false], release: 'Landing 期间不调动', now: '2 个项目', next: '结营后再看', dims: ['mot', 'wis'] },
      },
      manual: { 'p-hance': { r1: ['yes', '现任业务成功部负责人', null], r1alt: ['yes', '带 9 人的团队', null], r2: ['unknown', '没有 SMB 首次跟进的事件'], r2alt: ['unknown', '没有转化相关事件'], r3: ['conflict', '兼任需要上级确认'], r3alt: ['conflict', '兼任需要上级确认'], r4: ['yes', '客户成功手册专项', null], will: ['未知', true], release: '业务成功部负责人，不能全职', now: '负责业务成功部', next: '和秦舒确认能否兼任', dims: ['lead'] } },
    },
    gray: {
      project: { id: 'pr-gray' }, say: '灰度发布平台要找一个 owner', pool: 0,
      roles: [{ id: 'owner', name: '项目 owner' }],
      reqs: [
        { id: 'r1', text: '做过发布或回滚相关的系统', must: true, alt: '做过线上变更相关的工作' },
        { id: 'r2', text: '熟悉增长中台', must: true },
        { id: 'r3', text: '能投入 50% 以上', must: true, alt: '能投入 30% 以上' },
      ],
      cands: {
        'p-shenyan': { r1: ['unknown', '灰度发布相关经历资料不足'], r1alt: ['yes', '冷数据迁移分批上线，零差错', 'e-sy-2'], r2: ['yes', '增长中台数据迁移 owner', 'e-sy-3'], r3: ['unknown', '在数据迁移项目全职，可否释放未知'], r3alt: ['unknown', '可否释放未知'],
          will: ['「做的事情挺熟了，没什么新鲜感」（7 月自述）· 想不想换方向还没问', true], release: '未知 · 待和孟夏确认', now: '增长中台数据迁移 owner', next: '先安排一次沟通（来自「值得聊一聊」）', dims: ['prof', 'mot'] },
        'p-zhouyu': { r1: ['yes', '搜索索引重建一次完成，提前写好回滚步骤', 'e-zy-8'], r1alt: ['yes', '搜索索引重建', 'e-zy-8'], r2: ['unknown', '没有增长中台的事件'], r3: ['no', '海外加速搜索体验 owner，Q4 满负荷'], r3alt: ['no', 'Q4 满负荷'],
          will: ['未知', true], release: '海外加速搜索体验需要他', now: '海外加速搜索体验 owner', next: '—', dims: ['prof', 'grit'] },
        'p-gaoyuan': { r1: ['unknown', '没有相关事件'], r1alt: ['unknown', '没有相关事件'], r2: ['yes', '增长中台数据迁移成员', null], r3: ['unknown', '在数据迁移项目全职'], r3alt: ['yes', '迁移项目 12 月收尾后有余量', null],
          will: ['未知', true], release: '数据迁移项目', now: '增长中台数据迁移', next: '和沈砚一起聊', dims: ['prof'] },
      },
      manual: {},
    },
    search: {
      project: { id: 'pr-search' }, pool: 38,
      roles: [{ id: 'owner', name: '项目 owner' }, { id: 'fe', name: '前端' }],
      reqs: [
        { id: 'r1', text: '主导过跨团队交付', must: true, alt: '参与过跨团队交付' },
        { id: 'r2', text: '有海外客户经验', must: false, alt: '有海外客户经验，或愿意在 Q4 跟一次海外交付' },
        { id: 'r3', text: 'Q4 有余量', must: true },
      ],
      cands: {
        'p-zhouyu': { r1: ['yes', '融合线路配置改造：协调两条线按期交付', 'e-zy-1'], r2: ['conflict', '简历有，近两年事件里没有'], r2alt: ['yes', '愿意跟 Q4 的海外交付（10-08 一对一）', null], r3: ['yes', '已是 owner', null], will: ['已沟通 · 愿意', false], release: '运营平台部同意兼任', now: '3 个项目，其中 1 个 12 月结束', next: '—', dims: ['lead', 'prof'] },
        'p-lin': { r1: ['no', '入职 3 个月，没有主导过'], r1alt: ['yes', '海外演示时搭演示环境', 'e-demo-1015'], r2: ['unknown', '没有海外客户相关事件'], r2alt: ['yes', '已在海外加速搜索里兼职', null], r3: ['yes', '已在项目里兼职 · 观察到 12-15', null], will: ['本人说过想离客户近一点', false], release: 'Landing 期间兼职', now: '2 个项目', next: '观察到 12-15', dims: ['prof', 'mot'] },
        'p-chengnuo': { r1: ['unknown', '没有相关事件'], r1alt: ['yes', '黑客松里负责前端', null], r2: ['unknown', '资料不足'], r2alt: ['unknown', '资料不足'], r3: ['unknown', '本人余量未知'], will: ['未知', true], release: '业务成功部', now: '—', next: '确认 Q4 余量', dims: ['prof'] },
      },
      manual: {},
    },
  };

  const TPL_SAY = '新转化团队要一个能带 SDR 和 SMB 的 owner';

  // ---------- 状态 ----------
  const isNew = !!NT.param('new');
  let projectId = NT.param('project');
  let key = projectId === 'pr-search' ? 'search' : projectId === 'pr-gray' ? 'gray' : projectId === 'pr-newconv' ? 'newconv' : null;
  const q = NT.param('q') || '';
  // 目标角色模板（v1.3 3.15.2）：原型只为「业务负责人」预置了候选人（新转化团队）
  const tplId = NT.param('tpl'), tpl = tplId && st.template(tplId);
  if (isNew) key = tpl ? (tpl.id === 'tpl-biz' ? 'newconv' : null) : /灰度/.test(q) ? 'gray' : 'newconv';
  const sc = key && SCEN[key];
  // 从模板生成的需求卡：要求取自生成时的模板版本，之后就地补的要求也存在需求卡上
  const need0 = sc && st.get().needs.find((n) => n.project === (projectId || sc.project.id));
  let reqs = (need0?.tpl ? NT.clone(need0.reqs) : sc ? NT.clone(sc.reqs) : []).map((r) => ({ ...r, useAlt: false }));
  const insertReq = (r) => { const at = reqs.findIndex((x) => !x.must); if (r.must && at >= 0) reqs.splice(at, 0, r); else reqs.push(r); }; // 必须项排在加分项前面
  // 草稿里保存过改动后的要求，回来时按草稿恢复；就地补过的要求（需求卡或草稿上有、预置场景里没有的）一并补回
  const draftReqs = st.get().plans.find((p) => p.project === projectId && p.status === 'draft')?.reqs;
  [...(need0?.tpl ? [] : need0?.reqs || []), ...(draftReqs || [])].forEach((x) => { if (!reqs.some((r) => r.id === x.id)) insertReq({ id: x.id, text: x.text, must: x.must, ...(x.alt ? { alt: x.alt } : {}), ...(x.ev ? { ev: x.ev } : {}), useAlt: false }); });
  if (draftReqs) draftReqs.forEach((x) => { const r = reqs.find((y) => y.id === x.id); if (r) { r.must = x.must; r.useAlt = !!(x.useAlt && r.alt); } });
  let manual = [];
  let slots = {};
  let note = '';

  NT.shell({
    nav: 'projects', title: '找人', crumbs: [['项目', 'projects.html']],
    allow: (r) => st.canStaff(projectId, r),
    denyText: '找 owner 和项目找人只对 CEO、HRBP 和部门负责人开放。',
    view: () => `找人 · ${projectId ? st.project(projectId)?.name : '新项目'} · 方案 ${Object.values(slots).filter(Boolean).length} 个槽位已填`,
    state: () => ({ reqs: reqs.map((r) => [r.must, r.useAlt]), slots }),
    restore: (s) => { if (s.reqs) s.reqs.forEach(([m, a], i) => { if (reqs[i]) { reqs[i].must = m; reqs[i].useAlt = a; } }); if (s.slots) slots = s.slots; drawAll(); },
    render,
  });

  function render(main) {
    if (!sc) {
      const T = st.templates(), tv = tpl && st.tplVersion(tpl);
      mount(main, html`<header class="nt-head"><div><h1>为一个项目或关键岗位找人</h1><p>说一句要做什么、要什么样的人，或者从目标角色模板开始。系统会建项目、生成需求卡，再按你有权限查看的人逐项核对证据。</p></div></header>
        <div class="n-tpls" role="group" aria-label="目标角色模板" style="margin-bottom:var(--s-4)">${T.map((t) => html`<a class="n-tpl" href="staffing.html?tpl=${t.id}" aria-pressed="${t.id === tplId}">找${t.name}<small>v${st.tplVersion(t).v}</small></a>`)}</div>
        ${tpl ? html`<article class="n-card" style="max-width:720px;margin-bottom:var(--s-4)">
          <div class="nt-row" style="justify-content:space-between"><h3 class="n-section-title" style="margin:0">目标角色模板 · ${tpl.name}</h3><span class="n-tplver">v${tv.v} · ${st.person(tv.by).name} ${NT.md(tv.at)} 更新</span></div>
          <dl class="nt-dl" style="margin-top:var(--s-3)"><dt>对应通道</dt><dd>${st.channel(tpl.ch).name}</dd><dt>典型职责</dt><dd>${tpl.duties}</dd><dt>相关维度</dt><dd>${tpl.dims.map((d) => st.dim(d).name).join('、')}</dd></dl>
          <ul class="n-reqs">${tv.reqs.map((r) => html`<li><span class="n-badge ${r.must ? '' : 'n-badge--demo'}">${r.must ? '必须' : '加分'}</span><span>${r.text}${r.alt ? html` <span class="nt-muted">（可放宽为「${r.alt}」）</span>` : ''}</span></li>`)}</ul>
          ${tv.note ? html`<p class="nt-caption">v${tv.v} 的改动：${tv.note}。之前生成的需求卡保留当时的版本。</p>` : ''}
          ${tpl.id === 'tpl-biz' ? '' : html`<div class="n-notice is-plain" style="margin-top:var(--s-3)">${icon('info')}<div>原型只为「业务负责人」模板预置了候选人（新转化团队），这里可以看模板生成的需求卡长什么样。</div></div>`}
        </article>` : ''}
        <div class="n-composer" style="max-width:720px"><span class="nt-ip" data-ip="rest" data-size="36"></span><textarea class="n-composer__field" id="sq" rows="2" aria-label="描述项目和要找的人" placeholder="${tpl ? `比如：${TPL_SAY}` : "比如：新转化团队要找一个能带 SDR 和 SMB 的 owner，11 月到岗"}"></textarea>
          <div class="n-composer__bar"><span class="spacer"></span><button class="n-btn n-btn--ink n-btn--icon" type="button" id="sgo" aria-label="开始">${icon('up')}</button></div></div>
        <div class="n-asks" style="margin-top:var(--s-3)">${(tpl ? (tpl.id === 'tpl-biz' ? [TPL_SAY] : []) : [SCEN.newconv.say, SCEN.gray.say]).map((s) => html`<button class="n-ask" type="button" data-say="${s}">${s}</button>`)}</div>`);
      main.onclick = (e) => {
        const b = e.target.closest('[data-say]'); if (b) $('#sq').value = b.dataset.say;
        if (!e.target.closest('#sgo') || !$('#sq').value.trim()) return;
        if (tpl && tpl.id !== 'tpl-biz') { NT.toast(`原型没有为「${tpl.name}」预置候选人，可以换「业务负责人」模板走一遍`); return; }
        location.href = NT.link('staffing.html', { new: 1, q: $('#sq').value.trim(), ...(tpl ? { tpl: tpl.id } : {}) });
      };
      return;
    }
    if (!isNew && !st.project(projectId)) return mount(main, UI.state({ ip: 'confirm', title: '没有找到这个项目', text: '它可能还没创建，或者已经删除。', actions: html`<a class="n-btn n-btn--sm" href="staffing.html?new=1">为新项目找人</a>` }));
    if (isNew && key === 'newconv' && !st.project('pr-newconv')) return runNew(main);
    if (isNew) { projectId = sc.project.id; history.replaceState(null, '', `staffing.html?project=${projectId}`); }
    loadPlan();
    layout(main);
    drawAll();
  }

  function loadPlan() {
    const plans = st.get().plans.filter((p) => p.project === projectId);
    const draft = plans.find((p) => p.status === 'draft'), conf = plans.filter((p) => p.status === 'confirmed').pop();
    const base = draft || conf;
    slots = Object.fromEntries(sc.roles.map((r) => [r.id, base?.slots?.[r.id] || null]));
    note = base?.note || '';
  }

  async function runNew(main) {
    // 一句话 → 建项目 → 需求卡 → 候选人
    const me = st.me().id;
    const tv = tpl && st.tplVersion(tpl);
    mount(main, html`<header class="nt-head"><div><h1>${tpl ? `找${tpl.name}` : '为一个项目找人'}</h1><p>${q || sc.say}</p></div></header>
      <div class="n-composer" style="max-width:720px;margin-bottom:var(--s-4)"><span class="nt-ip" data-ip="searching" data-size="36" id="nip"></span><div class="n-composer__field" style="min-height:0">${q || sc.say}</div></div>
      <div class="n-card" style="max-width:720px">${UI.trail(`为「${sc.project.name}」找 owner · 5 步`, ['理解需求，建项目「新转化团队」（筹备中）', tv ? `按模板「${tpl.name}」v${tv.v} 生成 ${tv.reqs.length} 项要求` : '拆出 4 项要求', `检索你有权限查看的 ${sc.pool} 人`, '逐项核对证据', '生成候选与缺口'])}</div>`);
    UI.mountIPs(main);
    const trail = $('.n-trail', main);
    const steps = $$('.n-trail__step', trail);
    steps.forEach((s) => { s.dataset.state = 'pending'; });
    for (const [i, s] of steps.entries()) {
      s.dataset.state = 'active';
      await NT.wait(i === 3 ? 1100 : 650);
      if (i === 0) {
        st.addProject({ ...sc.project, owner: null, creator: me });
        st.get().memberLog.unshift({ project: sc.project.id, at: NT.TODAY, text: '项目创建（来自一句话找 owner）', by: me });
        st.get().needs.push({ id: 'n-newconv', project: sc.project.id, version: 1, by: me, at: NT.TODAY, text: q || sc.say, roles: sc.roles, reqs: tv ? NT.clone(tv.reqs) : sc.reqs, ...(tv ? { tpl: { id: tpl.id, v: tv.v } } : {}) });
        st.save();
        NT.toast('已创建项目「新转化团队」· 筹备中');
      }
      s.dataset.state = 'done';
    }
    NT.ipState($('#nip'), 'done');
    await NT.wait(300);
    location.replace('staffing.html?project=pr-newconv&fresh=1');
  }

  function layout(main) {
    const p = st.project(projectId);
    mount(main, html`
      <header class="nt-head"><div><h1>为「${p.name}」找人</h1><p>${p.goal}</p></div><div class="nt-head__acts">${UI.pstatus(p.status)}<a class="n-btn n-btn--sm n-btn--ghost" href="project.html?id=${p.id}">项目详情</a></div></header>
      <div class="nt-split nt-split--wide">
        <div class="nt-grid">
          <article class="n-card" id="needcard"></article>
          <div><h2 class="nt-h2">候选人 <small id="cand-meta"></small></h2><div class="nt-grid" id="cands"></div></div>
          <article class="n-card" id="pending"></article>
        </div>
        <aside class="nt-grid nt-sticky" id="plan"></aside>
      </div>`);
    wire(main);
  }

  // ---------- 证据与排列 ----------
  const STATUS = { yes: ['n-badge--yes', 'check', '支持'], no: ['n-badge--no', 'x', '不支持'], unknown: ['n-badge--unknown', 'dash', '资料不足'], conflict: ['n-badge--conflict', 'split', '证据冲突'] };
  // 证据按要求声明的证据键取（ev / evAlt，默认是 id）：模板改版后旧需求卡的要求意思不同，不能套用新版的核对结果
  const evOf = (pid, r) => { const c = sc.cands[pid] || sc.manual[pid]; return (r.useAlt && c[r.evAlt || `${r.id}alt`]) || c[r.ev || r.id] || ['unknown', '资料不足']; };
  const pool = () => [...Object.keys(sc.cands), ...manual].filter((pid) => st.scope(pid) === 'full' || manual.includes(pid));
  const tally = (pid) => { const must = reqs.filter((r) => r.must).map((r) => evOf(pid, r)[0]); return { yes: must.filter((s) => s === 'yes').length, no: must.filter((s) => s === 'no').length, unk: must.filter((s) => s === 'unknown').length }; };
  function ordered() {
    const list = pool().map((pid) => ({ pid, ...tally(pid) }));
    const main = list.filter((c) => c.unk < 2 || c.yes > 0), pend = list.filter((c) => !(c.unk < 2 || c.yes > 0));
    const by = (a, b) => b.yes - a.yes || a.no - b.no || st.person(a.pid).name.localeCompare(st.person(b.pid).name, 'zh');
    return { main: main.sort(by), pend: pend.sort(by) };
  }
  function citeFor(evId) {
    const e = evId && st.event(evId);
    if (!e) return '';
    const src = e.srcs[0] || { type: 'note', label: e.title, loc: NT.md(e.date) };
    return UI.cite({ ...src, quote: src.quote || `${e.title}。${e.res || ''}` }, 1);
  }

  function needCard() {
    const p = st.project(projectId);
    const need = st.get().needs.find((n) => n.project === projectId);
    return html`<div class="nt-row" style="justify-content:space-between;margin-bottom:var(--s-2)"><h3 class="n-section-title" style="margin:0">需求卡</h3><span class="n-src n-src--ai">${icon('spark')}AI 起草 · 点要求可以改写，点「必须 / 加分」切换</span></div>
      ${need?.text ? html`<p class="nt-muted" style="margin:0 0 var(--s-3)">来自：「${need.text}」· ${st.person(need.by).name} · ${NT.md(need.at)}</p>` : ''}
      ${need?.tpl ? html`<p class="nt-row" style="margin:0 0 var(--s-3)"><span class="n-tplver">${icon('doc', 11)}模板「${st.template(need.tpl.id).name}」v${need.tpl.v}</span><span class="nt-muted">要求取自生成时的模板版本；模板以后改版，这张需求卡不变</span></p>` : ''}
      <dl class="nt-dl" style="margin-bottom:var(--s-3)"><dt>项目</dt><dd>${p.name} · ${p.status}</dd><dt>角色</dt><dd>${sc.roles.map((r) => r.name).join('、')}</dd></dl>
      <ul class="n-reqs" id="reqs">${reqs.map((r, i) => html`<li><button class="n-badge ${r.must ? '' : 'n-badge--demo'}" type="button" data-must="${i}" style="border:0;cursor:pointer" aria-label="切换为${r.must ? '加分项' : '必须项'}">${r.must ? '必须' : '加分'}</button><span>${r.alt ? html`<button class="nt-req ${r.useAlt ? 'is-alt' : ''}" type="button" data-alt="${i}" title="点一下改写">${r.useAlt ? r.alt : r.text}</button>` : r.text}</span></li>`)}</ul>
      <div class="nt-row" style="margin-top:var(--s-3)"><input class="n-input" id="reqadd" style="flex:1;min-width:12em;height:32px" placeholder="补一句要求，比如：11 月能到岗" aria-label="补一句要求"><button class="n-btn n-btn--sm" type="button" id="reqadd-go">${icon('plus')}加上</button>
        ${!reqs.some((r) => r.id === 'r3') && key === 'newconv' ? html`<button class="n-ask" type="button" data-addreq="11 月能到岗">11 月能到岗</button>` : ''}</div>
      <p class="nt-caption">资料不足不当作「不满足」。改了要求，候选人会按新的要求重新核对。</p>`;
  }
  // 就地补的要求：只有和预置证据意思一致的到岗时间（11 月到岗 / 12 月前到岗）复用 r3 的核对结果，
  // 其他要求（含「到岗后必须全职」这类）一律先按资料不足核对，不凭关键词共享证据
  function addReq(text) {
    const t = text.trim(); if (!t || reqs.some((r) => r.text === t)) return;
    const m = t.replace(/\s/g, '').match(/^(11|12)月(前|之前|内)?(?:能|可以)?到岗$/);
    const known = m && key === 'newconv' && !reqs.some((x) => x.id === 'r3');
    const r = known && m[1] === '11' && !m[2] ? { id: 'r3', text: '11 月能到岗', must: true, alt: '12 月前能到岗', useAlt: false }
      : known && m[1] === '12' && m[2] ? { id: 'r3', text: '12 月前能到岗', must: true, ev: 'r3alt', useAlt: false }
        : { id: NT.uid('c'), text: t, must: true, useAlt: false };
    insertReq(r);
    if (need0) { need0.reqs = reqs.map(({ useAlt, ...x }) => x); st.save(); }
    drawAll(r.id);
    NT.toast(`已加上「${t}」，候选人按新的要求重新核对`);
  }

  function candCard(pid) {
    const p = st.person(pid), c = sc.cands[pid] || sc.manual[pid];
    const isManual = manual.includes(pid);
    const inSlot = Object.values(slots).includes(pid);
    const projs = st.projectsOf(pid).length;
    const scores = (c.dims || []).map((d) => { const l = st.scoresOf(pid, { dim: d, from: NT.addDays(NT.TODAY, -365), visible: true }); return l.length ? `${st.dim(d).name} ${st.mean(l.map((s) => s.v)).toFixed(1)}（${l.length} 条）` : `${st.dim(d).name}资料不足`; });
    return html`<article class="n-card n-candidate" draggable="true" data-pid="${pid}" aria-describedby="drag-tip">
      <div class="nt-row" style="justify-content:space-between;align-items:flex-start">${UI.person(pid, { meta: `${st.orgShort(p.org)} · ${p.level} · 当前在 ${projs} 个项目` })}${inSlot ? html`<span class="n-badge n-badge--yes">${icon('check')}已放入方案</span>` : ''}</div>
      ${isManual ? html`<div class="nt-row" style="margin-top:var(--s-2)"><span class="n-manual">${icon('user', 11)}${st.me().name}手动补入</span><span class="nt-muted">不冒充模型推荐；要求逐项照样核对</span></div>` : ''}
      <ul class="n-reqs">${reqs.map((r) => { const [s, t, ev] = evOf(pid, r); const [cls, ic, l] = STATUS[s]; return html`<li data-req="${r.id}" data-s="${s}"><span class="n-badge ${cls}">${icon(ic)}${l}</span><span>${t}${citeFor(ev)}${r.must ? '' : html` <span class="nt-muted">（加分项）</span>`}</span></li>`; })}</ul>
      ${st.scope(pid) === 'full' ? html`<div class="nt-muted" style="margin-top:var(--s-2)">相关维度 · ${scores.join(' · ')}</div>` : ''}
      <div style="margin-top:var(--s-2)">${UI.directionLine(pid)}</div>
      <dl class="n-cmeta"><dt>本人意愿</dt><dd class="${c.will[1] ? 'unknown' : ''}">${c.will[0]}</dd><dt>可否释放</dt><dd>${c.release}</dd><dt>当前安排</dt><dd>${c.now}</dd><dt>下一步</dt><dd>${c.next}</dd></dl>
      <div class="nt-row" style="margin-top:var(--s-3)">${sc.roles.map((ro) => html`<button class="n-btn n-btn--sm" type="button" data-put="${pid}" data-role="${ro.id}" ${NT.raw(inSlot ? 'disabled' : '')}>放入「${ro.name}」</button>`)}<a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${pid}">看档案</a></div>
    </article>`;
  }

  function planPanel() {
    const plans = st.get().plans.filter((p) => p.project === projectId);
    const conf = plans.filter((p) => p.status === 'confirmed').pop();
    const draft = plans.find((p) => p.status === 'draft');
    const ver = draft ? draft.version : (conf ? conf.version + 1 : 1);
    const changed = sc.roles.filter((r) => (conf?.slots?.[r.id] || null) !== (slots[r.id] || null));
    const gaps = (pid) => reqs.filter((r) => r.must).map((r) => [r, evOf(pid, r)]).filter(([, e]) => e[0] !== 'yes');
    const canConfirm = st.can('confirmPlan');
    const frozenNow = conf && !changed.length && !draft;
    return html`<article class="n-card"><h3 class="n-section-title">项目用人方案</h3>
      <div class="nt-grid" style="gap:var(--s-2)">${sc.roles.map((r) => {
        const pid = slots[r.id];
        if (!pid) return html`<div class="n-slot" data-slot="${r.id}" aria-live="polite"><span class="n-slot__empty">${icon('plus', 14)}</span><div><div class="n-slot__role">角色</div><b>${r.name}</b><div class="nt-muted">把候选人拖到这里</div></div></div>`;
        const g = gaps(pid);
        return html`<div class="n-slot is-filled" data-slot="${r.id}">${UI.avatar(pid)}<div><div class="n-slot__role">${r.name}</div><b>${st.person(pid).name}</b>${frozenNow ? '' : html` <button class="nt-linkbtn" type="button" data-clear="${r.id}">移出</button>`}</div>
          ${g.length ? html`<div class="n-slot__gap">${g.map(([rq, e]) => html`<span class="n-badge ${STATUS[e[0]][0]}">${icon(STATUS[e[0]][1])}${rq.useAlt ? rq.alt : rq.text}</span>`)}</div>` : html`<div class="n-slot__gap"><span class="n-badge n-badge--yes">${icon('check')}必须项都有证据</span></div>`}</div>`;
      })}</div>
      ${draft || changed.length ? html`<div class="n-version" style="margin-top:var(--s-3)"><span class="n-version__tag is-draft">草稿 v${ver}</span><span style="color:var(--ink-3)">${conf ? `基于 v${conf.version} · 改了 ${changed.length} 处` : '第一版'}</span>
        ${changed.length ? html`<span class="n-diff" style="flex-basis:100%">${changed.map((r) => html`${r.name}：${conf?.slots?.[r.id] ? html`<del>${st.person(conf.slots[r.id]).name}</del> ` : html`<del>待定</del> `}${slots[r.id] ? html`<ins>${st.person(slots[r.id]).name}${draft?.slotNote?.[r.id] ? `（${draft.slotNote[r.id]}）` : ''}</ins>` : html`<ins>待定</ins>`}。`)}</span>` : ''}</div>` : ''}
      ${plans.filter((p) => p.status !== 'draft').slice().reverse().map((p) => html`<div class="n-version" style="margin-top:6px"><span class="n-version__tag ${p.status === 'confirmed' ? 'is-frozen' : ''}">v${p.version} ${p.status === 'confirmed' ? '已确认' : '已被替代'}</span><span style="color:var(--ink-3)">${st.person(p.confirmedBy || p.by).name} · ${NT.md(p.confirmedAt || p.at)}${p.status === 'confirmed' ? ' · 快照已冻结' : ''}</span>${p.status === 'confirmed' ? html`<span class="n-seal n-seal--sm" style="margin-left:auto">定</span>` : ''}</div>`)}
      ${frozenNow ? html`<p class="nt-caption">当前方案已确认。想调整时，把候选人拖进槽位，会自动开一版新草稿。</p>` : html`
        <div class="nt-row" style="margin-top:var(--s-4)">
          <button class="n-btn n-btn--ink" type="button" id="confirm">${icon('stamp')}确认 v${ver}</button>
          <button class="n-btn n-btn--ghost" type="button" id="savedraft">保存草稿</button>
        </div>
        ${canConfirm ? html`<p class="nt-caption">确认后冻结快照，owner 和成员写入项目；确认方案不等于人事动作已执行，后续以行动跟踪。</p>` : ''}
        <div id="deny"></div>`}
    </article>
    <article class="n-card"><h3 class="n-section-title" style="font-size:var(--t-sm)">手动补入</h3>
      <div class="nt-row"><select class="n-select" id="manual" style="flex:1"><option value="">选一个不在候选里的人</option>${Object.keys(sc.manual).filter((x) => !manual.includes(x)).map((x) => html`<option value="${x}">${st.person(x).name} · ${st.orgShort(st.person(x).org)}</option>`)}${st.visiblePeople().filter((x) => st.scope(x.id) === 'full' && !sc.cands[x.id] && !sc.manual[x.id]).slice(0, 6).map((x) => html`<option value="" disabled>${x.name} · 没有可核对的证据</option>`)}</select><button class="n-btn n-btn--sm" type="button" id="addmanual">补入</button></div>
      <p class="nt-caption" id="drag-tip">候选卡可以直接拖到上面的槽位，也可以用卡片上的按钮放入。</p></article>`;
  }

  function drawAll(changedReq) {
    if (!$('#needcard')) return;
    mount($('#needcard'), needCard());
    const { main, pend } = ordered();
    const host = $('#cands');
    const old = $$('.n-candidate', host);
    const render = () => {
      mount(host, main.length ? main.map((c) => candCard(c.pid)) : UI.state({ ip: 'confirm', title: '没有找到合适的人选', text: '可以先补材料，或者放宽一项要求。' }));
      mount($('#pending'), html`<h4 class="n-section-title" style="font-size:var(--t-sm)">条件待确认 · ${pend.length} 人</h4>${pend.length ? html`<ul class="n-pending">${pend.map((c) => html`<li>${UI.avatar(c.pid, 'sm')}${UI.plink(c.pid)}<small>${reqs.filter((r) => r.must && evOf(c.pid, r)[0] === 'unknown').map((r) => (r.useAlt ? r.alt : r.text)).join('、')}资料不足</small></li>`)}</ul>` : html`<p class="nt-muted" style="margin:0">没有。</p>`}<p class="nt-caption">资料还缺的人放在这里，不当作「不满足」。进入正式方案前再核对关键条件。</p>`);
    };
    if (old.length && changedReq) {
      // 需求即时重排：记住旧位置，重画后做位置过渡，变化的证据高亮
      const prev = new Map(old.map((el) => [el.dataset.pid, el.getBoundingClientRect().top]));
      const prevS = new Map(old.map((el) => [el.dataset.pid, $(`[data-req="${changedReq}"]`, el)?.dataset.s]));
      render();
      $$('.n-candidate', host).forEach((el) => {
        const top = prev.get(el.dataset.pid);
        if (top != null) { const dy = top - el.getBoundingClientRect().top; if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: NT.reduced ? 1 : 460, easing: 'cubic-bezier(.65,0,.35,1)' }); }
        const li = $(`[data-req="${changedReq}"]`, el);
        if (li && prevS.get(el.dataset.pid) !== li.dataset.s) li.classList.add('nt-changed');
      });
    } else render();
    $('#cand-meta').textContent = `检索你有权限查看的 ${sc.pool || st.visiblePeople().length} 人 · ${main.length} 人进入候选 · 按必须项的证据排列，不按分数，也不按发展方向排序`;
    mount($('#plan'), planPanel());
    UI.mountIPs($('#main'));
  }

  function put(pid, role) {
    Object.keys(slots).forEach((k) => { if (slots[k] === pid) slots[k] = null; });
    slots[role] = pid;
    drawAll();
    const slot = $(`[data-slot="${role}"]`);
    slot?.animate([{ transform: 'scale(1.03)' }, { transform: 'none' }], { duration: NT.reduced ? 1 : 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  function wire(main) {
    main.onclick = async (e) => {
      const must = e.target.closest('[data-must]'), alt = e.target.closest('[data-alt]');
      if (must) { const r = reqs[+must.dataset.must]; r.must = !r.must; drawAll(r.id); return; }
      if (alt) { const r = reqs[+alt.dataset.alt]; r.useAlt = !r.useAlt; drawAll(r.id); NT.toast(`要求改为「${r.useAlt ? r.alt : r.text}」，候选人已重新核对`); return; }
      const ar = e.target.closest('[data-addreq]'); if (ar) { addReq(ar.dataset.addreq); return; }
      if (e.target.closest('#reqadd-go')) { addReq($('#reqadd').value); return; }
      const b = e.target.closest('[data-put]'); if (b) { put(b.dataset.put, b.dataset.role); return; }
      const c = e.target.closest('[data-clear]'); if (c) { slots[c.dataset.clear] = null; drawAll(); return; }
      if (e.target.closest('#addmanual')) { const v = $('#manual').value; if (v) { manual.push(v); drawAll(); NT.toast(`已补入${st.person(v).name}，标为手动补入`); } return; }
      if (e.target.closest('#savedraft')) { saveDraft(); NT.toast('草稿已保存'); drawAll(); return; }
      if (e.target.closest('#confirm')) confirmPlan();
    };
    main.addEventListener('keydown', (e) => { if (e.target.id === 'reqadd' && e.key === 'Enter') { e.preventDefault(); addReq(e.target.value); } });
    main.addEventListener('dragstart', (e) => { const c = e.target.closest('.n-candidate'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.pid); e.dataTransfer.effectAllowed = 'move'; c.style.opacity = '.5'; });
    main.addEventListener('dragend', (e) => { const c = e.target.closest('.n-candidate'); if (c) c.style.opacity = ''; $$('.n-slot.is-over').forEach((s) => s.classList.remove('is-over')); });
    main.addEventListener('dragover', (e) => { const s = e.target.closest('[data-slot]'); if (!s) return; e.preventDefault(); $$('.n-slot.is-over').forEach((x) => x !== s && x.classList.remove('is-over')); s.classList.add('is-over'); });
    main.addEventListener('dragleave', (e) => { const s = e.target.closest('[data-slot]'); if (s && !s.contains(e.relatedTarget)) s.classList.remove('is-over'); });
    main.addEventListener('drop', (e) => { const s = e.target.closest('[data-slot]'); if (!s) return; e.preventDefault(); const pid = e.dataTransfer.getData('text/plain'); if (pid) put(pid, s.dataset.slot); });
  }

  function saveDraft() {
    const S = st.get();
    let d = S.plans.find((p) => p.project === projectId && p.status === 'draft');
    const conf = S.plans.filter((p) => p.project === projectId && p.status === 'confirmed').pop();
    if (!d) { d = { id: NT.uid('sp'), kind: 'staffing', project: projectId, version: conf ? conf.version + 1 : 1, status: 'draft', by: st.me().id, at: NT.TODAY, slots: {}, note }; S.plans.push(d); }
    // 连同当时用于选人的要求一起保存，确认后的版本能重现选人条件
    d.slots = { ...slots }; d.by = st.me().id; d.at = NT.TODAY;
    d.reqs = reqs.map((r) => ({ id: r.id, text: r.useAlt ? r.alt : r.text, must: r.must, useAlt: r.useAlt }));
    st.save();
    return d;
  }

  async function confirmPlan() {
    const empty = sc.roles.filter((r) => !slots[r.id]);
    if (sc.roles[0] && !slots[sc.roles[0].id]) { NT.toast(`「${sc.roles[0].name}」还空着`); $(`[data-slot="${sc.roles[0].id}"]`)?.classList.add('nt-flash'); return; }
    if (!st.can('confirmPlan')) {
      saveDraft();
      mount($('#deny'), html`<div class="n-notice is-deny" style="margin-top:var(--s-3)">${icon('lock')}<div><b>你没有确认方案的权限。</b>部门负责人可以起草和提出修改；确认需要 CEO 或指定的 HRBP。草稿已保存。<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" id="askceo">请程远确认</button></div></div></div>`);
      $('#askceo').onclick = () => { NT.toast('已发给程远确认，会出现在他的待办里'); $('#deny').innerHTML = ''; };
      return;
    }
    const p = st.project(projectId);
    const d = saveDraft();
    const v = await NT.dialog({
      title: `确认「${p.name}」用人方案 v${d.version}？`,
      body: html`<p>确认后冻结快照，之后的修改自动进入新草稿。确认方案不等于人事动作已经执行，接下来以行动跟踪。</p>`,
      facts: [...sc.roles.map((r) => html`${r.name}：<b>${slots[r.id] ? st.person(slots[r.id]).name : '待定'}</b>`), empty.length ? html`<span style="color:var(--conflict)">${empty.map((r) => r.name).join('、')}还空着，之后可以再补</span>` : html`写入项目成员，生成跟进行动`],
      actions: [{ label: '再看看', value: 'cancel', cls: 'n-btn--ghost' }, { label: `确认并冻结 v${d.version}`, value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }],
    });
    if (v !== 'ok') return;
    st.confirmStaffing(d, sc.roles);
    drawAll();
    const seal = $('#plan .n-seal'); seal?.classList.add('is-stamping');
    NT.toast(`已确认 v${d.version} 并冻结。${slots.owner ? `${st.person(slots.owner).name}写入项目 owner` : ''}，后续行动进入行动列表`);
  }
})();
