/* 手机确认方案：看方案摘要和与上一版的差异，确认当前版本并冻结快照。
   部门负责人可以看、可以请人确认，确认需要 CEO 或 HRBP；确认方案不等于人事动作已经执行。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('id');

  NT.mshell({
    tab: 'todo', title: id ? '确认方案' : '待确认的方案', back: id ? 'plan.html' : 'inbox.html',
    allow: (r) => ['ceo', 'hrbp', 'lead'].includes(r) && (!id || !st.plan(id) || st.canSeePlan(st.plan(id), r)),
    denyText: '方案只对 CEO、HRBP 和部门负责人开放。',
    demos: [['用人方案 v3（CEO）', 'plan.html?id=sp-search-3&as=ceo'], ['组织调整方案（HRBP）', 'plan.html?id=op-h2-1&as=hrbp'], ['部门负责人：无权确认', 'plan.html?id=sp-search-3&as=lead']],
    view: () => { const p = id && st.plan(id); return p ? `${p.kind === 'org' ? '组织调整方案' : '用人方案'} v${p.version} · ${p.status === 'confirmed' ? '已确认' : '草稿'}` : '方案列表'; },
    render: (main) => (id ? renderOne(main) : renderList(main)),
  });

  const nameOf = (p) => (p.kind === 'org' ? `${st.batch(p.batch).name} · 组织调整方案` : `${st.project(p.project).name} · 用人方案`);

  function renderList(main) {
    const plans = st.get().plans.filter((p) => (p.kind === 'org' || st.project(p.project)) && st.canSeePlan(p));
    const drafts = plans.filter((p) => p.status === 'draft'), confirmed = plans.filter((p) => p.status === 'confirmed').slice(-3).reverse();
    mount(main, html`
      <h3 class="m-h" style="margin-top:0">草稿 · 待确认</h3>
      ${drafts.length ? html`<ul class="m-list">${drafts.map((p) => M.row(`plan.html?id=${p.id}`, icon(p.kind === 'org' ? 'layers' : 'folder'), nameOf(p), `v${p.version} · ${st.person(p.by).name}起草 · ${NT.md(p.at)}`, html`<span class="n-version__tag is-draft">草稿</span>`))}</ul>`
        : html`<div class="nt-empty">待确认的方案会出现在这里。</div>`}
      <h3 class="m-h">最近确认</h3>
      <ul class="m-list">${confirmed.map((p) => M.row(`plan.html?id=${p.id}`, icon(p.kind === 'org' ? 'layers' : 'folder'), nameOf(p), `v${p.version} · ${st.person(p.confirmedBy).name} ${NT.md(p.confirmedAt || p.at)} 确认`, html`<span class="n-seal n-seal--sm">定</span>`))}</ul>`);
  }

  function prevOf(p) {
    return st.get().plans.filter((x) => x !== p && x.kind === p.kind && (p.kind === 'org' ? x.batch === p.batch : x.project === p.project) && x.version < p.version && x.status !== 'draft').sort((a, b) => b.version - a.version)[0];
  }

  function renderOne(main) {
    const p = st.plan(id);
    if (!p) { mount(main, UI.state({ ip: 'confirm', title: '方案链接失效', actions: html`<a class="n-btn n-btn--sm" href="plan.html">回到方案列表</a>` })); return; }
    const prev = prevOf(p);
    const done = p.status !== 'draft';
    const body = p.kind === 'org' ? orgBody(p, prev) : staffingBody(p, prev);
    mount(main, html`
      <article class="m-card m-plan" id="doc">
        ${done ? html`<span class="n-seal" id="seal">${p.status === 'confirmed' ? html`已<br>确认` : html`已<br>替代`}</span>` : ''}
        <span class="n-version__tag ${done ? 'is-frozen' : 'is-draft'}">${p.status === 'draft' ? '草稿' : p.status === 'confirmed' ? '已确认' : '已被替代'} v${p.version}</span>
        <h2 class="m-plan__t">${nameOf(p)}</h2>
        <p class="nt-muted" style="margin:0">${st.person(p.by).name}起草 · ${NT.md(p.at)}${prev ? ` · 基于 v${prev.version}` : ' · 首个版本'}${body.changed != null ? ` · 改了 ${body.changed} 处` : ''}</p>
        ${body.html}
        ${p.note ? html`<div class="n-block" data-state="ink" style="margin-top:var(--s-3);font-size:var(--t-sm)">${p.note}<div class="n-block__by"><span class="n-block__sig">${st.person(p.by).name}</span>起草说明</div></div>` : ''}
      </article>
      ${p.kind === 'staffing' ? html`<a class="m-link m-card" style="margin-top:var(--s-3);border:0" href="staffing.html?project=${p.project}">${icon('spark')}在桌面版看需求卡、候选人与证据${icon('chev')}</a>` : html`<a class="m-link m-card" style="margin-top:var(--s-3);border:0" href="../app/plan.html?id=${p.batch}">${icon('layers')}在桌面版编辑这份方案${icon('chev')}</a>`}
      <div id="deny"></div>
      <div class="m-actions">${done ? doneFoot(p) : html`<p class="nt-muted" style="margin:0;text-align:center">确认后冻结快照并生成跟进行动，之后的修改进入新草稿。</p>
        <button class="n-btn n-btn--seal m-big" type="button" id="confirm">${icon('stamp')}确认并冻结 v${p.version}</button>`}</div>`);
    $('#confirm')?.addEventListener('click', () => confirm(main, p));
  }

  function doneFoot(p) {
    const acts = st.get().actions.filter((a) => a.from === p.id);
    return html`<p class="nt-muted" style="margin:0;text-align:center"><span class="ink-hand" style="font-size:var(--t-md);color:var(--ink)">${st.person(p.confirmedBy || p.by).name}</span> ${NT.md(p.confirmedAt || p.at)} 确认 · 快照已冻结${acts.length ? ` · 生成 ${acts.length} 条行动` : ''}</p>
      <a class="n-btn n-btn--ink m-big" href="actions.html">看行动与复盘</a>`;
  }

  function staffingBody(p, prev) {
    const roles = st.slotRoles(p);
    const need = st.get().needs.find((n) => n.id === p.need) || st.get().needs.find((n) => n.project === p.project);
    let changed = 0;
    const rows = roles.map((r) => {
      const now = p.slots[r.id], was = prev?.slots[r.id];
      const diff = prev && now !== was; if (diff) changed += 1;
      const who = (x) => (x ? st.person(x).name : '待定');
      return html`<div class="m-slot"><span class="n-slot__role">${r.name}</span><div>
        ${now ? html`<div class="nt-row">${UI.avatar(now, 'sm')}<b class="n-diff">${diff ? html`${was ? html`<del>${who(was)}</del> ` : html`<del>待定</del> `}<ins>${who(now)}</ins>` : who(now)}</b></div>` : html`<span class="n-diff">${diff ? html`<del>${who(was)}</del> ` : ''}<span class="nt-muted">待定</span></span>`}
        ${p.slotNote?.[r.id] ? html`<div class="nt-muted" style="margin-top:2px">${p.slotNote[r.id]}</div>` : ''}
        ${now && !diff && prev ? html`<div class="nt-muted" style="margin-top:2px">与 v${prev.version} 相同</div>` : ''}</div></div>`;
    });
    return { changed: prev ? changed : null, html: html`
      ${need ? html`<div class="m-need"><b>需求</b>「${need.text}」<ul>${(p.reqs || need.reqs).map((x) => html`<li>${x.must ? html`<span class="n-badge">必须</span>` : html`<span class="n-badge" style="opacity:.7">加分</span>`}${x.text}</li>`)}</ul></div>` : ''}
      <div class="m-slots">${rows}</div>` };
  }

  function orgBody(p) {
    const val = (t) => (/^未知/.test(t || '') ? html`<span class="n-badge n-badge--unknown">${icon('dash')}${t}</span>` : t || '—');
    const hiddenN = p.moves.filter((m) => !st.canSeeMove(m)).length;
    return { changed: null, html: html`${hiddenN ? html`<p class="nt-muted">另有 ${hiddenN} 条动作涉及你范围以外的人，已隐藏。</p>` : ''}<div class="m-moves">${p.moves.filter((m) => st.canSeeMove(m)).map((m) => html`<div class="m-move">
      <div class="nt-row"><span class="n-badge ${m.type === '继续观察' ? '' : 'n-badge--seal'}">${m.kind || m.type}</span><b>${m.person ? UI.plink(m.person) : html`<span class="nt-muted">人选待定</span>`}</b>${m.pending && !m.person ? html`<span class="nt-muted">等「${st.project(m.pending)?.name || m.to.replace(/ owner$/, '')}」的用人方案确认</span>` : ''}</div>
      <div class="m-move__path">${m.from ? html`${m.from} → ` : ''}<b>${m.to}</b></div>
      <dl class="nt-dl"><dt>依据</dt><dd>${m.basis}${m.ev && st.event(m.ev) ? UI.cite(st.event(m.ev).srcs[0], 1) : ''}</dd>
        ${m.type === '继续观察' ? html`<dt>下一步</dt><dd>${m.next} · ${st.person(m.owner).name} · ${NT.md(m.due)}</dd>` : html`<dt>缺口</dt><dd>${m.gap}</dd><dt>本人意愿</dt><dd>${val(m.will)}</dd><dt>释放</dt><dd>${val(m.release)}</dd>`}</dl>
    </div>`)}</div><p class="nt-caption">意愿和释放为「未知」的，确认后行动从沟通开始；未知不当作反对。</p>` };
  }

  async function confirm(main, p) {
    if (!st.can('confirmPlan')) {
      const who = p.kind === 'org' ? '苏晚' : '程远';
      mount($('#deny'), html`<div class="n-notice is-deny" style="margin-top:var(--s-3)">${icon('lock')}<div><b>方案由 CEO 或指定的 HRBP 确认。</b>${p.kind === 'org' ? '部门负责人可以查看涉及本部门的动作。' : '部门负责人可以起草和提出修改。'}<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" id="ask">请${who}确认</button></div></div></div>`);
      $('#ask').onclick = () => { NT.toast(`已发给${who}确认，会出现在对方的待办里`); $('#deny').innerHTML = ''; };
      $('#deny').scrollIntoView({ block: 'nearest' });
      return;
    }
    const facts = p.kind === 'org'
      ? [html`${p.moves.length} 条动作，每条生成一条行动`, p.moves.some((m) => !m.person && m.type !== '继续观察') ? html`<span style="color:var(--conflict)">有动作还没有人选，确认后在行动里继续跟进</span>` : html`意愿或释放为「未知」的，行动先从沟通开始`]
      : [...st.slotRoles(p).map((r) => html`${r.name}：<b>${p.slots[r.id] ? st.person(p.slots[r.id]).name : '待定'}</b>`), html`写入项目成员，生成跟进行动`];
    const v = await NT.dialog({
      title: `确认 v${p.version} 并冻结？`, sub: nameOf(p), facts,
      body: html`<p style="margin:0">确认后冻结快照并生成跟进行动，之后的修改进入新草稿。</p>`,
      actions: [{ label: `确认并冻结 v${p.version}`, value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }, { label: '再看看', value: 'cancel', cls: 'n-btn--ghost' }],
    });
    if (v !== 'ok') return;
    const created = p.kind === 'org' ? st.confirmOrg(p) : (st.confirmStaffing(p), 0);
    renderOne(main);
    $('#seal')?.classList.add('is-stamping');
    $('#doc')?.classList.add('is-settling');
    $('#m-scroll').scrollTop = 0;
    NT.toast(p.kind === 'org' ? `已确认 v${p.version} 并冻结${created ? `，新增 ${created} 条行动` : ''}` : `已确认 v${p.version} 并冻结${p.slots.owner ? `，${st.person(p.slots.owner).name}写入项目 owner` : ''}`);
  }
})();
