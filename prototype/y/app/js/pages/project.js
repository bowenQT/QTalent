/* 项目详情：概览（里程碑、近期动态）、看板（绑定仓库的 Issue 和 PR，按 GitHub 状态分列）、关键事件（按来源筛选）、成员；右栏是属性与用人需求。
   员工视角只看成员和属性。
   没有关联事件和方案的项目可以删除（5 秒撤销）；已有关联的只能归档。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('id');

  const visible = () => {
    const p = st.project(id); if (!p) return false;
    return st.search('').projects.some((x) => x.id === id);
  };
  const exists = !!st.project(id);
  NT.shell({
    nav: 'projects', title: st.project(id)?.name || '项目', crumbs: [['项目与课题', 'projects.html']],
    allow: visible,
    ...(exists
      ? { denyTitle: '这个项目在你的查看范围之外', denyText: '员工只能看到本人参与的项目，导师只能看到所带批次的课题。' }
      : { denyTitle: '项目链接失效', denyText: '项目可能已删除，或链接有误。回到项目列表重新进入。', denyActions: html`<a class="n-btn n-btn--sm" href="projects.html">回到项目列表</a>` }),
    view: () => `项目 · ${st.project(id)?.status || ''}`,
    render,
  });

  // 添加成员的候选：本视角能完整查看或所带的学员里，还不在项目里的人
  const candidates = () => {
    const cur = new Set(st.membersOf(id).map((m) => m.person));
    return st.visiblePeople().filter((x) => !cur.has(x.id) && ['full', 'mentor'].includes(st.scope(x.id)));
  };

  // 关键事件的来源：带 GitHub 依据的算 GitHub；从投递来的按投递入口（企业微信小犇、MCP、统一投递、手机）；其余按第一份材料
  const VIA = { gh: ['branch', 'GitHub'], wecom: ['chat', st.ENTRY.wecom], mcp: ['code', st.ENTRY.mcp], web: ['upload', st.ENTRY.web], mobile: ['phone', st.ENTRY.mobile], doc: ['doc', '材料与记录'] };
  const VIA_TABS = [['all', '全部'], ['gh', 'GitHub'], ['wecom', '企业微信 · 小犇'], ['mcp', 'MCP'], ['doc', '材料与记录']];
  const viaOf = (e) => {
    const g = e.srcs.find((x) => x.type === 'gh');
    if (g) return { k: 'gh', label: g.label.replace(/^GitHub：[\w.-]+\//, 'GitHub · ') };
    const d = (st.get().intake?.drops || []).find((x) => x.id === e.drop || x.evs?.includes(e.id));
    if (d) return { k: d.entry, label: d.tool ? `${VIA[d.entry][1]} · ${d.tool}` : VIA[d.entry][1] };
    return { k: 'doc', label: e.srcs[0]?.label || '直接记录' };
  };
  const viaGroup = (k) => (['web', 'mobile'].includes(k) ? 'doc' : k);
  const viaChip = (v) => html`<span class="n-via n-via--${viaGroup(v.k)}">${icon(VIA[v.k][0], 12)}${v.label}</span>`;
  // 第六期课题的小组评审节点（团队级，不拆到人）
  const MS_AT = { MS1: '2026-07-17', MS2: '2026-07-31', MS3: '2026-08-14', MS4: '2026-08-28' };
  const VERB = { 合并于: '合并了', 创建于: '创建了', 关闭于: '关闭了' };
  let tab = NT.param('tab') || 'overview', via = 'all', bRepo = '', bWho = '', bKind = '';

  function render(main) {
    const p = st.project(id), role = st.role(), S = st.get();
    const basic = role === 'self';
    const edit = st.canEditProject(p);
    const staff = st.canStaff(id);
    const all = st.membersOf(id, true).sort((a, b) => (a.to ? 1 : 0) - (b.to ? 1 : 0) || (a.role === 'owner' ? -1 : 1));
    // 已结束、已归档的项目：成员都有退出日期，列出所有参与过的人；进行中的项目：现任成员一组，已退出的另列一组，计数与列表行数一致
    const ended = ['已结束', '已归档'].includes(p.status);
    const curM = all.filter((m) => !m.to), goneM = ended ? [] : all.filter((m) => m.to), shownM = ended ? all : curM;
    const cand = edit && !basic ? candidates() : [];
    const mrow = (m) => html`<li class="${m.to ? 'is-left' : ''}"><div class="n-person">${UI.avatar(m.person, 'sm')}<span class="n-person__name">${basic ? st.person(m.person).name : UI.plink(m.person)}</span></div><span class="n-members__role">${m.role}${m.mode ? ` · ${m.mode}` : ''}</span><span class="n-members__when">${NT.md(m.from)}${m.to ? ` – ${NT.md(m.to)}` : ' 起'}${edit && !m.to && !basic ? html` <button class="n-link" type="button" data-end="${m.person}">退出</button>` : ''}</span></li>`;
    const log = S.memberLog.filter((l) => l.project === id);
    const evs = basic ? [] : S.events.filter((e) => e.project === id && e.kind === 'obs' && e.people.some((x) => st.scope(x) && st.scope(x) !== 'self')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const plans = S.plans.filter((x) => x.project === id);
    const need = S.needs.find((n) => n.project === id);
    const linked = st.projectLinked(id);
    const repos = (p.repos || []).filter((r) => NT.gh.repos().includes(r));
    const items = basic ? [] : NT.gh.repoItems(repos);
    const team = p.batch === 'b-xe6' ? NT.XE6.teams.find((t) => t.id === id) : null;
    const membersCard = html`<article class="n-card"><h3 class="n-section-title">成员与角色${!shownM.length ? '' : ended ? html`<span class="nt-muted" style="margin-left:6px;font-weight:400">${shownM.length} 人参与</span>` : html`<span class="n-count is-quiet">${shownM.length}</span>`}</h3>
      ${!p.owner ? html`<div class="n-ownerless" style="margin-bottom:var(--s-3)"><span class="n-slot__empty">${icon('plus', 14)}</span><div><b>owner 待定</b><div class="nt-muted">${p.status}</div></div>${st.can('findOwner') ? html`<a class="n-btn n-btn--sm n-btn--light" href="staffing.html?project=${id}">${icon('spark')}发起找 owner</a>` : ''}</div>` : ''}
      ${shownM.length ? html`<ul class="n-members">${shownM.map(mrow)}</ul>` : html`<div class="nt-empty">项目成员会出现在这里。</div>`}
      ${goneM.length ? html`<h4 class="n-action__grp">已退出<span>${goneM.length}</span></h4><ul class="n-members">${goneM.map(mrow)}</ul>` : ''}
    </article>`;
    const logCard = html`<article class="n-card"><h3 class="n-section-title">成员变动记录</h3>
      ${log.length ? html`<ul class="n-mhist" style="margin:0">${log.map((l) => html`<li><time>${NT.md(l.at)}</time>${l.text} · ${st.person(l.by).name}</li>`)}</ul>` : html`<div class="nt-empty">还没有变动。</div>`}</article>`;
    const head = html`<header class="nt-head" style="align-items:flex-start">
        <div class="n-project__head" style="flex:1 1 280px;min-width:0"><span class="n-avatar n-avatar--lg" style="--hue:220;border-radius:14px">${icon('folder', 20)}</span>
          <div style="min-width:0"><h1 style="margin:0;font-size:var(--t-xl)">${p.name}</h1><p class="n-project__goal" style="font-size:var(--t-body)">${p.goal}</p></div></div>
        ${edit && !basic ? html`<div class="nt-head__acts">${cand.length ? html`<button class="n-btn n-btn--sm" type="button" id="add">${icon('plus')}添加成员</button>` : ''}
          <span class="n-menuwrap"><button class="n-btn n-btn--sm n-btn--ghost" type="button" id="more">${icon('more')}更多</button></span></div>` : ''}
      </header>
      ${NT.param('created') ? html`<div class="n-notice is-plain" style="margin-bottom:var(--s-4)">${icon('check')}<div>项目已创建。${p.owner ? '' : '还没有 owner，可以'}${!p.owner && st.can('findOwner') ? html`<a href="staffing.html?project=${id}">发起找 owner</a>` : ''}</div></div>` : ''}`;
    if (basic) {
      mount(main, html`${head}<div class="nt-split"><div class="nt-grid">${membersCard}</div><aside class="nt-grid">${props(p, repos, edit, true)}${logCard}</aside></div>`);
      wire(main, p, linked);
      return;
    }
    const TABS = [['overview', '概览'], ['board', '看板', items.length], ['events', '关键事件', evs.length], ['members', '成员', shownM.length]];
    if (!TABS.some(([k]) => k === tab)) tab = 'overview';
    mount(main, html`${head}
      <div class="nt-split ${tab === 'board' ? 'is-board' : ''}" id="pjsplit">
        <div class="nt-grid" style="gap:var(--s-4);min-width:0">
          <div class="n-tabs" role="tablist" id="ptabs">${TABS.map(([k, l, n]) => html`<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}" aria-controls="pj-${k}" tabindex="${k === tab ? 0 : -1}">${l}${n ? html`<span class="n-count is-quiet">${n}</span>` : ''}</button>`)}</div>
          <div role="tabpanel" id="pj-overview" class="nt-grid" ${NT.raw(tab === 'overview' ? '' : 'hidden')}>${overview(p, team, evs, items, log)}</div>
          <div role="tabpanel" id="pj-board" ${NT.raw(tab === 'board' ? '' : 'hidden')}><div id="board"></div></div>
          <div role="tabpanel" id="pj-events" ${NT.raw(tab === 'events' ? '' : 'hidden')}><div id="evlist"></div></div>
          <div role="tabpanel" id="pj-members" class="nt-grid" ${NT.raw(tab === 'members' ? '' : 'hidden')}>${membersCard}${logCard}</div>
        </div>
        <aside class="nt-grid nt-sticky">
          ${props(p, repos, edit, false)}
          ${staff && (need || plans.length || !p.owner) ? html`<article class="n-card"><h3 class="n-section-title">用人需求与方案</h3>
            ${need ? html`<ul class="n-reqs" style="margin:0 0 var(--s-3)">${(plans.filter((x) => x.reqs).pop()?.reqs || need.reqs).map((r) => html`<li><span class="n-badge">${r.must ? '必须' : '加分'}</span><span>${r.text}</span></li>`)}</ul>` : html`<p class="nt-muted" style="margin:0 0 var(--s-3)">用人需求会出现在这里。</p>`}
            ${plans.slice().reverse().map((pl) => html`<div class="n-version" style="margin-bottom:6px"><span class="n-version__tag ${pl.status === 'draft' ? 'is-draft' : pl.status === 'confirmed' ? 'is-frozen' : ''}">${pl.status === 'draft' ? '草稿' : pl.status === 'confirmed' ? '已确认' : '已被替代'} v${pl.version}</span><span style="color:var(--ink-3)">${st.person(pl.by).name} · ${NT.md(pl.at)}</span>${pl.status === 'confirmed' ? html`<span class="n-seal n-seal--sm" style="margin-left:auto">定</span>` : ''}</div>`)}
            ${st.can('findOwner') ? html`<a class="n-btn n-btn--sm ${need ? '' : 'n-btn--light'}" href="staffing.html?project=${id}" style="margin-top:var(--s-2)">${icon('spark')}${need ? '打开找人文档' : '发起找 owner'}</a>` : ''}
          </article>` : ''}
        </aside>
      </div>`);
    NT.tabs($('#ptabs'), (t) => { tab = t; $('#pjsplit').classList.toggle('is-board', t === 'board'); });
    drawBoard(p, repos, items, edit);
    drawEvents(evs);
    wire(main, p, linked);
  }

  // 右栏属性：像项目看板的属性面板，一行一项
  function props(p, repos, edit, basic) {
    const ms = st.membersOf(id, ['已结束', '已归档'].includes(p.status));
    const batch = p.batch && st.get().batches.find((b) => b.id === p.batch);
    return html`<article class="n-card n-props">
      <dl>
        <dt>状态</dt><dd>${UI.pstatus(p.status)}</dd>
        <dt>${p.type === 'XEngineer 课题' ? '导师' : 'owner'}</dt><dd>${p.owner ? html`<span class="n-person">${UI.avatar(p.owner, 'sm')}${basic ? st.person(p.owner).name : UI.plink(p.owner)}</span>` : html`<span class="nt-muted">待定</span>`}</dd>
        <dt>成员</dt><dd><span class="n-project__members" style="margin:0">${ms.slice(0, 6).map((m) => UI.avatar(m.person, 'sm'))}<span>${ms.length} 人</span></span></dd>
        <dt>时间</dt><dd>${NT.md(p.from)} – ${NT.md(p.to)}</dd>
        <dt>类型</dt><dd>${p.type}</dd>
        ${batch ? html`<dt>所属</dt><dd>${batch.name || 'XEngineer 第六期'}</dd>` : ''}
        <dt>团队</dt><dd>${st.orgPath(p.org)}</dd>
        ${basic ? '' : html`<dt>代码仓库</dt><dd><div class="n-props__repos">${repos.length ? repos.map((r) => html`<span class="n-repo">${icon(NT.gh.repo(r)?.private ? 'lock' : 'book', 12)}${NT.gh.short(r)}</span>`) : html`<span class="nt-muted">未关联</span>`}${edit ? html`<button class="n-link" type="button" id="repos">${repos.length ? '调整' : '关联仓库'}</button>` : ''}</div></dd>`}
        <dt>创建</dt><dd>${st.person(p.creator).name}</dd>
      </dl></article>`;
  }

  function overview(p, team, evs, items, log) {
    const feed = [
      ...evs.map((e) => ({ at: e.date || '', ic: VIA[viaOf(e).k][0], body: html`${e.people.map((x) => st.person(x).name).join('、')} · <a class="nt-plink" href="person.html?id=${e.people[0]}#ev-${e.id}">${e.title}</a>`, chip: viaChip(viaOf(e)) })),
      ...items.filter((g) => VERB[g.atLabel]).map((g) => ({ at: g.at, ic: g.kind === 'pr' ? 'branch' : 'issue', body: html`${g.owner.pid ? st.person(g.owner.pid).name : `@${g.owner.login}`} ${VERB[g.atLabel]}${g.kind === 'pr' ? ' PR' : ' Issue'}「${g.title}」`, chip: html`<span class="n-via n-via--gh">${icon('branch', 12)}${g.ref}</span>` })),
      ...log.map((l) => ({ at: l.at, ic: 'users', body: html`${l.text}`, chip: html`<span class="nt-muted">${st.person(l.by).name}</span>` })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
    return html`
      ${team ? html`<article class="n-card"><h3 class="n-section-title">里程碑</h3>
        <ol class="n-msline">${Object.keys(team.ms).map((k) => { const done = MS_AT[k] <= NT.TODAY; return html`<li class="${done ? 'is-done' : ''}"><span class="n-msline__dot">${done ? icon('check', 12) : ''}</span><b>${k}</b><small>${NT.md(MS_AT[k])} · 小组评审${done ? '已完成' : ''}</small></li>`; })}
          <li class="${p.to <= NT.TODAY ? 'is-done' : ''}"><span class="n-msline__dot">${p.to <= NT.TODAY ? icon('check', 12) : ''}</span><b>${team.live}</b><small>${NT.md('2026-08-30')}</small></li></ol></article>` : ''}
      <div class="n-pjstats">
        <div><b>${evs.length}</b><span>关键事件</span></div>
        <div><b>${items.filter((g) => g.lane !== 'done').length}</b><span>进行中的 Issue / PR</span></div>
        <div><b>${items.filter((g) => g.state === '已合并').length}</b><span>已合并的 PR</span></div>
      </div>
      <article class="n-card"><h3 class="n-section-title">近期动态</h3>
        ${feed.length ? html`<ul class="n-feed">${feed.map((f) => html`<li><span class="n-feed__ic">${icon(f.ic, 14)}</span><div class="n-feed__body">${f.body}<div class="n-feed__meta">${f.at ? NT.md(f.at) : '时间未知'} · ${f.chip}</div></div></li>`)}</ul>` : html`<div class="nt-empty">记录、Issue 和 PR 会按时间出现在这里。</div>`}
      </article>`;
  }

  function drawBoard(p, repos, items, edit) {
    const host = $('#board'); if (!host) return;
    if (!repos.length) {
      mount(host, html`<div class="n-card nt-empty n-board__empty">${icon('book', 20)}<p>${edit ? '关联代码仓库后，这里按 GitHub 上的状态显示 Issue 和 PR。' : '这个项目还没有关联代码仓库。'}</p>${edit ? html`<button class="n-btn n-btn--sm" type="button" data-repos>关联仓库</button>` : ''}</div>`);
      return;
    }
    const whoKey = (g) => g.owner.pid || `@${g.owner.login}`;
    const whos = [...new Set(items.map(whoKey))];
    const list = items.filter((g) => (!bRepo || g.repo === bRepo) && (!bWho || whoKey(g) === bWho) && (!bKind || g.kind === bKind));
    const card = (g) => {
      const pid = g.owner.pid, canRec = pid && st.can('record', pid);
      return html`<article class="n-issue">
        <div class="n-issue__top">${icon(g.kind === 'pr' ? 'branch' : 'issue', 14)}<span>${g.ref}</span>${g.lane === 'done' ? html`<span class="n-issue__st ${g.tone ? 'is-yes' : ''}">${g.state.replace(' · 已完成', '')}</span>` : ''}</div>
        <p class="n-issue__title">${g.title}</p>
        <div class="n-issue__foot">
          ${pid ? html`<span class="n-person">${UI.avatar(pid, 'sm')}${st.person(pid).name}</span>` : html`<span class="n-issue__ext">@${g.owner.login}<small>未关联</small></span>`}
          ${g.reviewers.length ? html`<span class="n-issue__rv" title="评审">${icon('eye', 12)}${g.reviewers.map((r) => (r.pid ? st.person(r.pid).name : `@${r.login}`)).join('、')}</span>` : ''}
          ${g.talk[0] ? html`<span class="n-issue__talk">${icon('chat', 12)}${g.talk[0]}</span>` : ''}
          <time>${NT.md(g.at)}</time>
        </div>
        ${canRec ? html`<a class="n-issue__rec" href="record.html?person=${pid}&gh=${encodeURIComponent(g.key)}">${icon('pen', 12)}记一件事</a>` : ''}
      </article>`;
    };
    mount(host, html`<div class="n-board__bar">
        <select class="n-select" id="b-repo" aria-label="仓库"><option value="">全部仓库</option>${repos.map((r) => html`<option value="${r}" ${NT.raw(r === bRepo ? 'selected' : '')}>${NT.gh.short(r)}</option>`)}</select>
        <select class="n-select" id="b-who" aria-label="负责人"><option value="">全部负责人</option>${whos.map((w) => html`<option value="${w}" ${NT.raw(w === bWho ? 'selected' : '')}>${w.startsWith('@') ? `${w}（未关联）` : st.person(w).name}</option>`)}</select>
        <div class="n-seg" id="b-kind" role="group" aria-label="类型">${[['', '全部'], ['issue', 'Issue'], ['pr', 'PR']].map(([k, l]) => html`<button type="button" data-k="${k}" aria-pressed="${k === bKind}">${l}</button>`)}</div>
        <span class="n-board__sync">${icon('retry', 12)}${NT.gh.app().synced} 同步${UI.hint('列跟随 GitHub 上的状态，在这里不能拖动')}</span>
      </div>
      <div class="n-board">${NT.gh.LANES.map(([k, l]) => { const ls = list.filter((g) => g.lane === k); return html`<section class="n-lane n-lane--${k}"><h4 class="n-lane__head"><i></i>${l}<span>${ls.length}</span></h4>${ls.length ? ls.map(card) : html`<p class="n-lane__empty">没有</p>`}</section>`; })}</div>`);
    $('#b-repo').addEventListener('change', (e) => { bRepo = e.target.value; drawBoard(p, repos, items, edit); });
    $('#b-who').addEventListener('change', (e) => { bWho = e.target.value; drawBoard(p, repos, items, edit); });
    $('#b-kind').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; bKind = b.dataset.k; drawBoard(p, repos, items, edit); });
  }

  function drawEvents(evs) {
    const host = $('#evlist'); if (!host) return;
    const n = (k) => (k === 'all' ? evs.length : evs.filter((e) => viaGroup(viaOf(e).k) === k).length);
    const list = evs.filter((e) => via === 'all' || viaGroup(viaOf(e).k) === via);
    mount(host, html`<div class="n-chips" role="group" aria-label="按来源筛选" id="evvia">${VIA_TABS.filter(([k]) => k === 'all' || n(k)).map(([k, l]) => html`<button class="n-chip" type="button" data-v="${k}" aria-pressed="${k === via}">${l}<span class="n-count is-quiet">${n(k)}</span></button>`)}</div>
      <article class="n-card">${list.length ? html`<ul class="n-evrows">${list.map((e) => html`<li><div class="n-evrows__main"><a class="nt-plink" href="person.html?id=${e.people[0]}#ev-${e.id}"><b>${e.title}</b></a>
          <div class="n-evrows__meta">${e.people.map((x) => st.person(x).name).join('、')} · ${st.person(e.recorder).name}记录${e.scores.some((x) => x.st === 'ai') ? ' · 有 AI 建议分待确认' : ''}</div></div>
          <div class="n-evrows__side">${viaChip(viaOf(e))}<time>${e.date ? NT.md(e.date) : '时间未知'}</time></div></li>`)}</ul>` : html`<div class="nt-empty">还没有挂在这个项目上的事件。</div>`}</article>`);
    $('#evvia').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; via = b.dataset.v; drawEvents(evs); });
  }

  async function editRepos() {
    const p = st.project(id), open = NT.gh.repos(), cur = new Set(p.repos || []);
    const r = await NT.dialog({
      title: `「${p.name}」的代码仓库`,
      body: html`<div class="n-ghapp__pick">${NT.gh.ORG_REPOS.map((x) => { const ok = open.includes(x.name); return html`<label class="n-check ${ok ? '' : 'is-off'}"><input type="checkbox" value="${x.name}" ${NT.raw(cur.has(x.name) && ok ? 'checked' : '')} ${NT.raw(ok ? '' : 'disabled')}><b>${NT.gh.short(x.name)}</b>${x.private ? html`<span class="n-badge">${icon('lock', 12)}私有</span>` : ''}<span class="nt-muted">${ok ? x.desc : '没有开放给本系统'}</span></label>`; })}</div>
        ${open.length < NT.gh.ORG_REPOS.length ? html`<p class="nt-caption" style="margin-top:var(--s-3)">要用的仓库不在列表里，请系统管理员在 GitHub App 里开放。</p>` : ''}`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink', read: (d) => NT.$$('input:checked', d).map((x) => x.value) }],
    });
    if (r?.value !== 'ok') return;
    const before = p.repos || [];
    p.repos = r.data; st.save(); render($('#main'));
    NT.toast(r.data.length ? `已关联 ${r.data.length} 个仓库` : '已取消关联仓库', { undo: () => { p.repos = before; st.save(); render($('#main')); } });
  }

  function wire(main, p, linked) {
    $('#add')?.addEventListener('click', addMember);
    if ($('#more')) NT.menu($('#more'), [
      { label: '编辑基本信息', icon: 'pen', run: editInfo },
      p.status !== '已归档' && { label: '归档', icon: 'archive', run: archive },
      { label: linked ? '删除（已有关联，只能归档）' : '删除', icon: 'trash', danger: true, run: () => (linked ? archive(true) : remove()) },
    ].filter(Boolean));
    main.onclick = async (e) => {
      if (e.target.closest('#repos, [data-repos]')) { editRepos(); return; }
      const end = e.target.closest('[data-end]'); if (!end) return;
      const who = st.person(end.dataset.end);
      const r = await NT.dialog({ title: `${who.name}退出「${p.name}」？`, body: html`<label class="n-field"><span class="n-field__label">原因 <small>可选，会写进成员记录</small></span><input class="n-input" id="why" placeholder="比如：转去增长中台数据迁移"></label>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '确认退出', value: 'ok', cls: 'n-btn--ink', read: (d) => d.querySelector('#why').value.trim() }] });
      if (r?.value === 'ok') { st.endMember(id, who.id, r.data); render(main); NT.toast(`${who.name}已退出，记录保留在成员历史里`); }
    };
  }

  async function addMember() {
    const p = st.project(id);
    const cand = candidates();
    if (!cand.length) { NT.toast('你能查看的人都已经在这个项目里了'); return; }
    const r = await NT.dialog({
      title: `添加成员到「${p.name}」`,
      body: html`<div class="nt-grid" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">谁</span><select class="n-select" id="am-p">${cand.map((x) => html`<option value="${x.id}">${x.name} · ${st.orgShort(x.org)}${st.projectLoad(x.id).cur ? ` · 已在 ${st.projectLoad(x.id).cur} 个项目` : ''}</option>`)}</select></label>
        <div class="nt-cols" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">角色</span><input class="n-input" id="am-r" value="成员"></label><label class="n-field"><span class="n-field__label">投入</span><select class="n-select" id="am-m"><option>全职</option><option selected>兼职</option><option>顾问</option></select></label></div></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '添加', value: 'ok', cls: 'n-btn--ink', read: (d) => ({ person: d.querySelector('#am-p').value, role: d.querySelector('#am-r').value.trim() || '成员', mode: d.querySelector('#am-m').value }) }],
    });
    if (r?.value !== 'ok') return;
    const added = st.addMember({ project: id, ...r.data, from: NT.TODAY, to: null, by: st.me().id });
    if (!added) { NT.toast('没能添加：这个人已在项目里，或不在你的查看范围内'); return; }
    render($('#main'));
    const n = st.projectLoad(r.data.person).cur;
    NT.toast(`已添加${st.person(r.data.person).name}${n > 1 ? `，现在在 ${n} 个项目里` : ''}`);
  }
  async function editInfo() {
    const p = st.project(id);
    const r = await NT.dialog({ title: '编辑基本信息', body: html`<div class="nt-grid" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">目标</span><textarea class="n-textarea" id="ed-goal">${p.goal}</textarea></label><label class="n-field"><span class="n-field__label">状态</span><select class="n-select" id="ed-s">${['筹备中', '进行中', '已结束'].map((s) => html`<option ${s === p.status ? 'selected' : ''}>${s}</option>`)}</select></label></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink', read: (d) => ({ goal: d.querySelector('#ed-goal').value.trim(), status: d.querySelector('#ed-s').value }) }] });
    if (r?.value === 'ok') { Object.assign(p, r.data); st.save(); render($('#main')); NT.toast('已保存'); }
  }
  async function archive(fromDelete) {
    const p = st.project(id);
    const v = await NT.dialog({ title: fromDelete ? '改为归档？' : `归档「${p.name}」？`,
      body: html`<p>${fromDelete ? '事件和方案引用了这个项目，归档能保留这些记录的出处。' : ''}归档后，成员、事件和方案都保留，项目移到「已归档」，可以随时查看。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: fromDelete ? '改为归档' : '归档', value: 'ok', cls: 'n-btn--ink', icon: 'archive' }] });
    if (v !== 'ok') return;
    const prev = p.status; p.status = '已归档'; st.save(); render($('#main'));
    NT.toast('已归档。成员、事件和方案都保留', { undo: () => { p.status = prev; st.save(); render($('#main')); } });
  }
  function remove() {
    const S = st.get(), p = st.project(id);
    const snap = { p: NT.clone(p), members: S.members.filter((m) => m.project === id).map(NT.clone), i: S.projects.indexOf(p) };
    if (!st.removeProject(id)) { NT.toast('项目已经有关联资料，不能删除，请改为归档'); render($('#main')); return; }
    mount($('#main'), UI.state({ ip: 'done', title: `已删除「${snap.p.name}」`, text: '5 秒内可以撤销。之后回到项目列表。' }));
    UI.mountIPs($('#main'));
    let undone = false;
    NT.toast('项目已删除', { undo: () => { undone = true; S.projects.splice(snap.i, 0, snap.p); S.members.push(...snap.members); st.save(); render($('#main')); }, onExpire: () => { if (!undone) location.href = 'projects.html'; } });
  }
})();
