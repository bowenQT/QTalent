/* Niu-Talent 原型：桌面应用外壳。左侧导航 + 顶栏（搜索 ⌘K、演示视角、重置）+ 页面主体；
   页面状态通过 NT.reviewPage 交给评审评论层。 */
(function () {
  'use strict';
  const NT = window.NT;
  const st = NT.store;
  const { html, icon, mount } = NT;

  const NAV = [
    { id: 'work', label: '工作台', icon: 'home', href: 'index.html' },
    { id: 'people', label: '人才', icon: 'users', href: 'people.html' },
    { id: 'review', label: '盘点', icon: 'layers', href: 'reviews.html', roles: ['ceo', 'hrbp', 'lead'] },
  ];
  const MORE = [
    { id: 'projects', label: '项目', icon: 'folder', href: 'projects.html' },
    { id: 'landing', label: 'XEngineer 第六期', icon: 'book', href: 'landing.html', roles: ['ceo', 'hrbp', 'lead', 'mentor'], hideFor: ['ceo'] },
    { id: 'actions', label: '项目复盘', icon: 'check2', href: 'actions.html', roles: ['ceo', 'hrbp', 'lead'] },
    { id: 'queue', label: '校准队列', icon: 'split', href: 'queue.html', roles: ['hrbp'] },
    // 判断对照归在「评价体系」下（规则 / 判断对照两个页签）；导航里只给不能看汇总、但做过评价的人留「我的判断对照」
    { id: 'judge', label: '我的判断对照', icon: 'swap', href: 'judge.html?rater=me' },
    { id: 'rules', label: '评价体系', icon: 'grid', href: 'rules.html', roles: ['ceo', 'hrbp'] },
    { id: 'tags', label: '标签库', icon: 'tag', href: 'tags.html', roles: ['hrbp'] },
  ];
  const ROLE_ORDER = ['ceo', 'hrbp', 'mentor'];


  // 页面入口：NT.shell({ nav, title, crumbs, render(main), view(), state(), restore(state) })
  NT.shell = (cfg) => NT.ready(() => {
    NT.reviewPage(cfg);
    st.tickTasks();
    document.title = `${cfg.title} · Niu-Talent`;
    const role = st.role();
    const me = st.me();
    // 管理者视角收敛：工作台不挂待办数，盘点不挂草稿数；校准队列、标签库不进导航
    const counts = () => (role === 'ceo' ? { work: 0, review: 0 } : { work: st.todos().length, review: st.get().batches.filter((b) => b.kind === 'inventory' && b.status === 'draft').length });
    const allow = (n) => (n.id === 'judge' ? !st.canJudge() && st.isRater() : !n.roles || n.roles.includes(role)) && !(n.hideFor || []).includes(role);
    // 管理者视角：项目与训练营批次合并成一个入口，侧栏不放「最近」（v1.5 3.26.4）
    const more = MORE.map((n) => (n.id === 'projects' && role === 'ceo' ? { ...n, label: '项目与批次' } : n));
    const navCount = (id, n) => (n ? html`<span class="n-count${id === 'review' ? ' is-quiet' : ''}" data-nav-count>${n}</span>` : '');
    const first = counts();
    const navItem = (n) => html`<a class="n-navitem" data-nav="${n.id}" href="${n.href}" ${NT.raw(cfg.nav === n.id ? 'aria-current="page"' : '')}>${icon(n.icon)}${n.label}${navCount(n.id, first[n.id])}</a>`;
    // 待办和草稿数随数据变化：store.save() 之后统一重算，页面里处理完一件事，侧栏角标跟着变
    let navTimer = 0;
    NT.refreshNav = () => {
      clearTimeout(navTimer);
      navTimer = setTimeout(() => {
        const c = counts();
        ['work', 'review'].forEach((id) => {
          const a = document.querySelector(`.n-navitem[data-nav="${id}"]`); if (!a) return;
          const cur = a.querySelector('[data-nav-count]');
          if (!c[id]) cur?.remove();
          else if (cur) cur.textContent = c[id];
          else a.insertAdjacentHTML('beforeend', String(navCount(id, c[id])));
        });
      }, 0);
    };
    const people = role === 'self' ? { ...NAV[1], label: '我的档案', href: `person.html?id=${me.id}` } : role === 'mentor' ? { ...NAV[1], label: '所带学员' } : NAV[1];
    const recent = [
      ['盘点 · 第六期结营盘点', 'review.html?id=b-xe6-end', ['hrbp']],
      ['方案 · 留用与落位', 'plan.html?id=b-xe6-end', ['hrbp']],
      ['课题 · 口语搭子 · 一组', 'project.html?id=t-talk-a', ['mentor']],
      ['人员 · 孟逸尘', 'person.html?id=p-x11', ['hrbp', 'mentor']],
    ].filter((r) => r[2].includes(role) && role !== 'ceo');

    document.body.classList.add('nt-desk');
    const root = document.getElementById('app');
    mount(root, html`
      <a class="nt-skip" href="#main">跳到正文</a>
      <aside class="nt-side" aria-label="主导航">
        <a class="n-shell__brand nt-brand" href="index.html"><span class="nt-ip" data-ip="rest" data-size="24"></span>Niu-Talent</a>
        <nav class="nt-nav">${[NAV[0], people, NAV[2]].filter(allow).map(navItem)}</nav>
        <nav class="nt-nav nt-nav--more" aria-label="更多">${more.filter(allow).map(navItem)}</nav>
        ${recent.length ? html`<div class="n-shell__recent nt-recent">最近${recent.map(([t, h]) => html`<a href="${h}">${t}</a>`)}</div>` : ''}
        <div class="nt-side__foot">
          <a href="../../index.html">${icon('book')}评审导览</a>
          <a href="../m/index.html">${icon('phone')}手机版</a>
        </div>
      </aside>
      <div class="nt-main">
        <header class="nt-top">
          <nav class="nt-crumbs" aria-label="位置">${(cfg.crumbs || []).map(([t, h]) => html`<a href="${h}">${t}</a><span aria-hidden="true">/</span>`)}<b>${cfg.title}</b></nav>
          ${role === 'ceo' ? html`<button class="n-btn n-btn--ghost n-btn--icon" style="margin-left:auto" type="button" id="nt-cmdk-open" aria-label="搜人或项目（⌘K）" title="搜人或项目 · ⌘K">${icon('search')}</button>` : html`<button class="n-search nt-search" type="button" id="nt-cmdk-open">${icon('search')}<span>搜人、项目，或输入要做的事</span><kbd>⌘K</kbd></button>`}
          <span class="n-menuwrap"><button class="n-rolepick" type="button" id="nt-roles" aria-label="演示视角：${st.roles[role].label}，点击切换">${NT.ui.avatar(me.id, 'sm')}<small>演示视角</small>${st.roles[role].label}${icon('chev')}</button></span>
          <span class="n-menuwrap"><button class="n-btn n-btn--ghost n-btn--icon" type="button" id="nt-more" aria-label="更多">${icon('more')}</button></span>
        </header>
        <div class="nt-who">${NT.ui.avatar(me.id, 'sm')}<span>当前视角：<b>${me.name}</b>（${st.roles[role].label}） · ${st.roles[role].scope}</span><span class="n-badge n-badge--demo">演示视角</span></div>
        <main id="main" class="nt-body" tabindex="-1"></main>
      </div>`);

    // 视角切换：写进地址，刷新整页，模拟服务端按新身份重新过滤
    NT.menu(NT.$('#nt-roles'), ROLE_ORDER.map((r) => ({ label: `${st.person(st.roles[r].person).name} · ${st.roles[r].label}`, sub: st.roles[r].scope, checked: r === role, run: () => {
      if (r === role) return;
      st.setRole(r);
      const u = new URL(location.href); u.searchParams.set('as', r); u.hash = '';
      location.href = u.toString();
    } })));
    NT.menu(NT.$('#nt-more'), [
      { label: '评审导览', icon: 'book', run: () => { location.href = '../../index.html'; } },
      { label: '打开手机版', icon: 'phone', run: () => { location.href = '../m/index.html'; } },
      { sep: true },
      { label: '重置演示数据', icon: 'retry', danger: true, run: () => NT.resetDemo() },
    ]);
    wireCmdk();
    NT.ui.mountIPs(root);
    // 窄屏时侧栏变成横向滚动条：当前页的入口滚到可见处，两侧有渐隐提示还能滚动
    if (matchMedia('(max-width: 860px)').matches) document.querySelector('.nt-side [aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });

    const main = NT.$('#main');
    if (cfg.allow && !cfg.allow(role)) {
      mount(main, NT.ui.state({ ip: 'confirm', title: cfg.denyTitle || '这一页属于其他视角', text: cfg.denyText || '切换演示视角，或回到工作台。', actions: cfg.denyActions || html`<a class="n-btn n-btn--sm" href="index.html">回到工作台</a>` }));
      NT.ui.mountIPs(main);
    } else {
      cfg.render(main);
      NT.ui.mountIPs(main);
    }
    NT.applyRestore();
    if (location.hash) setTimeout(() => { const t = document.getElementById(location.hash.slice(1)); if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('nt-flash'); } }, 60);
  });


  // ⌘K：搜人、项目，或把输入当作一句话交给 AI
  function wireCmdk() {
    const dlg = document.createElement('dialog');
    dlg.className = 'n-cmdk'; dlg.setAttribute('aria-label', '命令面板');
    dlg.innerHTML = '<div class="n-cmdk__input"><svg><use href="#i-search"/></svg><input placeholder="搜人、项目，或输入要做的事" autocomplete="off" aria-controls="nt-cmdk-list"><kbd class="n-kbd">esc</kbd></div><div class="n-cmdk__list" id="nt-cmdk-list" role="listbox"></div><div class="n-cmdk__foot"><span>↑↓ 选择</span><span>↵ 打开</span></div>';
    document.body.append(dlg);
    const input = dlg.querySelector('input'), list = dlg.querySelector('.n-cmdk__list');
    const role = st.role();
    const acts = [
      role !== 'self' && ['做事', 'pen', '记一件事', '一句话或语音输入', 'record.html'],
      st.can('findOwner') && ['做事', 'spark', '为一个项目找人', '会先建项目和需求卡', 'staffing.html?new=1'],
      st.can('calibrate') && ['做事', 'layers', '发起一次盘点', '选团队和时间范围', 'reviews.html#new'],
      !['self', 'ceo'].includes(role) && ['做事', 'upload', '上传材料', 'Office 文件或录音', 'index.html#upload'],
      st.canOpenMinutes('w8') && ['做事', 'wave', '打开 W8 导师团复盘纪要', '会议纪要', 'record.html?m=w8', true],
    ].filter(Boolean);
    let sel = 0, shown = [];
    const render = () => {
      const q = input.value.trim();
      const { people, projects } = st.search(q);
      shown = [
        ...acts.filter((a) => !q || (a[2] + a[3]).includes(q)),
        ...people.slice(0, 8).map((p) => ['人员', 'user', p.name, `${st.orgShort(p.org)} · ${p.title}`, `person.html?id=${p.id}`]),
        ...projects.slice(0, 6).map((p) => ['项目', 'folder', p.name, `${p.status}${p.owner ? ` · owner ${st.person(p.owner).name}` : ' · owner 待定'}`, `project.html?id=${p.id}`]),
      ];
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      if (!shown.length) { list.innerHTML = `<div class="n-cmdk__empty">按回车，把「${NT.esc(q)}」交给 AI 记录</div>`; return; }
      let g = '';
      list.innerHTML = shown.map((c, i) => (c[0] !== g ? `<div class="n-cmdk__grp">${(g = c[0])}</div>` : '')
        + `<a class="n-cmdk__item" role="option" aria-selected="${i === sel}" href="${c[4]}"><svg><use href="#i-${c[1]}"/></svg>${NT.esc(c[2])}${c[5] ? ' <span class="n-badge n-badge--demo">演示</span>' : ''}<small>${NT.esc(c[3])}</small></a>`).join('');
    };
    const open = () => { input.value = ''; sel = 0; render(); dlg.showModal(); input.focus(); };
    NT.$('#nt-cmdk-open')?.addEventListener('click', open);
    document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg.open ? dlg.close() : open(); } });
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length); render(); list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = shown[sel];
        if (it) location.href = it[4];
        else if (input.value.trim() && role !== 'self') location.href = NT.link('record.html', { q: input.value.trim() });
      }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

})();
