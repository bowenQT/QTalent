/* Niu-Talent 手机原型：外壳。桌面浏览器里放进手机框，左侧是流程入口和演示视角；真机上铺满屏幕。
   底部导航：工作台、人才、记录（居中，轻点选方式，按住直接说话）、待办、我的。弹窗在手机上改为屏内底部弹层。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const M = (NT.m = {});
  const PAGES = ['index', 'record', 'quick', 'mentor', 'people', 'person', 'inbox', 'plan', 'me'];
  const ROLE_ORDER = ['ceo', 'hrbp', 'lead', 'mentor', 'self'];
  const FLOWS = [
    ['record', '录音', 'record.html?as=mentor', '导师 · 选模式 → 实时转写 → 处理中 → 人才纪要 → 追问'],
    ['quick', '快速记录', 'quick.html?as=lead', '部门负责人 · 一句话或按住说话 → 确认 AI 建议分'],
    ['mentor', '导师评价', 'mentor.html?as=mentor', '导师 · 选学员 → 说一段话 → 逐项确认 → 确认复盘'],
    ['person', '看人', 'person.html?id=p-lin&as=hrbp', '同一份档案，切换视角看分数与象限的显隐'],
    ['inbox', '待核对', 'inbox.html?as=mentor', '导师 · 逐条确认「小王」「宋老师」指谁'],
    ['plan', '确认方案', 'plan.html?id=sp-search-3&as=ceo', 'CEO · 看方案摘要与差异 → 确认并冻结'],
  ];

  // 页面入口：NT.mshell({ tab, title, back, action, allow, denyTitle, denyText, demos, view, state, restore, render(main), bare })
  NT.mshell = (cfg) => NT.ready(() => {
    NT.reviewPage(cfg);
    st.tickTasks();
    document.title = `${cfg.title} · Niu-Talent 手机版`;
    const role = st.role(), me = st.me();
    const page = document.body.dataset.page;
    const todos = st.todos().length;
    const tabs = [
      { id: 'work', label: '工作台', icon: 'home', href: 'index.html' },
      role === 'self' ? { id: 'people', label: '档案', icon: 'user', href: `person.html?id=${me.id}` } : { id: 'people', label: role === 'mentor' ? '学员' : '人才', icon: 'users', href: 'people.html' },
      { id: 'rec', rec: true },
      { id: 'todo', label: '待办', icon: 'check2', href: 'inbox.html', dot: todos > 0 },
      { id: 'me', label: '我的', icon: 'user', href: 'me.html' },
    ];
    document.body.classList.add('nt-mob');
    const root = document.getElementById('app');
    mount(root, html`
      <div class="m-stage">
        <aside class="m-side" aria-label="手机原型说明">
          <h1><span class="nt-ip" data-ip="rest" data-size="24"></span>Niu-Talent 手机版</h1>
          <p>手机端只做高频的事。下面六条流程各配了一个推荐视角，点开直接进入；也可以在手机里随便点。</p>
          <div><h2>六条流程</h2><ol class="m-flows">${FLOWS.map(([id, t, href, sub]) => html`<li><a href="${href}" ${NT.raw(page === id || (id === 'person' && page === 'people') ? 'aria-current="page"' : '')}>${t}<small>${sub}</small></a></li>`)}</ol></div>
          <div><h2>演示视角</h2><div class="n-seg" role="group" aria-label="演示视角" data-manual id="m-roles">${ROLE_ORDER.map((r) => html`<button type="button" data-r="${r}" aria-pressed="${r === role}" title="${st.roles[r].scope}">${st.roles[r].label}</button>`)}</div>
            <p style="margin-top:var(--s-2)">当前：${me.name} · ${st.roles[role].scope}</p></div>
          ${cfg.demos?.length ? html`<div><h2>演示其他情况</h2><div class="m-side__links">${cfg.demos.map(([t, h]) => html`<a class="n-btn n-btn--sm" href="${h}">${t}</a>`)}</div></div>` : ''}
          <div class="m-side__links">
            <a class="n-btn n-btn--sm n-btn--ghost" href="../app/index.html">${icon('home')}桌面版</a>
            <a class="n-btn n-btn--sm n-btn--ghost" href="../index.html">${icon('book')}评审导览</a>
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
              <div class="m-who">${UI.avatar(me.id, 'sm')}<span>以 <b>${me.name}</b>（${st.roles[role].label}）的身份查看</span><span class="n-badge n-badge--demo" style="margin-left:auto">演示视角</span></div>
              <main id="main"></main>
            </div>
            <div id="m-recbar-slot"></div>
            ${cfg.noTabbar ? '' : html`<nav class="n-tabbar" aria-label="手机导航">${tabs.map((t) => (t.rec
              ? html`<a class="n-tabbar__rec" href="quick.html" id="m-rec" aria-label="记录：轻点选方式，按住直接说话">${icon('mic')}</a>`
              : html`<a href="${t.href}" ${NT.raw(cfg.tab === t.id ? 'aria-current="page"' : '')}>${t.dot ? html`<span class="dot">${icon(t.icon)}</span>` : icon(t.icon)}${t.label}</a>`))}</nav>`}
          </div>
        </div>
      </div>`);

    NT.$('#m-roles').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]'); if (!b || b.dataset.r === role) return;
      st.setRole(b.dataset.r);
      const u = new URL(location.href); u.searchParams.set('as', b.dataset.r); u.hash = '';
      location.href = u.toString();
    });
    NT.$('#m-reset').addEventListener('click', () => NT.resetDemo());
    if (cfg.back === true) NT.$('#m-back')?.addEventListener('click', (e) => { if (history.length > 1 && document.referrer.includes('/m/')) { e.preventDefault(); history.back(); } });
    wireRecButton();
    wireLinks();
    recBar();
    UI.mountIPs(root);

    const main = NT.$('#main');
    if (cfg.allow && !cfg.allow(role)) {
      mount(main, UI.state({ ip: 'confirm', size: 56, title: cfg.denyTitle || '这一页属于其他视角', text: cfg.denyText || '在「我的」里切换演示视角，或回到工作台。', actions: html`<a class="n-btn n-btn--sm" href="index.html">回到工作台</a>` }));
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
      const role = st.role();
      if (role === 'self') { location.href = 'quick.html'; return; }
      M.sheet({
        title: '记录', sub: '按住中间的按钮可以直接说话',
        body: html`<ul class="m-list">
          <li><a href="record.html">${icon('wave')}<span>录音<small>观察速记、多人会议，或上传已有录音</small></span>${icon('chev')}</a></li>
          <li><a href="quick.html">${icon('pen')}<span>一句话记录<small>写或说一件具体的事，AI 整理成关键事件</small></span>${icon('chev')}</a></li>
          ${role === 'mentor' || role === 'hrbp' ? html`<li><a href="mentor.html">${icon('users')}<span>导师评价<small>复盘后对所带学员逐个评价</small></span>${icon('chev')}</a></li>` : ''}
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
    get() { try { return JSON.parse(sessionStorage.getItem('nt-rec') || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? sessionStorage.setItem('nt-rec', JSON.stringify(v)) : sessionStorage.removeItem('nt-rec'); } catch (e) { /* 忽略 */ } },
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
  // 待办在手机上的落点：复盘去导师评价，方案去确认方案，其余沿用；判断复盘、找人这类没有手机页的转到桌面版
  const M_PAGES = ['index', 'people', 'person', 'quick', 'record', 'plan', 'inbox', 'mentor', 'me'];
  const mHref = (h) => (M_PAGES.includes(h.split(/[?#]/)[0].replace('.html', '')) ? h : `../app/${h}`);
  M.todoHref = (t) => (t.kind === 'review' ? `mentor.html?id=${t.person}` : t.kind === 'plan' ? `plan.html?id=${t.plan}` : mHref(t.href));

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
        why.placeholder = `为什么改成 ${sc.v} 分？留空会进 HRBP 校准队列`;
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

  // 按住说话：按下开始把脚本里的话逐字「转写」进输入框，松开结束；没按够就提示
  M.hold = (btn, field, script, o = {}) => {
    let timer = 0, i = 0, down = 0;
    const start = (e) => {
      e.preventDefault(); down = Date.now(); i = field.value.length && field.value === script.slice(0, field.value.length) ? field.value.length : 0;
      if (!i) field.value = '';
      btn.classList.add('is-on'); o.onStart && o.onStart();
      timer = setInterval(() => { if (i < script.length) { field.value = script.slice(0, ++i); field.scrollTop = field.scrollHeight; } }, NT.reduced ? 1 : 55);
    };
    const end = () => {
      if (!down) return;
      clearInterval(timer); btn.classList.remove('is-on');
      const held = Date.now() - down; down = 0;
      if (held < 350 && i < 3) { field.value = ''; NT.toast('按住说话，松开结束'); o.onCancel && o.onCancel(); return; }
      field.value = script; o.onEnd && o.onEnd(script);
    };
    btn.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, end));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !down) start(e); });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') end(); });
  };

  // 人的行：点一下拉起速览（底部弹层），速览里再打开档案（v1.5 3.27）
  M.prow = (pid, title, sub, tail) => html`<li><a href="person.html?id=${pid}" data-peek="p:${pid}">${UI.avatar(pid, 'sm')}<span>${title}${sub ? html`<small>${sub}</small>` : ''}</span>${tail ?? icon('chev')}</a></li>`;
  // 一行待办：「CEO 请你」和「待核实线索」旁边可以先看这个人的速览，行本身仍去办理（v1.5 3.27.1）
  M.todoRow = (t) => {
    const lead = html`<span class="n-badge ${t.cls || ''}" style="flex:none">${t.icon ? icon(t.icon) : ''}${t.badge}</span>`;
    const pid = t.kind === 'push' ? st.pushOf(t.push)?.person : t.kind === 'clue' ? st.get().watchClues.find((c) => c.id === t.clue)?.person : null;
    if (!pid) return M.row(M.todoHref(t), lead, t.title, t.sub);
    return html`<li class="has-act"><a href="${M.todoHref(t)}">${lead}<span>${t.title}${t.sub ? html`<small>${t.sub}</small>` : ''}</span></a><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-peek="p:${pid}" aria-label="看${st.person(pid).name}的速览">速览</button></li>`;
  };
  M.row = (href, lead, title, sub, tail) => html`<li><a href="${href}">${lead}<span>${title}${sub ? html`<small>${sub}</small>` : ''}</span>${tail ?? icon('chev')}</a></li>`;
})();
