/* 项目详情：基本信息、成员与角色、成员历史、关联事件、用人需求与方案。
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
  NT.shell({
    nav: 'projects', title: st.project(id)?.name || '项目', crumbs: [['项目', 'projects.html']],
    allow: visible, denyTitle: '你看不到这个项目', denyText: '员工只能看到本人参与的项目，导师只能看到所带批次的议题。',
    view: () => `项目 · ${st.project(id)?.status}`,
    render,
  });

  function render(main) {
    const p = st.project(id), role = st.role(), S = st.get();
    const basic = role === 'self';
    const edit = st.canEditProject(p);
    const staff = st.canStaff(id);
    const all = st.membersOf(id, true).sort((a, b) => (a.to ? 1 : 0) - (b.to ? 1 : 0) || (a.role === 'owner' ? -1 : 1));
    const log = S.memberLog.filter((l) => l.project === id);
    const evs = basic ? [] : S.events.filter((e) => e.project === id && e.kind === 'obs' && e.people.some((x) => st.scope(x) && st.scope(x) !== 'self')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const plans = S.plans.filter((x) => x.project === id);
    const need = S.needs.find((n) => n.project === id);
    const linked = st.projectLinked(id);
    mount(main, html`
      <header class="nt-head" style="align-items:flex-start">
        <div class="n-project__head" style="flex:1;min-width:0"><span class="n-avatar n-avatar--lg" style="--hue:220;border-radius:14px">${icon('folder', 20)}</span>
          <div style="min-width:0"><h1 style="margin:0;font-size:var(--t-xl)">${p.name}</h1><p class="n-project__goal" style="font-size:var(--t-body)">${p.goal}</p>
            <div class="nt-row" style="margin-top:var(--s-2)">${UI.pstatus(p.status)}<span class="nt-muted">${p.type} · ${st.orgPath(p.org)} · ${NT.md(p.from)} – ${NT.md(p.to)} · ${st.person(p.creator).name}创建</span></div></div></div>
        ${edit && !basic ? html`<div class="nt-head__acts"><button class="n-btn n-btn--sm" type="button" id="add">${icon('plus')}添加成员</button>
          <span class="n-menuwrap"><button class="n-btn n-btn--sm n-btn--ghost" type="button" id="more">${icon('more')}更多</button></span></div>` : ''}
      </header>
      ${NT.param('created') ? html`<div class="n-notice is-plain" style="margin-bottom:var(--s-4)">${icon('check')}<div>项目已创建。${p.owner ? '' : '还没有 owner，可以'}${!p.owner && st.can('findOwner') ? html`<a href="staffing.html?project=${id}">发起找 owner</a>` : ''}</div></div>` : ''}
      <div class="nt-split">
        <div class="nt-grid">
          <article class="n-card"><h3 class="n-section-title">成员与角色<span class="n-count is-quiet">${all.filter((m) => !m.to).length}</span></h3>
            ${!p.owner ? html`<div class="n-ownerless" style="margin-bottom:var(--s-3)"><span class="n-slot__empty">${icon('plus', 14)}</span><div><b>owner 待定</b><div class="nt-muted">${p.status}</div></div>${st.can('findOwner') ? html`<a class="n-btn n-btn--sm n-btn--light" href="staffing.html?project=${id}">${icon('spark')}发起找 owner</a>` : ''}</div>` : ''}
            <ul class="n-members">${all.map((m) => html`<li class="${m.to ? 'is-left' : ''}"><div class="n-person">${UI.avatar(m.person, 'sm')}<span class="n-person__name">${basic ? st.person(m.person).name : UI.plink(m.person)}</span></div><span class="n-members__role">${m.role}${m.mode ? ` · ${m.mode}` : ''}</span><span class="n-members__when">${NT.md(m.from)}${m.to ? ` – ${NT.md(m.to)}` : ' 起'}${edit && !m.to && !basic ? html` <button class="n-link" type="button" data-end="${m.person}">退出</button>` : ''}</span></li>`)}</ul>
          </article>
          ${!basic ? html`<article class="n-card"><h3 class="n-section-title">关联事件<span class="n-count is-quiet">${evs.length}</span></h3>
            ${evs.length ? html`<ul class="nt-list">${evs.map((e) => html`<li><div class="nt-row" style="justify-content:space-between"><a class="nt-plink" href="person.html?id=${e.people[0]}#ev-${e.id}"><b>${e.title}</b></a><span class="nt-muted">${e.date ? NT.md(e.date) : '时间未知'}</span></div><div class="nt-muted">${e.people.map((x) => st.person(x).name).join('、')} · ${st.person(e.recorder).name}记录${e.scores.some((s) => s.st === 'ai') ? ' · 有 AI 建议分待确认' : ''}</div></li>`)}</ul>` : html`<div class="nt-empty">还没有挂在这个项目上的事件。</div>`}
          </article>` : html`<div class="n-lock">${icon('lock')}关联事件和用人方案对员工不可见。</div>`}
        </div>
        <aside class="nt-grid">
          ${!basic && staff && (need || plans.length || !p.owner) ? html`<article class="n-card"><h3 class="n-section-title">用人需求与方案</h3>
            ${need ? html`<ul class="n-reqs" style="margin:0 0 var(--s-3)">${(plans.filter((x) => x.reqs).pop()?.reqs || need.reqs).map((r) => html`<li><span class="n-badge">${r.must ? '必须' : '加分'}</span><span>${r.text}</span></li>`)}</ul>` : html`<p class="nt-muted" style="margin:0 0 var(--s-3)">还没有用人需求。</p>`}
            ${plans.slice().reverse().map((pl) => html`<div class="n-version" style="margin-bottom:6px"><span class="n-version__tag ${pl.status === 'draft' ? 'is-draft' : pl.status === 'confirmed' ? 'is-frozen' : ''}">${pl.status === 'draft' ? '草稿' : pl.status === 'confirmed' ? '已确认' : '已被替代'} v${pl.version}</span><span style="color:var(--ink-3)">${st.person(pl.by).name} · ${NT.md(pl.at)}</span>${pl.status === 'confirmed' ? html`<span class="n-seal n-seal--sm" style="margin-left:auto">定</span>` : ''}</div>`)}
            ${st.can('findOwner') ? html`<a class="n-btn n-btn--sm ${need ? '' : 'n-btn--light'}" href="staffing.html?project=${id}" style="margin-top:var(--s-2)">${icon('spark')}${need ? '打开找人文档' : '发起找 owner'}</a>` : ''}
          </article>` : ''}
          <article class="n-card"><h3 class="n-section-title">成员变动记录</h3>
            ${log.length ? html`<ul class="n-mhist" style="margin:0">${log.map((l) => html`<li><time>${NT.md(l.at)}</time>${l.text} · ${st.person(l.by).name}</li>`)}</ul>` : html`<div class="nt-empty">还没有变动。</div>`}
            <p class="nt-caption">加入、退出、改角色都记时间和操作人，任用后复盘会用到。</p></article>
        </aside>
      </div>`);

    $('#add')?.addEventListener('click', addMember);
    if ($('#more')) NT.menu($('#more'), [
      { label: '编辑基本信息', icon: 'pen', run: editInfo },
      p.status !== '已归档' && { label: '归档', icon: 'archive', run: archive },
      { label: linked ? '删除（已有关联，只能归档）' : '删除', icon: 'trash', danger: true, run: () => (linked ? archive(true) : remove()) },
    ].filter(Boolean));
    main.onclick = async (e) => {
      const end = e.target.closest('[data-end]'); if (!end) return;
      const who = st.person(end.dataset.end);
      const r = await NT.dialog({ title: `${who.name}退出「${p.name}」？`, body: html`<label class="n-field"><span class="n-field__label">原因 <small>可选，会写进成员记录</small></span><input class="n-input" id="why" placeholder="比如：转去增长中台数据迁移"></label>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '确认退出', value: 'ok', cls: 'n-btn--ink', read: (d) => d.querySelector('#why').value.trim() }] });
      if (r?.value === 'ok') { st.endMember(id, who.id, r.data); render(main); NT.toast(`${who.name}已退出，记录保留在成员历史里`); }
    };
  }

  async function addMember() {
    const p = st.project(id);
    const cur = new Set(st.membersOf(id).map((m) => m.person));
    const cand = st.visiblePeople().filter((x) => !cur.has(x.id) && st.scope(x.id) === 'full');
    const r = await NT.dialog({
      title: `添加成员到「${p.name}」`,
      body: html`<div class="nt-grid" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">谁</span><select class="n-select" id="am-p">${cand.map((x) => html`<option value="${x.id}">${x.name} · ${st.orgShort(x.org)} · 已在 ${st.projectsOf(x.id).length} 个项目</option>`)}</select></label>
        <div class="nt-cols" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">角色</span><input class="n-input" id="am-r" value="成员"></label><label class="n-field"><span class="n-field__label">投入</span><select class="n-select" id="am-m"><option>全职</option><option selected>兼职</option><option>顾问</option></select></label></div></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '添加', value: 'ok', cls: 'n-btn--ink', read: (d) => ({ person: d.querySelector('#am-p').value, role: d.querySelector('#am-r').value.trim() || '成员', mode: d.querySelector('#am-m').value }) }],
    });
    if (r?.value !== 'ok') return;
    st.addMember({ project: id, ...r.data, from: NT.TODAY, to: null, by: st.me().id });
    render($('#main'));
    const n = st.projectsOf(r.data.person).length;
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
    const v = await NT.dialog({ title: fromDelete ? '这个项目不能删除，只能归档' : `归档「${p.name}」？`,
      body: html`<p>${fromDelete ? '已有关联的事件或方案快照引用了它，删除会让这些记录失去出处。' : ''}归档后项目不再出现在进行中的列表里，成员、事件和方案都保留，可以随时查看。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '归档', value: 'ok', cls: 'n-btn--ink', icon: 'archive' }] });
    if (v !== 'ok') return;
    const prev = p.status; p.status = '已归档'; st.save(); render($('#main'));
    NT.toast('已归档。成员、事件和方案都保留', { undo: () => { p.status = prev; st.save(); render($('#main')); } });
  }
  function remove() {
    const S = st.get(), p = st.project(id);
    const snap = { p: NT.clone(p), members: S.members.filter((m) => m.project === id).map(NT.clone), i: S.projects.indexOf(p) };
    st.removeProject(id);
    mount($('#main'), UI.state({ ip: 'done', title: `已删除「${snap.p.name}」`, text: '5 秒内可以撤销。之后回到项目列表。' }));
    UI.mountIPs($('#main'));
    let undone = false;
    NT.toast('项目已删除', { undo: () => { undone = true; S.projects.splice(snap.i, 0, snap.p); S.members.push(...snap.members); st.save(); render($('#main')); }, onExpire: () => { if (!undone) location.href = 'projects.html'; } });
  }
})();
