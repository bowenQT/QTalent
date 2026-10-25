/* 找人活文档：一句话 → 建项目、生成需求卡 → 候选人逐项核对证据 → 拖进方案的角色槽位 → 确认后写入项目成员。
   候选卡逐项列出要求和证据状态，不出现总分；列表按「必须项支持了几条」排列，不按分数排序。「未知」和「不满足」分开。
   结果是脚本化的 mock：预置，但按真实节奏出现。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;

  // ---------- 预置的场景 ----------
  const KEPT = NT.XE6.students.filter((s) => s.accept === '接受').length;
  const SCEN = {
    newconv: {
      project: { id: 'pr-newconv', name: '语音硬件 · 端云联调', type: '用人项目', org: 'xe6', status: '筹备中', from: '2026-10-08', to: '2027-03-31', goal: '把语音硬件的端侧唤醒、实时语音链路和服务端编排串起来，年底前给第一批客户试用。' },
      say: '语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗', pool: KEPT,
      roles: [{ id: 'owner', name: '项目 owner' }],
      reqs: [
        { id: 'r1', text: '独立负责过一个服务端模块', must: true, alt: '参与过服务端核心模块开发' },
        { id: 'r2', text: '做过实时语音链路', must: true, alt: '做过语音或多模态相关开发' },
        { id: 'r3', text: '10 月能到岗', must: true, alt: '11 月前能到岗' },
        { id: 'r4', text: '写过测试并让 CI 稳定通过', must: false },
      ],
      cands: {
        'p-x53': { r1: ['yes', '负责核心语音模块：切分、网络传输和打断', 'e-x53-2'], r1alt: ['yes', '负责核心语音模块', 'e-x53-2'], r2: ['yes', 'WebRTC 落地前做了多方案调研，负责 Live Demo 的语音接口', 'e-x53-1'], r2alt: ['yes', '课题里负责语音模块', 'e-x53-3'], r3: ['yes', '10-12 回来，可以直接进项目', null], r3alt: ['yes', '10-12 回来', null], r4: ['unknown', '没有测试或 CI 相关事件'],
          will: ['未知 · 结营去向灵矽，对这个项目还没问', true], release: '不涉及', now: '结营后待回来', next: '回来前确认意愿', dims: ['prof', 'wis'] },
        'p-x07': { r1: ['yes', '独立完成服务端主流程 MVP，是核心框架的主要搭建者', 'e-x07-2'], r1alt: ['yes', '服务端主流程 MVP', 'e-x07-2'], r2: ['unknown', '没有实时语音链路的事件'], r2alt: ['yes', '口语陪练课题里负责服务端主流程', 'e-x07-2'], r3: ['unknown', '到岗时间还没确认'], r3alt: ['unknown', '到岗时间还没确认'], r4: ['unknown', '资料不足'],
          will: ['未知 · 结营去向灵矽，对这个项目还没问', true], release: '不涉及', now: '—', next: '确认到岗时间', dims: ['prof', 'wis'] },
        'p-x14': { r1: ['yes', '主导 Java 状态机模块的方案设计与落地', 'e-x14-2'], r1alt: ['yes', 'Java 状态机模块', 'e-x14-2'], r2: ['unknown', '没有语音相关事件'], r2alt: ['unknown', '没有语音或多模态相关事件'], r3: ['yes', '实习 offer 已接受，去向灵矽', null], r3alt: ['yes', '已接受实习', null], r4: ['unknown', '资料不足'],
          will: ['未知 · 还没问过', true], release: '实习期内', now: '—', next: '先补语音方向的证据', dims: ['prof', 'wis'] },
        'p-x80': { r1: ['no', '负责前端 MVP 开发，没有服务端模块'], r1alt: ['unknown', '没有服务端开发的事件'], r2: ['yes', '引入 ASR、LLM、TTS 组合，降低实时模型成本', 'e-x80-3'], r2alt: ['yes', '引入 ASR 和 TTS', 'e-x80-3'], r3: ['no', '12-01 才能回来'], r3alt: ['no', '12-01 才能回来'], r4: ['unknown', '资料不足'],
          will: ['未知', true], release: '结营去向 MaaS', now: '—', next: '—', dims: ['prof'] },
      },
      manual: { 'p-x28': { r1: ['yes', '完成 ModuleContent v1、JSON Schema 和规则引擎流程', 'e-x28-2'], r1alt: ['yes', '规则引擎流程', 'e-x28-2'], r2: ['unknown', '没有语音相关事件'], r2alt: ['unknown', '没有语音相关事件'], r3: ['no', '12-01 才能回来'], r3alt: ['no', '12-01 才能回来'], r4: ['unknown', '资料不足'], will: ['未知', true], release: '结营去向 Kodo', now: '—', next: '和 Kodo 确认能否兼顾', dims: ['prof', 'wis'] } },
    },
    gray: {
      project: { id: 'pr-agent' }, say: '智能体平台应用后端要找一个 owner', pool: 0,
      roles: [{ id: 'owner', name: '项目 owner' }],
      reqs: [
        { id: 'r1', text: '做过 Agent 或 MCP 工具链开发', must: true, alt: '做过 AI 应用接入' },
        { id: 'r2', text: '负责过服务端核心模块', must: true },
        { id: 'r3', text: '能投入 50% 以上', must: true, alt: '能投入 30% 以上' },
      ],
      cands: {
        'p-x36': { r1: ['yes', '完成知识库模块和 Knowledge MCP 开发', 'e-x36-2'], r1alt: ['yes', 'Knowledge MCP', 'e-x36-2'], r2: ['yes', '完成 Server 向 Knowledge Server 的收敛', 'e-x36-3'], r3: ['unknown', '结营去向 LAS，能投入多少未知'], r3alt: ['unknown', '能投入多少未知'],
          will: ['未知 · 还没问过', true], release: '未知 · 待和 LAS 确认', now: '—', next: '和 LAS 确认能否兼顾', dims: ['prof', 'wis'] },
        'p-x16': { r1: ['yes', '重构 Agent 工具体系，提高 RCA 准确率', 'e-x16-2'], r1alt: ['yes', 'Agent 工具体系', 'e-x16-2'], r2: ['yes', '经验注入改为按告警分桶，线上相关经验从 0 份到 3 份以上', 'e-x16-3'], r3: ['yes', '结营去向 MaaS，本部门项目', null], r3alt: ['yes', '本部门项目', null],
          will: ['未知 · 还没问过', true], release: '不涉及', now: '—', next: '和本人确认意愿', dims: ['prof', 'wis'] },
        'p-x60': { r1: ['yes', '完成 Knowledge MCP 客户端接入和 fetch MCP 服务部署', 'e-x60-3'], r1alt: ['yes', 'MCP 客户端接入', 'e-x60-3'], r2: ['yes', '实现后端骨架代码和审计', 'e-x60-2'], r3: ['no', '已在 TS 新人组全职'], r3alt: ['no', 'TS 新人组全职'],
          will: ['未知', true], release: 'TS 新人组在岗，先和组里确认', now: 'TS 新人组', next: '—', dims: ['prof'] },
        'p-x52': { r1: ['unknown', '没有 Agent 工具链的事件'], r1alt: ['yes', '调研产品对接灵矽，接入企业微信等入口', 'e-x52-2'], r2: ['yes', '负责用户系统', 'e-x52-2'], r3: ['yes', '结营去向 MaaS', null], r3alt: ['yes', '结营去向 MaaS', null],
          will: ['未知', true], release: '不涉及', now: '—', next: '和林一诺一起聊', dims: ['lead', 'prof'] },
      },
      manual: {},
    },
    search: {
      project: { id: 'pr-ts' }, say: 'TS 新人组还缺一个懂测试和部署、能带大家对齐节奏的人', pool: KEPT,
      roles: [{ id: 'owner', name: '新人组牵头人' }],
      reqs: [
        { id: 'r1', text: '在训练营里担任过组长或牵头过分工', must: true, alt: '在组里主动推动过协作' },
        { id: 'r2', text: '做过测试、部署或排障相关的工作', must: true },
        { id: 'r3', text: '已接受留用', must: true },
      ],
      cands: {
        'p-x47': { r1: ['yes', '担任组长，建立 GitHub 协作规范', 'e-x47-1'], r2: ['yes', '负责合并全组代码和质量把控', 'e-x47-3'], r3: ['yes', '已接受，去向 TS', null], will: ['已沟通 · 接受', false], release: '不涉及', now: 'TS 新人组牵头人', next: '—', dims: ['lead', 'prof'] },
        'p-x60': { r1: ['unknown', '没有牵头分工的事件'], r1alt: ['yes', '轮值站会里主动发起问题讨论并记录', 'e-x60-1'], r2: ['yes', '完成 URL 安全校验和 fetch MCP 服务部署', 'e-x60-3'], r3: ['yes', '已接受，去向 TS', null], will: ['未知', true], release: '不涉及', now: 'TS 新人组', next: '—', dims: ['mot', 'prof'] },
        'p-x19': { r1: ['unknown', '没有牵头分工的事件'], r1alt: ['unknown', '没有相关事件'], r2: ['yes', '完成直播告警排查，补了 Runbook 调查', 'e-x19-2'], r3: ['yes', '已接受，去向 TS', null], will: ['未知', true], release: '不涉及', now: 'TS 新人组', next: '—', dims: ['prof'] },
        'p-x08': { r1: ['unknown', '在组里是协作支撑角色，没有牵头的事件'], r1alt: ['unknown', '没有相关事件'], r2: ['yes', '完成 CI 功能开发，提升整体覆盖率', 'e-x08-3'], r3: ['yes', '已接受，去向 TS', null], will: ['未知', true], release: '不涉及', now: 'TS 新人组', next: '—', dims: ['prof'] },
      },
      manual: {},
    },
  };

  // 演示数据只准备了后端研发和技术支持两个模板的候选人
  const TPL_SAY = { 'tpl-be': '语音硬件端云联调要一个独立负责过服务端模块的 owner', 'tpl-ts': SCEN.search.say };
  const TPL_SCEN = { 'tpl-be': 'newconv', 'tpl-ts': 'search' };
  // 一句话落到哪个预置场景：智能体 → 平台应用后端；TS / 新人组 → 业务成功部新人组；其余 → 语音硬件
  const sceneOf = (text) => (/智能体|Agent|MCP/i.test(text) ? 'gray' : /\bTS\b|技术支持|新人组/.test(text) ? 'search' : 'newconv');

  // ---------- 状态 ----------
  const isNew = !!NT.param('new');
  let projectId = NT.param('project');
  let key = projectId === 'pr-ts' ? 'search' : projectId === 'pr-agent' ? 'gray' : projectId === 'pr-newconv' ? 'newconv' : null;
  const q = NT.param('q') || '';
  // 目标角色模板（v1.3 3.15.2）：后端研发、技术支持各预置了一个场景
  const tplId = NT.param('tpl'), tpl = tplId && st.template(tplId);
  if (isNew) key = tpl ? TPL_SCEN[tpl.id] || null : q.trim() ? sceneOf(q) : null;
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
    denyText: '找 owner 和项目找人只对管理者和 HR 开放。',
    view: () => `找人 · ${projectId ? st.project(projectId)?.name : '新项目'} · 方案 ${Object.values(slots).filter(Boolean).length} 个槽位已填`,
    state: () => ({ reqs: reqs.map((r) => [r.must, r.useAlt]), slots }),
    restore: (s) => { if (s.reqs) s.reqs.forEach(([m, a], i) => { if (reqs[i]) { reqs[i].must = m; reqs[i].useAlt = a; } }); if (s.slots) slots = s.slots; drawAll(); },
    render,
  });

  function render(main) {
    if (!isNew && projectId && !st.project(projectId)) return mount(main, UI.state({ ip: 'confirm', title: '项目链接失效', text: '可能已删除，或链接有误。回到项目列表重新进入。', actions: html`<a class="n-btn n-btn--sm" href="projects.html">回到项目列表</a><a class="n-btn n-btn--sm n-btn--ghost" href="staffing.html">为新项目找人</a>` }));
    if (!sc) {
      const T = st.templates(), tv = tpl && st.tplVersion(tpl);
      mount(main, html`<header class="nt-head"><div><h1>为一个项目或关键岗位找人</h1><p>说一句要做什么、要什么样的人，或者从目标角色模板开始。</p></div></header>
        <div class="n-tpls" role="group" aria-label="目标角色模板" style="margin-bottom:var(--s-4)">${T.map((t) => html`<a class="n-tpl" href="staffing.html?tpl=${t.id}" aria-pressed="${t.id === tplId}">${UI.tplTitle(t)}<small>v${st.tplVersion(t).v}</small></a>`)}</div>
        ${tpl ? html`<article class="n-card" style="max-width:720px;margin-bottom:var(--s-4)">
          <div class="nt-row" style="justify-content:space-between"><h3 class="n-section-title" style="margin:0">目标角色模板 · ${tpl.name}</h3><span class="n-tplver">v${tv.v} · ${st.person(tv.by).name} ${NT.md(tv.at)} 更新</span></div>
          <dl class="nt-dl" style="margin-top:var(--s-3)"><dt>对应通道</dt><dd>${st.channel(tpl.ch).name}</dd><dt>典型职责</dt><dd>${tpl.duties}</dd><dt>相关维度</dt><dd>${tpl.dims.map((d) => st.dim(d).name).join('、')}</dd></dl>
          <ul class="n-reqs">${tv.reqs.map((r) => html`<li><span class="n-badge ${r.must ? '' : 'n-badge--demo'}">${r.must ? '必须' : '加分'}</span><span>${r.text}${r.alt ? html` <span class="nt-muted">（可放宽为「${r.alt}」）</span>` : ''}</span></li>`)}</ul>
          ${tv.note ? html`<p class="nt-caption">v${tv.v} 的改动：${tv.note}。之前生成的需求卡保留当时的版本。</p>` : ''}
          ${TPL_SCEN[tpl.id] ? '' : html`<div class="n-notice is-plain" id="demo-note" style="margin-top:var(--s-3)">${icon('info')}<div>${UI.demo()} 候选人只准备了后端研发和技术支持两个模板，其他模板可以先看上面的要求。<div class="nt-row" style="margin-top:var(--s-2)"><a class="n-btn n-btn--sm" href="staffing.html?tpl=tpl-be">用后端研发走一遍</a><a class="n-btn n-btn--sm" href="staffing.html?tpl=tpl-ts">用技术支持走一遍</a></div></div></div>`}
        </article>` : ''}
        <div class="n-composer" style="max-width:720px"><span class="nt-ip" data-ip="rest" data-size="36"></span><textarea class="n-composer__field" id="sq" rows="2" aria-label="描述项目和要找的人" placeholder="${tpl ? (TPL_SAY[tpl.id] ? `比如：${TPL_SAY[tpl.id]}` : '比如：说一句要做什么、要什么样的人') : "比如：语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗"}"></textarea>
          <div class="n-composer__bar"><span class="spacer"></span><button class="n-btn n-btn--ink n-btn--icon" type="button" id="sgo" aria-label="开始">${icon('up')}</button></div></div>
        <div class="n-asks" style="margin-top:var(--s-3)">${(tpl ? (TPL_SAY[tpl.id] ? [TPL_SAY[tpl.id]] : []) : [SCEN.newconv.say, SCEN.gray.say, SCEN.search.say]).map((s) => html`<button class="n-ask" type="button" data-say="${s}">${s}</button>`)}</div>`);
      main.onclick = (e) => {
        const b = e.target.closest('[data-say]'); if (b) $('#sq').value = b.dataset.say;
        if (!e.target.closest('#sgo') || !$('#sq').value.trim()) return;
        if (tpl && !TPL_SCEN[tpl.id]) { const note = $('#demo-note'); note?.scrollIntoView({ block: 'center', behavior: NT.reduced ? 'auto' : 'smooth' }); note?.classList.add('nt-flash'); $('a', note)?.focus({ preventScroll: true }); return; }
        location.href = NT.link('staffing.html', { new: 1, q: $('#sq').value.trim(), ...(tpl ? { tpl: tpl.id } : {}) });
      };
      return;
    }
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
    mount(main, html`<header class="nt-head"><div><h1>${tpl ? UI.tplTitle(tpl) : '为一个项目找人'}</h1><p>${q || sc.say}</p></div></header>
      <div class="n-composer" style="max-width:720px;margin-bottom:var(--s-4)"><span class="nt-ip" data-ip="searching" data-size="36" id="nip"></span><div class="n-composer__field" style="min-height:0">${q || sc.say}</div></div>
      <div class="n-card" style="max-width:720px">${UI.trail(`为「${sc.project.name}」找 owner · 5 步`, [`理解需求，建项目「${sc.project.name}」（筹备中）`, tv ? `按模板「${tpl.name}」v${tv.v} 生成 ${tv.reqs.length} 项要求` : '拆出 4 项要求', `检索你有权限查看的 ${sc.pool} 人`, '逐项核对证据', '生成候选与缺口'])}</div>`);
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
        NT.toast(`已创建项目「${sc.project.name}」· 筹备中`);
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
  // 不在预置候选里的人：没有预先核对的证据，各项要求先记为资料不足，等负责人补证据
  const BLANK = { will: ['未知 · 还没问过', true], release: '未知', now: '—', next: '逐项补证据，再和本人确认意愿', dims: [] };
  const candOf = (pid) => sc.cands[pid] || sc.manual[pid] || BLANK;
  const evOf = (pid, r) => { const c = candOf(pid); return (r.useAlt && c[r.evAlt || `${r.id}alt`]) || c[r.ev || r.id] || ['unknown', c === BLANK ? '还没有核对到相关事件，需要补证据' : '资料不足']; };
  const pool = () => [...Object.keys(sc.cands), ...manual].filter((pid) => st.scope(pid) === 'full' || manual.includes(pid));
  const tally = (pid) => { const must = reqs.filter((r) => r.must).map((r) => evOf(pid, r)[0]); return { yes: must.filter((s) => s === 'yes').length, no: must.filter((s) => s === 'no').length, unk: must.filter((s) => s === 'unknown').length }; };
  function ordered() {
    const list = pool().map((pid) => ({ pid, ...tally(pid) }));
    // 手动补入的人是负责人有意带进来的，始终给完整候选卡，逐项照样显示核对结果；资料不足的模型候选才收进「条件待确认」
    const full = (c) => c.unk < 2 || c.yes > 0 || manual.includes(c.pid);
    const main = list.filter(full), pend = list.filter((c) => !full(c));
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
      <div class="nt-row" style="margin-top:var(--s-3)"><input class="n-input" id="reqadd" style="flex:1;min-width:12em;height:32px" placeholder="补一句要求，比如：10 月能到岗" aria-label="补一句要求"><button class="n-btn n-btn--sm" type="button" id="reqadd-go">${icon('plus')}加上</button>
        ${!reqs.some((r) => r.id === 'r3') && key === 'newconv' ? html`<button class="n-ask" type="button" data-addreq="10 月能到岗">10 月能到岗</button>` : ''}</div>
      <p class="nt-caption">改了要求，候选人会按新要求重新核对。</p>`;
  }
  // 就地补的要求：只有和预置证据意思一致的到岗时间（10 月到岗 / 11 月前到岗）复用 r3 的核对结果，
  // 其他要求（含「到岗后必须全职」这类）一律先按资料不足核对，不凭关键词共享证据
  function addReq(text) {
    const t = text.trim(); if (!t || reqs.some((r) => r.text === t)) return;
    const m = t.replace(/\s/g, '').match(/^(10|11)月(前|之前|内)?(?:能|可以)?到岗$/);
    const known = m && key === 'newconv' && !reqs.some((x) => x.id === 'r3');
    const r = known && m[1] === '10' && !m[2] ? { id: 'r3', text: '10 月能到岗', must: true, alt: '11 月前能到岗', useAlt: false }
      : known && m[1] === '11' && m[2] ? { id: 'r3', text: '11 月前能到岗', must: true, ev: 'r3alt', useAlt: false }
        : { id: NT.uid('c'), text: t, must: true, useAlt: false };
    insertReq(r);
    if (need0) { need0.reqs = reqs.map(({ useAlt, ...x }) => x); st.save(); }
    drawAll(r.id);
    NT.toast(`已加上「${t}」，候选人按新的要求重新核对`);
  }

  function candCard(pid) {
    const p = st.person(pid), c = candOf(pid);
    const isManual = manual.includes(pid);
    const inSlot = Object.values(slots).includes(pid);
    const projs = st.projectsOf(pid).length;
    const scores = (c.dims || []).map((d) => { const l = st.scoresOf(pid, { dim: d, from: NT.addDays(NT.TODAY, -365), visible: true }); return l.length ? `${st.dim(d).name} ${st.mean(l.map((s) => s.v)).toFixed(1)}（${l.length} 条）` : `${st.dim(d).name}资料不足`; });
    return html`<article class="n-card n-candidate" draggable="true" data-pid="${pid}" aria-describedby="drag-tip">
      <div class="nt-row" style="justify-content:space-between;align-items:flex-start">${UI.person(pid, { meta: `${st.orgShort(p.org)} · ${p.level} · 当前在 ${projs} 个项目` })}${inSlot ? html`<span class="n-badge n-badge--yes">${icon('check')}已放入方案</span>` : ''}</div>
      ${isManual ? html`<div class="nt-row" style="margin-top:var(--s-2)"><span class="n-manual">${icon('user', 11)}${st.me().name}手动补入</span><span class="nt-muted">不冒充模型推荐；要求逐项照样核对</span></div>` : ''}
      <ul class="n-reqs">${reqs.map((r) => { const [s, t, ev] = evOf(pid, r); const [cls, ic, l] = STATUS[s]; return html`<li data-req="${r.id}" data-s="${s}"><span class="n-badge ${cls}">${icon(ic)}${l}</span><span>${t}${citeFor(ev)}${r.must ? '' : html` <span class="nt-muted">（加分项）</span>`}</span></li>`; })}</ul>
      ${st.scope(pid) === 'full' && scores.length ? html`<div class="nt-muted" style="margin-top:var(--s-2)">相关维度 · ${scores.join(' · ')}</div>` : ''}
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
        return html`<div class="n-slot is-filled" data-slot="${r.id}">${UI.avatar(pid)}<div><div class="n-slot__role">${r.name}</div><b>${st.person(pid).name}</b>${frozenNow ? '' : html` <button class="n-link" type="button" data-clear="${r.id}">移出</button>`}</div>
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
        ${canConfirm ? html`<p class="nt-caption">确认后冻结快照，owner 和成员写入项目，并生成跟进行动，执行情况在「人才项目复盘」里跟踪。</p>` : ''}
        <div id="deny"></div>`}
    </article>
    <article class="n-card"><h3 class="n-section-title" style="font-size:var(--t-sm)">手动补入</h3>
      <div class="nt-row"><select class="n-select" id="manual" style="flex:1"><option value="">选一个不在候选里的人</option>${Object.keys(sc.manual).filter((x) => !manual.includes(x)).map((x) => html`<option value="${x}">${st.person(x).name} · ${st.orgShort(st.person(x).org)}</option>`)}${st.visiblePeople().filter((x) => st.scope(x.id) === 'full' && !sc.cands[x.id] && !sc.manual[x.id] && !manual.includes(x.id)).map((x) => html`<option value="${x.id}">${x.name} · 还没有预先核对的证据</option>`)}</select><button class="n-btn n-btn--sm" type="button" id="addmanual">补入</button></div>
      <p class="nt-caption" id="drag-tip">候选卡可以直接拖到上面的槽位，也可以用卡片上的按钮放入。</p></article>`;
  }

  function drawAll(changedReq) {
    if (!$('#needcard')) return;
    mount($('#needcard'), needCard());
    const { main, pend } = ordered();
    const host = $('#cands');
    const old = $$('.n-candidate', host);
    const render = () => {
      mount(host, main.length ? main.map((c) => candCard(c.pid)) : UI.state({ ip: 'confirm', title: '换个条件再找', text: '可以先补材料，或者放宽一项要求。' }));
      mount($('#pending'), html`<h4 class="n-section-title" style="font-size:var(--t-sm)">条件待确认 · ${pend.length} 人</h4>${pend.length ? html`<ul class="n-pending">${pend.map((c) => html`<li>${UI.avatar(c.pid, 'sm')}${UI.plink(c.pid)}<small>${reqs.filter((r) => r.must && evOf(c.pid, r)[0] === 'unknown').map((r) => (r.useAlt ? r.alt : r.text)).join('、')}资料不足</small></li>`)}</ul>` : html`<p class="nt-muted" style="margin:0">没有。</p>`}<p class="nt-caption">资料待补充的人放在这里，补齐后再看是否满足。进入正式方案前再核对关键条件。</p>`);
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
    $('#cand-meta').textContent = `检索 ${sc.pool || st.visiblePeople().length} 人 · ${main.length} 人进入候选 · 按必须项的证据排列`;
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
      mount($('#deny'), html`<div class="n-notice is-deny" style="margin-top:var(--s-3)">${icon('lock')}<div><b>方案由管理者或指定的 HR 确认。</b>其他有权限的人可以起草和提出修改。草稿已保存。<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" id="askceo">请程远确认</button></div></div></div>`);
      $('#askceo').onclick = () => { NT.toast('已发给程远确认，会出现在程远的待办里'); $('#deny').innerHTML = ''; };
      return;
    }
    const p = st.project(projectId);
    const d = saveDraft();
    const v = await NT.dialog({
      title: `确认「${p.name}」用人方案 v${d.version}？`,
      body: html`<p>确认后冻结快照并生成跟进行动，之后的修改进入新草稿。</p>`,
      facts: [...sc.roles.map((r) => html`${r.name}：<b>${slots[r.id] ? st.person(slots[r.id]).name : '待定'}</b>`), empty.length ? html`<span style="color:var(--conflict)">${empty.map((r) => r.name).join('、')}还空着，之后可以再补</span>` : html`写入项目成员，生成跟进行动`],
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: `确认并冻结 v${d.version}`, value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }],
    });
    if (v !== 'ok') return;
    st.confirmStaffing(d, sc.roles);
    drawAll();
    const seal = $('#plan .n-seal'); seal?.classList.add('is-stamping');
    NT.toast(`已确认 v${d.version} 并冻结。${slots.owner ? `${st.person(slots.owner).name}写入项目 owner` : ''}，后续行动进入行动列表`);
  }
})();
