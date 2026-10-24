/* 人才：人员列表（按团队、姓名排列，不按分数排序）、重点跟踪、值得聊一聊。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  let tab = NT.param('tab') || 'list', org = 'all', kind = 'all', q = '';

  NT.shell({
    nav: 'people', title: st.role() === 'mentor' ? '所带学员' : '人才',
    allow: (r) => r !== 'self',
    view: () => `人才 · ${({ list: '人员', track: '重点跟踪', signal: '值得聊一聊' })[tab]}${kind !== 'all' ? ` · ${kind}` : ''}`,
    state: () => ({ tab, org, kind, q }),
    restore: (s) => { Object.assign(STATE, s); tab = s.tab; org = s.org; kind = s.kind; q = s.q || ''; render($('#main')); },
    render,
  });
  const STATE = {};

  function render(main) {
    const role = st.role();
    const people = st.visiblePeople();
    const tracks = st.get().tracks.filter((t) => st.scope(t.person));
    const sigs = st.get().signals.filter((s) => st.can('signals', s.person));
    const tabs = [['list', role === 'mentor' ? '学员' : '人员', people.length], ['track', '重点跟踪', tracks.filter((t) => t.state === 'on').length], st.can('signals') && ['signal', '值得聊一聊', sigs.filter((s) => s.state === 'open').length]].filter(Boolean);
    mount(main, html`
      <header class="nt-head"><div><h1>${role === 'mentor' ? '所带学员' : '人才'}</h1><p>${role === 'mentor' ? '你在 Landing 第三期带的学员。导师看得到学员的全部评价，看不到象限、变化和管理观察。' : `你能查看的 ${people.length} 人，按团队和姓名排列。列表不提供按分数排序。`}</p></div>
        <div class="nt-head__acts">${role !== 'mentor' ? html`<a class="n-btn n-btn--sm" href="people.html?tab=track&new=1">${icon('target')}设一个重点跟踪</a>` : ''}<a class="n-btn n-btn--sm n-btn--ink" href="record.html">${icon('pen')}记一条事件</a></div></header>
      <div class="n-tabs" role="tablist" id="ptabs">${tabs.map(([k, l, n]) => html`<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}" aria-controls="pp-${k}" tabindex="${k === tab ? 0 : -1}">${l}${n ? html`<span class="n-count is-quiet">${n}</span>` : ''}</button>`)}</div>
      <div class="n-tabpanel" role="tabpanel" id="pp-list" ${NT.raw(tab === 'list' ? '' : 'hidden')}></div>
      <div class="n-tabpanel" role="tabpanel" id="pp-track" ${NT.raw(tab === 'track' ? '' : 'hidden')}></div>
      <div class="n-tabpanel" role="tabpanel" id="pp-signal" ${NT.raw(tab === 'signal' ? '' : 'hidden')}></div>`);
    NT.tabs($('#ptabs'), (t) => { tab = t; });
    renderList(people);
    renderTracks(tracks);
    if (st.can('signals')) renderSignals(sigs);
    if (NT.param('new')) newTrack();
  }

  function renderList(people) {
    const role = st.role();
    const quad = st.can('quad');
    const teams = [...new Set(people.map((p) => p.org))];
    const kinds = [['all', '全部'], ['landing', 'Landing 新人'], quad && ['na', '资料不足'], quad && ['recal', '可能需要重新校准'], ['merged', 'SDR 与 SMB 并入']].filter(Boolean);
    const host = $('#pp-list');
    const draw = () => {
      const list = people.filter((p) => (org === 'all' || p.org === org) && (!q || p.name.includes(q) || p.title.includes(q))
        && (kind === 'all' || (kind === 'landing' && p.landing) || (kind === 'merged' && p.merged) || (kind === 'na' && st.refPos(p.id).na) || (kind === 'recal' && st.needsRecal(p.id))));
      const groups = teams.filter((t) => list.some((p) => p.org === t));
      mount($('#plist'), list.length ? groups.map((t) => html`<div class="nt-h2" style="font-size:var(--t-xs);color:var(--ink-3);font-weight:500;margin:var(--s-4) 0 var(--s-1)">${st.orgPath(t)} · ${list.filter((p) => p.org === t).length} 人</div>
        <div class="n-card" style="padding:var(--s-1)">${list.filter((p) => p.org === t).sort((a, b) => a.name.localeCompare(b.name, 'zh')).map((p) => row(p, quad))}</div>`)
        : html`<div class="nt-empty">没有符合条件的人。</div>`);
    };
    mount(host, html`<div class="nt-filter">
        <input class="n-input" type="search" placeholder="按姓名或岗位筛选" aria-label="按姓名或岗位筛选" id="pq" value="${q}">
        ${teams.length > 1 ? html`<select class="n-select" id="porg" aria-label="团队"><option value="all">全部团队</option>${teams.map((t) => html`<option value="${t}" ${org === t ? 'selected' : ''}>${st.orgShort(t)}</option>`)}</select>` : ''}
        <div class="n-chips" style="margin:0" role="group" aria-label="筛选">${kinds.map(([k, l]) => html`<button class="n-chip" type="button" data-k="${k}" aria-pressed="${k === kind}">${l}</button>`)}</div>
      </div><div id="plist"></div>
      ${quad ? html`<p class="nt-caption">右侧是正式位置（最近一次冻结的校准）；没有正式位置的人显示参考位置，带光点标记。资料不足的人不会被放进低潜力。</p>` : role === 'lead' ? '' : html`<p class="nt-caption">${UI.lock('导师看不到象限')}</p>`}`);
    $('#pq').addEventListener('input', (e) => { q = e.target.value.trim(); draw(); });
    $('#porg')?.addEventListener('change', (e) => { org = e.target.value; draw(); });
    host.querySelector('.n-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $$('[data-k]', host).forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
    draw();
  }
  function row(p, quad) {
    const projs = st.projectsOf(p.id).length;
    const land = st.landingOf(p.id);
    const meta = `${p.title} · ${p.level} · ${projs} 个项目${land ? ` · ${land.batch.name}` : ''}${p.merged ? ' · 10-20 并入' : ''}`;
    let right = '';
    if (quad && st.scope(p.id) === 'full') {
      const f = st.formal(p.id), r = st.refPos(p.id);
      if (f) right = html`<span class="nt-row">${st.needsRecal(p.id) ? html`<span class="n-badge n-badge--recal">可能需要重新校准</span>` : ''}${UI.qBadge(f.q)}</span>`;
      else if (!r.na) right = html`<span class="n-badge n-badge--ai" title="还没有正式校准，这是系统按已确认分数算的参考位置">${icon('spark')}参考：${st.QN[r.q]}</span>`;
      else right = html`<span title="${r.miss}">${UI.na()}</span>`;
    } else if (st.scope(p.id) === 'mentor') {
      const rv = st.review(p.id, 'W2');
      right = rv.state === 'confirmed' ? html`<span class="n-badge n-badge--yes">${icon('check')}W2 已确认</span>` : rv.conflicts ? html`<span class="n-badge n-badge--conflict">${icon('split')}待校准</span>` : html`<span class="n-badge">W2 待确认 ${rv.confirmed}/${rv.total}</span>`;
    } else if (st.scope(p.id) === 'project') right = UI.lock('只看项目相关资料');
    return html`<a class="n-person-row nt-plink" href="person.html?id=${p.id}">${UI.person(p.id, { link: false, meta })}${right}</a>`;
  }

  function renderTracks(tracks) {
    const host = $('#pp-track');
    const on = tracks.filter((t) => t.state === 'on'), off = tracks.filter((t) => t.state !== 'on');
    mount(host, html`<p class="nt-caption" style="margin:0 0 var(--s-3)">跟踪不是收藏：要写清为什么关注、具体想观察什么、谁负责、下次什么时候看。</p>
      <div class="nt-cols">${on.map((t) => NT.ui.trackCard(t))}</div>
      ${!on.length ? html`<div class="nt-empty">还没有重点跟踪的人。可以从人员档案、变化或一句话发起。</div>` : ''}
      ${off.length ? html`<h3 class="nt-h2" style="margin-top:var(--s-6)">已结束的跟踪</h3><div class="nt-cols">${off.map((t) => NT.ui.trackCard(t))}</div>` : ''}`);
    NT.ui.wireTracks(host, () => renderTracks(st.get().tracks.filter((t) => st.scope(t.person))));
  }

  function renderSignals(sigs) {
    const host = $('#pp-signal');
    mount(host, html`<p class="nt-caption" style="margin:0 0 var(--s-3)">只列能核实的信号，每条带来源；不打分、不下结论、不影响找人排序。处理只有两种：安排一次沟通，或写明原因暂不处理。</p>
      <div class="n-card" style="padding:var(--s-1)">${sigs.map((s) => html`<a class="n-person-row nt-plink" href="person.html?id=${s.person}#signal">${UI.person(s.person, { link: false, meta: s.items.map((i) => i.text).join(' · ') })}${s.state === 'open' ? html`<span class="n-badge">${s.items.length} 条信号 · 待处理</span>` : s.state === 'talk' ? html`<span class="n-badge">待沟通</span>` : s.state === 'hold' ? html`<span class="n-badge">暂不处理</span>` : html`<span class="n-badge n-badge--yes">${icon('check')}已沟通</span>`}</a>`)}</div>
      <div class="n-lock" style="margin-top:var(--s-3)">${icon('lock')}只对 CEO、归属 HRBP、直属负责人可见；导师和员工本人在任何入口都看不到。</div>`);
  }

  async function newTrack() {
    const pick = await NT.dialog({
      title: '设一个重点跟踪',
      body: html`<label class="n-field"><span class="n-field__label">跟踪谁</span><select class="n-select" id="tk-p">${st.visiblePeople().filter((p) => st.scope(p.id) === 'full').map((p) => html`<option value="${p.id}">${p.name} · ${st.orgShort(p.org)}</option>`)}</select></label>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '下一步', value: 'ok', cls: 'n-btn--ink', read: (d) => d.querySelector('#tk-p').value }],
    });
    if (pick?.value === 'ok') location.href = `person.html?id=${pick.data}&track=1`;
  }
})();
