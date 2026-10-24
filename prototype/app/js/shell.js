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
    { id: 'landing', label: 'Landing 第三期', icon: 'book', href: 'landing.html', roles: ['ceo', 'hrbp', 'lead', 'mentor'] },
    { id: 'actions', label: '行动与复盘', icon: 'check2', href: 'actions.html', roles: ['ceo', 'hrbp', 'lead'] },
    { id: 'queue', label: '校准队列', icon: 'split', href: 'queue.html', roles: ['ceo', 'hrbp'] },
    { id: 'tags', label: '标签库', icon: 'tag', href: 'tags.html', roles: ['ceo', 'hrbp', 'lead'] },
  ];
  const ROLE_ORDER = ['ceo', 'hrbp', 'lead', 'mentor', 'self'];


  // 页面入口：NT.shell({ nav, title, crumbs, render(main), view(), state(), restore(state) })
  NT.shell = (cfg) => NT.ready(() => {
    NT.reviewPage(cfg);
    st.tickTasks();
    document.title = `${cfg.title} · Niu-Talent`;
    const role = st.role();
    const me = st.me();
    const todos = st.todos().length;
    const drafts = st.get().batches.filter((b) => b.kind === 'inventory' && b.status === 'draft').length;
    const allow = (n) => !n.roles || n.roles.includes(role);
    const navItem = (n) => html`<a class="n-navitem" href="${n.href}" ${NT.raw(cfg.nav === n.id ? 'aria-current="page"' : '')}>${icon(n.icon)}${n.label}${n.id === 'work' && todos ? html`<span class="n-count">${todos}</span>` : ''}${n.id === 'review' && drafts ? html`<span class="n-count is-quiet">${drafts}</span>` : ''}</a>`;
    const people = role === 'self' ? { ...NAV[1], label: '我的档案', href: `person.html?id=${me.id}` } : role === 'mentor' ? { ...NAV[1], label: '所带学员' } : NAV[1];
    const recent = [
      ['项目 · 海外加速搜索体验', 'project.html?id=pr-search', ['ceo', 'hrbp', 'lead']],
      ['盘点 · 增长产品部 2026 H2', 'review.html?id=b-h2', ['ceo', 'hrbp', 'lead']],
      ['批次 · Landing 第三期', 'landing.html', ['ceo', 'hrbp', 'lead', 'mentor']],
      ['人员 · 林知远', 'person.html?id=p-lin', ['ceo', 'hrbp', 'mentor', 'self']],
    ].filter((r) => r[2].includes(role));

    document.body.classList.add('nt-desk');
    const root = document.getElementById('app');
    mount(root, html`
      <a class="nt-skip" href="#main">跳到正文</a>
      <aside class="nt-side" aria-label="主导航">
        <a class="n-shell__brand nt-brand" href="index.html"><span class="nt-ip" data-ip="rest" data-size="24"></span>Niu-Talent</a>
        <nav class="nt-nav">${[NAV[0], people, NAV[2]].filter(allow).map(navItem)}</nav>
        <nav class="nt-nav nt-nav--more" aria-label="更多">${MORE.filter(allow).map(navItem)}</nav>
        ${recent.length ? html`<div class="n-shell__recent nt-recent">最近${recent.map(([t, h]) => html`<a href="${h}">${t}</a>`)}</div>` : ''}
        <div class="nt-side__foot">
          <a href="../index.html">${icon('book')}评审导览</a>
          <a href="../m/index.html">${icon('phone')}手机版</a>
        </div>
      </aside>
      <div class="nt-main">
        <header class="nt-top">
          <nav class="nt-crumbs" aria-label="位置">${(cfg.crumbs || []).map(([t, h]) => html`<a href="${h}">${t}</a><span aria-hidden="true">/</span>`)}<b>${cfg.title}</b></nav>
          <button class="n-search nt-search" type="button" id="nt-cmdk-open">${icon('search')}<span>搜人、项目，或输入要做的事</span><kbd>⌘K</kbd></button>
          <div class="n-roles nt-roles"><span>演示视角</span>
            <div class="n-seg" role="group" aria-label="演示视角" data-manual id="nt-roles">${ROLE_ORDER.map((r) => html`<button type="button" data-r="${r}" aria-pressed="${r === role}" title="${st.roles[r].scope}">${st.roles[r].label}</button>`)}</div>
          </div>
          <span class="n-menuwrap"><button class="n-btn n-btn--ghost n-btn--icon" type="button" id="nt-more" aria-label="更多">${icon('more')}</button></span>
        </header>
        <div class="nt-who">${NT.ui.avatar(me.id, 'sm')}<span>以 <b>${me.name}</b>（${st.roles[role].label}）的身份查看 · ${st.roles[role].scope}</span><span class="n-badge n-badge--demo">演示视角</span></div>
        <main id="main" class="nt-body" tabindex="-1"></main>
      </div>`);

    // 视角切换：写进地址，刷新整页，模拟服务端按新身份重新过滤
    NT.$('#nt-roles').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]'); if (!b || b.dataset.r === role) return;
      st.setRole(b.dataset.r);
      const u = new URL(location.href); u.searchParams.set('as', b.dataset.r); u.hash = '';
      location.href = u.toString();
    });
    NT.menu(NT.$('#nt-more'), [
      { label: '评审导览', icon: 'book', run: () => { location.href = '../index.html'; } },
      { label: '打开手机版', icon: 'phone', run: () => { location.href = '../m/index.html'; } },
      { sep: true },
      { label: '重置演示数据', icon: 'retry', danger: true, run: () => NT.resetDemo() },
    ]);
    wireCmdk();
    NT.ui.mountIPs(root);

    const main = NT.$('#main');
    if (cfg.allow && !cfg.allow(role)) {
      mount(main, NT.ui.state({ ip: 'confirm', title: cfg.denyTitle || '这个视角看不到这一页', text: cfg.denyText || `${st.roles[role].label}没有这部分内容的权限。切换到其他演示视角，或回到工作台。`, actions: html`<a class="n-btn n-btn--sm" href="index.html">回到工作台</a>` }));
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
    dlg.innerHTML = '<div class="n-cmdk__input"><svg><use href="#i-search"/></svg><input placeholder="搜人、项目，或输入要做的事" autocomplete="off" aria-controls="nt-cmdk-list"><kbd class="n-kbd">esc</kbd></div><div class="n-cmdk__list" id="nt-cmdk-list" role="listbox"></div><div class="n-cmdk__foot"><span>↑↓ 选择</span><span>↵ 打开</span><span style="margin-left:auto">只搜索你有权限查看的人员</span></div>';
    document.body.append(dlg);
    const input = dlg.querySelector('input'), list = dlg.querySelector('.n-cmdk__list');
    const role = st.role();
    const acts = [
      role !== 'self' && ['做事', 'pen', '记一条关键事件', '一句话或按住说话', 'record.html'],
      st.can('findOwner') && ['做事', 'spark', '为一个项目找人', '会先建项目和需求卡', 'staffing.html?new=1'],
      st.can('review') && role !== 'lead' && ['做事', 'layers', '发起一次盘点', '选团队和时间范围', 'reviews.html#new'],
      role !== 'self' && ['做事', 'upload', '上传材料', 'Office 文件或录音', 'index.html#upload'],
      st.canOpenMinutes('w2') && ['做事', 'wave', '打开 W2 导师团复盘纪要', '预先处理的演示任务', 'record.html?m=w2'],
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
      if (!shown.length) { list.innerHTML = `<div class="n-cmdk__empty">没有找到「${NT.esc(q)}」。按回车，把它当作一句话交给 AI 记录。</div>`; return; }
      let g = '';
      list.innerHTML = shown.map((c, i) => (c[0] !== g ? `<div class="n-cmdk__grp">${(g = c[0])}</div>` : '')
        + `<a class="n-cmdk__item" role="option" aria-selected="${i === sel}" href="${c[4]}"><svg><use href="#i-${c[1]}"/></svg>${NT.esc(c[2])}<small>${NT.esc(c[3])}</small></a>`).join('');
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
