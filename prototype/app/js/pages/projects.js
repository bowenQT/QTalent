/* 项目列表：人和项目多对多。新建项目时可以一次加多名成员；没有 owner 的项目可以直接发起找 owner。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  let status = 'all';

  NT.shell({
    nav: 'projects', title: '项目',
    view: () => `项目 · ${status === 'all' ? '全部' : status}`,
    state: () => ({ status }),
    restore: (s) => { status = s.status || 'all'; draw(); },
    render(main) {
      const role = st.role();
      const canNew = ['ceo', 'hrbp', 'lead'].includes(role);
      mount(main, html`
        <header class="nt-head"><div><h1>项目</h1><p>${role === 'self' ? '你参与的项目。这里只显示项目基本信息。' : role === 'mentor' ? '你所带批次的议题项目，以及你参与的项目。' : '业务项目、Landing 议题、训练营课题、黑客松和专项。一个人可以同时在几个项目里，进出都留有记录。'}</p></div>
          ${canNew ? html`<div class="nt-head__acts"><a class="n-btn n-btn--sm" href="staffing.html?new=1">${icon('spark')}为项目找人</a><button class="n-btn n-btn--sm n-btn--ink" type="button" id="new">${icon('plus')}新建项目</button></div>` : ''}</header>
        <div class="n-chips" role="group" aria-label="按状态筛选" id="chips">${['all', '筹备中', '进行中', '已结束', '已归档'].map((s) => html`<button class="n-chip" type="button" data-s="${s}" aria-pressed="${s === status}">${s === 'all' ? '全部' : s}</button>`)}</div>
        <div class="nt-cols" id="plist"></div>`);
      $('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; status = b.dataset.s; $$('#chips button').forEach((x) => x.setAttribute('aria-pressed', x === b)); draw(); });
      $('#new')?.addEventListener('click', newProject);
      draw();
    },
  });

  function draw() {
    const host = $('#plist'); if (!host) return;
    const list = st.search('').projects.filter((p) => status === 'all' || p.status === status);
    mount(host, list.length ? list.map(card) : html`<div class="nt-empty" style="grid-column:1/-1">没有这个状态的项目。</div>`);
  }
  function card(p) {
    const ms = st.membersOf(p.id);
    const role = st.role();
    return html`<article class="n-card n-project">
      <div class="n-project__head"><span class="n-avatar" style="--hue:220;border-radius:10px">${icon('folder', 16)}</span>
        <div style="flex:1;min-width:0"><h3 class="n-project__name"><a class="nt-plink" href="project.html?id=${p.id}">${p.name}</a></h3><p class="n-project__goal">${p.goal}</p></div>${UI.pstatus(p.status)}</div>
      <div class="nt-muted" style="margin-top:var(--s-2)">${p.type} · ${st.orgShort(p.org)} · ${NT.md(p.from)} – ${NT.md(p.to)}</div>
      ${p.owner ? html`<div class="n-project__members">${ms.slice(0, 6).map((m) => UI.avatar(m.person, 'sm'))}<span>owner ${st.person(p.owner).name} · ${ms.length} 人</span></div>`
        : html`<div class="n-ownerless" style="margin-top:var(--s-4)"><span class="n-slot__empty">${icon('plus', 14)}</span><div><b>owner 待定</b><div class="nt-muted">${p.status}</div></div>${st.can('findOwner') && role !== 'self' ? html`<a class="n-btn n-btn--sm n-btn--light" href="staffing.html?project=${p.id}">${icon('spark')}发起找 owner</a>` : ''}</div>`}
    </article>`;
  }

  async function newProject() {
    const people = st.visiblePeople().filter((p) => st.scope(p.id) === 'full');
    const r = await NT.dialog({
      title: '新建项目',
      body: html`<div class="nt-grid" style="gap:var(--s-3)">
        <label class="n-field"><span class="n-field__label">项目名称</span><input class="n-input" id="np-name" placeholder="比如：控制台新手引导改版"></label>
        <div class="nt-cols" style="gap:var(--s-3)"><label class="n-field"><span class="n-field__label">类型</span><select class="n-select" id="np-type">${['业务项目', '专项', '黑客松', '训练营课题'].map((t) => html`<option>${t}</option>`)}</select></label>
          <label class="n-field"><span class="n-field__label">状态</span><select class="n-select" id="np-status"><option>筹备中</option><option selected>进行中</option></select></label></div>
        <label class="n-field"><span class="n-field__label">目标 <small>一句话</small></span><input class="n-input" id="np-goal" placeholder="比如：让新客户第一次登录就能找到要用的产品"></label>
        <label class="n-field"><span class="n-field__label">owner <small>可以先空着，之后发起找 owner</small></span><select class="n-select" id="np-owner"><option value="">待定</option>${people.map((p) => html`<option value="${p.id}">${p.name} · ${st.orgShort(p.org)}</option>`)}</select></label>
        <fieldset class="n-field" style="border:0;padding:0;margin:0"><legend class="n-field__label" style="margin-bottom:6px">成员 <small>可以多选；已在别的项目里的人也能加</small></legend>
          <div style="max-height:180px;overflow:auto;display:grid;gap:4px;padding:var(--s-2);border-radius:var(--r-field);background:var(--sheet-sunk)">${people.map((p) => html`<label class="n-check"><input type="checkbox" value="${p.id}">${p.name}<span class="nt-muted">${st.orgShort(p.org)} · 在 ${st.projectsOf(p.id).length} 个项目</span></label>`)}</div></fieldset></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '创建', value: 'ok', cls: 'n-btn--ink',
        validate: (d) => { const n = d.querySelector('#np-name'); if (!n.value.trim()) { n.focus(); n.closest('.n-field').classList.add('is-error'); return false; } return true; },
        read: (d) => ({ name: d.querySelector('#np-name').value.trim(), type: d.querySelector('#np-type').value, status: d.querySelector('#np-status').value, goal: d.querySelector('#np-goal').value.trim() || '目标待补充', owner: d.querySelector('#np-owner').value || null, members: $$('input[type=checkbox]:checked', d).map((c) => c.value) }) }],
    });
    if (r?.value !== 'ok') return;
    const me = st.me().id, d = r.data;
    const p = st.addProject({ id: NT.uid('pr'), name: d.name, type: d.type, org: st.me().org.startsWith('gp') ? st.me().org : 'gp', status: d.status, from: NT.TODAY, to: '2026-12-31', owner: d.owner, creator: me, goal: d.goal });
    st.get().memberLog.unshift({ project: p.id, at: NT.TODAY, text: `项目创建${d.members.length ? `，${d.members.map((x) => st.person(x).name).join('、')}加入` : ''}`, by: me });
    if (d.owner) st.get().members.push({ project: p.id, person: d.owner, role: 'owner', mode: '兼职', from: NT.TODAY, to: null, by: me });
    d.members.filter((x) => x !== d.owner).forEach((x) => st.get().members.push({ project: p.id, person: x, role: '成员', mode: '兼职', from: NT.TODAY, to: null, by: me }));
    st.save();
    location.href = `project.html?id=${p.id}&created=1`;
  }
})();
