/* Niu-Talent 原型：公共工具。所有页面脚本挂在全局 NT 上，不用构建，浏览器直接打开。 */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});

  NT.TODAY = '2026-09-04'; // 演示时钟：所有「近 3 个月」「90 天」都相对这一天
  NT.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- DOM ----------
  NT.$ = (s, r = document) => r.querySelector(s);
  NT.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  NT.esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // html`...`：插值默认转义；NT.raw() 包裹的内容、数组（已拼好的片段）原样输出
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  NT.raw = (s) => new Raw(String(s ?? ''));
  const piece = (v) => {
    if (v == null || v === false) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(piece).join('');
    return NT.esc(v);
  };
  NT.piece = piece;
  NT.html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? piece(vals[i]) : ''), ''));
  NT.mount = (el, content) => { el.innerHTML = piece(content); return el; };
  NT.icon = (name, size) => NT.raw(`<svg${size ? ` width="${size}" height="${size}"` : ''}><use href="#i-${name}"/></svg>`);

  NT.wait = (ms) => new Promise((r) => setTimeout(r, NT.reduced ? 0 : ms));
  NT.uid = (p = 'x') => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  NT.clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- 日期 ----------
  // 日期都是不带时区的「年-月-日」，全程按 UTC 计算，避免东八区零点被 toISOString 退回前一天
  const D = (s) => new Date(`${s}T00:00:00Z`);
  NT.days = (a, b = NT.TODAY) => Math.round((D(b) - D(a)) / 864e5);
  NT.md = (s) => (s ? s.slice(5) : '');
  NT.addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  NT.monthLabel = (s) => `${s.slice(0, 4)} 年 ${+s.slice(5, 7)} 月`;
  NT.nowStamp = () => `${NT.md(NT.TODAY)} ${new Date().toTimeString().slice(0, 5)}`;

  // ---------- URL ----------
  NT.param = (k) => new URLSearchParams(location.search).get(k);
  NT.link = (path, params) => {
    const q = new URLSearchParams(params || {}).toString();
    return `${path}${q ? `?${q}` : ''}`;
  };

  // ---------- 图标 ----------
  const SYMBOLS = {
    mic: '<symbol id="i-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></symbol>',
    clip: '<symbol id="i-clip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/></symbol>',
    up: '<symbol id="i-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></symbol>',
    chev: '<symbol id="i-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></symbol>',
    back: '<symbol id="i-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></symbol>',
    check: '<symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>',
    x: '<symbol id="i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>',
    dash: '<symbol id="i-dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 12h2.5M10.75 12h2.5M17.5 12H20"/></symbol>',
    split: '<symbol id="i-split" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6l-6 6v6M12 9l6 6v6"/></symbol>',
    eye: '<symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></symbol>',
    quote: '<symbol id="i-quote" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"/></symbol>',
    doc: '<symbol id="i-doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l5 5v13H6zM14 3v5h5"/></symbol>',
    spark: '<symbol id="i-spark" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.6 5 2.8 7.5 8.5 8.5-5.7 1-7.9 3.5-8.5 8.5-.6-5-2.8-7.5-8.5-8.5 5.7-1 7.9-3.5 8.5-8.5Z"/></symbol>',
    pen: '<symbol id="i-pen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 20l4-1 11-11-3-3L5 16z"/></symbol>',
    lock: '<symbol id="i-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>',
    play: '<symbol id="i-play" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></symbol>',
    pause: '<symbol id="i-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></symbol>',
    flag: '<symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 21V4h12l-2.5 4.5L17 13H5"/></symbol>',
    note: '<symbol id="i-note" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h14v11l-5 5H5zM14 20v-5h5"/></symbol>',
    at: '<symbol id="i-at" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M15.5 8.5v5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9"/></symbol>',
    plus: '<symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></symbol>',
    folder: '<symbol id="i-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></symbol>',
    wave: '<symbol id="i-wave" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 6.5v11M12 9v6M16 4.5v15M20 10v4"/></symbol>',
    retry: '<symbol id="i-retry" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5"/></symbol>',
    search: '<symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></symbol>',
    home: '<symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 11 12 4l8 7v9h-5.5v-5.5h-5V20H4z"/></symbol>',
    users: '<symbol id="i-users" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.8.7 3 2.4 3.5 5.2"/></symbol>',
    layers: '<symbol id="i-layers" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3.5 9 4.5-9 4.5L3 8z"/><path d="m3 12.5 9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/></symbol>',
    'up-r': '<symbol id="i-up-r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M9 6h9v9"/></symbol>',
    'down-r': '<symbol id="i-down-r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 9v9H9"/></symbol>',
    clock: '<symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>',
    download: '<symbol id="i-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4.5h16V15"/></symbol>',
    print: '<symbol id="i-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/></symbol>',
    upload: '<symbol id="i-upload" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4.5h16V15"/></symbol>',
    archive: '<symbol id="i-archive" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 5h17v4h-17zM5 9v10.5h14V9M10 13h4"/></symbol>',
    more: '<symbol id="i-more" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></symbol>',
    user: '<symbol id="i-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6"/></symbol>',
    target: '<symbol id="i-target" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></symbol>',
    swap: '<symbol id="i-swap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></symbol>',
    grid: '<symbol id="i-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3.5v17M3.5 12h17"/><rect x="3.5" y="3.5" width="17" height="17" rx="3"/></symbol>',
    pulse: '<symbol id="i-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 5 12 2.5-6h4"/></symbol>',
    info: '<symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/></symbol>',
    tag: '<symbol id="i-tag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0z"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></symbol>',
    calendar: '<symbol id="i-calendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></symbol>',
    phone: '<symbol id="i-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3" stroke-linecap="round"/></symbol>',
    book: '<symbol id="i-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></symbol>',
    trash: '<symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5"/></symbol>',
    check2: '<symbol id="i-check2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12.5 3 3 5-6"/></symbol>',
    star: '<symbol id="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></symbol>',
    'star-on': '<symbol id="i-star-on" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></symbol>',
    stamp: '<symbol id="i-stamp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M9 3.5h6l-1 7h3.5a2 2 0 0 1 2 2V16h-15v-3.5a2 2 0 0 1 2-2H10zM5 19.5h14"/></symbol>',
  };
  function injectSprite() {
    if (document.getElementById('nt-sprite')) return;
    const box = document.createElement('div');
    box.innerHTML = `<svg id="nt-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${Object.values(SYMBOLS).join('')}</defs></svg>`;
    document.body.prepend(box.firstChild);
  }

  // ---------- 撤销 Toast ----------
  // undo() 如实返回结果：false = 没有撤销，显示 failText；字符串 = 显示这段文字；true 或不返回 = 显示 undoneText
  let toastHost = null;
  NT.toast = (msg, opts = {}) => {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'nt-toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      (document.querySelector('.m-screen') || document.body).append(toastHost);
    }
    const t = document.createElement('div');
    t.className = 'n-toast';
    t.innerHTML = `<span>${NT.esc(msg)}</span>`;
    let timer = 0;
    const close = () => { clearTimeout(timer); t.remove(); };
    if (opts.undo) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'n-toast__undo';
      b.innerHTML = '<svg class="n-toast__ring" viewBox="0 0 20 20"><circle class="track" cx="10" cy="10" r="8"/><circle class="run" cx="10" cy="10" r="8"/></svg>撤销';
      b.onclick = () => {
        clearTimeout(timer);
        const r = opts.undo();
        const failed = r === false;
        const text = failed ? opts.failText || '撤销失败，已保留当前内容' : typeof r === 'string' ? r : opts.undoneText || '已撤销';
        if (failed) t.dataset.state = 'fail';
        t.innerHTML = `${failed ? NT.icon('info', 16) : ''}<span>${NT.esc(text)}</span>`;
        timer = setTimeout(close, failed || typeof r === 'string' ? 4000 : 1600);
      };
      t.append(b);
      requestAnimationFrame(() => t.classList.add('is-counting'));
    }
    toastHost.append(t);
    t.animate([{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: NT.reduced ? 1 : 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    timer = setTimeout(() => { close(); opts.onExpire && opts.onExpire(); }, opts.undo ? 5000 : (opts.duration || 3200));
    return close;
  };

  // ---------- 弹窗 ----------
  // NT.dialog({ title, body, facts, actions: [{ label, value, cls, icon, validate(d), hint }] }) → Promise<value | 'cancel'>
  // validate 返回假值（或一句提示）时弹窗不关闭：聚焦第一个空着的必填项，并在按钮栏上方给一句提示
  function nudge(d, msg) {
    // 弹窗自己已经显示了错误提示（带 role="alert" 的元素）时不重复提示
    if (NT.$$('[role="alert"]', d).some((x) => !x.classList.contains('n-dialog__hint') && !x.hidden && x.textContent.trim())) return;
    const fields = NT.$$('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])', d);
    const labelOf = (f) => f.closest('.n-field')?.querySelector('.n-field__label');
    const optional = (f) => f.hasAttribute('data-optional') || /可选/.test(labelOf(f)?.textContent || '');
    const empty = fields.find((f) => !f.value.trim() && !optional(f));
    let text = msg;
    if (empty) {
      empty.closest('.n-field')?.classList.add('is-error');
      empty.focus();
      if (!text) {
        const lab = labelOf(empty)?.cloneNode(true);
        lab?.querySelectorAll('small').forEach((s) => s.remove());
        const name = (lab?.textContent || empty.getAttribute('aria-label') || '').replace(/[（(]必填[）)]/g, '').trim();
        text = name ? `请先填写「${name}」` : '请先填写这一项';
      }
    }
    d.querySelector('.n-dialog__hint')?.remove();
    const hint = document.createElement('p');
    hint.className = 'n-dialog__hint'; hint.setAttribute('role', 'alert');
    hint.textContent = text || '还有必填项没填';
    d.querySelector('.n-dialog__bar')?.before(hint);
  }
  NT.dialog = (o) => new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'n-dialog';
    d.setAttribute('aria-labelledby', 'dlg-t');
    d.innerHTML = `<h3 id="dlg-t">${NT.esc(o.title)}</h3>${o.body ? `<div class="nt-dlg-body">${piece(o.body)}</div>` : ''}
      ${o.facts?.length ? `<ul class="n-dialog__facts">${o.facts.map((f) => `<li>${piece(f)}</li>`).join('')}</ul>` : ''}
      <div class="n-dialog__bar">${(o.actions || [{ label: '知道了', value: 'ok', cls: 'n-btn--ink' }]).map((a, i) =>
        `<button class="n-btn ${a.cls || ''}" type="button" data-i="${i}">${a.icon ? `<svg><use href="#i-${a.icon}"/></svg>` : ''}${NT.esc(a.label)}</button>`).join('')}</div>`;
    document.body.append(d);
    let value = 'cancel';
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) {
        const a = o.actions[+b.dataset.i];
        if (a.validate) {
          const ok = a.validate(d);
          if (!ok || typeof ok === 'string') { nudge(d, typeof ok === 'string' ? ok : a.hint); return; }
        }
        value = a.value; if (a.read) value = { value: a.value, data: a.read(d) };
        d.close();
      } else if (e.target === d) d.close();
    });
    // 校验没通过：聚焦第一个空着的必填项，并在按钮栏上方给一句可见的提示
    d.addEventListener('input', () => { d.querySelector('.n-dialog__hint')?.remove(); NT.$$('.is-error', d).forEach((x) => x.classList.remove('is-error')); });
    d.addEventListener('close', () => { d.remove(); resolve(value); });
    d.showModal();
    // 浏览器默认聚焦第一个可聚焦元素，常常是正文里的引用角标，会直接弹出引用浮层；有输入项时先聚焦输入项，否则不停在引用上
    const field = d.querySelector('textarea, select, input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])');
    if (field) field.focus(); else if (document.activeElement?.closest('.n-cite')) d.querySelector('.n-dialog__bar .n-btn:last-child')?.focus();
    o.onOpen && o.onOpen(d);
  });

  // ---------- 流式输出（脚本化 mock：结果预置，按真实节奏出现） ----------
  // 表单控件（textarea、input）写 value，其他元素写 textContent；opts.onTick(当前文本) 每次更新后调用，opts.stop() 返回 true 时中断
  NT.stream = async (el, text, speed = 26, opts = {}) => {
    const field = el.matches('textarea, input');
    const put = (v) => { if (field) el.value = v; else el.textContent = v; if (opts.onTick) opts.onTick(v); };
    put('');
    if (NT.reduced) { put(text); return; }
    let out = '';
    for (const ch of text) {
      if (opts.stop && opts.stop()) return;
      out += ch;
      put(out);
      await new Promise((r) => setTimeout(r, '，。；：'.includes(ch) ? speed * 5 : speed));
    }
  };
  NT.runTrail = async (trailEl, gap = 650) => {
    const steps = NT.$$('.n-trail__step', trailEl);
    steps.forEach((s) => { s.dataset.state = 'pending'; });
    for (const s of steps) { s.dataset.state = 'active'; await NT.wait(gap); s.dataset.state = 'done'; }
  };

  // FLIP：重排前记位置，重排后做过渡
  NT.flip = (items, mutate, duration = 420) => {
    const first = new Map(items.map((el) => [el, el.getBoundingClientRect().top]));
    mutate();
    items.forEach((el) => {
      const dy = first.get(el) - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: NT.reduced ? 1 : duration, easing: 'cubic-bezier(.65,0,.35,1)' });
    });
  };

  // 证据飞入：卡片沿弧线飞向头像，计数 +1
  NT.flyTo = (fromEl, toEl, onDone) => {
    if (!fromEl || !toEl) { onDone && onDone(); return; }
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const ghost = fromEl.cloneNode(true);
    Object.assign(ghost.style, { position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, margin: 0, zIndex: 9999, pointerEvents: 'none' });
    document.body.append(ghost);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy - 60}px) scale(.55)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.1)`, opacity: 0 },
    ], { duration: NT.reduced ? 1 : 680, easing: 'cubic-bezier(.7,0,.15,1)' });
    anim.onfinish = () => { ghost.remove(); onDone && onDone(); };
  };

  // 引用浮层按视口定位：在速览、可滚动的卡片、手机框和屏幕边缘都不被裁掉；上方放不下就放到角标下方
  const placeCite = (c) => {
    const pop = c?.querySelector('.n-cite__pop'), mark = c?.querySelector('.n-cite__mark');
    if (!pop || !mark) return;
    // 窄屏用贴底浮层（CSS）：清掉宽屏时写上的定位
    if (matchMedia('(max-width: 760px)').matches) { pop.classList.remove('is-placed'); pop.style.removeProperty('width'); pop.style.removeProperty('left'); pop.style.removeProperty('top'); return; }
    const box = c.closest('.m-screen')?.getBoundingClientRect() || { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const pad = 8, gap = 10, m = mark.getBoundingClientRect();
    pop.classList.add('is-placed');
    pop.style.width = `${Math.min(320, box.right - box.left - pad * 2)}px`;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(Math.max(m.left + m.width / 2 - w / 2, box.left + pad), box.right - w - pad);
    const above = m.top - gap - h >= box.top + pad || m.bottom + gap + h > box.bottom - pad;
    pop.style.left = `${left}px`;
    pop.style.top = `${above ? m.top - gap - h : m.bottom + gap}px`;
  };
  NT.placeCite = placeCite;

  // ---------- 通用交互 ----------
  function wireGlobal() {
    document.addEventListener('mouseover', (e) => { const c = e.target.closest?.('.n-cite'); if (c && !c.contains(e.relatedTarget)) placeCite(c); });
    document.addEventListener('focusin', (e) => { const c = e.target.closest?.('.n-cite'); if (c) placeCite(c); });
    // 滚动时跟着角标走（只重算正在显示的）
    document.addEventListener('scroll', () => NT.$$('.n-cite.is-open, .n-cite:hover, .n-cite:focus-within').forEach(placeCite), { capture: true, passive: true });
    // 视口变化（含跨过窄屏断点）时，已经放置过的浮层全部按新视口重算或复位
    addEventListener('resize', () => new Set([...NT.$$('.n-cite__pop.is-placed'), ...NT.$$('.n-cite.is-open .n-cite__pop, .n-cite:hover .n-cite__pop, .n-cite:focus-within .n-cite__pop')]).forEach((p) => placeCite(p.closest('.n-cite'))));
    // 引用角标：触屏点按展开
    document.addEventListener('click', (e) => {
      const mark = e.target.closest('.n-cite__mark');
      NT.$$('.n-cite.is-open').forEach((o) => { if (!mark || o !== mark.closest('.n-cite')) o.classList.remove('is-open'); });
      if (mark) { e.stopPropagation(); const c = mark.closest('.n-cite'); c.classList.toggle('is-open'); placeCite(c); }
      const head = e.target.closest('.n-trail__head');
      if (head) {
        const t = head.closest('.n-trail'); const open = t.dataset.open !== 'true';
        t.dataset.open = open; head.setAttribute('aria-expanded', open);
      }
      // 只做外观单选的分段控件；带 data-manual 的由页面自己处理
      const segBtn = e.target.closest('.n-seg:not([data-manual]) > button, .n-modes > button');
      if (segBtn) NT.$$('button', segBtn.parentElement).forEach((x) => x.setAttribute('aria-pressed', x === segBtn));
      // 菜单：点外面关闭
      if (!e.target.closest('.n-menuwrap')) NT.$$('.n-menu:not([hidden])').forEach((m) => { m.hidden = true; m.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') NT.$$('.n-menu:not([hidden])').forEach((m) => { m.hidden = true; });
    });
  }

  // 标签页：点击与左右方向键；onChange(id)
  NT.tabs = (list, onChange) => {
    const tabs = NT.$$('[role="tab"]', list);
    const pick = (t) => {
      tabs.forEach((x) => {
        const on = x === t;
        x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(x.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      onChange && onChange(t.dataset.tab || t.id);
    };
    list.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) pick(t); });
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = tabs.indexOf(document.activeElement);
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      pick(n); n.focus();
    });
    return { pick: (id) => pick(tabs.find((t) => (t.dataset.tab || t.id) === id) || tabs[0]) };
  };

  // 更多菜单：items = [{ label, icon, danger, run }]
  NT.menu = (btn, items) => {
    const wrap = btn.closest('.n-menuwrap');
    let menu = wrap.querySelector('.n-menu');
    if (!menu) { menu = document.createElement('div'); menu.className = 'n-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true; wrap.append(menu); }
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button role="${it.checked == null ? 'menuitem' : 'menuitemradio'}" ${it.checked == null ? '' : `aria-checked="${it.checked}"`} type="button" data-i="${i}" class="${it.danger ? 'is-danger' : ''}">${it.icon ? `<svg width="15" height="15"><use href="#i-${it.icon}"/></svg>` : ''}<span>${NT.esc(it.label)}${it.sub ? `<small>${NT.esc(it.sub)}</small>` : ''}</span>${it.checked ? '<svg class="n-menu__check" width="14" height="14"><use href="#i-check"/></svg>' : ''}</button>`).join('');
      const open = menu.hidden;
      NT.$$('.n-menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('button')?.focus();
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      items[+b.dataset.i].run();
    });
  };

  // ---------- 评审评论层：记录与还原现场（演示视角 + 页面自报的界面状态） ----------
  let reviewPage = null;
  NT.reviewPage = (cfg) => { reviewPage = cfg; };
  window.NTReview = {
    context() {
      const st = NT.store, role = st.role();
      return { role, roleLabel: `${st.roles[role].label}视角`, view: reviewPage?.view ? reviewPage.view() : '', state: reviewPage?.state ? reviewPage.state() : null };
    },
    restore(ctx) {
      if (!ctx) return;
      try { sessionStorage.setItem('nty-restore', JSON.stringify(ctx)); } catch (e) { /* 忽略 */ }
      // 视角和一次性参数（q、hold、mic…）都要回到 URL 里，页面才会回到评论时的样子
      const u = new URL(location.href);
      (ctx.drop || []).forEach((k) => u.searchParams.delete(k));
      if (ctx.params) new URLSearchParams(ctx.params).forEach((v, k) => u.searchParams.set(k, v));
      if (ctx.role && ctx.role !== NT.store.role()) { NT.store.setRole(ctx.role); u.searchParams.set('as', ctx.role); }
      if (u.search !== location.search) { location.href = u.toString(); return; }
      NT.applyRestore();
    },
  };
  NT.applyRestore = () => {
    let ctx = null;
    try { ctx = JSON.parse(sessionStorage.getItem('nty-restore') || 'null'); sessionStorage.removeItem('nty-restore'); } catch (e) { ctx = null; }
    if (ctx && ctx.state && reviewPage?.restore) reviewPage.restore(ctx.state);
  };

  NT.ip = (el, state = 'rest', size = 36) => (window.NiuIP && el ? NiuIP.mount(el, { state, size }) : el);
  NT.ipState = (el, state) => { if (window.NiuIP && el) NiuIP.setState(el, state); };

  NT.ready = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  NT.ready(() => { injectSprite(); wireGlobal(); });
})();
