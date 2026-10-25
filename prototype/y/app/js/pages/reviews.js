/* 盘点：批次列表与发起盘点。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;

  NT.shell({
    nav: 'review', title: '盘点',
    allow: (r) => st.can('review', null, r),
    denyText: '盘点、象限和调整方案只对管理者和 HR 开放。',
    view: () => '盘点 · 批次列表',
    render(main) {
      const S = st.get();
      const canStart = st.can('calibrate');
      const inv = S.batches.filter((b) => b.kind === 'inventory'), land = S.batches.filter((b) => b.kind === 'landing');
      mount(main, html`
        <header class="nt-head"><div><h1>盘点</h1><p>先固定范围和证据截止时间，再补资料缺口、校准象限、逐人写结论，最后形成调整方案并确认版本。确认后为范围内每个人冻结一份档案版本。</p></div>
          ${canStart ? html`<div class="nt-head__acts"><button class="n-btn n-btn--sm n-btn--ink" type="button" id="new">${icon('plus')}发起盘点</button></div>` : ''}</header>
        <div class="nt-grid">${inv.map((b) => card(b))}</div>
        <h2 class="nt-h2" style="margin-top:var(--s-6)">训练营</h2>
        <div class="nt-grid">${land.map((b) => html`<a class="n-card nt-plink" href="landing.html" style="display:block"><div class="n-batch__head"><div><h3 class="n-batch__title" style="font-size:var(--t-md)">${b.name}</h3><div class="n-batch__meta">${NT.md(b.from)} – ${NT.md(b.to)} · ${b.newcomers.length} 名学员 · 结营盘点做第一次正式校准</div></div><span class="n-badge">已结营</span></div></a>`)}</div>`);
      $('#new')?.addEventListener('click', startNew);
      if (location.hash === '#new' && canStart) startNew();
    },
  });

  function card(b) {
    const ids = Object.keys(scopeOf(b)), people = ids.length;
    const conf = b.status === 'confirmed';
    const done = ids.filter((pid) => st.get().conclusions[pid]).length;
    const steps = conf ? '已确认 · 档案版本已冻结' : `${done} 人已写结论 · 证据截止 ${NT.md(b.cutoff)}`;
    return html`<a class="n-card nt-plink" href="review.html?id=${b.id}" style="display:block;position:relative">
      <div class="n-batch__head"><div><h3 class="n-batch__title" style="font-size:var(--t-md)">${b.name}</h3><div class="n-batch__meta">${st.person(b.starter).name}发起 · ${people} 人 · ${steps}${b.compareTo ? ` · 与 ${st.batch(b.compareTo).name.split('· ')[1]} 对比` : ''}</div></div>
        ${conf ? html`<span class="n-seal n-seal--sm">定</span>` : html`<span class="n-badge n-version__tag is-draft" style="background:var(--light-soft)">草稿</span>`}</div></a>`;
  }
  // 批次范围只算当前视角有权看到的人
  function scopeOf(b) {
    if (b.id === 'b-xe6-mid') return Object.fromEntries(Object.keys(st.snaps().find((s) => s.id === 's-mid').entries).filter((pid) => st.scope(pid) === 'full').map((pid) => [pid, 1]));
    return Object.fromEntries(st.people().filter((p) => !p.noReview && st.inOrg(p.org, b.org) && st.scope(p.id) === 'full').map((p) => [p.id, 1]));
  }

  async function startNew() {
    const orgs = st.orgs().filter((o) => !o.group && o.id === 'xe6');
    const r = await NT.dialog({
      title: '发起盘点',
      body: html`<div class="nt-grid" style="gap:var(--s-3)">
        <label class="n-field"><span class="n-field__label">盘哪个团队</span><select class="n-select" id="bo">${orgs.map((o) => html`<option value="${o.id}">${st.orgPath(o.id)}</option>`)}</select></label>
        <label class="n-field"><span class="n-field__label">证据截止 <small>之后的新事件不进这次盘点</small></span><input class="n-input" type="date" id="bc" value="2026-11-15"></label>
        <label class="n-field"><span class="n-field__label">对比基准</span><select class="n-select"><option>上一次盘点的档案版本</option><option>不对比</option></select></label></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '发起', value: 'ok', cls: 'n-btn--ink', read: (d) => ({ org: d.querySelector('#bo').value, cutoff: d.querySelector('#bc').value }) }],
    });
    if (r?.value !== 'ok') return;
    // 这个团队还有没确认的盘点就接着做那一批；都确认了才发起新的一批
    const open = st.get().batches.find((x) => x.kind === 'inventory' && x.org === r.data.org && x.status !== 'confirmed');
    if (open) { location.href = `review.html?id=${open.id}`; return; }
    const last = st.get().batches.filter((x) => x.kind === 'inventory' && x.org === r.data.org).sort((x, y) => (y.cutoff || '').localeCompare(x.cutoff || ''))[0];
    const b = st.startInventory({ id: NT.uid('b'), kind: 'inventory', name: `${st.orgShort(r.data.org)} · ${NT.md(r.data.cutoff)} 盘点`, compareTo: last?.id, org: r.data.org, status: 'draft', starter: st.me().id, startedAt: NT.TODAY, cutoff: r.data.cutoff, log: [[NT.TODAY, st.me().id, '发起盘点，固定范围']] });
    location.href = `review.html?id=${b.id}`;
  }
})();
