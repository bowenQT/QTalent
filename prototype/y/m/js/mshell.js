/* Niu-Talent 手机原型（版本 Y）：只给导师用，覆盖录音、一句话记录、导师评价和待核对。桌面浏览器里放进手机框，左侧是流程入口；真机上铺满屏幕。
   底部导航：工作台、学员、记录（居中，轻点选方式，按住直接说话）、待办、我的。弹窗在手机上改为屏内底部弹层。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const M = (NT.m = {});
  const PAGES = ['index', 'record', 'quick', 'mentor', 'people', 'person', 'inbox', 'me', 'judge', 'confirm'];
  // 手机端给导师用，不写入本地的视角设置，回到桌面版时仍是原来的视角。
  // 系统管理员不能改写成导师，否则侧栏的手机入口和 ?as=admin 会看到学员与分数。
  const incomingRole = st.role();
  if (incomingRole !== 'admin') st.role = () => 'mentor';
  const FLOWS = [
    ['record', '录音', 'record.html', '选模式 → 实时转写 → 处理中 → 人才纪要 → 追问'],
    ['quick', '一句话记录', 'quick.html', '一句话或按住说话 → 确认 AI 建议分'],
    ['mentor', '导师评价', 'mentor.html', '选学员 → 说一段话 → 逐项确认 → 确认复盘'],
    ['inbox', '待核对', 'inbox.html', '逐条确认「小孟」「说话人 2」指的是谁'],
    ['confirm', '回执确认', 'confirm.html?r=d-ms2', '企业微信回执里的链接 → 逐条确认或改分'],
  ];

  // 页面入口：NT.mshell({ tab, title, back, action, allow, denyTitle, denyText, demos, view, state, restore, render(main), bare })
  NT.mshell = (cfg) => NT.ready(() => {
    if (incomingRole === 'admin') {
      document.title = '系统管理员看不到这一页 · Niu-Talent 手机版';
      document.body.classList.add('nt-mob');
      const root = document.getElementById('app');
      mount(root, html`
        <div class="m-stage"><div class="m-phone"><div class="m-screen"><main id="main" class="m-body" style="padding:24px">
          ${UI.state({ ip: 'confirm', size: 56, title: '系统管理员看不到人才数据', text: '手机版会进入导师的学员、档案和分数。系统管理员只使用桌面版的系统管理。', actions: html`<a class="n-btn n-btn--sm" href="../app/admin.html">回到系统管理</a>` })}
        </main></div></div></div>`);
      UI.mountIPs(root);
      return;
    }
    st.tickTasks();
    document.title = `${cfg.title} · Niu-Talent 手机版`;
    const role = st.role(), me = st.me();
    const denied = cfg.allow && !cfg.allow(role);
    // 被拦下的页面不把业务页面的现场交给评论层，避免还原现场时重新渲染被拦的内容
    NT.reviewPage(denied ? { view: () => cfg.title } : cfg);
    const page = document.body.dataset.page;
    const todos = st.todos().length;
    const tabs = [
      { id: 'work', label: '工作台', icon: 'home', href: 'index.html' },
      { id: 'people', label: '学员', icon: 'users', href: 'people.html' },
      { id: 'rec', rec: true },
      { id: 'todo', label: '待办', icon: 'check2', href: 'inbox.html', dot: todos > 0 },
      { id: 'me', label: '我的', icon: 'user', href: 'me.html' },
    ];
    document.body.classList.add('nt-mob');
    const root = document.getElementById('app');
    mount(root, html`
      <div class="m-stage">
        <aside class="m-side" aria-label="手机版说明">
          <h1><span class="nt-ip" data-ip="rest" data-size="24"></span>Niu-Talent 手机版</h1>
          <p>手机端只给导师用，做复盘现场最常用的几件事。管理者和 HR 的工作在桌面版完成。</p>
          <div><h2>五条流程</h2><ol class="m-flows">${FLOWS.map(([id, t, href, sub]) => html`<li><a href="${href}" ${NT.raw(page === id || (id === 'mentor' && (page === 'people' || page === 'person')) ? 'aria-current="page"' : '')}>${t}<small>${sub}</small></a></li>`)}</ol></div>
          <div><h2>身份</h2><p>${me.name} · ${st.roles[role].label} · ${st.roles[role].scope}</p></div>
          ${cfg.demos?.length ? html`<div><h2>演示其他情况</h2><div class="m-side__links">${cfg.demos.map(([t, h]) => html`<a class="n-btn n-btn--sm" href="${h}">${t}</a>`)}</div></div>` : ''}
          <div class="m-side__links">
            <a class="n-btn n-btn--sm n-btn--ghost" href="../app/index.html?as=mentor">${icon('home')}桌面版</a>
            <a class="n-btn n-btn--sm n-btn--ghost" href="../../index.html">${icon('book')}评审导览</a>
            <button class="n-btn n-btn--sm n-btn--ghost" type="button" id="m-reset">${icon('retry')}重置演示数据</button>
          </div>
        </aside>
        <div class="m-phone">
          <div class="m-screen" id="m-screen">
            <div class="m-status" aria-hidden="true"><span>9:41</span><i></i></div>
            ${cfg.bare ? '' : html`<header class="m-bar">
              ${cfg.back ? html`<a href="${cfg.back === true ? 'index.html' : cfg.back}" aria-label="返回" id="m-back">${icon('back')}</a>` : html`<span></span>`}
              <h1>${cfg.title}</h1>
              <span id="m-act">${cfg.action || ''}</span>
            </header>`}
            <div class="m-body" id="m-scroll" tabindex="-1">
              <div class="m-who">${UI.avatar(me.id, 'sm')}<span>以 <b>${me.name}</b>（${st.roles[role].label}）的身份查看</span><span class="n-badge n-badge--demo" style="margin-left:auto">演示</span></div>
              <main id="main"></main>
            </div>
            <div id="m-recbar-slot"></div>
            ${cfg.noTabbar ? '' : html`<nav class="n-tabbar" aria-label="手机导航">${tabs.map((t) => (t.rec
              ? html`<a class="n-tabbar__rec" href="quick.html" id="m-rec" aria-label="记录：轻点选方式，按住直接说话">${icon('mic')}</a>`
              : html`<a href="${t.href}" ${NT.raw(cfg.tab === t.id ? 'aria-current="page"' : '')}>${t.dot ? html`<span class="dot">${icon(t.icon)}</span>` : icon(t.icon)}${t.label}</a>`))}</nav>`}
          </div>
        </div>
      </div>`);

    NT.$('#m-reset').addEventListener('click', () => NT.resetDemo());
    if (cfg.back === true) NT.$('#m-back')?.addEventListener('click', (e) => { if (history.length > 1 && document.referrer.includes('/m/')) { e.preventDefault(); history.back(); } });
    wireRecButton();
    wireLinks();
    recBar();
    UI.mountIPs(root);

    const main = NT.$('#main');
    if (denied) {
      mount(main, UI.state({ ip: 'confirm', size: 56, title: cfg.denyTitle || '这一页不在导师的范围内', text: cfg.denyText || '回到工作台，或在桌面版查看。', actions: html`<a class="n-btn n-btn--sm" href="index.html">回到工作台</a>` }));
    } else cfg.render(main);
    UI.mountIPs(main);
    NT.applyRestore();
    if (location.hash) setTimeout(() => { const t = document.getElementById(location.hash.slice(1)); if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('nt-flash'); } }, 80);
  });

  // 手机版没有的页面（项目、校准队列、象限……）去桌面版
  function wireLinks() {
    NT.$('#m-screen').addEventListener('click', (e) => {
      const a = e.target.closest('a[href]'); if (!a) return;
      const href = a.getAttribute('href');
      if (/^(#|\.\.\/|https?:|mailto:)/.test(href)) return;
      const name = href.split(/[?#]/)[0].replace(/\.html$/, '');
      if (name && !PAGES.includes(name)) { e.preventDefault(); location.href = `../app/${href}`; }
    });
  }

  // 居中的记录键：轻点弹出三种方式，按住直接说话
  function wireRecButton() {
    const b = NT.$('#m-rec'); if (!b) return;
    let timer = 0, held = false;
    b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; location.href = 'quick.html?hold=1'; }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault(); if (held) return;
      M.sheet({
        title: '记录', sub: '按住中间的按钮可以直接说话',
        body: html`<ul class="m-list">
          <li><a href="record.html">${icon('wave')}<span>录音<small>观察速记、多人会议，或上传已有录音</small></span>${icon('chev')}</a></li>
          <li><a href="quick.html">${icon('pen')}<span>一句话记录<small>写或说一件具体的事，AI 整理成关键事件</small></span>${icon('chev')}</a></li>
          <li><a href="mentor.html">${icon('users')}<span>导师评价<small>复盘后对所带学员逐个评价</small></span>${icon('chev')}</a></li>
        </ul>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }],
      });
    });
  }

  // ---------- 屏内底部弹层：替代桌面的居中弹窗，接口与 NT.dialog 相同 ----------
  M.sheet = (o) => new Promise((resolve) => {
    const screen = NT.$('#m-screen') || document.body;
    const scrim = document.createElement('div'); scrim.className = 'm-scrim';
    const sh = document.createElement('div');
    sh.className = 'n-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', o.title);
    sh.innerHTML = `<div class="n-sheet__grip"></div><h4>${NT.esc(o.title)}</h4>${o.sub ? `<p class="n-sheet__sub">${NT.esc(o.sub)}</p>` : ''}
      ${o.body ? `<div class="nt-dlg-body">${NT.piece(o.body)}</div>` : ''}
      ${o.facts?.length ? `<ul class="n-dialog__facts">${o.facts.map((f) => `<li>${NT.piece(f)}</li>`).join('')}</ul>` : ''}
      <div class="m-sheet__bar">${(o.actions || [{ label: '知道了', value: 'ok', cls: 'n-btn--ink' }]).map((a, i) =>
        `<button class="n-btn ${a.cls || ''}" type="button" data-i="${i}">${a.icon ? `<svg><use href="#i-${a.icon}"/></svg>` : ''}${NT.esc(a.label)}</button>`).join('')}</div>`;
    screen.append(scrim, sh);
    const prev = document.activeElement;
    let value = 'cancel';
    const close = () => {
      sh.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: NT.reduced ? 1 : 200, easing: 'ease-in' }).onfinish = () => { sh.remove(); scrim.remove(); prev?.focus?.(); resolve(value); };
    };
    sh.addEventListener('click', (e) => {
      const dv = e.target.closest('[data-value]'); // 列表里的选项：点一下即选定并关闭
      if (dv) { value = dv.dataset.value; close(); return; }
      const b = e.target.closest('[data-i]'); if (!b) return;
      const a = (o.actions || [{ value: 'ok' }])[+b.dataset.i];
      if (a.validate && !a.validate(sh)) return;
      value = a.value; if (a.read) value = { value: a.value, data: a.read(sh) };
      close();
    });
    scrim.addEventListener('click', close);
    sh.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    sh.tabIndex = -1; sh.focus();
    o.onOpen && o.onOpen(sh);
  });
  NT.dialog = M.sheet;

  // ---------- 录音中离开录音页：悬浮录音条 ----------
  M.rec = {
    get() { try { return JSON.parse(sessionStorage.getItem('nty-rec') || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? sessionStorage.setItem('nty-rec', JSON.stringify(v)) : sessionStorage.removeItem('nty-rec'); } catch (e) { /* 忽略 */ } },
    elapsed(r) { return Math.floor(((r.paused ? r.pausedAt : Date.now()) - r.t0) / 1000); },
  };
  M.fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  function recBar() {
    const r = M.rec.get();
    if (!r || document.body.dataset.page === 'record') return;
    const slot = NT.$('#m-recbar-slot');
    mount(slot, html`<div class="n-recbar m-recbar"><span class="n-recbar__dot"></span><span class="n-recbar__time" id="m-rectime">${M.fmt(M.rec.elapsed(r))}</span><span class="n-wave" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => html`<i style="animation-delay:${i * 0.15}s"></i>`)}</span><span style="opacity:.75;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.paused ? '已暂停' : r.title}</span><a class="n-btn n-btn--sm" href="record.html" style="background:rgb(255 255 255 / .14);color:#fff;box-shadow:none;margin-left:auto">展开</a></div>`);
    if (!r.paused) setInterval(() => { const t = NT.$('#m-rectime'); if (t) t.textContent = M.fmt(M.rec.elapsed(r)); }, 1000);
  }

  // ---------- 手机页面常用片段 ----------
  // 待办在手机上的落点：复盘去导师评价，方案去确认方案，其余沿用；判断对照、找人这类没有手机页的转到桌面版
  const M_PAGES = ['index', 'people', 'person', 'quick', 'record', 'plan', 'inbox', 'mentor', 'me', 'judge'];
  // 回执在手机上打开确认页（企业微信回执里的链接落到这里）
  const mHref = (h) => (/^receipt\.html\?id=/.test(h) ? `confirm.html?r=${h.match(/id=([^&#]+)/)[1]}` : M_PAGES.includes(h.split(/[?#]/)[0].replace('.html', '')) ? h : `../app/${h}`);
  M.todoHref = (t) => (t.kind === 'review' ? `mentor.html?id=${t.person}` : t.kind === 'plan' ? `../app/plan.html?id=${t.plan}` : mHref(t.href));

  // 一行分数：AI 建议是带流光的空心点，点圆点即确认或改分；改分留下 AI 的淡影和差值，差 2 分以上提示写理由。
  // sc = { d, v, ai, note }；返回 { el, settle() }，状态写回 sc（v、touched、why）
  M.scoreRow = (sc, o = {}) => {
    const d = st.dim(sc.d);
    const el = document.createElement('div');
    el.className = 'm-score';
    el.innerHTML = `<div class="n-score" data-state="${sc.v == null ? 'unknown' : 'ai'}"><span class="n-score__dim">${NT.esc(d.name)}</span><span class="n-score__dots" role="radiogroup" aria-label="${NT.esc(d.name)}分数">${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="n-score__dot" role="radio" aria-checked="false" aria-label="${v} 分" data-v="${v}"></button>`).join('')}</span>${sc.v == null ? '<span class="n-score__empty n-badge n-badge--unknown"><svg><use href="#i-dash"/></svg>资料不足</span>' : ''}</div><div class="m-score__note"></div><div class="m-score__anchor" hidden></div>`;
    const row = el.firstChild, note = el.querySelector('.m-score__note'), anchor = el.querySelector('.m-score__anchor');
    const paint = () => {
      const edited = sc.touched && sc.ai != null && sc.v !== sc.ai;
      NT.$$('.n-score__dot', row).forEach((b) => {
        const v = +b.dataset.v;
        b.classList.toggle('is-on', sc.v != null && v <= sc.v);
        b.classList.toggle('is-ghost', edited && v <= sc.ai && v > sc.v);
        b.setAttribute('aria-checked', v === sc.v);
      });
      if (row.dataset.state === 'confirmed') note.innerHTML = edited ? `<span class="n-score__delta">${sc.v > sc.ai ? '+' : ''}${sc.v - sc.ai}</span> AI 原为 ${sc.ai}` : sc.ai == null ? '你补的分' : '和 AI 建议一致';
      else note.textContent = sc.note || '';
      let why = el.querySelector('.n-score__why');
      if (edited && Math.abs(sc.v - sc.ai) >= 2) {
        if (!why) { why = document.createElement('input'); why.className = 'n-score__why'; why.setAttribute('aria-label', `${d.name}改分理由`); why.oninput = () => { sc.why = why.value; }; el.append(why); }
        why.placeholder = `为什么改成 ${sc.v} 分？留空会转给 HR 复核`;
      } else why?.remove();
    };
    row.addEventListener('click', (e) => {
      const b = e.target.closest('.n-score__dot'); if (!b || el.dataset.locked) return;
      sc.v = +b.dataset.v; sc.touched = true; row.dataset.state = 'confirmed';
      // 专业度按被记录人的岗位族锚点（v1.6 3.36）；已保存的事件按保存时的版本（o.ver），写出所用版本
      const pid = o.pid?.(), a = st.anchors(sc.d, pid, o.ver?.()), fam = sc.d === 'prof' && pid ? ` · ${st.familyName(st.familyOf(pid))}族${a.fam ? '' : '按通用锚点'}` : '';
      anchor.hidden = false; anchor.innerHTML = `<b>${sc.v} 分锚点</b><small> ${NT.esc(a.v + fam)}</small><br>${NT.esc(a.list[sc.v - 1])}`;
      paint(); o.onChange && o.onChange(sc);
    });
    paint();
    return {
      el,
      settle() { if (row.dataset.state === 'ai') row.dataset.state = 'confirmed'; el.dataset.locked = 1; anchor.hidden = true; paint(); const w = el.querySelector('.n-score__why'); if (w) { if (w.value.trim()) w.readOnly = true; else w.remove(); } },
    };
  };

  // 按住说话：按下开始把脚本里的话逐字「转写」进输入框，在按钮上松开才结束。
  // 轻点、滑出按钮或手势被取消时恢复按下前的原话，不提交，也不开始整理。
  M.hold = (btn, field, script, o = {}) => {
    let timer = 0, i = 0, down = 0, prev = '';
    const start = (e) => {
      if (down) return;
      e.preventDefault();
      prev = field.value; down = Date.now(); i = 0;
      btn.classList.add('is-on'); o.onStart && o.onStart();
      if (e.pointerId != null && btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 没有指针捕获时仍靠离开和松开判断 */ } }
      timer = setInterval(() => { if (i < script.length) { field.value = script.slice(0, ++i); field.scrollTop = field.scrollHeight; } }, NT.reduced ? 1 : 55);
    };
    const inside = (e) => {
      if (!e || e.clientX == null || e.clientY == null || !btn.getBoundingClientRect) return true;
      const r = btn.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const stop = () => { clearInterval(timer); timer = 0; btn.classList.remove('is-on'); down = 0; };
    const restore = () => { field.value = prev; o.onCancel && o.onCancel(); };
    const end = (e) => {
      if (!down) return;
      const held = Date.now() - down;
      const kind = e && e.type;
      if (kind === 'pointerleave' || kind === 'pointercancel' || (kind === 'pointerup' && !inside(e))) { stop(); restore(); return; }
      stop();
      if (held < 350) { restore(); NT.toast('按住说话，松开结束'); return; }
      field.value = script; o.onEnd && o.onEnd(script);
    };
    btn.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, end));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !down) start(e); });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') end(e); });
  };

  // 人的行：点一下拉起速览（底部弹层），速览里再打开档案（v1.5 3.27）
  M.prow = (pid, title, sub, tail) => html`<li><a href="person.html?id=${pid}" data-peek="p:${pid}">${UI.avatar(pid, 'sm')}<span>${title}${sub ? html`<small>${sub}</small>` : ''}</span>${tail ?? icon('chev')}</a></li>`;
  // 一行待办：「管理者请你」和「待核实线索」旁边可以先看这个人的速览，行本身仍去办理（v1.5 3.27.1）
  M.todoRow = (t) => {
    const lead = html`<span class="n-badge ${t.cls || ''}" style="flex:none">${t.icon ? icon(t.icon) : ''}${t.badge}</span>`;
    const pid = t.kind === 'push' ? st.pushOf(t.push)?.person : t.kind === 'clue' ? st.get().watchClues.find((c) => c.id === t.clue)?.person : null;
    if (!pid) return M.row(M.todoHref(t), lead, t.title, t.sub);
    return html`<li class="has-act"><a href="${M.todoHref(t)}">${lead}<span>${t.title}${t.sub ? html`<small>${t.sub}</small>` : ''}</span></a><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-peek="p:${pid}" aria-label="看${st.person(pid).name}的速览">速览</button></li>`;
  };
  M.row = (href, lead, title, sub, tail) => html`<li><a href="${href}">${lead}<span>${title}${sub ? html`<small>${sub}</small>` : ''}</span>${tail ?? icon('chev')}</a></li>`;
})();
