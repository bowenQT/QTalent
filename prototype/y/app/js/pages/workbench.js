/* 工作台：按视角呈现。
   - 管理者：找人、值得关注的人、值得关注的项目、我的关注；判断提醒只做一行告知。留用与落位方案在方案页由 HR 确认，这里不审批。
   - HR：首屏「变化」，然后是一句话输入、待办、判断复盘、进行中的任务与上传。
   - 导师：先列所带学员，记一件事、推荐。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, raw, icon, mount, $, $$ } = NT;
  let base = 'win', type = 'all', expanded = false, watchCat = 'all', watchAll = false;

  const SUGGEST = {
    ceo: ['MaaS 智能体平台要一个能牵头应用后端的人，10 月到岗', 'TS 新人组还缺一个懂测试和部署、能带大家对齐节奏的人'],
    hrbp: ['谷嘉树这周把 CI 覆盖率补到了 80%，还写了一份排障手册', '为 XEngineer 第六期发起结营盘点'],
    mentor: ['孟逸尘今天主动把任务池同步给了全组，下午组员就接上了', '周初晴这周先画了接口图，再去找后端对齐'],
  };
  const TODAY_LINE = () => { const [, m, d] = NT.TODAY.split('-'); return `${+m} 月 ${+d} 日 · 周五`; };

  function greet(me) {
    const h = new Date().getHours();
    return `${h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'}，${me.name}`;
  }

  NT.shell({
    nav: 'work', title: '工作台',
    view: () => (st.role() === 'ceo' ? `值得关注的人：${watchCat === 'all' ? '全部' : Object.fromEntries(st.WATCH_CATS)[watchCat]}${watchAll ? ' · 展开全部' : ''}` : `变化：${base === 'win' ? '近 3 个月 vs 之前' : 'vs 中期'}${type !== 'all' ? ` · 筛选 ${type}` : ''}`),
    state: () => ({ base, type, watchCat, watchAll }),
    restore: (s) => { base = s.base || base; type = s.type || type; watchCat = s.watchCat || watchCat; watchAll = !!s.watchAll; renderChanges(); drawWatch(); },
    render(main) {
      const role = st.role(), me = st.me();
      main.dataset.peekScope = ''; // 工作台上的人名先拉起速览
      if (role === 'ceo') return renderCeo(main, me);
      const todos = st.todos();
      const changesCard = st.can('changes') ? html`<article class="n-card n-changes" id="changes" style="margin-bottom:var(--s-5)">
          <header class="n-changes__head"><h3>变化</h3><span class="n-changes__meta" id="chg-meta"></span>
            <div class="n-seg" role="group" aria-label="比较基准" data-manual id="chg-base">
              <button type="button" data-b="win" aria-pressed="true">近 3 个月 vs 之前</button>
              <button type="button" data-b="ver" aria-pressed="false">vs 中期档案版本</button>
            </div></header>
          <div class="n-chips" role="group" aria-label="按类型筛选" id="chg-filter">
            ${[['all', '全部'], ['trend', '能力走向'], ['activity', '活跃度与安排'], ['quad', '象限偏移'], ['team', '团队分布']].map(([k, l]) => html`<button class="n-chip" type="button" data-t="${k}" aria-pressed="${k === type}">${l}<b data-n="${k}"></b></button>`)}
          </div>
          <div id="chg-list"></div>
          <p class="nt-caption">按时间列出已确认的变化。</p>
        </article>` : '';
      const composer = html`
        <div class="n-composer" id="composer" style="margin-bottom:var(--s-2)">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="2" id="composer-field" aria-label="描述你要做的事" placeholder="${role === 'mentor' ? '按情境、行为、影响说一件学员做的事：在什么情况下、做了什么、带来什么影响' : '说一件事，或描述一个项目要找谁。输入 / 查看命令'}"></textarea>
          <div class="n-composer__bar">
            <a class="n-btn n-btn--ghost n-btn--icon" href="#upload" aria-label="上传材料">${icon('clip')}</a>
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="按住说话" aria-pressed="false">${icon('mic')}</button>
            <span class="spacer"></span><span class="n-composer__hint">⌘ ↵ 发送</span>
            <button class="n-btn n-btn--ink n-btn--icon" type="button" id="composer-send" aria-label="发送">${icon('up')}</button>
          </div>
        </div>
        <div class="n-slash" id="slash" role="listbox" aria-label="命令" hidden>
          ${[['note', '记录关键事件', '/记', 'record.html'], st.can('findOwner') && ['folder', '为项目找人', '/找', 'staffing.html?new=1'], st.can('review') && ['eye', '发起盘点', '/盘', 'reviews.html#new'], st.canOpenMinutes('w8') && ['wave', '打开会议人才纪要', '/录', 'record.html?m=w8']].filter(Boolean).map(([ic, l, k, h], i) => html`<a class="n-slash__item" role="option" aria-selected="${i === 0}" href="${h}">${icon(ic, 16)}${l}<kbd>${k}</kbd></a>`)}
        </div>
        <div class="n-asks" style="margin:var(--s-2) 0 var(--s-6)">${(SUGGEST[role] || []).map((s) => html`<button class="n-ask" type="button" data-say="${s}">${s}</button>`)}</div>`;
      const head = html`<header class="nt-head"><div><h1>${greet(me)}</h1><p>${TODAY_LINE()} · ${role === 'mentor' ? 'XEngineer 第六期已结营 · 本周五前完成 W8 对人复盘' : 'XEngineer 第六期结营盘点进行中 · 证据截至 09-05'}</p></div></header>`;
      // 导师：进行中的任务和上传材料收进「材料与任务」，默认折叠
      const fold = html`<details class="n-card nt-fold" id="fold" ${raw(location.hash === '#upload' ? 'open' : '')}><summary><h3 class="n-section-title">材料与任务</h3><span class="nt-muted">${st.visibleTasks().filter((t) => t.state !== 'done').length} 个在处理</span>${icon('chev')}</summary>
          <div id="tasks"></div>
          <div id="upload" style="margin-top:var(--s-4)"><button class="n-drop" type="button" id="drop">${icon('upload')}<b>拖入文件，或点这里选择</b><small>${UI.ATT_TYPES}，可以一次拖入多个 · 解析结果写明能定位到段落、页、单元格还是时间点</small></button><ul class="n-files" id="files"></ul></div></details>`;
      if (role === 'mentor') {
        mount(main, html`${head}${composer}
          <div class="nt-ceo">
            <div class="nt-grid"><article class="n-card n-students" id="students" aria-labelledby="stu-h"></article><article class="n-card" id="todo">${todoBlock(role, todos)}</article></div>
            <div class="nt-grid"><article class="n-card n-recos" id="recos" aria-labelledby="recos-h"></article>${fold}</div>
          </div>`);
        wireComposer(role); wireTodos(); renderTasks(); wireUpload();
        $('a[href="#upload"]', main)?.addEventListener('click', () => { $('#fold').open = true; });
        drawMentor(); wireMentor();
        UI.peek.changed = drawMentor;
        return;
      }
      mount(main, html`
        ${head}
        ${changesCard}${composer}
        <div class="nt-cols">
          <article class="n-card" id="todo">${todoBlock(role, todos)}</article>
          <div class="nt-grid">
            ${judgeCard()}
            <article class="n-card"><h3 class="n-section-title">进行中的任务</h3><div id="tasks"></div></article>
            <article class="n-card" id="upload"><h3 class="n-section-title">上传材料</h3>
              <button class="n-drop" type="button" id="drop">${icon('upload')}<b>拖入文件，或点这里选择</b><small>${UI.ATT_TYPES}，可以一次拖入多个 · 解析结果写明能定位到段落、页、单元格还是时间点</small></button>
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

  // 待核实线索先给出 AI 引用的原文和位置，HR 核对过再决定是否进入「值得关注的人」
  const clueSrc = (id) => { const c = st.get().watchClues.find((x) => x.id === id); if (!c) return ''; return html`<div class="n-todo__src">${icon('quote')}<span>原文依据</span>${c.srcs ? UI.cites(c.srcs) : (c.evs || []).map((e, i) => UI.evCite(e, i + 1))}<span class="nt-muted">点角标看原文与位置</span></div>`; };
  // 待核实线索先看这个人的速览再办
  const peekBtn = (pid) => (pid ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-peek="p:${pid}">${icon('user')}看速览</button>` : '');
  const todoActs = (t) => (t.kind === 'clue' ? html`<div class="n-todo__acts">${clueSrc(t.clue)}${peekBtn(st.get().watchClues.find((c) => c.id === t.clue)?.person)}<button class="n-btn n-btn--sm" type="button" data-cok="${t.clue}">${icon('check')}核实，进入值得关注</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cno="${t.clue}">不采纳</button></div>` : '');
  const todoList = (list) => html`<ul class="n-todo">${list.map((t) => html`<li class="${t.kind === 'clue' ? 'has-acts' : ''}"><a href="${t.href}"><span class="n-badge ${t.cls || ''}">${t.icon ? icon(t.icon) : ''}${t.badge}</span><span>${t.title}<small>${t.sub}</small></span><span class="due">${t.due}</span></a>${todoActs(t)}</li>`)}</ul>`;
  const GROUPS = [['verify', '待核对', ['verify']], ['clue', '待核实线索', ['clue']], ['plan', '待确认', ['plan', 'ruleback']], ['rulesug', '规则修订建议', ['rulesug']], ['rulereview', '按新版本复核', ['rulereview']], ['calib', '待校准', ['calib']], ['follow', '待跟进', ['track', 'talk']]];
  let openGroup = null, showHandled = false;
  // 已处理的线索：核实的和不采纳的都留痕，不采纳的写出理由，可以改回待核实
  function handledBlock() {
    const list = st.watchHandled(); if (!list.length) return '';
    const nRej = list.filter((c) => c.state === 'rejected').length;
    const row = (c) => html`<li><span class="n-badge ${c.state === 'verified' ? 'n-badge--yes' : ''}">${c.state === 'verified' ? '已核实' : '不采纳'}</span><span>${st.person(c.person).name}：${c.why}<small>${c.by === 'ai' ? 'AI 线索' : `${st.person(c.by).name}提名`} · ${st.person(c.verifiedBy).name} ${NT.md(c.verifiedAt)}${c.state === 'rejected' ? `处理 · 理由：${c.rejectWhy}` : '核实，管理者可见'}</small></span><button class="n-link" type="button" data-cun="${c.id}">改回待核实</button></li>`;
    return html`<button class="n-todomore" type="button" id="todo-handled" aria-expanded="${showHandled}">${icon('check2')}已处理的线索 ${list.length} 条${nRej ? `，其中不采纳 ${nRej} 条` : ''}<span style="margin-left:auto">${showHandled ? '收起' : '查看'}</span></button>
      ${showHandled ? html`<ul class="n-handled">${list.map(row)}</ul>` : ''}`;
  }
  function todoBlock(role, todos) {
    const empty = UI.state({ ip: 'done', size: 48, title: '待办都处理完了', text: '新的待核对、校准和到期的跟踪会出现在这里。' });
    if (role !== 'hrbp') return html`<h3 class="n-section-title">待办${todos.length ? html`<span class="n-count">${todos.length}</span>` : ''}</h3>${todos.length ? todoList(todos) : empty}`;
    const groups = GROUPS.map(([k, l, kinds]) => ({ k, l, list: todos.filter((t) => kinds.includes(t.kind)) })).filter((g) => g.list.length);
    if (!groups.length) return html`<h3 class="n-section-title">待办</h3>${empty}${handledBlock()}`;
    const open = groups.some((g) => g.k === openGroup) ? openGroup : groups[0].k; // 默认展开最紧急的一组：当天要处理的待核对
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
      if (un) { st.unverifyClue(un.dataset.cun); redraw(); NT.toast('已改回待核实，已从「值得关注的人」移出'); return; }
      const b = e.target.closest('[data-cok],[data-cno]'); if (!b) return;
      if (b.dataset.cok) {
        const c = st.verifyClue(b.dataset.cok, true); redraw();
        NT.toast(`已核实，${st.person(c.person).name}会出现在「值得关注的人」`, { undo: () => { st.unverifyClue(c.id); redraw(); } });
      }
      if (b.dataset.cno) {
        const r = await NT.dialog({ title: '不采纳这条线索', body: html`<label class="n-field"><span class="n-field__label">理由（必填）</span><textarea class="n-textarea" rows="2" id="cn-why" placeholder="比如：周报里说的是同一件事，只能算一条证据"></textarea></label><p class="nt-caption">这条线索只留在你的处理记录里。</p>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '不采纳', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#cn-why').value.trim(), read: (d) => d.querySelector('#cn-why').value.trim() }] });
        if (r?.value !== 'ok') return;
        const c = st.verifyClue(b.dataset.cno, false, r.data); redraw();
        NT.toast('已不采纳，理由已记录', { undo: () => { st.unverifyClue(c.id); redraw(); } });
      }
    };
  }
  // HR 的判断复盘入口：有待确认的 AI 假设时提示数量
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
    const scope = 'XEngineer 第六期';
    $('#chg-meta').textContent = `${scope} · ${list.length} 条，其中 ${list.filter((c) => c.hit).length} 条命中规则`;
    const cut = expanded ? list.length : 6;
    mount(host, list.length ? html`${list.slice(0, cut).map((c) => UI.change(c, base))}${list.length > cut ? html`<button class="n-btn n-btn--ghost n-btn--sm" type="button" id="chg-more" style="margin-top:var(--s-2)">再看 ${list.length - cut} 条</button>` : ''}` : html`<div class="nt-empty">这一类的变化会出现在这里。</div>`);
    $('#chg-more')?.addEventListener('click', () => { expanded = true; renderChanges(); });
  }

  function wireComposer(role) {
    const field = $('#composer-field'), ipEl = $('#composer-ip'), slash = $('#slash'); // 管理者首页没有斜杠命令
    const go = () => {
      const q = field.value.trim();
      if (!q) { field.focus(); return; }
      NT.ipState(ipEl, 'thinking');
      // 管理者首页的输入框主讲找人：明确的找人请求优先；没有找人字眼、又明显在记一件刚发生的事时才去记录，其余都交给找人
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
        done: html`<a class="n-btn n-btn--sm n-btn--ghost" href="review.html?id=b-xe6-end">查看</a>`,
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
      if (el) { $('.n-progress i', el).style.width = `${t.progress}%`; $('.n-task__state', el).innerHTML = `<b>上传中</b> · 182 MB 中的 ${mb} MB · 上传时请保持页面打开`; }
      setTimeout(loop, 700);
    };
    setTimeout(loop, 700);
  }
  async function retry(id) {
    const t = st.get().tasks.find((x) => x.id === id);
    t.state = 'shaping'; t.note = '重新提取人员和事件'; renderTasks();
    await NT.wait(2400);
    t.state = 'partial'; t.note = '4 条事件已整理，1 处人名待确认'; t.link = 'inbox.html'; st.save(); renderTasks();
    NT.toast(`「${t.name}」整理完成，1 处待核对`);
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
    $('#drop').addEventListener('click', () => add('W8 对人复盘纪要.docx', 'DOCX', ['解析中 · 读取 9 段', '整理中 · 提取人员和事件'],
      ['<span class="ok">已解析</span> · 9 段，定位到段落 · 提取 2 条事件待确认 · 已关联「XEngineer 第六期」', '<a class="n-btn n-btn--sm" href="record.html?q=W8%20对人复盘：孟逸尘主动把任务池同步给了全组">确认事件</a>']));
    ['dragover', 'dragenter'].forEach((t) => $('#drop').addEventListener(t, (e) => { e.preventDefault(); e.currentTarget.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => $('#drop').addEventListener(t, (e) => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); }));
    // 一次可以拖入多个；格式与「记录关键事件」的附件同一口径（v1.5 3.34）
    $('#drop').addEventListener('drop', (e) => {
      const list = [...e.dataTransfer.files];
      if (list.length > UI.ATT_MAX) NT.toast(`已加入前 ${UI.ATT_MAX} 个文件，其余 ${list.length - UI.ATT_MAX} 个请再选一次`);
      list.slice(0, UI.ATT_MAX).forEach((f) => {
        const k = UI.attachKind(f.name), err = UI.attachCheck(f);
        if (err) add(f.name, k.ext, [], [`<span class="err">${NT.esc(err)}</span>`, '<span></span>']);
        else add(f.name, k.ext, [k.unit === '时' ? '转写中' : '解析中 · 识别文字', '整理中 · 提取人员和事件'], [`<span class="ok">已解析</span> · ${k.label} <span class="n-badge n-badge--demo">演示</span>`, '<span></span>']);
      });
    });
  }


  // ---------- 管理者首页：找人、值得关注的人、值得关注的项目、我的关注；判断提醒一行告知 ----------
  function renderCeo(main, me) {
    mount(main, html`
      <header class="nt-head"><div><h1>${greet(me)}</h1><p>${TODAY_LINE()} · 全部人才项目</p></div></header>
      <section class="n-find" aria-label="找人">
        <div class="n-composer is-hero" id="composer">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="1" id="composer-field" aria-label="描述你要找什么样的人" placeholder="描述你需要什么样的人：业务目标、必须项和加分项"></textarea>
          <div class="n-composer__bar">
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="按住说话" aria-pressed="false">${icon('mic')}</button>
            <span class="n-find__hint">可以跨课题、跨方向找；改任何一条要求，候选人都会重新核对</span>
            <span class="spacer"></span>
            <button class="n-btn n-btn--ink" type="button" id="composer-send">${icon('search')}开始找人</button>
          </div>
        </div>
        <div class="n-find__more">
          <div class="n-asks">${SUGGEST.ceo.map((x) => html`<button class="n-ask" type="button" data-say="${x}">${x}</button>`)}</div>
          <div class="n-find__tpls"><span class="nt-muted">或从目标角色模板开始</span>${st.templates().map((t) => html`<a class="n-tpl is-quiet" href="staffing.html?tpl=${t.id}">${UI.tplTitle(t)}<small>v${st.tplVersion(t).v}</small></a>`)}</div>
        </div>
      </section>
      <div class="nt-jline" id="jsig" role="note" aria-label="判断提醒"></div>
      <div class="nt-ceo">
        <article class="n-card n-watch" id="watch" aria-labelledby="watch-h"></article>
        <div class="nt-grid"><article class="n-card n-progs" id="progs" aria-labelledby="progs-h"></article><article class="n-card n-follows" id="follows" aria-labelledby="follows-h"></article></div>
      </div>`);
    wireComposer('ceo');
    drawCeo();
    wireWatch();
    wireFollows();
    UI.peek.changed = drawCeo;
  }
  function drawCeo() { drawWatch(); drawJudge(); drawPrograms(); drawFollows(); }

  // 值得关注的人：类别计数 + 最近 5 条；按规则入选、按触发时间排，不显示分数
  const CAT = () => Object.fromEntries(st.WATCH_CATS);
  const peekP = (pid) => `data-peek="p:${pid}"`;
  function watchItem(w) {
    const p = st.person(w.person), fresh = st.freshFor(w.person);
    const cites = w.srcs ? UI.cites(w.srcs) : (w.evs || []).slice(0, 3).map((id, i) => UI.evCite(id, i + 1));
    return html`<li class="n-watch__item" data-cat="${w.cat}">
      <a class="n-watch__ava" href="person.html?id=${w.person}" ${raw(peekP(w.person))} tabindex="-1" aria-hidden="true">${UI.avatar(w.person)}</a>
      <div class="n-watch__body">
        <div class="n-watch__who"><a class="nt-plink" href="person.html?id=${w.person}" ${raw(peekP(w.person))}><b>${p.name}</b></a><span class="nt-muted">${st.orgShort(p.org)} · ${p.title}</span><span class="n-watch__cat" data-cat="${w.cat}">${CAT()[w.cat]}</span><span class="n-watch__when">${NT.md(w.when)}</span></div>
        <div class="n-watch__why">${w.why}${cites}</div>
        ${fresh ? html`<div class="n-watch__fresh">${icon('clock')}<span>${fresh.text}</span></div>` : ''}
      </div>
      <div class="n-watch__acts">${UI.followBtn(w.person)}<a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${w.person}" ${raw(peekP(w.person))}>查看依据</a></div>
    </li>`;
  }
  function wireWatch() {
    $('#watch').addEventListener('click', (e) => {
      const c = e.target.closest('[data-wf]');
      if (c) { watchCat = c.dataset.wf; watchAll = false; drawWatch(); return; }
      if (e.target.closest('#watch-more')) { watchAll = !watchAll; drawWatch(); return; }
      const f = e.target.closest('[data-follow]');
      if (f) UI.toggleFollow(f.dataset.follow, drawCeo);
    });
  }
  function drawWatch() {
    const host = $('#watch'); if (!host) return;
    const all = st.watch();
    const list = all.filter((w) => watchCat === 'all' || w.cat === watchCat);
    const shown = watchAll ? list : list.slice(0, 5);
    mount(host, html`<div class="n-watch__head"><h3 class="n-section-title" id="watch-h">值得关注的人<span class="n-count is-quiet">${all.length} 人</span></h3></div>
      <div class="n-chips" role="group" aria-label="按类别筛选">
        <button class="n-chip" type="button" data-wf="all" aria-pressed="${watchCat === 'all'}">全部<b>${all.length}</b></button>
        ${st.WATCH_CATS.map(([k, l]) => { const n = all.filter((w) => w.cat === k).length; return html`<button class="n-chip" type="button" data-wf="${k}" aria-pressed="${watchCat === k}">${l}<b>${n ? `${n} 人` : '暂无'}</b></button>`; })}
      </div>
      ${list.length ? html`<ul class="n-watch__list">${shown.map(watchItem)}</ul>` : html`<div class="nt-empty">这一类入选的人会出现在这里。</div>`}
      ${list.length > 5 ? html`<button class="n-btn n-btn--ghost n-btn--sm" type="button" id="watch-more" aria-expanded="${watchAll}" style="margin-top:var(--s-2)">${watchAll ? '收起' : `查看全部 ${list.length} 人`}</button>` : ''}
      <p class="nt-caption">按入选时间排列，点人名看依据。</p>`);
  }

  // 值得关注的项目：人才项目按期次，一期一行，按时间排；入选原因写在同一行
  const PROG_ICON = { XEngineer: 'book', Landing: 'flag', 校招: 'users', 黑客松: 'spark' };
  function drawPrograms() {
    const host = $('#progs'); if (!host) return;
    const { list, quiet } = st.watchPrograms();
    mount(host, html`<h3 class="n-section-title" id="progs-h">值得关注的项目<span class="n-count is-quiet">${list.length} 期</span></h3>
      ${list.length ? html`<ul class="n-progs__list">${list.map((g) => html`<li><a href="${g.href || 'projects.html'}">
          <span class="n-progs__icon">${icon(PROG_ICON[g.kind] || 'folder')}</span>
          <span class="n-progs__main"><b>${g.name}</b><small>${g.why.map((x) => x.text).join(' · ')}</small></span>
          <span class="n-progs__when">${NT.md(g.at)}</span></a></li>`)}</ul>` : html`<div class="nt-empty">近两周没有需要留意的期次。</div>`}
      ${quiet.length ? html`<p class="nt-caption">其余 ${quiet.length} 期近两周没有新变化：${quiet.map((g) => g.name).join('、')}</p>` : ''}`);
  }

  // 判断提醒：一行告知差异与待确认的规则修订，不展开细节；详情在判断复盘和评价体系
  function drawJudge() {
    const host = $('#jsig'); if (!host) return;
    const sigs = st.judgeSignals().slice(0, 1), rules = st.rulesToConfirm();
    const lines = [
      ...sigs.map((g) => html`<a href="judge.html?id=${g.b.id}">${icon('swap')}<span><b>判断提醒</b>${g.b.name.replace('判断复盘', '')}：${UI.judgeTipText(g)}${g.attrib === 'open' ? ' · HR 归因中' : ''}</span>${icon('chev')}</a>`),
      ...rules.map((x) => html`<a href="${x.href}">${icon('grid')}<span><b>规则修订待你确认</b>${st.ruleKindName(x.kind)} ${x.r.v}：${x.r.why}</span>${icon('chev')}</a>`),
    ];
    host.hidden = !lines.length;
    mount(host, html`${lines}`);
  }

  // 我的关注：动态（关注之后的已确认进展）和名单两种看法；只对本人可见（v1.5 3.26.2）
  let followView = 'feed';
  const FEED_KIND = { event: '关键事件', watch: '值得关注', action: '行动', track: '重点跟踪', reco: '推荐方向' };
  function drawFollows() {
    const host = $('#follows'); if (!host) return;
    const list = st.followList(), feed = st.followFeed().slice(0, 5);
    const fresh = (pid) => st.followFeed(pid)[0];
    mount(host, html`<div class="n-follows__head"><h3 class="n-section-title" id="follows-h">我的关注<span class="n-count is-quiet">${list.length} 人</span></h3>
        ${list.length ? html`<span class="n-seg" role="group" aria-label="查看方式" data-manual><button type="button" data-fv="feed" aria-pressed="${followView === 'feed'}">动态</button><button type="button" data-fv="list" aria-pressed="${followView === 'list'}">名单</button></span>` : ''}</div>
      ${!list.length ? html`<div class="nt-empty">在值得关注或速览里点「加关注」，之后他们的新进展会出现在这里。</div>`
        : followView === 'list' ? html`<ul class="n-follows__list">${list.map((f) => { const x = fresh(f.person); return html`<li><a href="person.html?id=${f.person}" ${raw(peekP(f.person))}>${UI.avatar(f.person, 'sm')}<span><b>${st.person(f.person).name}</b><small>${NT.md(f.at)} 关注${x ? ` · 最近：${NT.md(x.at)} ${x.text}` : ''}</small></span></a><button class="n-link" type="button" data-unf="${f.person}">取消关注</button></li>`; })}</ul>`
        : feed.length ? html`<ol class="n-feed">${feed.map((x) => html`<li><a href="person.html?id=${x.person}" ${raw(peekP(x.person))}>${UI.avatar(x.person, 'sm')}<span><b>${st.person(x.person).name}</b> ${x.text}<small>${NT.md(x.at)} · ${FEED_KIND[x.kind]}${x.by ? ` · ${st.person(x.by)?.name}` : ''}</small></span></a></li>`)}</ol>`
          : html`<div class="nt-empty">关注以来的新进展会出现在这里。</div>`}`);
  }
  function wireFollows() {
    $('#follows').addEventListener('click', (e) => {
      const v = e.target.closest('[data-fv]');
      if (v) { followView = v.dataset.fv; drawFollows(); return; }
      const u = e.target.closest('[data-unf]');
      if (u) UI.toggleFollow(u.dataset.unf, drawCeo);
    });
  }

  // ---------- 导师：我带的学员 → 记一件事（SBI）→ 在事件里评 → 推荐 ----------
  function drawMentor() {
    const me = st.me().id, since = NT.addDays(NT.TODAY, -6), S = st.get();
    const list = st.visiblePeople().filter((p) => st.scope(p.id) === 'mentor');
    const row = (p) => {
      const land = st.landingOf(p.id), topic = land && st.project(land.row[1]);
      const mine = S.events.filter((e) => e.kind === 'obs' && e.people.includes(p.id) && e.recorder === me && e.date).sort((a, b) => b.date.localeCompare(a.date));
      const week = mine.filter((e) => e.date >= since).length;
      return html`<li>${raw(`<a href="person.html?id=${p.id}" data-peek="p:${p.id}" tabindex="-1" aria-hidden="true">`)}${UI.avatar(p.id)}</a>
        <div><a class="nt-plink" href="person.html?id=${p.id}" data-peek="p:${p.id}"><b>${p.name}</b></a><small>${topic ? `${topic.name} · ` : ''}${week ? `本周记了 ${week} 件` : '本周还没记'}${mine[0] ? ` · 最近 ${NT.md(mine[0].date)}` : ''}</small></div>
        <div class="n-students__acts"><a class="n-btn n-btn--sm n-btn--ink" href="record.html?person=${p.id}">${icon('pen')}记一件事</a>${st.canRecommend(p.id) ? html`<button class="n-btn n-btn--sm" type="button" data-reco="${p.id}">${icon('target')}推荐</button>` : ''}</div></li>`;
    };
    mount($('#students'), html`<h3 class="n-section-title" id="stu-h">我带的学员<span class="n-count is-quiet">${list.length} 人</span></h3>
      ${list.length ? html`<ul class="n-students__list">${list.map(row)}</ul>` : html`<div class="nt-empty">还没有分配给你的学员。</div>`}
      <p class="nt-caption">每件事按情境、行为、影响记下来；分数只在事件里给，对照行为锚点。「本周还没记」只是提醒你，不会出现在学员的档案里。</p>`);
    drawRecos();
  }
  // 我的推荐：本人提交的推荐与处理状态
  function drawRecos() {
    const host = $('#recos'); if (!host) return;
    const recos = st.myRecos(), ST = { pending: ['HR 核实中', 'doing'], verified: ['已核实', 'done'], rejected: ['不采纳', 'cancel'] };
    mount(host, html`<h3 class="n-section-title" id="recos-h">我的推荐${recos.length ? html`<span class="n-count is-quiet">${recos.length}</span>` : ''}</h3>
      ${recos.length ? html`<ul class="n-mine__list">${recos.map((c) => html`<li><a href="person.html?id=${c.person}" data-peek="p:${c.person}"><span class="n-mine__title">${st.person(c.person).name} · ${st.fitText(c.dir)}<small>${c.state === 'rejected' ? `${st.person(c.verifiedBy).name}不采纳：${c.rejectWhy}` : c.state === 'verified' ? `${st.person(c.verifiedBy).name} ${NT.md(c.verifiedAt)} 核实，已进入档案的发展方向` : `${NT.md(c.at)} 提交 · ${c.why}`}</small></span><span class="n-mine__meta"><span class="n-astate" data-s="${ST[c.state][1]}">${ST[c.state][0]}</span></span></a></li>`)}</ul>`
        : html`<div class="nt-empty">在学员那一行点「推荐」，写理由并引用两件事；HR 核实后会进入学员档案的发展方向。</div>`}`);
  }
  function wireMentor() {
    $('#students').addEventListener('click', (e) => { const r = e.target.closest('[data-reco]'); if (r) UI.recoDialog(r.dataset.reco, drawMentor); });
  }

})();
