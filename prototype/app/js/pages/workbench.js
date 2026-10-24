/* 工作台：按视角呈现。
   - CEO（v1.4 3.19）：找人、值得关注、我推动的事项、判断提醒四块，不放变化、任务队列和上传。
   - 其他视角：首屏「变化」，然后是一句话输入、待办、进行中的任务与上传。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  let base = 'win', type = 'all', expanded = false, watchCat = 'all', watchAll = false, watchBy = 'person';

  const SUGGEST = {
    ceo: ['新转化团队要找一个能带 SDR 和 SMB 的 owner，11 月到岗', '找一位能负责新业务探索的人，最好做过 0 到 1，能跨团队推动'],
    hrbp: ['陆川这周主动帮许清和理清了投放口径，还整理成了文档', '为增长产品部发起 2026 H2 盘点'],
    lead: ['顾南今天独立处理了一个大客户故障，自己写了复盘', '灰度发布平台要找一个 owner'],
    mentor: ['唐果今天方案被问住了，第二天主动约了客服再访谈一次', '林知远这周排查缓存时先缩小了范围再动手'],
  };

  function greet(me) {
    const h = new Date().getHours();
    return `${h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'}，${me.name}`;
  }

  NT.shell({
    nav: 'work', title: '工作台',
    view: () => (st.role() === 'ceo' ? `值得关注：${watchBy === 'project' ? '按项目看' : '按人看'} · ${watchCat === 'all' ? '全部' : Object.fromEntries(st.WATCH_CATS)[watchCat]}${watchAll ? ' · 展开全部' : ''}` : `变化：${base === 'win' ? '近 3 个月 vs 之前' : 'vs 2026 H1'}${type !== 'all' ? ` · 筛选 ${type}` : ''}`),
    state: () => ({ base, type, watchCat, watchAll, watchBy }),
    restore: (s) => { base = s.base || base; type = s.type || type; watchCat = s.watchCat || watchCat; watchAll = !!s.watchAll; watchBy = s.watchBy || watchBy; renderChanges(); drawWatch(); },
    render(main) {
      const role = st.role(), me = st.me();
      if (role === 'self') return renderSelf(main, me);
      if (role === 'ceo') return renderCeo(main, me);
      const todos = st.todos();
      const changesCard = st.can('changes') ? html`<article class="n-card n-changes" id="changes" style="margin-bottom:var(--s-5)">
          <header class="n-changes__head"><h3>变化</h3><span class="n-changes__meta" id="chg-meta"></span>
            <div class="n-seg" role="group" aria-label="比较基准" data-manual id="chg-base">
              <button type="button" data-b="win" aria-pressed="true">近 3 个月 vs 之前</button>
              <button type="button" data-b="ver" aria-pressed="false">vs 2026 H1 档案版本</button>
            </div></header>
          <div class="n-chips" role="group" aria-label="按类型筛选" id="chg-filter">
            ${[['all', '全部'], ['trend', '能力走向'], ['activity', '活跃度与安排'], ['quad', '象限偏移'], ['team', '团队分布']].map(([k, l]) => html`<button class="n-chip" type="button" data-t="${k}" aria-pressed="${k === type}">${l}<b data-n="${k}"></b></button>`)}
          </div>
          <div id="chg-list"></div>
          <p class="nt-caption">只统计已确认的事件和分数，AI 建议分不会触发变化。资料从无到有不算上升；没有新事件不等于能力下降。变化按发生时间排列，不按幅度给人排名。</p>
        </article>` : '';
      const composer = html`
        <div class="n-composer" id="composer" style="margin-bottom:var(--s-2)">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="2" id="composer-field" aria-label="描述你要做的事" placeholder="${role === 'mentor' ? '说一件学员这周做的事，或输入 / 查看命令' : '说一件事，或描述一个项目要找谁。输入 / 查看命令'}"></textarea>
          <div class="n-composer__bar">
            <a class="n-btn n-btn--ghost n-btn--icon" href="#upload" aria-label="上传材料">${icon('clip')}</a>
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="按住说话" aria-pressed="false">${icon('mic')}</button>
            <span class="spacer"></span><span class="n-composer__hint">⌘ ↵ 发送</span>
            <button class="n-btn n-btn--ink n-btn--icon" type="button" id="composer-send" aria-label="发送">${icon('up')}</button>
          </div>
        </div>
        <div class="n-slash" id="slash" role="listbox" aria-label="命令" hidden>
          ${[['note', '记录关键事件', '/记', 'record.html'], st.can('findOwner') && ['folder', '为项目找 owner', '/找', 'staffing.html?new=1'], st.can('review') && role !== 'lead' && ['eye', '发起盘点', '/盘', 'reviews.html#new'], st.canOpenMinutes('w2') && ['wave', '打开会议人才纪要', '/录', 'record.html?m=w2']].filter(Boolean).map(([ic, l, k, h], i) => html`<a class="n-slash__item" role="option" aria-selected="${i === 0}" href="${h}">${icon(ic, 16)}${l}<kbd>${k}</kbd></a>`)}
        </div>
        <div class="n-asks" style="margin:var(--s-2) 0 var(--s-6)">${(SUGGEST[role] || []).map((s) => html`<button class="n-ask" type="button" data-say="${s}">${s}</button>`)}</div>`;
      mount(main, html`
        <header class="nt-head"><div><h1>${greet(me)}</h1><p>10 月 23 日 · 周五 · ${role === 'mentor' ? 'Landing 第三期 W3 · 本周五 16:00 对事复盘' : `${st.roles[role].scope}`}</p></div></header>
        ${changesCard}${composer}
        <div class="nt-cols">
          <article class="n-card" id="todo">${todoBlock(role, todos)}</article>
          <div class="nt-grid">
            ${role === 'hrbp' ? judgeCard() : ''}
            <article class="n-card"><h3 class="n-section-title">进行中的任务</h3><div id="tasks"></div></article>
            <article class="n-card" id="upload"><h3 class="n-section-title">上传材料</h3>
              <button class="n-drop" type="button" id="drop">${icon('upload')}<b>拖入文件，或点这里选择</b><small>TXT、MD、DOCX、PPTX、XLSX 和录音 · 解析结果写明能定位到段落、页、单元格还是时间点</small></button>
              <ul class="n-files" id="files"></ul>
            </article>
          </div>
        </div>`);
      wireComposer(role);
      wireTodos();
      renderTasks();
      wireUpload();
      if (st.can('changes')) {
        renderChanges();
        UI.wireChanges($('#chg-list'));
        $('#chg-base').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; base = b.dataset.b; $$('#chg-base button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderChanges(); });
        $('#chg-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; type = b.dataset.t; $$('#chg-filter button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderChanges(); });
      }
    },
  });

  // 待核实线索先给出 AI 引用的原文和位置，HRBP 核对过再决定是否给 CEO 看
  const clueSrc = (id) => { const c = st.get().watchClues.find((x) => x.id === id); if (!c) return ''; return html`<div class="n-todo__src">${icon('quote')}<span>原文依据</span>${c.srcs ? UI.cites(c.srcs) : (c.evs || []).map((e, i) => UI.evCite(e, i + 1))}<span class="nt-muted">点角标看原文与位置</span></div>`; };
  // CEO 请你（推动）、待核实线索可以就地处理；其余点进去处理
  // 推动按动作给出处理入口（v1.4 3.21.1）：验证去补事件或设重点跟踪，培养生成行动，任用讨论去找人补入；都可以记进展、确认结果或写理由取消
  const pushKindActs = (x) => ({
    verify: html`<a class="n-btn n-btn--sm" href="record.html?person=${x.person}">${icon('plus')}补一条事件</a><a class="n-btn n-btn--sm" href="person.html?id=${x.person}&track=1&push=${x.id}">${icon('target')}设为重点跟踪</a>`,
    grow: x.action ? html`<a class="n-btn n-btn--sm" href="actions.html#${x.action}">${icon('check2')}看行动</a>` : html`<button class="n-btn n-btn--sm" type="button" data-pact="${x.id}">${icon('plus')}生成行动</button>`,
    staff: x.project ? html`<a class="n-btn n-btn--sm" href="staffing.html?project=${x.project}&push=${x.id}">${icon('folder')}去找人补入</a>` : '',
  }[x.kind] || '');
  const todoActs = (t) => (t.kind === 'push' ? html`<div class="n-todo__acts">${pushKindActs(st.pushOf(t.push))}<button class="n-btn n-btn--sm" type="button" data-pres="${t.push}">${icon('check')}确认结果，写进档案</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-plog="${t.push}">记一笔进展</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-pcancel="${t.push}">取消推动</button></div>`
    : t.kind === 'clue' ? html`<div class="n-todo__acts">${clueSrc(t.clue)}<button class="n-btn n-btn--sm" type="button" data-cok="${t.clue}">${icon('check')}核实，给 CEO 看</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cno="${t.clue}">不采纳</button></div>` : '');
  const todoList = (list) => html`<ul class="n-todo">${list.map((t) => html`<li class="${t.kind === 'push' || t.kind === 'clue' ? 'has-acts' : ''}"><a href="${t.href}"><span class="n-badge ${t.cls || ''}">${t.icon ? icon(t.icon) : ''}${t.badge}</span><span>${t.title}<small>${t.sub}</small></span><span class="due">${t.due}</span></a>${todoActs(t)}</li>`)}</ul>`;
  const GROUPS = [['ceo', 'CEO 请你', ['push', 'jask']], ['verify', '待核对', ['verify']], ['clue', '待核实线索', ['clue']], ['calib', '待校准', ['calib']], ['plan', '待确认', ['plan']], ['follow', '待跟进', ['track', 'talk']]];
  let openGroup = null, showHandled = false;
  // 已处理的线索：核实的和不采纳的都留痕，不采纳的写出理由，可以改回待核实
  function handledBlock() {
    const list = st.watchHandled(); if (!list.length) return '';
    const nRej = list.filter((c) => c.state === 'rejected').length;
    const row = (c) => html`<li><span class="n-badge ${c.state === 'verified' ? 'n-badge--yes' : ''}">${c.state === 'verified' ? '已核实' : '不采纳'}</span><span>${st.person(c.person).name}：${c.why}<small>${c.by === 'ai' ? 'AI 线索' : `${st.person(c.by).name}提名`} · ${st.person(c.verifiedBy).name} ${NT.md(c.verifiedAt)}${c.state === 'rejected' ? `处理 · 理由：${c.rejectWhy}` : '核实，CEO 可见'}</small></span><button class="n-link" type="button" data-cun="${c.id}">改回待核实</button></li>`;
    return html`<button class="n-todomore" type="button" id="todo-handled" aria-expanded="${showHandled}">${icon('check2')}已处理的线索 ${list.length} 条${nRej ? `，其中不采纳 ${nRej} 条` : ''}<span style="margin-left:auto">${showHandled ? '收起' : '查看'}</span></button>
      ${showHandled ? html`<ul class="n-handled">${list.map(row)}</ul>` : ''}`;
  }
  function todoBlock(role, todos) {
    const empty = UI.state({ ip: 'done', size: 48, title: '待办都处理完了', text: '新的待核对、校准和到期的跟踪会出现在这里。' });
    if (role !== 'hrbp') return html`<h3 class="n-section-title">待办${todos.length ? html`<span class="n-count">${todos.length}</span>` : ''}</h3>${todos.length ? todoList(todos) : empty}`;
    const groups = GROUPS.map(([k, l, kinds]) => ({ k, l, list: todos.filter((t) => kinds.includes(t.kind)) })).filter((g) => g.list.length);
    if (!groups.length) return html`<h3 class="n-section-title">待办</h3>${empty}${handledBlock()}`;
    const open = groups.some((g) => g.k === openGroup) ? openGroup : groups[0].k; // 默认展开最紧急的一组：CEO 请你，其次是当天要处理的待核对
    return html`<h3 class="n-section-title">待办<span class="n-count">${todos.length}</span></h3>
      ${groups.map((g) => html`<div class="n-todogrp"><button class="n-todogrp__head" type="button" data-grp="${g.k}" aria-expanded="${g.k === open}">${g.l}<span class="n-count is-quiet">${g.list.length}</span>${g.k === open ? '' : html`<small>${g.list[0].title}${g.list.length > 1 ? ' 等' : ''}</small>`}${icon('chev')}</button>${g.k === open ? todoList(g.list) : ''}</div>`)}
      ${handledBlock()}`;
  }
  function wireTodos() {
    const host = $('#todo'); if (!host) return;
    const redraw = () => mount(host, todoBlock(st.role(), st.todos()));
    host.onclick = async (e) => {
      const g = e.target.closest('[data-grp]');
      if (g) { openGroup = g.dataset.grp; redraw(); return; }
      if (e.target.closest('#todo-handled')) { showHandled = !showHandled; redraw(); return; }
      const un = e.target.closest('[data-cun]');
      if (un) { st.unverifyClue(un.dataset.cun); redraw(); NT.toast('已改回待核实，CEO 暂时看不到这条'); return; }
      const b = e.target.closest('[data-plog],[data-pres],[data-cok],[data-cno],[data-pact],[data-pcancel]'); if (!b) return;
      if (b.dataset.pact) UI.pushActionDialog(b.dataset.pact, redraw);
      if (b.dataset.pcancel) UI.pushCancelDialog(b.dataset.pcancel, redraw);
      if (b.dataset.plog) UI.pushLogDialog(b.dataset.plog, redraw);
      if (b.dataset.pres) UI.pushResultDialog(b.dataset.pres, redraw);
      if (b.dataset.cok) {
        const c = st.verifyClue(b.dataset.cok, true); redraw();
        NT.toast(`已核实，${st.person(c.person).name}会出现在 CEO 的「值得关注」`, { undo: () => { st.unverifyClue(c.id); redraw(); } });
      }
      if (b.dataset.cno) {
        const r = await NT.dialog({ title: '不采纳这条线索', body: html`<label class="n-field"><span class="n-field__label">理由（必填）</span><textarea class="n-textarea" rows="2" id="cn-why" placeholder="比如：周报里说的是同一件事，只能算一条证据"></textarea></label><p class="nt-caption">线索保留在你这里，CEO 看不到。</p>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '不采纳', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#cn-why').value.trim(), read: (d) => d.querySelector('#cn-why').value.trim() }] });
        if (r?.value !== 'ok') return;
        const c = st.verifyClue(b.dataset.cno, false, r.data); redraw();
        NT.toast('已不采纳，理由已记录', { undo: () => { st.unverifyClue(c.id); redraw(); } });
      }
    };
  }
  // HRBP 的判断复盘入口：有待确认的 AI 假设时提示数量
  function judgeCard() {
    const rows = st.judgeBatches().filter((b) => b.status === 'open').map((b) => ({ b, n: st.judgeHyps(b.id).filter((h) => !st.judgeAttrib(h.id)).length }));
    return html`<article class="n-card"><h3 class="n-section-title">判断复盘<a class="n-link" href="judge.html">全部</a></h3>
      <ul class="nt-list">${rows.map(({ b, n }) => html`<li><a class="nt-plink" href="judge.html?id=${b.id}"><b style="font-weight:600">${b.name}</b></a><div class="nt-muted">${n ? `${n} 条 AI 归因假设待确认` : '归因都已确认'} · ${b.range}</div></li>`)}</ul></article>`;
  }

  function renderChanges() {
    const host = $('#chg-list'); if (!host) return;
    const all = st.changes({ base });
    $$('#chg-filter [data-n]').forEach((b) => { const n = b.dataset.n === 'all' ? all.length : all.filter((c) => c.t === b.dataset.n).length; b.textContent = n ? ` ${n}` : ''; });
    $$('#chg-base button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.b === base));
    $$('#chg-filter button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.t === type));
    const list = all.filter((c) => type === 'all' || c.t === type);
    const scope = st.role() === 'ceo' ? '全公司' : st.role() === 'lead' ? '业务成功部' : '增长产品部、产品市场部';
    $('#chg-meta').textContent = `${scope} · ${list.length} 条，其中 ${list.filter((c) => c.hit).length} 条命中规则 · 规则版本 change-v1`;
    const cut = expanded ? list.length : 6;
    mount(host, list.length ? html`${list.slice(0, cut).map((c) => UI.change(c, base))}${list.length > cut ? html`<button class="n-btn n-btn--ghost n-btn--sm" type="button" id="chg-more" style="margin-top:var(--s-2)">再看 ${list.length - cut} 条</button>` : ''}` : html`<div class="nt-empty">这个类型下没有变化。</div>`);
    $('#chg-more')?.addEventListener('click', () => { expanded = true; renderChanges(); });
  }

  function wireComposer(role) {
    const field = $('#composer-field'), ipEl = $('#composer-ip'), slash = $('#slash'); // CEO 首页没有斜杠命令
    const go = () => {
      const q = field.value.trim();
      if (!q) { field.focus(); return; }
      NT.ipState(ipEl, 'thinking');
      // CEO 首页的输入框主讲找人：明确的找人请求优先；没有找人字眼、又明显在记一件刚发生的事时才去记录，其余都交给找人
      const askFind = /找|owner|负责人|谁来|人选/.test(q);
      const find = (role === 'ceo' ? askFind || !/(今天|昨天|这周|刚才|刚刚)/.test(q) : askFind) && st.can('findOwner');
      const inv = /盘点/.test(q) && st.can('review');
      setTimeout(() => { location.href = inv ? 'reviews.html' : NT.link(find ? 'staffing.html' : 'record.html', find ? { new: 1, q } : { q }); }, NT.reduced ? 0 : 450);
    };
    field.addEventListener('input', () => { if (slash) slash.hidden = !field.value.startsWith('/'); NT.ipState(ipEl, field.value ? 'listening' : 'rest'); });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
      if (slash && !slash.hidden && (e.key === 'Enter')) { e.preventDefault(); location.href = slash.querySelector('[aria-selected="true"]').getAttribute('href'); }
      if (slash && !slash.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = $$('.n-slash__item', slash), i = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
        const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((x, k) => x.setAttribute('aria-selected', k === n));
      }
      if (slash && e.key === 'Escape') slash.hidden = true;
    });
    $('#composer-send').addEventListener('click', go);
    $('#composer-mic').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', on);
      NT.ipState(ipEl, on ? 'listening' : 'rest');
      if (on) {
        field.value = '';
        const say = (SUGGEST[role] || [''])[0];
        NT.stream(field, say, 40).then(() => { e.currentTarget.setAttribute('aria-pressed', 'false'); NT.ipState(ipEl, 'confirm'); });
      }
    });
    $$('[data-say]').forEach((b) => b.addEventListener('click', () => { field.value = b.dataset.say; field.focus(); NT.ipState(ipEl, 'listening'); }));
  }

  // 长任务：上传 → 排队 → 转写 → 整理 → 完成 / 部分待核对 / 失败
  const STATE = {
    uploading: ['upload', '上传中'], queued: ['clock', '已提交，排队中'], transcribing: ['wave', '转写中'], shaping: ['spark', '整理中'],
    partial: ['split', '部分待核对'], done: ['check', '已完成'], failed: ['x', '整理失败'],
  };
  function renderTasks() {
    const all = st.get().tasks, tasks = st.visibleTasks();
    mount($('#tasks'), tasks.map((t) => {
      const [ic, label] = STATE[t.state];
      const act = {
        uploading: html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel="${t.id}">取消</button>`,
        partial: html`<a class="n-btn n-btn--sm" href="${t.link || 'inbox.html'}">去核对</a>`,
        done: html`<a class="n-btn n-btn--sm n-btn--ghost" href="landing.html">查看</a>`,
        failed: html`<button class="n-btn n-btn--sm" type="button" data-retry="${t.id}">${icon('retry')}重试整理</button>`,
        shaping: t.minutes ? html`<a class="n-btn n-btn--sm n-btn--ghost" href="record.html?m=${t.minutes}&tab=text">看转写</a>` : '',
      }[t.state] || '';
      const bar = t.state === 'uploading' ? html`<div class="n-progress"><i style="width:${t.progress}%"></i></div>` : ['transcribing', 'shaping'].includes(t.state) ? html`<div class="n-progress is-indeterminate"><i></i></div>` : '';
      return html`<div class="n-task" data-state="${t.state}" data-id="${t.id}"><span class="n-task__icon">${icon(ic)}</span><div><div class="n-task__name">${t.name}${t.preset ? html` <span class="n-badge n-badge--preset">预先处理的演示任务</span>` : ''}</div><div class="n-task__state"><b>${label}</b> · ${t.note}</div>${bar}</div><div class="n-task__acts">${act}</div></div>`;
    }));
    $('#tasks').onclick = (e) => {
      const r = e.target.closest('[data-retry]'), c = e.target.closest('[data-cancel]');
      if (r) retry(r.dataset.retry);
      if (c) { const t = tasks.find((x) => x.id === c.dataset.cancel); const i = all.indexOf(t); all.splice(i, 1); st.save(); renderTasks(); NT.toast(`已取消上传「${t.name}」`, { undo: () => { all.splice(i, 0, t); st.save(); renderTasks(); } }); }
    };
    tickUpload();
  }
  let ticking = false;
  function tickUpload() {
    if (ticking) return; ticking = true;
    const loop = () => {
      const t = st.get().tasks.find((x) => x.state === 'uploading');
      if (!t || !document.body.contains($('#tasks'))) { ticking = false; return; }
      t.progress = Math.min(100, t.progress + 3);
      const mb = Math.round(182 * t.progress / 100);
      const el = $(`.n-task[data-id="${t.id}"]`);
      if (t.progress >= 100) { t.state = 'queued'; t.note = `${NT.nowStamp().slice(6)} 提交 · 可以离开，结果会回到这里`; st.save(); ticking = false; renderTasks(); return; }
      if (el) { $('.n-progress i', el).style.width = `${t.progress}%`; $('.n-task__state', el).innerHTML = `<b>上传中</b> · 182 MB 中的 ${mb} MB · 上传完成前别关页面`; }
      setTimeout(loop, 700);
    };
    setTimeout(loop, 700);
  }
  async function retry(id) {
    const t = st.get().tasks.find((x) => x.id === id);
    t.state = 'shaping'; t.note = '重新提取人员和事件'; renderTasks();
    await NT.wait(2400);
    t.state = 'partial'; t.note = '4 条事件已整理，1 处人名待确认'; t.link = 'inbox.html'; st.save(); renderTasks();
    NT.toast('「导师访谈.m4a」整理完成，1 处待核对');
  }

  function wireUpload() {
    const files = $('#files');
    const add = async (name, ext, steps, final) => {
      const li = document.createElement('li'); li.className = 'n-file';
      li.innerHTML = `<span class="n-file__ext">${ext}</span><div style="min-width:0"><div class="n-file__name">${NT.esc(name)}</div><div class="n-file__state">上传中</div><div class="n-progress"><i style="width:0%"></i></div></div><span></span>`;
      files.prepend(li);
      const bar = $('.n-progress i', li), state = $('.n-file__state', li);
      for (let p = 0; p <= 100; p += 20) { bar.style.width = `${p}%`; await NT.wait(160); }
      $('.n-progress', li).classList.add('is-indeterminate');
      for (const s of steps) { state.textContent = s; await NT.wait(900); }
      $('.n-progress', li).remove();
      state.innerHTML = final[0]; li.lastElementChild.outerHTML = final[1];
    };
    $('#drop').addEventListener('click', () => add('W3 对事复盘纪要.docx', 'DOCX', ['解析中 · 读取 9 段', '整理中 · 提取人员和事件'],
      ['<span class="ok">已解析</span> · 9 段，定位到段落 · 提取 2 条事件待确认 · 已关联「Landing 第三期」', '<a class="n-btn n-btn--sm" href="record.html?q=W3%20对事复盘：唐果主动约了客服再访谈一次">确认事件</a>']));
    ['dragover', 'dragenter'].forEach((t) => $('#drop').addEventListener(t, (e) => { e.preventDefault(); e.currentTarget.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => $('#drop').addEventListener(t, (e) => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); }));
    $('#drop').addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0]; if (!f) return;
      const ext = (f.name.split('.').pop() || '').toUpperCase();
      if (ext === 'PDF') add(f.name, 'PDF', [], ['<span class="err">暂不支持 PDF</span> · 本期只处理文字、Office 文件和录音。可以另存为 DOCX，或直接粘贴文字', '<a class="n-btn n-btn--sm n-btn--ghost" href="record.html">粘贴文字</a>']);
      else add(f.name, ext.slice(0, 4), ['解析中', '整理中 · 提取人员和事件'], ['<span class="ok">已解析</span> · 原型不读取真实文件内容，这里只演示状态流转', '<span></span>']);
    });
  }


  // ---------- CEO 首页（v1.4 3.19） ----------
  function renderCeo(main, me) {
    mount(main, html`
      <header class="nt-head"><div><h1>${greet(me)}</h1><p>10 月 23 日 · 周五 · 全公司</p></div></header>
      <section class="n-find" aria-label="找人">
        <div class="n-composer is-hero" id="composer">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="1" id="composer-field" aria-label="描述你要找什么样的人" placeholder="描述你需要什么样的人：业务目标、必须项和加分项"></textarea>
          <div class="n-composer__bar">
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="按住说话" aria-pressed="false">${icon('mic')}</button>
            <span class="n-find__hint">可以跨岗位、跨职业通道找；改任何一条要求，候选人都会重新核对</span>
            <span class="spacer"></span>
            <button class="n-btn n-btn--ink" type="button" id="composer-send">${icon('search')}开始找人</button>
          </div>
        </div>
        <div class="n-find__more">
          <div class="n-asks">${SUGGEST.ceo.map((x) => html`<button class="n-ask" type="button" data-say="${x}">${x}</button>`)}</div>
          <div class="n-find__tpls"><span class="nt-muted">或从目标角色模板开始</span>${st.templates().map((t) => html`<a class="n-tpl is-quiet" href="staffing.html?tpl=${t.id}">${UI.tplTitle(t)}<small>v${st.tplVersion(t).v}</small></a>`)}</div>
        </div>
      </section>
      <div class="nt-ceo">
        <article class="n-card n-watch" id="watch" aria-labelledby="watch-h"></article>
        <div class="nt-grid"><article class="n-card n-mine" id="mine" aria-labelledby="mine-h"></article><article class="n-card n-jtip" id="jsig" aria-labelledby="jsig-h"></article></div>
      </div>`);
    wireComposer('ceo');
    drawCeo();
    $('#watch').addEventListener('click', (e) => {
      const c = e.target.closest('[data-wf]');
      if (c) { watchCat = c.dataset.wf; watchAll = false; drawWatch(); return; }
      const v = e.target.closest('[data-by]');
      if (v) { watchBy = v.dataset.by; drawWatch(); return; }
      if (e.target.closest('#watch-more')) { watchAll = !watchAll; drawWatch(); }
    });
  }
  function drawCeo() { drawWatch(); drawJudge(); drawMine(); }

  // 值得关注：类别计数 + 最近 4 条；按规则入选、按触发时间排，不显示分数
  const CAT = () => Object.fromEntries(st.WATCH_CATS);
  function watchItem(w) {
    const p = st.person(w.person), r = st.WATCH_RULES[w.rule];
    const cites = w.srcs ? UI.cites(w.srcs) : (w.evs || []).slice(0, 3).map((id, i) => UI.evCite(id, i + 1));
    const source = w.verifiedBy ? `${w.by === 'ai' ? 'AI 发现' : `${st.person(w.by).name}提名`} · ${st.person(w.verifiedBy).name}核实` : '按规则算出';
    return html`<li class="n-watch__item" data-cat="${w.cat}">
      ${UI.avatar(w.person)}
      <div class="n-watch__body">
        <div class="n-watch__who"><a class="nt-plink" href="person.html?id=${w.person}"><b>${p.name}</b></a><span class="nt-muted">${st.orgShort(p.org)} · ${p.title}</span><span class="n-watch__cat" data-cat="${w.cat}">${CAT()[w.cat]}</span><span class="n-watch__when">${NT.md(w.when)}</span></div>
        <div class="n-watch__why">${w.why}${cites}</div>
        <div class="n-watch__meta"><span class="n-rule" title="${r.text}">${icon('flag')}${w.rule}</span><span>${w.verifiedBy ? source : `${r.text} · ${source}`}</span>${w.also.length ? html`<span>也命中 ${w.also.map((a) => a.rule).join('、')}</span>` : ''}</div>
        ${w.doing.length ? html`<div class="n-watch__doing">${icon('clock')}<span>${w.doing.join('；')}</span></div>` : ''}
      </div>
      <div class="n-watch__acts"><a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${w.person}">查看人员与证据</a><span class="n-menuwrap"><button class="n-btn n-btn--sm" type="button" data-push="${w.person}">推动${icon('chev')}</button></span></div>
    </li>`;
  }
  function drawWatch() {
    const host = $('#watch'); if (!host) return;
    const all = st.watch();
    const list = all.filter((w) => watchCat === 'all' || w.cat === watchCat);
    const shown = watchAll ? list : list.slice(0, 4);
    mount(host, html`<div class="n-watch__head"><h3 class="n-section-title" id="watch-h">值得关注<span class="n-count is-quiet">${all.length} 人</span></h3>
        <span class="n-seg n-watch__by" role="group" aria-label="查看方式" data-manual><button type="button" data-by="person" aria-pressed="${watchBy === 'person'}">按人看</button><button type="button" data-by="project" aria-pressed="${watchBy === 'project'}">按项目看</button></span></div>
      <div class="n-chips" role="group" aria-label="按类别筛选">
        <button class="n-chip" type="button" data-wf="all" aria-pressed="${watchCat === 'all'}">全部<b>${all.length}</b></button>
        ${st.WATCH_CATS.map(([k, l]) => { const n = all.filter((w) => w.cat === k).length; return html`<button class="n-chip" type="button" data-wf="${k}" aria-pressed="${watchCat === k}">${l}<b>${n ? `${n} 人` : '暂无'}</b></button>`; })}
      </div>
      ${!list.length ? html`<div class="nt-empty">这一类暂时没有人。没有命中规则不代表有问题。</div>` : watchBy === 'project' ? byProject(list) : html`<ul class="n-watch__list">${shown.map(watchItem)}</ul>`}
      ${watchBy === 'person' && list.length > 4 ? html`<button class="n-btn n-btn--ghost n-btn--sm" type="button" id="watch-more" aria-expanded="${watchAll}" style="margin-top:var(--s-2)">${watchAll ? '收起' : `查看全部 ${list.length} 人`}</button>` : ''}
      <p class="nt-caption">按写明的规则入选，按触发时间排列，不按分数挑人；资料不足不算需要介入。AI 线索和提名经 HRBP 核实后才会出现在这里。规则版本 watch-v1</p>`);
    // 推动带上这条关注的规则、原因和证据，作为发起依据交给负责人
    const byId = Object.fromEntries(all.map((w) => [w.person, w]));
    $$('[data-push]', host).forEach((b) => { const w = byId[b.dataset.push]; UI.pushMenu(b, w.person, drawCeo, { rule: w.rule, why: w.why, evs: w.evs, srcs: w.srcs, clue: w.clue }); });
  }

  // 按项目看：同一批入选的人，按依据事件所在的项目或批次分组；Landing 议题归到所在批次（v1.4 3.20.2）
  function byProject(list) {
    const groups = new Map();
    const put = (key, head, w, note) => { if (!groups.has(key)) groups.set(key, { ...head, items: [], when: '' }); const g = groups.get(key); if (!g.items.some((x) => x.w.person === w.person)) g.items.push({ w, note }); if (w.when > g.when) g.when = w.when; };
    list.forEach((w) => {
      const projs = [...new Set((w.evs || []).map((id) => st.event(id)?.project).filter(Boolean))].map(st.project).filter(Boolean);
      if (!projs.length) put('none', { name: '不在具体项目里', sub: '日常工作中的事件或信号' }, w);
      projs.forEach((pj) => {
        const b = pj.batch && st.batch(pj.batch);
        if (b) put(b.id, { name: b.name, href: 'landing.html', sub: 'Landing 批次' }, w, pj.name);
        else put(pj.id, { name: pj.name, href: `project.html?id=${pj.id}`, sub: pj.type }, w);
      });
    });
    const gs = [...groups.entries()].sort(([a, x], [b, y]) => (a === 'none') - (b === 'none') || y.when.localeCompare(x.when));
    return html`<ul class="n-wgroup">${gs.map(([, g]) => html`<li>
      <div class="n-wgroup__head">${g.href ? html`<a class="nt-plink" href="${g.href}"><b>${g.name}</b></a>` : html`<b>${g.name}</b>`}<span class="nt-muted">${g.sub} · ${g.items.length} 人 · 最近 ${NT.md(g.when)}</span></div>
      <div class="n-wgroup__people">${g.items.map(({ w, note }) => html`<a class="n-wperson" href="person.html?id=${w.person}">${UI.avatar(w.person, 'sm')}<b>${st.person(w.person).name}</b><span class="n-watch__cat" data-cat="${w.cat}">${CAT()[w.cat]}</span>${note ? html`<small>${note}</small>` : ''}</a>`)}</div>
    </li>`)}</ul>`;
  }

  // 判断提醒：首页只放 1–2 条值得复核的批次差异，一行一条；详情和「请 HRBP 复核」在判断复盘页（v1.4 3.22）
  const ASTATE = { 待你确认: 'todo', 待处理: 'todo', 进行中: 'doing', 'HRBP 复核中': 'doing', 已有结果: 'done', 已复核: 'done', 已取消: 'cancel' };
  function drawJudge() {
    const host = $('#jsig'); if (!host) return;
    const sigs = st.judgeSignals(), top = sigs.slice(0, 2);
    const item = (g) => {
      const [label, s] = g.ask?.state === 'open' ? ['HRBP 复核中', 'doing'] : g.attrib === 'open' ? ['待 HRBP 归因', 'todo'] : ['归因已确认', 'done'];
      return html`<li><a href="judge.html?id=${g.b.id}"><span><b>${g.b.name.replace('判断复盘', '')}</b><small>${UI.judgeTipText(g)}</small></span><span class="n-astate" data-s="${s}">${label}</span></a></li>`;
    };
    mount(host, html`<h3 class="n-section-title" id="jsig-h">判断提醒<a class="n-link" href="judge.html">去判断复盘</a></h3>
      ${top.length ? html`<ul class="n-jtip__list">${top.map(item)}</ul><p class="nt-caption">差异需要复核，不代表员工退步，也不直接认定标准或评价人有错。</p>`
        : html`<div class="nt-empty">最近的判断复盘没有需要复核的差异。</div>`}`);
  }

  // 我推动的事项：待你确认的置顶，其后是你发起、还在推进的
  function drawMine() {
    const host = $('#mine'); if (!host) return;
    const m = st.myPushes();
    const row = (it) => html`<li><a href="${it.href}"><span class="n-mine__title">${it.title}<small>${it.sub}</small></span><span class="n-mine__meta">${it.owner ? html`${UI.avatar(it.owner, 'sm')}<span>${st.person(it.owner).name}</span>` : ''}<span class="n-astate" data-s="${ASTATE[it.state] || 'todo'}">${it.state}</span></span></a></li>`;
    mount(host, html`<h3 class="n-section-title" id="mine-h">我推动的事项</h3>
      ${m.confirm.length ? html`<div class="n-mine__pin"><h4>待你确认<span class="n-count">${m.confirm.length}</span></h4><ul class="n-mine__list">${m.confirm.map(row)}</ul></div>` : ''}
      <h4 class="n-mine__sub">在推进<span>${m.doing.length || ''}</span></h4>
      ${m.doing.length ? html`<ul class="n-mine__list">${m.doing.map(row)}</ul>` : html`<div class="nt-empty">你发起的找人、推动和复核请求会出现在这里。</div>`}
      ${m.done.length ? html`<h4 class="n-mine__sub">近 7 天有结果</h4><ul class="n-mine__list">${m.done.map(row)}</ul>` : ''}`);
  }

  // 员工本人：只看本人经历、参与的项目和发布给本人的行动
  function renderSelf(main, me) {
    const S = st.get();
    const pub = S.pubActions.filter((a) => a.person === me.id);
    const projs = st.projectsOf(me.id);
    mount(main, html`
      <header class="nt-head"><div><h1>${greet(me)}</h1><p>这里是你自己的资料：经历、参与的项目和发布给你的安排。你可以补充经历、写下意愿、提出纠错。</p></div></header>
      <div class="nt-cols">
        <article class="n-card"><h3 class="n-section-title">发布给你的</h3>
          ${pub.length ? pub.map((a) => html`<div class="n-pubaction" style="margin-bottom:var(--s-2)"><div>${a.title}<small>${st.person(a.by).name}发布给你 · ${NT.md(a.at)}</small></div><span class="n-astate" data-s="todo">待安排</span></div>`) : html`<div class="nt-empty">还没有发布给你的安排。</div>`}
          <div class="n-self__acts">
            <a class="n-btn n-btn--sm" href="person.html?id=${me.id}&add=exp">${icon('plus')}补充经历</a>
            <a class="n-btn n-btn--sm" href="person.html?id=${me.id}&add=will">${icon('quote')}写意愿</a>
            <a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${me.id}&add=fix">${icon('pen')}提出纠错</a>
          </div>
        </article>
        <article class="n-card"><h3 class="n-section-title">我参与的项目</h3>
          <ul class="n-members">${projs.map((m) => html`<li><a class="nt-plink" href="project.html?id=${m.p.id}"><b>${m.p.name}</b></a><span class="n-members__role">${m.role} · ${m.mode}</span><span class="n-members__when">${NT.md(m.from)} 起</span></li>`)}</ul>
        </article>
      </div>
      <div class="n-lock" style="margin-top:var(--s-4)">${icon('lock')}维度分、象限、他人的评价、变化和「值得聊一聊」对本人不可见。</div>`);
  }
})();
