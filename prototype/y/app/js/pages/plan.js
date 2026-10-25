/* 组织调整方案：每条动作写清依据、缺口、本人意愿、可否释放和对两边团队的影响；意愿和释放未知时写「未知」。
   按版本确认并冻结快照（压印）；之后的修改自动进入新草稿，并用行内差异标出变化。确认方案不等于人事动作已执行。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const bid = NT.param('id') || 'b-xe6-end';
  const TYPES = ['落位', '留用', '继续观察', '未接受', '调岗', '负责人安排', '激活'];

  NT.shell({
    nav: 'review', title: '留用与落位方案', crumbs: [['盘点', 'reviews.html'], [st.batch(bid)?.name || '', `review.html?id=${bid}`]],
    allow: (r) => st.canBatch(st.batch(bid), r),
    view: () => { const p = cur(); return `调整方案 v${p?.version} · ${p?.status === 'confirmed' ? '已确认' : '草稿'}`; },
    render,
  });

  const plans = () => st.get().plans.filter((p) => p.kind === 'org' && p.batch === bid).sort((a, b) => a.version - b.version);
  const cur = () => plans()[plans().length - 1];
  const confirmed = () => plans().filter((p) => p.status === 'confirmed').pop();
  const key = (m) => m.person || m.pending || m.to;
  const typeLabel = (m) => (m.type === '未接受' ? '未接受 offer' : m.type);

  function render(main) {
    const b = st.batch(bid);
    let p = cur();
    const S = st.get();
    if (!p) { p = { id: NT.uid('op'), kind: 'org', batch: bid, version: 1, status: 'draft', by: st.me().id, at: NT.TODAY, moves: [] }; S.plans.push(p); st.save(); }
    const conf = confirmed();
    const prev = p.status === 'draft' ? conf : plans().filter((x) => x.status !== 'draft' && x.version < p.version).pop();
    const draft = p.status === 'draft';
    // 留用与落位方案由 HR 起草、修改和确认；管理者只读
    const canEdit = st.role() === 'hrbp' && b.status !== 'confirmed';
    const T = p.title || '组织调整方案';
    const hiddenN = p.moves.filter((m) => !st.canSeeMove(m)).length;
    const diff = draft && prev ? diffOf(prev, p) : null;
    mount(main, html`
      <header class="nt-head"><div><h1>${T}</h1><p>${b.name}。每条动作都能回到依据，确认后生成跟进行动。</p></div>
        <div class="nt-head__acts">${draft && canEdit ? html`<button class="n-btn n-btn--sm" type="button" id="add">${icon('plus')}加一条动作</button>` : ''}</div></header>
      <div class="nt-split">
        <article class="n-card" id="doc" style="position:relative">
          ${!draft ? html`<span class="n-seal" style="position:absolute;right:22px;top:18px" id="seal">定</span>` : ''}
          ${hiddenN ? html`<p class="nt-muted" style="margin:0 0 var(--s-3)">另有 ${hiddenN} 条动作涉及你范围以外的人，已隐藏。</p>` : ''}
          ${p.moves.length ? p.moves.map((m, i) => (st.canSeeMove(m) ? move(m, i, draft && canEdit, diff) : '')) : html`<div class="nt-empty">还没有动作。从盘点清单和象限校准的结论出发，加第一条。</div>`}
          ${diff?.removed.length ? html`<div class="n-move"><div class="n-move__head"><span class="n-move__type is-watch">已删去</span><span class="n-diff">${diff.removed.map((m) => html`<del>${typeLabel(m)} · ${m.person ? st.person(m.person).name : m.to}</del> `)}</span></div></div>` : ''}
        </article>
        <aside class="nt-grid nt-sticky">
          <article class="n-card"><h3 class="n-section-title">版本</h3>
            ${plans().slice().reverse().map((x) => html`<div class="n-version" style="margin-bottom:6px"><span class="n-version__tag ${x.status === 'draft' ? 'is-draft' : x.status === 'confirmed' ? 'is-frozen' : ''}">${x.status === 'draft' ? '草稿' : x.status === 'confirmed' ? '已确认' : '已被替代'} v${x.version}</span><span style="color:var(--ink-3)">${st.person(x.confirmedBy || x.by).name} · ${NT.md(x.confirmedAt || x.at)}${x.status === 'confirmed' ? ' · 快照已冻结' : ''}</span>${x.status === 'confirmed' ? html`<span class="n-seal n-seal--sm" style="margin-left:auto">定</span>` : ''}</div>`)}
            ${diff ? html`<div class="n-version" style="margin-top:var(--s-2)"><span style="color:var(--ink-3)">v${p.version} 对比 v${prev.version}：</span><span class="n-diff">${diff.summary}</span></div>` : ''}
            ${draft && !canEdit ? html`<div class="n-notice is-plain" style="margin-top:var(--s-4)">${icon('lock')}<div>方案由 HR 修改和确认，你在这里查看。</div></div>` : ''}${draft && canEdit ? html`<div class="nt-row" style="margin-top:var(--s-4)"><button class="n-btn n-btn--ink" type="button" id="confirm">${icon('stamp')}确认 v${p.version}</button></div><div id="deny"></div>
              <p class="nt-caption">确认后冻结快照并生成行动，这次盘点也一起确认；之后的调整在下一次盘点里做。</p>` : html`<p class="nt-caption">${conf ? `v${conf.version} 已确认。` : ''}${canEdit ? '要调整时直接改，会自动开一版新草稿。' : ''}</p>${canEdit ? html`<button class="n-btn n-btn--sm" type="button" id="newdraft">${icon('pen')}基于 v${p.version} 修改</button>` : ''}`}
          </article>
          <article class="n-card"><h3 class="n-section-title" style="font-size:var(--t-sm)">写方案时的规则</h3>
            <ul class="nt-list" style="font-size:var(--t-sm);color:var(--ink-2)">
              <li>本人意愿、可否释放待了解时写「未知」。</li><li>资料不足的人放「继续观察」，写清下次补什么、谁负责。</li><li>动作来自「值得聊一聊」的，标为「激活」。</li></ul></article>
        </aside>
      </div>`);
    wire(main, p);
  }

  function move(m, i, editable, diff) {
    const who = m.person ? st.person(m.person) : null;
    const tag = diff?.added.includes(m) ? html`<span class="n-badge n-badge--yes">新增</span>` : diff?.changed.has(m) ? html`<span class="n-badge n-badge--conflict">有改动</span>` : '';
    const pendingLink = m.pending ? (st.project(m.pending) ? `staffing.html?project=${m.pending}` : NT.link('staffing.html', { new: 1, q: '新转化团队要找一个能带 SDR 和 SMB 的 owner，11 月到岗' })) : null;
    const unk = (t) => (/未知/.test(t || '') ? html`<b style="color:var(--unknown)">${t}</b>` : html`<b>${t || '—'}</b>`);
    const changedField = (f) => diff?.changed.get(m)?.includes(f);
    const val = (f, t) => (changedField(f) ? html`<b class="n-diff"><ins>${t}</ins></b>` : unk(t));
    if (m.type === '继续观察') {
      return html`<div class="n-move" data-i="${i}"><div class="n-move__head"><span class="n-move__type is-watch">继续观察</span><b>${who ? UI.plink(m.person) : ''}</b><span class="n-move__path">${m.to}</span>${tag}${editable ? menu(i) : ''}</div>
        <div class="n-move__grid"><div>依据${val('basis', m.basis)}</div><div>下次补什么${val('next', m.next)}</div><div>负责人${val('owner', `${st.person(m.owner)?.name || ''} · ${NT.md(m.due)} 前`)}</div></div></div>`;
    }
    return html`<div class="n-move" data-i="${i}"><div class="n-move__head"><span class="n-move__type">${typeLabel(m)}</span>
      ${who ? html`<b>${UI.plink(m.person)}</b>` : html`<span class="n-badge n-badge--unknown">${icon('dash')}人选待定</span>`}
      <span class="n-move__path">${m.from || ''}${m.from ? icon('chev') : ''}${m.to}</span>${m.kind === '激活' ? html`<span class="n-kind">激活</span>` : ''}${tag}${editable ? menu(i) : ''}</div>
      ${!who && pendingLink ? html`<div class="n-ownerless" style="margin-top:var(--s-3)"><span class="n-slot__empty">${icon('plus', 14)}</span><div><b>人选来自项目用人方案</b><div class="nt-muted">项目用人方案确认后，这里自动填上人</div></div><a class="n-btn n-btn--sm n-btn--light" href="${pendingLink}">${icon('spark')}去找 owner</a></div>` : ''}
      <div class="n-move__grid"><div>依据${val('basis', m.basis)}${m.ev ? UI.cite(st.event(m.ev)?.srcs[0], 1) : ''}</div><div>缺口${val('gap', m.gap)}</div><div>本人意愿${val('will', m.will)}</div><div>可否释放${val('release', m.release)}</div><div>影响${val('impact', m.impact)}</div></div></div>`;
  }
  const menu = (i) => html`<span class="n-menuwrap" style="margin-left:auto"><button class="n-btn n-btn--sm n-btn--ghost n-btn--icon" type="button" data-menu="${i}" aria-label="更多">${icon('more')}</button></span>`;

  function diffOf(a, b) {
    const ka = new Map(a.moves.map((m) => [key(m), m]));
    const added = [], changed = new Map();
    b.moves.forEach((m) => {
      const o = ka.get(key(m)) || (m.person && a.moves.find((x) => x.pending && x.pending === m.pending));
      if (!o) { added.push(m); return; }
      const f = ['person', 'to', 'basis', 'gap', 'will', 'release', 'impact', 'next'].filter((k) => (o[k] || '') !== (m[k] || ''));
      if (f.length) changed.set(m, f);
    });
    const kb = new Set(b.moves.map(key));
    const removed = a.moves.filter((m) => !kb.has(key(m)) && !(m.pending && b.moves.some((x) => x.pending === m.pending)));
    const summary = [added.length && `新增 ${added.length} 条`, changed.size && `改动 ${changed.size} 条`, removed.length && `删去 ${removed.length} 条`].filter(Boolean).join('，') || '还没有改动';
    return { added, changed, removed, summary };
  }

  async function editMove(p, i) {
    const m = i == null ? { type: '调岗', person: '', from: '', to: '', basis: '', gap: '', will: '未知', release: '未知', impact: '' } : p.moves[i];
    const people = st.visiblePeople().filter((x) => st.scope(x.id) === 'full');
    const f = (k, label, ph) => html`<label class="n-field"><span class="n-field__label">${label}</span><input class="n-input" data-k="${k}" value="${m[k] || ''}" placeholder="${ph || ''}"></label>`;
    const r = await NT.dialog({
      title: i == null ? '加一条动作' : '修改这条动作',
      body: html`<div class="nt-grid" style="gap:var(--s-3)">
        <div class="nt-cols" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">类型</span><select class="n-select" data-k="type">${TYPES.map((t) => html`<option ${t === (m.kind === '激活' ? '激活' : m.type) ? 'selected' : ''}>${t}</option>`)}</select></label>
          <label class="n-field"><span class="n-field__label">谁</span><select class="n-select" data-k="person"><option value="">人选待定</option>${people.map((x) => html`<option value="${x.id}" ${x.id === m.person ? 'selected' : ''}>${x.name} · ${st.orgShort(x.org)}</option>`)}</select></label></div>
        <div class="nt-cols" style="gap:var(--s-3)">${f('from', '从', '原团队 / 原角色')}${f('to', '到', '新团队 / 新角色')}</div>
        ${f('basis', '依据', '能回到证据的事实')}${f('gap', '缺口', '还缺什么证据')}
        <div class="nt-cols" style="gap:var(--s-3)">${f('will', '本人意愿', '未知')}${f('release', '可否释放', '未知')}</div>${f('impact', '对两边团队的影响')}
        <p class="n-field__err" id="mv-err" role="alert" hidden>「谁」和「到」至少填写一项。</p></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink',
        validate: (d) => {
          const who = d.querySelector('[data-k="person"]'), to = d.querySelector('[data-k="to"]'), ok = !!(who.value || to.value.trim());
          d.querySelector('#mv-err').hidden = ok;
          if (!ok) who.focus();
          return ok;
        },
        read: (d) => Object.fromEntries(NT.$$('[data-k]', d).map((x) => [x.dataset.k, x.value.trim()])) }],
    });
    if (r?.value !== 'ok') return;
    const d = r.data;
    const next = { ...m, ...d, person: d.person || null, kind: d.type === '激活' ? '激活' : undefined, type: d.type === '激活' ? '调岗' : d.type, will: d.will || '未知', release: d.release || '未知' };
    if (next.type === '继续观察') Object.assign(next, { next: next.gap || '补充事件', owner: st.me().id, due: '2026-12-15' });
    const target = ensureDraft(p);
    if (i == null) target.moves.push(next); else target.moves[i] = next;
    st.save(); render($('#main'));
    NT.toast(i == null ? '已加入方案草稿' : '已修改，差异会在版本里标出');
  }
  function ensureDraft(p) {
    if (p.status === 'draft') return p;
    const d = { ...NT.clone(p), id: NT.uid('op'), version: p.version + 1, status: 'draft', by: st.me().id, at: NT.TODAY };
    delete d.confirmedBy; delete d.confirmedAt;
    st.get().plans.push(d); st.save();
    return d;
  }

  function wire(main, p) {
    $('#add')?.addEventListener('click', () => editMove(p, null));
    $('#newdraft')?.addEventListener('click', () => { ensureDraft(p); render(main); NT.toast(`已基于 v${p.version} 开了一版新草稿`); });
    NT.$$('[data-menu]', main).forEach((btn) => {
      const i = +btn.dataset.menu;
      NT.menu(btn, [{ label: '修改', icon: 'pen', run: () => editMove(p, i) }, { label: '删去这条', icon: 'trash', danger: true, run: () => {
        const t = ensureDraft(p); const [rm] = t.moves.splice(i, 1); st.save(); render(main);
        NT.toast('已删去这条动作', { undo: () => { t.moves.splice(i, 0, rm); st.save(); render(main); } });
      } }]);
    });
    $('#confirm')?.addEventListener('click', () => confirm(p));
  }

  async function confirm(p) {
    if (st.role() !== 'hrbp') {
      mount($('#deny'), html`<div class="n-notice is-deny" style="margin-top:var(--s-3)">${icon('lock')}<div><b>方案由 HR 修改和确认。</b><div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" id="ask">请苏晚确认</button></div></div></div>`);
      $('#ask').onclick = () => { NT.toast('已发给苏晚确认'); $('#deny').innerHTML = ''; };
      return;
    }
    const pending = p.moves.filter((m) => !m.person && m.type !== '继续观察');
    // 范围内还没有校准快照的人，确认时按参考位置冻结，记为未校准
    const b = st.batch(bid), sn = st.get().snaps.find((x) => x.batch === bid);
    const uncal = st.people().filter((x) => !x.noReview && st.inOrg(x.org, b.org) && !sn?.entries[x.id]).length;
    const v = await NT.dialog({
      title: `确认${p.title || '组织调整方案'} v${p.version}？`,
      body: html`<p>确认后冻结快照，每条动作生成一条跟进行动。</p>`,
      facts: [uncal ? html`${uncal} 人待校准，确认时按参考位置记为「未校准」` : html`范围内的人都已有校准结果`, html`${p.moves.length} 条动作：${p.moves.slice(0, 6).map((m) => `${m.kind || typeLabel(m)}${m.person ? ` · ${st.person(m.person).name}` : ''}`).join('、')}${p.moves.length > 6 ? ' 等' : ''}`, pending.length ? html`<span style="color:var(--conflict)">${pending.length} 条人选待定，确认后在行动里继续跟进</span>` : html`意愿或释放为「未知」的，行动会先从沟通开始`],
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: `确认并冻结 v${p.version}`, value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }],
    });
    if (v !== 'ok') return;
    const created = st.confirmOrg(p);
    render($('#main'));
    const seal = $('#seal'); seal?.classList.add('is-stamping');
    $('#doc')?.classList.add('is-settling');
    NT.toast(`已确认 v${p.version} 并冻结${created ? `，新增 ${created} 条行动` : ''}，在「人才项目」的关键节点复盘里跟进`);
  }
})();
