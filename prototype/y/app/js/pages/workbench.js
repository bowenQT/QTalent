/* 工作台：按视角呈现。
   - 管理者：找人、值得关注的人、值得关注的项目、我的关注；判断提醒只做一行告知。留用与落位方案在方案页修改和确认，这里不审批。
   - HR：首屏「变化」，然后是一句话输入、待办、判断对照、进行中的任务与上传。
   - 导师：一句话输入，下面收着所带学员（记一件事、推荐及推荐进展），然后是待办与进行中的任务。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, raw, icon, mount, $, $$ } = NT;
  let base = 'ver', type = 'all', expanded = false, chgOpen = false, stuOpen = false, watchCat = 'all', watchAll = false, watchProg = null;

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
    view: () => (st.role() === 'ceo' ? `值得关注的人：${watchCat === 'all' ? '全部' : Object.fromEntries(st.WATCH_CATS)[watchCat]}${watchAll ? ' · 展开全部' : ''}` : `有变化的人：${base === 'win' ? '近 3 个月和之前比' : '和中期盘点比'}${type !== 'all' ? ` · 筛选 ${type}` : ''}`),
    state: () => ({ base, type, watchCat, watchAll }),
    restore: (s) => { base = s.base || base; type = s.type || type; watchCat = s.watchCat || watchCat; watchAll = !!s.watchAll; renderChanges(); drawWatch(); },
    render(main) {
      const role = st.role(), me = st.me();
      main.dataset.peekScope = ''; // 工作台上的人名先拉起速览
      if (role === 'ceo') return renderCeo(main, me);
      const todos = st.todos();
      // 有变化的人收成输入框下面的一条抽屉：平时只露一行摘要，点开看清单，输入框始终在首屏
      const changesTray = st.can('changes') ? html`<div class="n-chgtray" id="changes">
          <button class="n-chgtray__head" type="button" id="chg-toggle" aria-expanded="${String(chgOpen)}" aria-controls="chg-panel">${icon('pulse')}<b>有变化的人</b><span class="n-count is-quiet" id="chg-total"></span><span class="n-changes__meta" id="chg-meta"></span><span class="n-chgtray__act">${chgOpen ? '收起' : '展开'}</span>${icon('chev')}</button>
          <div class="n-fold" id="chg-panel" ${raw(chgOpen ? 'data-open' : 'inert')}><div class="n-changes">
            <div class="n-changes__head">
              <div class="n-chips" role="group" aria-label="按类型筛选" id="chg-filter">
                ${[['all', '全部'], ['trend', '能力走向'], ['activity', '活跃度与安排'], ['quad', '象限变化'], ['team', '团队分布']].map(([k, l]) => html`<button class="n-chip" type="button" data-t="${k}" aria-pressed="${String(k === type)}">${l}<b data-n="${k}"></b></button>`)}
              </div>
              <div class="n-seg" role="group" aria-label="比较基准" data-manual id="chg-base">
                <button type="button" data-b="win" aria-pressed="${String(base === 'win')}">近 3 个月和之前比</button>
                <button type="button" data-b="ver" aria-pressed="${String(base === 'ver')}">和中期盘点比</button>
              </div>
            </div>
            <div id="chg-list"></div>
            
          </div></div>
        </div>` : '';
      // 导师所带学员同样收在输入框下面：平时一行摘要，点开逐人记一件事、推荐
      const studentsTray = html`<div class="n-chgtray" id="stu-tray">
          <button class="n-chgtray__head" type="button" id="stu-toggle" aria-expanded="${String(stuOpen)}" aria-controls="stu-panel">${icon('users')}<b id="stu-h">我带的学员</b><span class="n-count is-quiet" id="stu-total"></span><span class="n-changes__meta" id="stu-meta"></span><span class="n-chgtray__act">${stuOpen ? '收起' : '展开'}</span>${icon('chev')}</button>
          <div class="n-fold" id="stu-panel" ${raw(stuOpen ? 'data-open' : 'inert')}><div class="n-changes n-students" id="students"></div></div>
        </div>`;
      const composer = html`
        <section class="n-cmd" id="upload" aria-label="输入框">
        <div class="n-cmd__box">
        <div class="n-composer" id="composer">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="2" id="composer-field" aria-label="描述你要做的事" placeholder="${role === 'mentor' ? '说一件学员做的事：在什么情况下、做了什么、带来什么影响；文件可以直接拖进来。输入 / 查看命令' : '说一件事，或描述一个项目要找谁；文件可以直接拖进来。输入 / 查看命令'}"></textarea>
          <div class="n-composer__bar">
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="drop" aria-label="添加文件" title="添加文件：${UI.ATT_TYPES}，可以一次拖入多个">${icon('clip')}</button>
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="语音输入" title="语音输入（演示）" aria-pressed="false">${icon('mic')}</button>
            <span class="spacer"></span><span class="n-composer__hint">⌘ ↵ 发送</span>
            <button class="n-btn n-btn--ink n-btn--icon" type="button" id="composer-send" aria-label="发送">${icon('up')}</button>
          </div>
        </div>
        <!-- 命令和示例在输入框聚焦且还没输入、或输入 / 时出现；/ 之后的字只筛命令 -->
        <div class="n-slash is-pop" id="slash" role="listbox" aria-label="命令和示例" hidden>
          <span class="n-slash__label" data-group="cmd">命令</span>
          ${[['note', '记一件事', '/记', 'record.html'], st.can('findOwner') && ['folder', '为项目找人', '/找', 'staffing.html?new=1'], role === 'mentor' && ['users', '做 W8 对人复盘', '/复', 'landing.html'], st.can('calibrate') && ['eye', '发起盘点', '/盘', 'reviews.html#new'], st.canOpenMinutes('w8') && ['wave', '打开会议人才纪要', '/录', 'record.html?m=w8']].filter(Boolean).map(([ic, l, k, h]) => html`<a class="n-slash__item" role="option" aria-selected="false" href="${h}" data-group="cmd" data-label="${l}" data-key="${k.slice(1)}">${icon(ic, 16)}${l}<kbd>${k}</kbd></a>`)}
          <span class="n-slash__label" data-group="say">试试这样说</span>
          ${(SUGGEST[role] || []).map((x) => html`<button class="n-slash__item" type="button" role="option" aria-selected="false" data-group="say" data-say="${x}">${icon('quote', 16)}<span>${x}</span></button>`)}
        </div>
        </div>
        <ul class="n-files" id="files"></ul>
        ${role === 'mentor' ? studentsTray : changesTray}
        </section>`;
      const head = html`<header class="nt-head"><div><h1>${greet(me)}</h1><p>${TODAY_LINE()} · ${role === 'mentor' ? 'XEngineer 第六期已结营 · W8 对人复盘今天截止' : `XEngineer 第六期结营盘点进行中 · 证据截至 ${NT.md(NT.TODAY)}`}</p></div>${exportBtn()}</header>${exportHost()}`;
      // 导师：进行中的任务默认折叠
      const fold = html`<details class="n-card nt-fold" id="fold"><summary><h3 class="n-section-title">进行中的任务</h3><span class="nt-muted">${st.visibleTasks().filter((t) => t.state !== 'done').length} 个在处理</span>${icon('chev')}</summary>
          <div id="tasks"></div></details>`;
      if (role === 'mentor') {
        mount(main, html`${head}${composer}
          <div class="nt-cols">
            <article class="n-card" id="todo">${todoBlock(role, todos)}</article>
            ${fold}
          </div>`);
        wireComposer(role); wireTodos(); renderTasks(); wireUpload();
        drawMentor(); wireMentor();
        UI.peek.changed = drawMentor;
        return;
      }
      mount(main, html`
        ${head}
        ${composer}
        <div class="nt-cols">
          <article class="n-card" id="todo">${todoBlock(role, todos)}</article>
          <div class="nt-grid">
            <article class="n-card"><h3 class="n-section-title">进行中的任务</h3><div id="tasks"></div></article>
          </div>
        </div>`);
      wireComposer(role);
      wireTodos();
      renderTasks();
      wireUpload();
      wireExport();
      if (st.can('changes')) {
        renderChanges();
        UI.wireChanges($('#chg-list'));
        $('#chg-toggle').addEventListener('click', (e) => {
          const btn = e.currentTarget; chgOpen = !chgOpen;
          btn.setAttribute('aria-expanded', String(chgOpen));
          btn.querySelector('.n-chgtray__act').textContent = chgOpen ? '收起' : '展开';
          const panel = $('#chg-panel'); panel.toggleAttribute('data-open', chgOpen); panel.inert = !chgOpen;
        });
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
  // bare：组里每条的标签都一样时不再逐条重复
  const todoList = (list, o = {}) => html`<ul class="n-todo${o.bare ? ' is-bare' : ''}">${list.map((t) => html`<li class="${t.kind === 'clue' ? 'has-acts' : ''}"><a href="${t.href}">${o.bare ? '' : html`<span class="n-badge ${t.cls || ''}">${t.icon ? icon(t.icon) : ''}${t.badge}</span>`}<span>${t.title}<small>${t.sub}</small></span><span class="due">${t.due}</span></a>${todoActs(t)}</li>`)}</ul>`;
  // 按要做的动作分组：组名统一两个字，后面一句话说清要处理什么（导师有自己的说法）；本视角没有的组不出现
  const GROUPS = [
    ['verify', '核对', '材料里的人和课题对不上号，选一下是谁', ['verify']],
    ['landing', '复盘', '本周的对人复盘，逐项确认后整份确认', ['review']],
    ['confirm', '确认', '建议分、节点结论、判断对照和方案等你拍板', ['confirm', 'conclusion', 'plan', 'ruleback', 'judge'], '记录里 AI 给的建议分等你确认'],
    ['review', '复核', '评分有分歧或规则改了版，再看一眼', ['calib', 'rulereview', 'rulesug']],
    ['follow', '跟进', '线索、补记录、回访和接手的事', ['clue', 'cover', 'track', 'talk', 'reassign', 'takeover'], '补记录和到期的重点跟踪'],
  ];
  const TODO_SHOWN = 3;
  let openGroup = null, showHandled = false, todoMore = {};
  // 一组待办：标题行写动作、要处理什么和条数；默认露出 3 条，其余点开展开
  const todoGroup = (g, open) => {
    const o = { bare: new Set(g.list.map((t) => t.badge)).size === 1 };
    const rest = g.list.slice(TODO_SHOWN), more = !!todoMore[g.k];
    return html`<div class="n-todogrp"><button class="n-todogrp__head" type="button" data-grp="${g.k}" aria-expanded="${String(open)}" aria-controls="tg-${g.k}"><b>${g.l}</b><small>${g.d}</small><span class="n-count is-quiet">${g.list.length}</span>${icon('chev')}</button>
      <div class="n-fold" id="tg-${g.k}" ${raw(open ? 'data-open' : 'inert')}><div>${todoList(g.list.slice(0, TODO_SHOWN), o)}${rest.length ? html`<div class="n-fold" id="tgm-${g.k}" ${raw(more ? 'data-open' : 'inert')}><div>${todoList(rest, o)}</div></div><button class="n-link n-todogrp__more" type="button" data-more="${g.k}" aria-controls="tgm-${g.k}" aria-expanded="${String(more)}">${more ? '收起' : `再看 ${rest.length} 条`}</button>` : ''}</div></div></div>`;
  };
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
    const handled = role === 'hrbp' ? handledBlock() : '';
    const groups = GROUPS.map(([k, l, d, kinds, dMentor]) => ({ k, l, d: (role === 'mentor' && dMentor) || d, list: todos.filter((t) => kinds.includes(t.kind)) })).filter((g) => g.list.length);
    if (!groups.length) return html`<h3 class="n-section-title">待办</h3>${empty}${handled}`;
    // 默认展开最紧急的一组（当天要处理的待核对）；空字符串表示用户把各组都收起了
    const open = openGroup === '' ? '' : groups.some((g) => g.k === openGroup) ? openGroup : groups[0].k;
    return html`<h3 class="n-section-title">待办<span class="n-count">${todos.length}</span></h3>
      ${groups.map((g) => todoGroup(g, g.k === open))}
      ${handled}`;
  }
  // 线索处理失败时说清发生了什么：只由负责这个人的 HR 处理；或这条线索已有新结论
  const CLUE_UNDO_FAIL = '撤销失败：这条线索已有新结论，已保留当前结果';
  const clueFail = (id) => { const c = st.get().watchClues.find((x) => x.id === id); return !c || st.role() !== 'hrbp' || st.scope(c.person) !== 'full' ? '线索由负责这个人的 HR 处理' : '这条线索已有新结论，已刷新'; };
  function wireTodos() {
    const host = $('#todo'); if (!host) return;
    const redraw = () => mount(host, todoBlock(st.role(), st.todos()));
    host.onclick = async (e) => {
      // 展开收起只切换属性，不重画，高度和透明度按 CSS 过渡
      const fold = (btn, on) => { btn.setAttribute('aria-expanded', String(on)); const body = $(`#${btn.getAttribute('aria-controls')}`); body.toggleAttribute('data-open', on); body.inert = !on; };
      const g = e.target.closest('[data-grp]');
      if (g) {
        const on = g.getAttribute('aria-expanded') !== 'true';
        $$('[data-grp]', host).forEach((h) => fold(h, h === g && on));
        openGroup = on ? g.dataset.grp : '';
        return;
      }
      const m = e.target.closest('[data-more]');
      if (m) { const on = !todoMore[m.dataset.more]; todoMore[m.dataset.more] = on; fold(m, on); m.textContent = on ? '收起' : `再看 ${$(`#${m.getAttribute('aria-controls')}`).querySelectorAll('li').length} 条`; return; }
      if (e.target.closest('#todo-handled')) { showHandled = !showHandled; redraw(); return; }
      const un = e.target.closest('[data-cun]');
      if (un) { if (!st.unverifyClue(un.dataset.cun)) { NT.toast(clueFail(un.dataset.cun)); redraw(); return; } redraw(); NT.toast('已改回待核实，已从「值得关注的人」移出'); return; }
      const b = e.target.closest('[data-cok],[data-cno]'); if (!b) return;
      if (b.dataset.cok) {
        const c = st.verifyClue(b.dataset.cok, true); if (!c) { NT.toast(clueFail(b.dataset.cok)); redraw(); return; }
        const token = c.handledToken; redraw();
        NT.toast(`已核实，${st.person(c.person).name}会出现在「值得关注的人」`, { undo: () => { const ok = st.unverifyClue(c.id, token); redraw(); return ok; }, failText: CLUE_UNDO_FAIL });
      }
      if (b.dataset.cno) {
        const r = await NT.dialog({ title: '不采纳这条线索', body: html`<label class="n-field"><span class="n-field__label">理由（必填）</span><textarea class="n-textarea" rows="2" id="cn-why" placeholder="比如：周报里说的是同一件事，只能算一条证据"></textarea></label>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '不采纳', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#cn-why').value.trim(), read: (d) => d.querySelector('#cn-why').value.trim() }] });
        if (r?.value !== 'ok') return;
        const c = st.verifyClue(b.dataset.cno, false, r.data); if (!c) { NT.toast(clueFail(b.dataset.cno)); redraw(); return; }
        const token = c.handledToken; redraw();
        NT.toast('已不采纳，理由已记录', { undo: () => { const ok = st.unverifyClue(c.id, token); redraw(); return ok; }, failText: CLUE_UNDO_FAIL });
      }
    };
  }

  function renderChanges() {
    const host = $('#chg-list'); if (!host) return;
    const all = st.changes({ base });
    $('#chg-total').textContent = all.length;
    $$('#chg-filter [data-n]').forEach((b) => { const n = b.dataset.n === 'all' ? all.length : all.filter((c) => c.t === b.dataset.n).length; b.textContent = n ? ` ${n}` : ''; });
    $$('#chg-base button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.b === base));
    $$('#chg-filter button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.t === type));
    const list = all.filter((c) => type === 'all' || c.t === type);
    const scope = 'XEngineer 第六期';
        // 人和团队分开计数：团队分布的条目没有人员
    const ppl = new Set(list.filter((c) => c.person).map((c) => c.person)).size, teams = new Set(list.filter((c) => !c.person && c.team).map((c) => c.team)).size;
    const hit = list.filter((c) => c.hit).length, who = [ppl && `${ppl} 人`, teams && `${teams} 个团队`].filter(Boolean).join('、');
    $('#chg-meta').textContent = who ? `${scope} · ${who}${hit ? `，${hit === list.length ? '都' : `${hit} 条`}符合提醒条件` : ''}` : scope;
    const cut = expanded ? list.length : 6;
    mount(host, list.length ? html`${list.slice(0, cut).map((c) => UI.change(c, base))}${list.length > cut ? html`<button class="n-btn n-btn--ghost n-btn--sm" type="button" id="chg-more" style="margin-top:var(--s-2)">再看 ${list.length - cut} 条</button>` : ''}` : html`<div class="nt-empty">这一类的变化会出现在这里。</div>`);
    $('#chg-more')?.addEventListener('click', () => { expanded = true; renderChanges(); });
  }

  function wireComposer(role) {
    const field = $('#composer-field'), ipEl = $('#composer-ip'), slash = $('#slash'); // 管理者首页没有斜杠命令
    const hero = role === 'ceo';
    // 管理者首页的找人框随输入增高，到上限后在框内滚动
    const FIT_MAX = 200;
    const fit = () => {
      if (!hero) return;
      field.style.height = 'auto';
      const h = Math.min(field.scrollHeight, FIT_MAX);
      field.style.height = `${h}px`;
      field.style.overflowY = field.scrollHeight > FIT_MAX ? 'auto' : 'hidden';
    };
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
    // 命令与示例：聚焦且空着时列出全部；输入 / 后按之后的字过滤命令（命令名或快捷字），第一条为选中项，示例收起
    const items = slash ? $$('.n-slash__item', slash) : [];
    const shown = () => items.filter((x) => !x.hidden);
    const drawSlash = () => {
      if (!slash) return;
      const v = field.value, cmd = v.startsWith('/');
      if (document.activeElement !== field || (v && !cmd)) { slash.hidden = true; return; }
      const q = cmd ? v.slice(1).trim() : '';
      items.forEach((x) => {
        x.hidden = x.dataset.group === 'say' ? cmd : !!q && !x.dataset.key.includes(q) && !x.dataset.label.includes(q);
        x.setAttribute('aria-selected', 'false');
      });
      $$('.n-slash__label', slash).forEach((l) => { l.hidden = !items.some((x) => x.dataset.group === l.dataset.group && !x.hidden); });
      const list = shown();
      if (cmd) list[0]?.setAttribute('aria-selected', 'true');
      slash.hidden = !list.length;
    };
    const pick = (x) => {
      if (x.dataset.say) { field.value = x.dataset.say; slash.hidden = true; fit(); field.focus(); NT.ipState(ipEl, 'listening'); return; }
      location.href = x.getAttribute('href');
    };
    if (slash) {
      field.addEventListener('focus', drawSlash);
      field.addEventListener('blur', () => { slash.hidden = true; });
      slash.addEventListener('mousedown', (e) => e.preventDefault()); // 点选项时输入框不失焦
    }
    const sync = () => { drawSlash(); fit(); NT.ipState(ipEl, field.value ? 'listening' : 'rest'); };
    field.addEventListener('input', sync);
    field.addEventListener('keydown', (e) => {
      const composing = e.isComposing || e.keyCode === 229; // 输入法组字时的回车是选词
      const open = slash && !slash.hidden;
      if (e.key === 'Enter' && !composing) {
        const cur = open && shown().find((x) => x.getAttribute('aria-selected') === 'true');
        if (cur) { e.preventDefault(); pick(cur); return; }
        if (e.metaKey || e.ctrlKey || (hero && !e.shiftKey)) { e.preventDefault(); go(); return; }
      }
      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const list = shown(), i = list.findIndex((x) => x.getAttribute('aria-selected') === 'true');
        const n = i < 0 ? (e.key === 'ArrowDown' ? 0 : list.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        items.forEach((x) => x.setAttribute('aria-selected', 'false'));
        list[n].setAttribute('aria-selected', 'true');
      }
      if (slash && e.key === 'Escape') slash.hidden = true;
    });
    $('#composer-send').addEventListener('click', go);
    // 语音输入：点一下开始（演示：按角色预置一句话，逐字写进输入框），再点一下停止
    const mic = $('#composer-mic');
    let micRun = 0;
    mic.addEventListener('click', () => {
      const on = mic.getAttribute('aria-pressed') !== 'true';
      const run = ++micRun;
      mic.setAttribute('aria-pressed', String(on));
      NT.ipState(ipEl, on ? 'listening' : (field.value ? 'listening' : 'rest'));
      if (!on) return;
      const say = (SUGGEST[role] || [''])[0];
      NT.stream(field, say, 40, { onTick: fit, stop: () => run !== micRun || !mic.isConnected }).then(() => {
        if (run !== micRun) return; // 中途停止或重新开始过
        mic.setAttribute('aria-pressed', 'false');
        sync();
        NT.ipState(ipEl, 'confirm');
        field.focus();
      });
    });
    $$('[data-say]').forEach((b) => b.addEventListener('click', () => { field.value = b.dataset.say; if (slash) slash.hidden = true; fit(); field.focus(); NT.ipState(ipEl, 'listening'); }));
    fit();
  }

  // 长任务：上传 → 排队 → 转写 → 整理 → 完成 / 部分待核对 / 失败
  const STATE = {
    uploading: ['upload', '上传中'], queued: ['clock', '已提交，排队中'], transcribing: ['wave', '转写中'], shaping: ['spark', '整理中'],
    partial: ['split', '部分待核对'], done: ['check', '已完成'], failed: ['x', '整理失败'],
  };
  // 材料批次：一次投递一行，点开是回执；面评 PDF 打开导入预览
  const DROP_ICON = { processing: 'spark', verify: 'split', confirm: 'check2', done: 'check' };
  function dropRow(d) {
    const [k, label] = st.dropState(d), s = st.dropSummary(d);
    const parts = d.kind === 'interview' ? [d.files[0].meta] : [`${s.files} 个文件`, s.processing && `${s.processing} 个处理中`, s.failed && `${s.failed} 个失败`, s.people && `${s.people} 人`, `${s.events} 件事`, s.verifyOpen && `${s.verifyOpen} 处待核对`, s.toConfirm && `${s.toConfirm} 件待确认`].filter(Boolean);
    const act = d.kind === 'interview' ? '打开导入预览' : s.mineToConfirm ? `去确认 ${s.mineToConfirm} 件` : '看回执';
    return html`<div class="n-task" data-state="${k === 'processing' ? 'shaping' : k === 'done' ? 'done' : 'partial'}" data-drop="${d.id}"><span class="n-task__icon">${icon(DROP_ICON[k])}</span><div><div class="n-task__name">${d.title}<span class="n-badge">${st.ENTRY[d.entry]}</span></div><div class="n-task__state"><b>${label}</b> · ${parts.join(' · ')}</div>${k === 'processing' ? html`<div class="n-progress is-indeterminate"><i></i></div>` : ''}</div><div class="n-task__acts"><a class="n-btn n-btn--sm ${s.mineToConfirm || d.kind === 'interview' ? '' : 'n-btn--ghost'}" href="${st.dropHref(d)}${s.mineToConfirm ? '#confirm' : ''}">${act}</a></div></div>`;
  }
  // 进行中的任务默认露出前几条，其余收在折叠区里；列表随进度频繁重绘，展开状态单独记住
  const TASKS_SHOWN = 3;
  let tasksOpen = false;
  function renderTasks() {
    const all = st.get().tasks, tasks = st.visibleTasks();
    st.tickDrops();
    const rows = [...st.drops().map(dropRow), ...tasks.map((t) => {
      const [ic, label] = STATE[t.state];
      const act = {
        uploading: html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel="${t.id}">取消</button>`,
        partial: html`<a class="n-btn n-btn--sm" href="${t.link || 'inbox.html'}">去核对</a>`,
        done: html`<a class="n-btn n-btn--sm n-btn--ghost" href="${st.can('review') ? 'review.html?id=b-xe6-end' : 'landing.html'}">查看</a>`,
        failed: html`<button class="n-btn n-btn--sm" type="button" data-retry="${t.id}">${icon('retry')}重试整理</button>`,
        shaping: t.minutes ? html`<a class="n-btn n-btn--sm n-btn--ghost" href="record.html?m=${t.minutes}&tab=text">看转写</a>` : '',
      }[t.state] || '';
      const bar = t.state === 'uploading' ? html`<div class="n-progress"><i style="width:${t.progress}%"></i></div>` : ['transcribing', 'shaping'].includes(t.state) ? html`<div class="n-progress is-indeterminate"><i></i></div>` : '';
      return html`<div class="n-task" data-state="${t.state}" data-id="${t.id}"><span class="n-task__icon">${icon(ic)}</span><div><div class="n-task__name">${t.name}${t.preset ? html` <span class="n-badge n-badge--demo">演示</span>` : ''}</div><div class="n-task__state"><b>${label}</b> · ${t.note}</div>${bar}</div><div class="n-task__acts">${act}</div></div>`;
    })];
    const rest = rows.length - TASKS_SHOWN;
    mount($('#tasks'), rest > 0
      ? html`${rows.slice(0, TASKS_SHOWN)}<div class="n-tasks__fold" id="tasks-fold" ${tasksOpen ? 'data-open' : 'inert'}><div>${rows.slice(TASKS_SHOWN)}</div></div><div class="n-tasks__foot"><button class="n-link" type="button" id="tasks-more" aria-controls="tasks-fold" aria-expanded="${String(tasksOpen)}">${tasksOpen ? '收起' : `再看 ${rest} 个`}</button></div>`
      : rows);
    $('#tasks').onclick = (e) => {
      const m = e.target.closest('#tasks-more');
      if (m) {
        tasksOpen = !tasksOpen;
        const fold = $('#tasks-fold');
        fold.toggleAttribute('data-open', tasksOpen);
        fold.inert = !tasksOpen;
        m.setAttribute('aria-expanded', tasksOpen);
        m.textContent = tasksOpen ? '收起' : `再看 ${rest} 个`;
        return;
      }
      const r = e.target.closest('[data-retry]'), c = e.target.closest('[data-cancel]');
      if (r) retry(r.dataset.retry);
      if (c) { const t = tasks.find((x) => x.id === c.dataset.cancel); const i = all.indexOf(t); all.splice(i, 1); st.save(); renderTasks(); NT.toast(`已取消上传「${t.name}」`, { undo: () => { all.splice(i, 0, t); st.save(); renderTasks(); } }); }
    };
    tickUpload();
  }
  // 录音整理任务在本页停留期间到点推进（桌面壳发出），列表跟着刷新
  addEventListener('nt:tasks', () => { if ($('#tasks')) renderTasks(); });
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
    t.state = 'shaping'; t.note = '重新提取人员和事件'; st.save(); renderTasks();
    await NT.wait(2400);
    const done = st.finishTask(id);
    if ($('#tasks')) renderTasks();
    NT.toast(done.state === 'partial' ? `「${done.name}」整理完成，1 处人名待核对` : `「${done.name}」整理完成`);
  }

  // 统一投递：一次拖入多个文件成一批，文件各自上传、解析，有的失败、有的要核对；处理完在回执里看读到了什么
  function wireUpload() {
    const files = $('#files');
    let timer = 0, closed = '';
    const draw = (d) => {
      if (d.id === closed) return;
      const s = st.dropSummary(d), [k, label] = st.dropState(d);
      mount(files, html`<li class="n-dropbatch" data-state="${k}"><div class="n-dropbatch__head"><b>${d.title}</b><span class="n-dropbatch__end"><span class="n-rstate" data-s="${k}">${label}</span><button class="n-btn n-btn--ghost n-btn--icon n-dropbatch__close" type="button" data-close="${d.id}" aria-label="收起本次投递" title="收起，处理进度仍在「进行中的任务」">${icon('x')}</button></span></div>
        ${d.files.map((f) => { const [ic, fl] = st.FILE_STATE[f.state]; return html`<div class="n-file"><span class="n-file__ext">${UI.attachKind(f.name).ext}</span><div style="min-width:0"><div class="n-file__name">${f.name}</div><div class="n-file__state"><span class="${f.state === 'failed' ? 'err' : f.state === 'done' ? 'ok' : ''}">${icon(ic, 12)} ${fl}</span> · ${f.meta}</div>${['queued', 'parsing', 'transcribing', 'uploading'].includes(f.state) ? html`<div class="n-progress is-indeterminate"><i></i></div>` : ''}</div><span></span></div>`; })}
        <div class="n-dropbatch__foot"><span class="nt-muted">${s.processing ? `${s.processing} 个处理中，可以离开，结果会回到「进行中的任务」` : [s.failed && `${s.failed} 个失败`, s.verifyOpen && `${s.verifyOpen} 处待核对`, `${s.events} 件事`].filter(Boolean).join(' · ')}</span><a class="n-btn n-btn--sm" href="receipt.html?id=${d.id}">看回执</a></div></li>`);
    };
    // 批次里还有没走完的步骤就按时推进；d 是本页刚投递、要在投递区画出来的批次
    const busy = (b) => b.files.some((f) => f.steps?.some((x) => !x.done));
    const watch = (d) => {
      clearInterval(timer);
      timer = setInterval(() => { if (!document.body.contains(files)) { clearInterval(timer); return; } if (st.tickDrops()) { if (d) draw(st.drop(d.id)); renderTasks(); } if (!st.drops().some(busy)) clearInterval(timer); }, 500);
    };
    const follow = (d) => { draw(d); renderTasks(); watch(d); };
    // 收起本次投递：批次照常处理，进度和回执在「进行中的任务」里
    files.addEventListener('click', (e) => {
      const b = e.target.closest('[data-close]');
      if (!b) return;
      closed = b.dataset.close;
      const li = b.closest('.n-dropbatch');
      li.classList.add('is-leaving');
      setTimeout(() => { if (li.isConnected) mount(files, ''); }, NT.reduced ? 0 : 200);
    });
    // 刷新或离开后回到工作台：之前投递、还没处理完的批次接着推进
    if (st.drops().some(busy)) watch(null);
    // 回形针选文件；文件也可以直接拖到输入框上
    const box = $('#composer');
    $('#drop').addEventListener('click', () => follow(st.addDemoDrop()));
    ['dragover', 'dragenter'].forEach((t) => box.addEventListener(t, (e) => { e.preventDefault(); box.classList.add('is-over'); }));
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('is-over'); });
    // 一次可以拖入多个；格式与「记录关键事件」的附件同一口径（v1.5 3.34）
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('is-over');
      const list = [...e.dataTransfer.files];
      if (list.length > UI.ATT_MAX) NT.toast(`已加入前 ${UI.ATT_MAX} 个文件，其余 ${list.length - UI.ATT_MAX} 个请再选一次`);
      follow(st.addFilesDrop(list.slice(0, UI.ATT_MAX).map((f) => ({ name: f.name, err: UI.attachCheck(f), kind: UI.attachKind(f.name) }))));
    });
  }


  // ---------- 管理者首页：找人、值得关注的人、值得关注的项目、我的关注；判断提醒一行告知 ----------
  function renderCeo(main, me) {
    mount(main, html`
      <header class="nt-head"><div><h1>${greet(me)}</h1><p>${TODAY_LINE()} · 全部人才项目</p></div><div class="nt-notes" id="jsig" role="note" aria-label="提醒"></div>${exportBtn()}</header>${exportHost()}
      <section class="n-find is-pop" aria-label="找人">
        <div class="n-composer is-hero" id="composer">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="1" id="composer-field" aria-label="描述你要找什么样的人" placeholder="描述你需要什么样的人：业务目标、必须项和加分项"></textarea>
          <div class="n-composer__bar">
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="语音输入" title="语音输入（演示）" aria-pressed="false">${icon('mic')}</button>
            <span class="spacer"></span><span class="n-composer__hint">↵ 发送 · ⇧ ↵ 换行</span>
            <button class="n-btn n-btn--ink" type="button" id="composer-send">${icon('search')}开始找人</button>
          </div>
        </div>
        <!-- 示例和角色模板只在输入框聚焦且还没输入时出现，平时不占首页的位置 -->
        <div class="n-find__more">
          <span class="n-find__label">试试这样说</span>
          <div class="n-find__asks">${SUGGEST.ceo.map((x) => html`<button class="n-find__ask" type="button" data-say="${x}">${icon('search')}<span>${x}</span></button>`)}</div>
          <span class="n-find__label">或从角色模板开始</span>
          <div class="n-find__tpls">${st.templates().map((t) => html`<a class="n-tpl is-quiet" href="staffing.html?tpl=${t.id}">${UI.tplTitle(t)}</a>`)}</div>
        </div>
      </section>
      <div class="nt-ceo">
        <article class="n-card n-watch" id="watch" aria-labelledby="watch-h"></article>
        <div class="nt-grid"><article class="n-card n-progs" id="progs" aria-labelledby="progs-h"></article><article class="n-card n-follows" id="follows" aria-labelledby="follows-h"></article></div>
      </div>`);
    wireComposer('ceo');
    wireExport();
    $('#composer-field').addEventListener('keydown', (e) => { if (e.key === 'Escape') e.target.blur(); });
    drawCeo();
    wireWatch();
    wireFollows();
    UI.peek.changed = drawCeo;
  }
  // 批量导出已确认内容（BOW-912 口径）：只导当前视角范围内、已确认的事件分；表头写明导出时间、导出人、口径和范围；
  // 导出成功或失败都记审计。演示：?export=fail 看生成失败
  const EX_TIME = [['', '全部时间'], ['2025-09-04', '近 12 个月'], ['2026-06-04', '近 3 个月']];
  let exJob = null;
  const exportBtn = () => (st.canExport() ? html`<div class="nt-head__acts"><button class="n-btn n-btn--sm" type="button" id="btn-export">${icon('download')}导出已确认内容</button></div>` : '');
  const exportHost = () => (st.canExport() ? html`<div id="export-st" aria-live="polite"></div>` : '');
  const exLabel = (sc, from) => `${sc.label} · ${EX_TIME.find(([k]) => k === from)[1]}`;
  const EX_BASIS = '截至导出时已确认的关键事件与维度分，按新版本复核过的取复核结果；AI 建议分、待按新版本复核的分和还在评分复核里的分留在系统里；盘点结论以盘点确认时的存档为准';
  const exSkipped = (n) => html`<span>已跳过 ${n} 条待确认、待复核或还在评分复核里的分</span>`;
  function wireExport() {
    $('#btn-export')?.addEventListener('click', openExport);
    drawExport();
  }
  async function openExport() {
    const scopes = st.exportScopes();
    const sum = (d) => {
      const sc = scopes.find((x) => x.id === $('#ex-scope', d).value), from = $('#ex-time', d).value, r = st.exportRows(sc.people, from);
      mount($('#ex-sum', d), r.rows.length
        ? html`<b>${r.people} 人 · ${r.rows.length} 条已确认的维度分</b>${r.skipped ? exSkipped(r.skipped) : ''}`
        : html`<b>这个范围里已确认的内容 0 条</b>${!sc.people.length ? html`<span>这个范围里 0 人</span>` : r.skipped ? exSkipped(r.skipped) : ''}`);
      mount($('#ex-head', d), html`<dt>导出时间</dt><dd>生成时写入，精确到分钟</dd><dt>导出人</dt><dd>${st.me().name}</dd><dt>口径</dt><dd>${EX_BASIS}</dd><dt>范围</dt><dd>${exLabel(sc, from)}</dd>`);
      return r.rows.length;
    };
    const r = await NT.dialog({
      title: '导出已确认内容',
      body: html`<div class="n-export">
        <div class="n-export__pick">
          <label class="n-field"><span class="n-field__label">范围</span><select class="n-select" id="ex-scope">${scopes.map((x) => html`<option value="${x.id}">${x.label}（${x.people.length} 人）</option>`)}</select></label>
          <label class="n-field"><span class="n-field__label">事件时间</span><select class="n-select" id="ex-time">${EX_TIME.map(([k, l]) => html`<option value="${k}" ${raw(k === '2025-09-04' ? 'selected' : '')}>${l}</option>`)}</select></label>
        </div>
        <p class="n-export__sum" id="ex-sum"></p>
        <div class="n-export__head"><span class="n-export__cap">表头会写明</span><dl id="ex-head"></dl></div>
        
      </div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '生成表格', value: 'go', cls: 'n-btn--ink', icon: 'download', validate: (d) => (sum(d) ? true : '换一个范围或时间再生成'), read: (d) => ({ scope: $('#ex-scope', d).value, from: $('#ex-time', d).value }) }],
      onOpen: (d) => { sum(d); d.addEventListener('change', () => sum(d)); },
    });
    if (r?.value !== 'go') return;
    runExport(scopes.find((x) => x.id === r.data.scope), r.data.from);
  }
  function runExport(sc, from) {
    if (exJob?.url) URL.revokeObjectURL(exJob.url);
    exJob = { state: 'busy', sc, from, tries: (exJob?.sc === sc ? exJob.tries : 0) + 1 };
    drawExport();
    const job = exJob;
    setTimeout(() => {
      if (exJob !== job) return;
      // 生成前按当前视角再判一次：期间权限变了就拒绝，范围外的人不会进表，取不到已确认内容就不生成
      const r = st.exportCheck(sc.people, from), at = st.clockNow(), label = exLabel(sc, from);
      if (r.state === 'deny') {
        st.audit('拒绝导出', `已确认内容 · ${label}`);
        Object.assign(job, { state: 'deny' });
      } else if (r.state === 'empty') {
        Object.assign(job, { state: 'empty' });
      } else if (NT.param('export') === 'fail' && job.tries === 1) {
        st.audit('导出失败', `已确认内容 · ${label}`);
        Object.assign(job, { state: 'fail' });
      } else {
        const csv = buildCsv(r.rows, at, label);
        const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
        st.audit('导出已确认内容', `${label} · ${r.people} 人 · ${r.rows.length} 条维度分`);
        Object.assign(job, { state: 'done', at, url, n: r.rows.length, people: r.people, name: `已确认内容-${sc.label}-${NT.TODAY.replaceAll('-', '')}.csv` });
      }
      drawExport();
    }, NT.reduced ? 200 : 1400);
  }
  function buildCsv(rows, at, label) {
    const q = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const head = [['导出时间', at], ['导出人', st.me().name], ['口径', EX_BASIS], ['范围', label], ['说明', '演示数据，人员均为化名']];
    const cols = ['人员', '组织', '事件日期', '关键事件', '维度', '分数', '行为锚点', '原文引用', '评分人', '评价规则版本', '来源位置'];
    const body = rows.map((x) => { const p = st.person(x.pid); return [p.name, st.orgShort(p.org), x.date, x.title, x.dim, x.v, x.anchor, x.note, st.person(x.by)?.name || x.by, x.rubric, x.src && !x.srcExact ? `全部来源：${x.src}` : x.src]; });
    return [...head, [], cols, ...body].map((r) => r.map(q).join(',')).join('\r\n');
  }
  function drawExport() {
    const host = $('#export-st'); if (!host) return;
    const j = exJob;
    if (!j) { host.hidden = true; mount(host, ''); return; }
    host.hidden = false;
    const label = exLabel(j.sc, j.from);
    const close = html`<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-exclose>关闭</button></div>`;
    mount(host, j.state === 'busy'
      ? html`<div class="n-notice is-plain n-exst" data-state="busy">${icon('clock')}<div>正在生成「${label}」的表格，只取已确认的内容…</div></div>`
      : j.state === 'deny'
        ? html`<div class="n-notice is-deny n-exst" data-state="deny">${icon('lock')}<div><b>导出停在权限校验这一步。</b>生成前按你现在的视角重新校验，批量导出只对管理者和 HR 开放；这次尝试已记入审计日志。${close}</div></div>`
      : j.state === 'empty'
        ? html`<div class="n-notice is-plain n-exst" data-state="empty">${icon('info')}<div><b>导出停在取数这一步。</b>生成时「${label}」里已确认的内容 0 条，换一个范围或时间再导出。${close}</div></div>`
      : j.state === 'fail'
        ? html`<div class="n-notice is-deny n-exst" data-state="fail">${icon('x')}<div><b>导出停在生成文件这一步。</b>导出服务超时，文件待重新生成；这次失败已记入审计日志。<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" data-exretry>${icon('retry')}重试</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-exclose>关闭</button></div></div></div>`
        : html`<div class="n-notice is-plain n-exst" data-state="done">${icon('check')}<div><b>表格已生成：</b>${label}，${j.people} 人、${j.n} 条已确认的维度分。表头写明了导出时间 ${j.at.slice(5)} 和口径，盘点结论以盘点确认时的存档为准；已记入审计日志。<div class="nt-row" style="margin-top:var(--s-2)"><a class="n-btn n-btn--sm n-btn--ink" href="${j.url}" download="${j.name}">${icon('download')}下载表格</a><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-exclose>关闭</button></div></div></div>`);
    host.onclick = (e) => {
      if (e.target.closest('[data-exretry]')) runExport(j.sc, j.from);
      if (e.target.closest('[data-exclose]')) { if (j.url) URL.revokeObjectURL(j.url); exJob = null; drawExport(); }
    };
  }

  function drawCeo() { drawWatch(); drawJudge(); drawPrograms(); drawFollows(); }

  // 值得关注的人：按规则入选，不显示分数。「全部」里「需要介入」收成列表顶部的一行，
  // 风险最先被看到、又不把首页变成待办；其余按「突出表现」「新发现」分组，组内按入选时间排，每类先看最近 2 人
  const CAT_ORDER = ['top', 'new', 'act'];
  // 「需要介入」那一行里每个人的短原因：去向风险优先写出来
  const ACT_WHY = { I2: '约谈未发生', I3: '跟踪逾期', I1: '能力走低' };
  const CAT_NOTE = { top: '导师提名或推荐，HR 已核实', new: '近期有多件事印证，或 AI 线索经 HR 核实', act: '约定的跟进没有按时发生，HR 在跟' };
  const CAT = () => Object.fromEntries(st.WATCH_CATS);
  const peekP = (pid) => `data-peek="p:${pid}"`;
  // 去向是管理者最关心的上下文：未接受 offer、部门待定都直接写出来
  const fate = (p) => {
    const x = p.xe; if (!x) return '';
    if (x.accept === '拒绝') return '未接受 offer';
    if (!x.dest || x.dest === '待定部门') return x.accept === '接受' ? '部门待定' : '';
    return `去向 ${x.dest.replace(" · ", " ")}`;
  };
  // 一行只放管理者要的：名字、方向、去向，加一句简述。来源、引用和入选日期都在速览里；AI 来源保留小标记
  function watchItem(w) {
    const p = st.person(w.person), fresh = st.freshFor(w.person), on = st.isFollowing(w.person);
    const f = fate(p);
    const showFresh = fresh && !(w.track && fresh.kind === 'track'); // 跟踪逾期的简述已经写了跟踪，不再重复
    return html`<li class="n-watch__item" data-cat="${w.cat}">
      <a class="n-watch__ava" href="person.html?id=${w.person}" ${raw(peekP(w.person))} tabindex="-1" aria-hidden="true">${UI.avatar(w.person)}</a>
      <div class="n-watch__body">
        <div class="n-watch__who"><a class="nt-plink" href="person.html?id=${w.person}" ${raw(peekP(w.person))}><b>${p.name}</b></a><span class="n-watch__meta">${p.title}${f ? html` · <span class="${f.startsWith('去向') ? '' : 'is-open'}">${f}</span>` : ''}</span></div>
        <div class="n-watch__why">${w.by === 'ai' ? html`<span class="n-watch__ai" title="AI 线索，${st.person(w.verifiedBy)?.name || 'HR'}已核实">AI</span>` : ''}${w.brief || w.why}</div>
        ${showFresh ? html`<div class="n-watch__fresh">${icon('clock')}<span>${fresh.text}</span></div>` : ''}
      </div>
      <div class="n-watch__acts">
        ${st.canFollow(w.person) ? html`<button class="n-watch__star" type="button" data-follow="${w.person}" aria-pressed="${on}" aria-label="${on ? `取消关注${p.name}` : `关注${p.name}`}" title="${on ? '已关注，点一下取消' : '加关注'}">${icon(on ? 'star-on' : 'star')}</button>` : ''}
        <a class="n-watch__go" href="person.html?id=${w.person}" ${raw(peekP(w.person))}>查看依据${icon('chev')}</a>
      </div>
    </li>`;
  }
  function wireWatch() {
    $('#watch').addEventListener('click', (e) => {
      const c = e.target.closest('[data-wf]');
      if (c) { watchCat = c.dataset.wf; watchAll = false; drawWatch(); return; }
      if (e.target.closest('[data-wprog-clear]')) { watchProg = null; drawWatch(); drawPrograms(); return; }
      if (e.target.closest('#watch-more')) { watchAll = !watchAll; drawWatch(); return; }
      const f = e.target.closest('[data-follow]');
      if (f) { e.stopPropagation(); UI.toggleFollow(f.dataset.follow, drawCeo); return; }
      // 点行里的空白处也拉起速览：和「查看依据」同一个入口
      const row = e.target.closest('.n-watch__item');
      if (row && !e.target.closest('a, button, .n-cite')) { e.stopPropagation(); row.querySelector('.n-watch__go')?.click(); }
    });
  }
  function drawWatch() {
    const host = $('#watch'); if (!host) return;
    const all = st.watch();
    const prog = watchProg && st.watchPrograms().list.find((g) => g.id === watchProg);
    const progSet = prog && new Set(prog.why.flatMap((x) => x.people || []));
    const base = progSet ? all.filter((w) => progSet.has(w.person)) : all;
    const list = base.filter((w) => watchCat === 'all' || w.cat === watchCat);
    const count = (k) => base.filter((w) => w.cat === k).length;
    const grouped = watchCat === 'all';
    const acts = grouped ? list.filter((w) => w.cat === 'act') : [];
    const per = watchAll ? Infinity : grouped ? 2 : 5;
    const groups = grouped ? CAT_ORDER.filter((k) => k !== 'act').map((k) => [k, list.filter((w) => w.cat === k)]).filter(([, l]) => l.length) : [[watchCat, list]];
    const hidden = groups.reduce((n, [, l]) => n + Math.max(0, l.length - per), 0);
    const actWhy = (w) => (fate(st.person(w.person)) === '未接受 offer' ? '未接受 offer' : ACT_WHY[w.rule] || '');
    mount(host, html`<div class="n-watch__head"><h3 class="n-section-title" id="watch-h">值得关注的人<span class="n-count is-quiet">${base.length} 人</span></h3>
        ${prog ? html`<span class="n-watch__scope">${prog.name}<button type="button" data-wprog-clear aria-label="清除项目筛选">${icon('x')}</button></span>` : ''}</div>
      <div class="n-chips" role="group" aria-label="按类别筛选">
        <button class="n-chip" type="button" data-wf="all" aria-pressed="${watchCat === 'all'}">全部</button>
        ${CAT_ORDER.map((k) => html`<button class="n-chip" type="button" data-wf="${k}" aria-pressed="${watchCat === k}" title="${CAT_NOTE[k]}" ${raw(count(k) ? '' : 'disabled')}>${CAT()[k]}</button>`)}
      </div>
      ${acts.length ? html`<p class="n-watch__alert">${icon('flag')}<span><button class="n-link" type="button" data-wf="act">${acts.length} 人需要介入</button>，HR 在跟：${acts.map((w, i) => html`${i ? '、' : ''}<a class="nt-plink" href="person.html?id=${w.person}" ${raw(peekP(w.person))}>${st.person(w.person).name}</a>${actWhy(w) ? `（${actWhy(w)}）` : ''}`)}</span></p>` : ''}
      ${list.length ? groups.map(([k, l]) => html`<section class="n-watch__group" aria-label="${CAT()[k]}">
          ${grouped ? html`<h4 class="n-watch__glabel" title="${CAT_NOTE[k]}">${CAT()[k]}<span>${l.length}</span></h4>` : ''}
          <ul class="n-watch__list">${l.slice(0, per).map(watchItem)}</ul></section>`)
        : html`<div class="nt-empty">这一类入选的人会出现在这里。</div>`}
      ${hidden || watchAll ? html`<div class="n-watch__foot"><button class="n-link" type="button" id="watch-more" aria-expanded="${watchAll}">${watchAll ? '收起' : `再看 ${hidden} 人`}</button></div>` : ''}`);
  }

  // 值得关注的项目：人才项目按期次，一期一行，按时间排。名字旁只写最近的阶段，不写日期；
  // 「有人新进入值得关注」「方案待确认」做成可点的小标签：前者在左侧筛出这些人，后者去方案页
  const PROG_ICON = { XEngineer: 'book', Landing: 'flag', 校招: 'users', 黑客松: 'spark' };
  function drawPrograms() {
    const host = $('#progs'); if (!host) return;
    const { list } = st.watchPrograms();
    mount(host, html`<h3 class="n-section-title" id="progs-h">值得关注的项目<span class="n-count is-quiet">${list.length} 期</span></h3>
      ${list.length ? html`<ul class="n-progs__list">${list.map((g) => {
        const stage = g.nodes[g.nodes.length - 1]?.[1];
        const notes = g.why.filter((x) => !x.people && !x.href && !/^\d\d-\d\d /.test(x.text)), acts = g.why.filter((x) => x.people || x.href);
        return html`<li class="${watchProg === g.id ? 'is-on' : ''}">
          <span class="n-progs__icon">${icon(PROG_ICON[g.kind] || 'folder')}</span>
          <div class="n-progs__main">
            <div class="n-progs__top"><a class="n-progs__name" href="${g.href || 'projects.html'}">${g.name}</a>${stage ? html`<span class="n-progs__when">${stage}</span>` : ''}</div>
            ${acts.length || notes.length ? html`<div class="n-progs__acts">${notes.map((x) => html`<span class="n-progs__note">${x.text}</span>`)}${acts.map((x) => (x.people
              ? html`<button class="n-progs__tag" type="button" data-wprog="${g.id}" aria-pressed="${watchProg === g.id}">${icon('users')}${x.text.replace('新进入值得关注的人', '新进入值得关注')}</button>`
              : html`<a class="n-progs__tag" href="${x.href}">${icon('stamp')}${x.text}</a>`))}</div>` : ''}
          </div></li>`;
      })}</ul>` : html`<div class="nt-empty">近两周没有需要留意的期次。</div>`}`);
    host.onclick = (e) => {
      const t = e.target.closest('[data-wprog]'); if (!t) return;
      watchProg = watchProg === t.dataset.wprog ? null : t.dataset.wprog;
      watchCat = 'all'; watchAll = false;
      drawWatch(); drawPrograms();
      if (watchProg && window.innerWidth <= 1080) $('#watch').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  // 判断提醒：一行告知差异与待确认的规则修订，不展开细节；详情在人才评价规则的判断对照和规则里
  function drawJudge() {
    const host = $('#jsig'); if (!host) return;
    const sigs = st.judgeSignals().slice(0, 1), rules = st.rulesToConfirm();
    // 只说一句结论，细节放在悬停说明和目标页里
    // 口径：前段给了明确判断的人里，后段结论不同的人数（见 store.judgeSignals）；多维度时取不一致最多的那个维度并写明
    const worst = (g) => g.dims.slice().sort((a, b) => b.diff - a.diff)[0];
    const sigText = (g) => { const d = worst(g); return `${g.b.name.replace('判断对照', '').trim()}${g.chain.dims.length > 1 ? ` · ${d.name}` : ''} ${d.diff} 人前后判断不一致${g.attrib === 'open' ? '，HR 归因中' : ''}`; };
    const ruleName = (x) => (x.r.line ? st.FRONT_LINES.find((l) => l[0] === x.r.line)?.[1] : '') || `「${st.ruleKindName(x.kind)}」规则`;
    const lines = [
      ...sigs.map((g) => html`<a href="judge.html?id=${g.b.id}" title="${UI.judgeTipText(g)}">${icon('swap')}<span>${sigText(g)}</span></a>`),
      ...rules.map((x) => html`<a href="${x.href}" title="${x.r.why}">${icon('grid')}<span>${ruleName(x)}有一条修订待你确认</span></a>`),
    ];
    host.hidden = !lines.length;
    mount(host, html`${lines}`);
  }

  // 我的关注：动态（关注之后的已确认进展）和名单两种看法；只对本人可见（v1.5 3.26.2）
  // 「进入值得关注」左侧已经列出，动态里不再重复
  let followView = 'feed';
  const FEED_KIND = { event: '关键事件', watch: '值得关注', action: '行动', track: '重点跟踪', reco: '推荐方向' };
  function drawFollows() {
    const host = $('#follows'); if (!host) return;
    const list = st.followList(), feed = st.followFeed().filter((x) => x.kind !== 'watch').slice(0, 5);
    const fresh = (pid) => st.followFeed(pid).find((x) => x.kind !== 'watch');
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
    // 推荐的进展跟着学员走：每人只显示本人最近一次推荐
    const recos = st.myRecos(), recoOf = (pid) => recos.find((c) => c.person === pid);
    const recoLine = (c) => html`<button class="n-students__reco" type="button" data-recoview="${c.id}">${icon('target', 12)}<span>${st.fitText(c.dir)} · ${c.state === 'pending' ? 'HR 核实中' : c.state === 'verified' ? `${st.person(c.verifiedBy).name}已核实，进入发展方向` : `${st.person(c.verifiedBy).name}不采纳：${c.rejectWhy}`}</span></button>`;
    const row = (p) => {
      const reco = recoOf(p.id);
      const land = st.landingOf(p.id), topic = land && st.project(land.row[1]);
      const mine = S.events.filter((e) => e.kind === 'obs' && e.people.includes(p.id) && e.recorder === me && e.date).sort((a, b) => b.date.localeCompare(a.date));
      const week = mine.filter((e) => e.date >= since).length;
      return html`<li>${raw(`<a href="person.html?id=${p.id}" data-peek="p:${p.id}" tabindex="-1" aria-hidden="true">`)}${UI.avatar(p.id)}</a>
        <div><a class="nt-plink" href="person.html?id=${p.id}" data-peek="p:${p.id}"><b>${p.name}</b></a><small>${topic ? `${topic.name} · ` : ''}${week ? `本周记了 ${week} 件` : '本周待记'}${mine[0] ? ` · 最近 ${NT.md(mine[0].date)}` : ''}</small>${reco ? recoLine(reco) : ''}</div>
        <div class="n-students__acts"><a class="n-btn n-btn--sm n-btn--ink" href="record.html?person=${p.id}">${icon('pen')}记一件事</a>${st.canRecommend(p.id) ? html`<button class="n-btn n-btn--sm" type="button" data-reco="${p.id}"${raw(reco ? ' title="推荐另一个发展方向"' : '')}>${icon('target')}${reco ? '再推荐' : '推荐'}</button>` : ''}</div></li>`;
    };
    const todo = list.filter((p) => !S.events.some((e) => e.kind === 'obs' && e.people.includes(p.id) && e.recorder === me && e.date >= since)).length;
    $('#stu-total').textContent = `${list.length} 人`;
    const pending = recos.filter((c) => c.state === 'pending').length;
    $('#stu-meta').textContent = !list.length ? '' : [todo ? `本周还有 ${todo} 人没记` : '本周每人都记过了', pending && `${pending} 条推荐 HR 核实中`].filter(Boolean).join(' · ');
    mount($('#students'), list.length ? html`<ul class="n-students__list">${list.map(row)}</ul>` : html`<div class="nt-empty">分配给你的学员会出现在这里。</div>`);
  }
  // 本人提交的一条推荐：方向、理由、引用的事和 HR 的处理
  async function recoView(id) {
    const c = st.myRecos().find((x) => x.id === id); if (!c) return;
    const p = st.person(c.person), evs = c.evs.map((e) => st.get().events.find((x) => x.id === e)).filter(Boolean);
    const state = c.state === 'pending' ? html`<span class="n-astate" data-s="doing">HR 核实中</span>`
      : c.state === 'verified' ? html`<span class="n-astate" data-s="done">已核实</span><small>${st.person(c.verifiedBy).name} ${NT.md(c.verifiedAt)} 核实，已进入档案的发展方向</small>`
      : html`<span class="n-astate" data-s="cancel">不采纳</span><small>${st.person(c.verifiedBy).name} ${NT.md(c.verifiedAt)}：${c.rejectWhy}</small>`;
    const r = await NT.dialog({ title: `推荐方向：${p.name}`, cls: 'n-recoview',
      body: html`<dl class="n-recoview__dl"><dt>适合做</dt><dd><b>${st.template(c.dir)?.name}</b></dd><dt>状态</dt><dd class="n-recoview__st">${state}</dd><dt>理由</dt><dd>${c.why}</dd><dt>依据</dt><dd><ul>${evs.map((e) => html`<li>${e.title}<small>${NT.md(e.date)}</small></li>`)}</ul></dd><dt>提交</dt><dd>${NT.md(c.at)}</dd></dl>`,
      actions: [{ label: '关闭', value: 'cancel', cls: 'n-btn--ghost' }, { label: '看档案', value: 'open', cls: 'n-btn--ink' }] });
    if (r === 'open') location.href = `person.html?id=${c.person}`;
  }
  function wireMentor() {
    $('#stu-toggle').addEventListener('click', (e) => {
      const btn = e.currentTarget; stuOpen = !stuOpen;
      btn.setAttribute('aria-expanded', String(stuOpen));
      btn.querySelector('.n-chgtray__act').textContent = stuOpen ? '收起' : '展开';
      const panel = $('#stu-panel'); panel.toggleAttribute('data-open', stuOpen); panel.inert = !stuOpen;
    });
    $('#students').addEventListener('click', (e) => {
      const v = e.target.closest('[data-recoview]'); if (v) { recoView(v.dataset.recoview); return; }
      const r = e.target.closest('[data-reco]'); if (r) UI.recoDialog(r.dataset.reco, drawMentor);
    });
  }

})();
