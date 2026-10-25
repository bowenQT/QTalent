/* 手机学员列表：按课题和姓名排列，不按分数排序。导师只看到所带学员，看不到象限。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $, $$ } = NT;
  let q = '', kind = 'all';

  NT.mshell({
    tab: 'people', title: '所带学员',
    view: () => `学员 · ${kind}${q ? ` · 搜「${q}」` : ''}`,
    state: () => ({ q, kind }),
    restore: (s) => { q = s.q || ''; kind = s.kind || 'all'; render($('#main')); },
    render,
  });

  function render(main) {
    const quad = st.can('quad');
    const people = st.visiblePeople();
    const tracks = st.get().tracks.filter((t) => t.state === 'on' && st.scope(t.person)).map((t) => t.person);
    const kinds = [['all', '全部'], ['track', '重点跟踪'], ['landing', '第六期学员'], quad && ['na', '资料不足']].filter(Boolean);
    mount(main, html`
      <input class="n-input m-search" type="search" placeholder="按姓名或岗位筛选" aria-label="按姓名或岗位筛选" id="pq" value="${q}">
      <div class="m-chips" role="group" aria-label="筛选">${kinds.map(([k, l]) => html`<button class="n-chip" type="button" data-k="${k}" aria-pressed="${k === kind}">${l}</button>`)}</div>
      <div id="plist"></div>
      <p class="nt-caption">${quad ? '右侧是正式位置，待校准的人显示带光点的参考位置。' : st.role() === 'mentor' ? '每位学员的全部评价都在档案里。' : ''}</p>`);
    const draw = () => {
      const list = people.filter((p) => (!q || p.name.includes(q) || p.title.includes(q))
        && (kind === 'all' || (kind === 'track' && tracks.includes(p.id)) || (kind === 'landing' && p.landing) || (kind === 'na' && st.refPos(p.id).na)));
      // 团队按团队名的中文拼音排序（与桌面版一致），组内按姓名拼音
      const teams = [...new Set(list.map((p) => p.org))].sort((a, b) => st.orgShort(a).localeCompare(st.orgShort(b), 'zh-Hans-CN') || (a < b ? -1 : a > b ? 1 : 0));
      mount($('#plist'), list.length ? teams.map((t) => html`<h3 class="m-h" style="font-weight:500;color:var(--ink-3);font-size:var(--t-xs)">${st.orgPath(t)} · ${list.filter((p) => p.org === t).length} 人</h3>
        <ul class="m-list">${list.filter((p) => p.org === t).sort((a, b) => a.name.localeCompare(b.name, 'zh')).map((p) => M.row(`person.html?id=${p.id}`, UI.avatar(p.id, 'sm'), html`${p.name}${tracks.includes(p.id) ? html` <span class="n-badge" style="font-size:10px">${icon('target')}跟踪中</span>` : ''}`, p.title, quad ? tail(p.id) : undefined))}</ul>`)
        : html`<div class="nt-empty">换个筛选条件试试。</div>`);
    };
    draw();
    $('#pq').addEventListener('input', (e) => { q = e.target.value.trim(); draw(); });
    $('.m-chips', main).addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $$('[data-k]', main).forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
  }

  function tail(pid) {
    const f = st.formal(pid);
    if (f) return UI.qBadge(f.q);
    const ref = st.refPos(pid);
    return ref.na ? UI.na() : html`<span class="n-badge n-badge--ai">${icon('spark')}${st.QN[ref.q]}</span>`;
  }
})();
