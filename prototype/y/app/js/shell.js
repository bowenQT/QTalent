/* Niu-Talent 原型：桌面应用外壳。左侧导航 + 顶栏（搜索 ⌘K、演示视角、重置）+ 页面主体；
   页面状态通过 NT.reviewPage 交给评审评论层。 */
(function () {
  'use strict';
  const NT = window.NT;
  const st = NT.store;
  const { html, icon, mount } = NT;

  // 侧栏分三组：人、项目、规则；组名只是一行小字。人才项目（各期训练营、校招等）和项目与课题（人实际做事的地方）分开
  const NAV = [
    { id: 'work', label: '工作台', icon: 'home', href: 'index.html' },
    { id: 'people', label: '人才', icon: 'users', href: 'people.html', group: '人' },
    { id: 'review', label: '盘点', icon: 'layers', href: 'reviews.html', roles: ['ceo', 'hrbp', 'lead'], group: '人' },
    { id: 'queue', label: '评分复核', icon: 'check2', href: 'queue.html', roles: ['hrbp'], group: '人' },
    { id: 'programs', label: '人才项目', icon: 'book', href: 'landing.html', group: '项目' },
    { id: 'projects', label: '项目与课题', icon: 'folder', href: 'projects.html', group: '项目' },
    { id: 'rules', label: '人才评价规则', icon: 'grid', href: 'rules.html', roles: ['ceo', 'hrbp'], group: '规则' },
    // 判断对照归在「人才评价规则」下（规则 / 判断对照两个页签）；导航里只给不能看汇总、但做过评价的人留「我的判断对照」
    { id: 'judge', label: '我的判断对照', icon: 'swap', href: 'judge.html?rater=me', group: '规则' },
    { id: 'tags', label: '标签库', icon: 'tag', href: 'tags.html', roles: ['hrbp'], group: '规则' },
    { id: 'admin', label: '系统管理', icon: 'lock', href: 'admin.html', roles: ['admin'], group: '系统' },
  ];
  const ROLE_ORDER = ['ceo', 'hrbp', 'mentor', 'admin'];

  // 桌面录音状态：存在本标签页的 sessionStorage，与手机端的 nty-rec 分开。
  // 站内跳转时录音继续（工程里录音组件挂在桌面布局层）；整页刷新等同录音页被关掉，录音暂停，回到录音页时问继续还是结束
  const REC_KEY = 'nty-drec';
  NT.rec = {
    get() { try { return JSON.parse(sessionStorage.getItem(REC_KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? sessionStorage.setItem(REC_KEY, JSON.stringify(v)) : sessionStorage.removeItem(REC_KEY); } catch (e) { /* 存不下时只在本页生效 */ } },
    elapsed(r) { return Math.floor(((r.paused ? r.pausedAt : Date.now()) - r.t0) / 1000); },
    fmt: (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
    // 录音只属于录的人：切换演示视角后不带出别人的录音
    mine() { const r = NT.rec.get(); return r && ['hrbp', 'mentor'].includes(st.role()) && r.by === st.me().id ? r : null; },
    LIMIT: { meet: 7200, obs: 600 }, // 时长上限（秒）：多人会议 2 小时，观察速记 10 分钟
    overLimit(r) { return !r.paused && NT.rec.elapsed(r) >= NT.rec.LIMIT[r.mode]; },
    // 结束后的整理任务进工作台「进行中的任务」：转写中 → 整理中 → 部分待核对（演示里结果是预先处理好的 W8 纪要）
    addTask({ title, dur }) {
      const S = st.get(), now = Date.now();
      S.tasks = S.tasks.filter((t) => t.id !== 'tk-drec');
      const task = { id: 'tk-drec', name: `${title}.m4a`, state: 'transcribing', minutes: 'w8', by: st.me().id, note: `录音 ${NT.rec.fmt(dur)} · 可以离开，结果会回到这里`, link: 'record.html?m=w8', shapeAt: now + 3000, readyAt: now + 6000 };
      S.tasks.unshift(task); st.save(); watchRecTask();
      return task;
    },
  };
  // 收起后到达时长上限：直接结束，不弹确认，整理任务照常生成（录音页里由页面自己结束）
  const recAutoEnd = (r) => {
    NT.rec.addTask({ title: r.title, dur: NT.rec.LIMIT[r.mode] });
    NT.rec.set(null);
    return `录音已到 ${NT.rec.fmt(NT.rec.LIMIT[r.mode])}，自动结束，整理结果会出现在工作台「进行中的任务」`;
  };
  addEventListener('pagehide', () => { const r = NT.rec.get(); if (r && !r.paused) { r.hiddenAt = Date.now(); NT.rec.set(r); } });
  (() => {
    const r = NT.rec.get();
    if (!r || r.paused || performance.getEntriesByType('navigation')[0]?.type !== 'reload') return;
    Object.assign(r, { paused: true, pausedAt: r.hiddenAt || Date.now(), away: true });
    NT.rec.set(r);
  })();
  // 桌面录音的整理任务先转写再整理：转写的约定时间到了先进入整理中，之后由 store.tickTasks 按 readyAt 收尾
  const recTask = () => {
    const t = st.get().tasks.find((x) => x.id === 'tk-drec' && x.state === 'transcribing' && Date.now() >= x.shapeAt);
    if (t) { t.state = 'shaping'; t.note = '转写完成，正在整理事件'; st.save(); }
  };
  // 停在某一页时任务也按约定时间往下走：到点推进一步并发出 nt:tasks，工作台据此刷新任务列表
  let recTaskTimer = 0;
  function watchRecTask() {
    clearTimeout(recTaskTimer);
    const t = st.get().tasks.find((x) => x.id === 'tk-drec' && ['transcribing', 'shaping'].includes(x.state));
    if (!t) return;
    recTaskTimer = setTimeout(() => {
      recTask(); st.tickTasks();
      dispatchEvent(new Event('nt:tasks'));
      watchRecTask();
    }, Math.max(0, (t.state === 'transcribing' ? t.shapeAt : t.readyAt) - Date.now()) + 50);
  }
  // 录音收起后，顶栏的录音条：计时、波形、标题（暂停时写「已暂停」），点「展开」回到录音页
  const recBar = () => {
    const r = NT.rec.mine();
    if (!r || document.body.dataset.page === 'recording') return '';
    return html`<div class="n-recbar nt-recbar${r.paused ? ' is-paused' : ''}" role="group" aria-label="录音"><span class="n-recbar__dot"></span><span class="n-recbar__time" id="nt-rectime">${NT.rec.fmt(NT.rec.elapsed(r))}</span><span class="n-wave" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => html`<i style="animation-delay:${i * 0.15}s"></i>`)}</span><span class="nt-recbar__t">${r.paused ? '已暂停' : r.title}</span><a class="n-btn n-btn--sm" href="recording.html" aria-label="展开录音">展开</a></div>`;
  };


  // 页面入口：NT.shell({ nav, title, crumbs, render(main), view(), state(), restore(state) })
  NT.shell = (cfg) => NT.ready(() => {
    const live = NT.rec.mine();
    const ended = live && document.body.dataset.page !== 'recording' && NT.rec.overLimit(live) ? recAutoEnd(live) : '';
    recTask();
    st.tickTasks();
    watchRecTask();
    const role = st.role();
    // 系统管理员打开业务页面：标题和面包屑也不带出人名、项目名
    const blocked = role === 'admin' && cfg.nav !== 'admin';
    const denied = blocked || (cfg.allow && !cfg.allow(role));
    const title = blocked ? '系统管理员看不到这一页' : cfg.title;
    // 被拦下的页面不把业务页面的现场交给评论层：还原现场会调用页面自己的 restore 重新渲染，绕过拦截
    NT.reviewPage(denied ? { view: () => title } : cfg);
    document.title = `${title} · Niu-Talent`;
    const me = st.me();
    // 管理者视角收敛：工作台不挂待办数，盘点不挂草稿数；评分复核、标签库不进导航
    const counts = () => (['ceo', 'admin'].includes(role) ? { work: 0, review: 0 } : { work: st.todos().length, review: st.get().batches.filter((b) => b.kind === 'inventory' && b.status === 'draft').length });
    // 系统管理员只有「系统管理」一个入口；其他视角看不到它
    const allow = (n) => (role === 'admin' ? n.id === 'admin' : n.id === 'judge' ? !st.canJudge() && st.isRater() : !n.roles || n.roles.includes(role)) && !(n.hideFor || []).includes(role);
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
    // 本人和导师看到的「人才」换成自己的入口；管理者的人才项目先进各期的关键节点复盘
    const items = NAV.map((n) => (n.id === 'people' && role === 'self' ? { ...n, label: '我的档案', href: `person.html?id=${me.id}` }
      : n.id === 'people' && role === 'mentor' ? { ...n, label: '所带学员' }
      : n.id === 'programs' && role === 'ceo' ? { ...n, href: 'actions.html' } : n)).filter(allow);
    const groups = [...new Set(items.map((n) => n.group).filter(Boolean))];
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
        <a class="n-shell__brand nt-brand" href="${role === 'admin' ? 'admin.html' : 'index.html'}"><span class="nt-ip" data-ip="rest" data-size="24"></span><span>Niu-Talent<small>人才识别、追踪与盘点</small></span></a>
        <nav class="nt-nav">${items.filter((n) => !n.group).map(navItem)}${groups.map((g) => html`<div class="nt-nav__grp" role="group" aria-label="${g}"><span class="nt-nav__h" aria-hidden="true">${g}</span>${items.filter((n) => n.group === g).map(navItem)}</div>`)}</nav>
        ${recent.length ? html`<div class="n-shell__recent nt-recent">最近${recent.map(([t, h]) => html`<a href="${h}">${t}</a>`)}</div>` : ''}
        <div class="nt-side__foot">
          <a href="../../index.html">${icon('book')}评审导览</a>
          <a href="../m/index.html">${icon('phone')}手机版</a>
        </div>
      </aside>
      <div class="nt-main">
        <header class="nt-top">
          <nav class="nt-crumbs" aria-label="位置">${(blocked ? [] : cfg.crumbs || []).map(([t, h]) => html`<a href="${h}">${t}</a><span aria-hidden="true">/</span>`)}<b>${title}</b></nav>
          ${blocked ? '' : recBar()}
          ${role === 'admin' ? html`<span style="margin-left:auto"></span>` : role === 'ceo' ? html`<button class="n-btn n-btn--ghost n-btn--icon" style="margin-left:auto" type="button" id="nt-cmdk-open" aria-label="搜人或项目（⌘K）" title="搜人或项目 · ⌘K">${icon('search')}</button>` : html`<button class="n-search nt-search" type="button" id="nt-cmdk-open">${icon('search')}<span>搜人、项目，或输入要做的事</span><kbd>⌘K</kbd></button>`}
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
    if (role !== 'admin') wireCmdk(); // 系统管理员不能搜人
    if (ended) NT.toast(ended, { duration: 6000 });
    const rec = NT.$('#nt-rectime');
    if (rec && !NT.rec.mine().paused) {
      const timer = setInterval(() => {
        const r = NT.rec.get();
        if (!r) { clearInterval(timer); NT.$('.nt-recbar')?.remove(); return; }
        if (NT.rec.overLimit(r)) { clearInterval(timer); NT.$('.nt-recbar')?.remove(); NT.toast(recAutoEnd(r), { duration: 6000 }); return; }
        rec.textContent = NT.rec.fmt(NT.rec.elapsed(r));
      }, 1000);
    }
    NT.ui.mountIPs(root);
    // 窄屏时侧栏变成横向滚动条：当前页的入口滚到可见处，两侧有渐隐提示还能滚动
    if (matchMedia('(max-width: 860px)').matches) document.querySelector('.nt-side [aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });

    const main = NT.$('#main');
    if (blocked) {
      // 业务页面一律不对系统管理员渲染：先拦在外层，不依赖各页面自己的 allow
      mount(main, NT.ui.state({ ip: 'confirm', title: '系统管理员看不到人才数据', text: '这一页属于业务视角。系统管理员负责账号与权限、北森同步、集成配置和审计日志。', actions: html`<a class="n-btn n-btn--sm" href="admin.html">打开系统管理</a>` }));
      NT.ui.mountIPs(main);
    } else if (denied) {
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
      ['hrbp', 'mentor'].includes(role) && ['做事', 'mic', '开始录音', '多人会议或观察速记', 'recording.html'],
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
