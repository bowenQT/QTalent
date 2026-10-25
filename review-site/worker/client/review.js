// 评审评论层：选中文字或点选元素后写评论；讨论按页面存储，支持回复与已解决。
// 文字评论按「原文 + 前后文」重新定位，元素评论按元素路径 + 元素文字定位；
// 原型改版后找不到位置的讨论归入「原文已改」，不会丢。
// 页面可以提供 window.NTReview = { context(), restore(ctx) }，用来记录和还原评论时的现场（视角、界面状态）。
(function () {
  'use strict';
  if (window.__rvLoaded) return;
  window.__rvLoaded = true;

  const SKIP = '#rv-ui, #rv-pins, script, style, noscript, textarea, input, select, [contenteditable], [data-rv-skip]';
  const CTX = 40;
  const EPHEMERAL = new Set(['as', 'q', 'hold', 'mic', 'created', 'fresh', 'add']);
  const isKeyParam = ([k, v]) => !k.startsWith('rv') && !EPHEMERAL.has(k) && /^\w{1,20}$/.test(k) && /^[\w.-]{1,40}$/.test(v);
  const PAGE = pageKey();

  let me = '';
  let threads = [];        // 顶层讨论
  let replies = new Map(); // 讨论 id → 回复列表
  let filter = 'open';
  let pending = null;      // 正在写的新讨论的锚点
  let commentDraft = '';   // 只在当前页面内存中保留未发送评论
  const replyDrafts = new Map(); // 讨论 id → 尚未发送的回复
  let focusId = null;
  let located = new Map(); // 讨论 id → { type, el?, top }
  let loadState = 'loading';
  let loadError = '';
  let picking = false;
  let applying = false;
  let postingComment = false;
  const postingReplies = new Set();

  // ---------- 小工具 ----------
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }
  const who = (email) => String(email || '').split('@')[0];
  const fmt = (iso) => {
    const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  // 页面键只留路由和对象 id 一类的参数（id=p-lin、tab=ev）：视角 as 记在 context 里，
  // 一次性的输入（q 里的原话、hold、mic 这类演示开关）也不算页面的一部分，放进 context.params
  function pageKey() {
    const keep = [...new URLSearchParams(location.search).entries()].filter(isKeyParam).sort(([a], [b]) => a.localeCompare(b));
    const path = location.pathname.replace(/\/index\.html$/, '/');
    const key = path + (keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join('&')}` : '');
    return key.length <= 200 ? key : path;
  }
  const transient = () => [...new URLSearchParams(location.search).entries()].filter((e) => !isKeyParam(e) && e[0] !== 'as' && !e[0].startsWith('rv'));
  function droppedParams() {
    const rest = transient();
    return rest.length ? new URLSearchParams(rest).toString().slice(0, 300) : undefined;
  }
  async function api(method, url, body) {
    const r = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!r.ok) throw new Error(data.error || `请求失败（${r.status}）`);
    return data;
  }
  function context() {
    let extra = {};
    try { extra = (window.NTReview && window.NTReview.context && window.NTReview.context()) || {}; } catch (e) { extra = {}; }
    return { ...extra, params: droppedParams(), vw: window.innerWidth };
  }
  function contextLabel(raw) {
    if (!raw) return '';
    let c; try { c = JSON.parse(raw); } catch (e) { return ''; }
    const bits = [];
    if (c.roleLabel) bits.push(c.roleLabel);
    if (c.view) bits.push(c.view);
    if (c.vw) bits.push(c.vw < 760 ? '手机宽度' : '桌面宽度');
    return bits.join(' · ');
  }

  // ---------- 界面骨架 ----------
  const LAUNCH_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5h12a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.5 2.5V14H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"/><path d="M6.5 8h7M6.5 10.8h4.5" stroke-linecap="round"/></svg>';
  const ui = h('div', { id: 'rv-ui' });
  const pins = h('div', { id: 'rv-pins', 'aria-hidden': 'true' });
  const hover = h('div', { class: 'rv-hover', hidden: true });
  const bubble = h('button', { class: 'rv-bubble', type: 'button', hidden: true, onclick: startFromSelection }, '评论');
  const launcher = h('button', { class: 'rv-launch', type: 'button', 'aria-expanded': 'false', onclick: () => toggle() });
  const panel = h('aside', { class: 'rv-panel', 'aria-label': '评审评论', hidden: true });
  const toastBox = h('div', { class: 'rv-toasts', role: 'status', 'aria-live': 'polite' });
  ui.append(launcher, panel, bubble, hover, toastBox);

  function toast(msg) {
    const t = h('div', { class: 'rv-toast' }, msg);
    toastBox.append(t);
    setTimeout(() => t.remove(), 3200);
  }

  function renderLauncher() {
    const open = threads.filter((t) => !t.resolved).length;
    launcher.innerHTML = LAUNCH_ICON;
    launcher.append(h('span', { class: 'rv-launch__label' }, '评审评论'));
    if (open) launcher.append(h('b', null, String(open)));
    launcher.setAttribute('aria-label', open ? `评审评论，${open} 条未解决` : '评审评论');
  }

  function toggle(force) {
    const show = force ?? panel.hidden;
    panel.hidden = !show;
    launcher.setAttribute('aria-expanded', String(show));
    document.documentElement.classList.toggle('rv-open', show);
    if (show) renderPanel();
    else { stopPick(); }
  }

  // ---------- 面板 ----------
  function renderPanel() {
    if (panel.hidden) return;
    const head = h('header', { class: 'rv-head' },
      h('div', { class: 'rv-head__row' },
        h('h2', null, '评审评论'),
        h('button', { class: 'rv-icon', type: 'button', 'aria-label': '关闭评论', onclick: () => toggle(false) }, '×'),
      ),
      h('p', { class: 'rv-hint' }, '选中文字即可评论；看不到文字的地方，用「点选元素」。'),
      h('div', { class: 'rv-head__row' },
        h('div', { class: 'rv-seg', role: 'group', 'aria-label': '筛选' },
          ...[['open', '未解决'], ['done', '已解决'], ['all', '全部']].map(([k, label]) =>
            h('button', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; apply(); renderPanel(); } }, label)),
        ),
        h('button', { class: `rv-btn${picking ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(picking), onclick: () => (picking ? stopPick() : startPick()) },
          picking ? '退出点选' : '点选元素'),
      ),
    );
    const body = h('div', { class: 'rv-body' });

    if (pending) body.append(composer());

    if (loadState === 'loading') body.append(h('p', { class: 'rv-empty' }, '正在加载这一页的评论…'));
    else if (loadState === 'error') {
      body.append(h('div', { class: 'rv-empty' }, `评论没有加载出来：${loadError}`,
        h('button', { class: 'rv-btn', type: 'button', onclick: load }, '重试')));
    } else {
      const list = threads.filter((t) => filter === 'all' || (filter === 'open' ? !t.resolved : t.resolved));
      const found = list.filter((t) => located.has(t.id)).sort((a, b) => located.get(a.id).top - located.get(b.id).top);
      const lost = list.filter((t) => !located.has(t.id));
      if (!list.length && !pending) {
        body.append(h('p', { class: 'rv-empty' }, filter === 'done' ? '还没有已解决的讨论。' : '这一页还没有评论。'));
      }
      found.forEach((t) => body.append(threadCard(t)));
      if (lost.length) {
        body.append(h('h3', { class: 'rv-group' }, '原文已改或当前界面里看不到'));
        lost.forEach((t) => body.append(threadCard(t, true)));
      }
    }
    panel.replaceChildren(head, body);
    if (focusId) {
      const el = panel.querySelector(`[data-thread="${focusId}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function anchorPreview(t) {
    if (t.kind === 'element') return h('div', { class: 'rv-anchor is-el' }, h('span', null, '元素'), t.label || '（无文字的元素）');
    return h('blockquote', { class: 'rv-anchor' }, t.quote);
  }

  function threadCard(t, lost) {
    const rs = replies.get(t.id) || [];
    const ctx = contextLabel(t.context);
    const card = h('article', {
      class: `rv-thread${t.resolved ? ' is-done' : ''}${focusId === t.id ? ' is-focus' : ''}`,
      'data-thread': t.id,
      onclick: (e) => { if (e.target.closest('button, textarea, a')) return; focus(t.id, true); },
    },
      anchorPreview(t),
      ctx ? h('div', { class: 'rv-ctx' },
        h('span', null, `评论时：${ctx}`),
        lost && window.NTReview && window.NTReview.restore ? h('button', { class: 'rv-link', type: 'button', onclick: () => restore(t) }, '还原现场') : null,
      ) : null,
      comment(t),
      ...rs.map((r) => comment(r, true)),
      replyBox(t),
    );
    return card;
  }

  function comment(c, isReply) {
    const mine = c.author === me;
    return h('div', { class: `rv-c${isReply ? ' is-reply' : ''}` },
      h('div', { class: 'rv-c__meta' },
        h('b', null, who(c.author)),
        h('time', { datetime: c.created_at }, fmt(c.created_at)),
        !isReply && c.resolved ? h('span', { class: 'rv-done' }, `${who(c.resolved_by)} 已解决`) : null,
      ),
      h('p', { class: 'rv-c__body' }, c.body),
      mine && !(isReply === undefined && (replies.get(c.id) || []).length)
        ? h('button', { class: 'rv-link is-quiet', type: 'button', onclick: () => remove(c) }, '删除') : null,
    );
  }

  function replyBox(t) {
    const wrap = h('div', { class: 'rv-reply' });
    const ta = h('textarea', { rows: '1', placeholder: '回复…', 'aria-label': '回复这条讨论' });
    ta.value = replyDrafts.get(t.id) || '';
    ta.addEventListener('input', () => { if (ta.value) replyDrafts.set(t.id, ta.value); else replyDrafts.delete(t.id); });
    const send = h('button', { class: 'rv-btn is-primary', type: 'button', disabled: postingReplies.has(t.id), onclick: () => submitReply(t, ta, send) }, '回复');
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitReply(t, ta, send); });
    const toggleDone = h('button', { class: 'rv-btn', type: 'button', onclick: () => setResolved(t, !t.resolved) }, t.resolved ? '重新打开' : '标为已解决');
    wrap.append(ta, h('div', { class: 'rv-reply__acts' }, toggleDone, send));
    return wrap;
  }

  function composer() {
    const box = h('div', { class: 'rv-compose' });
    const ta = h('textarea', { rows: '3', placeholder: '写下你的意见。⌘/Ctrl + Enter 发表', 'aria-label': '评论内容' });
    ta.value = commentDraft;
    ta.addEventListener('input', () => { commentDraft = ta.value; });
    const err = h('p', { class: 'rv-err', hidden: true });
    const send = h('button', { class: 'rv-btn is-primary', type: 'button', disabled: postingComment }, postingComment ? '发表中…' : '发表评论');
    const cancel = h('button', { class: 'rv-btn', type: 'button', onclick: () => { pending = null; commentDraft = ''; clearPendingMark(); renderPanel(); } }, '取消');
    const submit = async () => {
      if (postingComment) return;
      const text = ta.value.trim();
      if (!text) { err.hidden = false; err.textContent = '先写点内容再发表。'; ta.focus(); return; }
      postingComment = true;
      send.disabled = true; send.textContent = '发表中…'; err.hidden = true;
      try {
        const { comment: c } = await api('POST', '/api/comments', { ...pending, body: text, page: PAGE, context: context() });
        threads.push(c);
        pending = null; commentDraft = ''; clearPendingMark();
        focusId = c.id;
        refresh();
        toast('评论已发表');
      } catch (e) {
        err.hidden = false; err.textContent = `没有发表成功：${e.message}。内容还在，可以再试一次。`;
        send.disabled = false; send.textContent = '发表评论';
      } finally {
        postingComment = false;
        const current = panel.querySelector('.rv-compose .is-primary');
        if (current) { current.disabled = false; current.textContent = '发表评论'; }
      }
    };
    send.addEventListener('click', submit);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });
    box.append(anchorPreview({ kind: pending.kind, quote: pending.quote, label: pending.label }), ta, err, h('div', { class: 'rv-reply__acts' }, cancel, send));
    setTimeout(() => ta.focus(), 0);
    return box;
  }

  async function submitReply(t, ta, btn) {
    if (postingReplies.has(t.id)) return;
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    postingReplies.add(t.id);
    btn.disabled = true;
    try {
      const { comment: c } = await api('POST', '/api/comments', { parent_id: t.id, body: text });
      const list = replies.get(t.id) || [];
      list.push(c); replies.set(t.id, list);
      replyDrafts.delete(t.id);
      focusId = t.id;
      renderPanel();
    } catch (e) {
      toast(`回复没有发出去：${e.message}`);
      btn.disabled = false;
    } finally {
      postingReplies.delete(t.id);
      const current = panel.querySelector(`[data-thread="${t.id}"] .rv-reply .is-primary`);
      if (current) current.disabled = false;
    }
  }

  async function setResolved(t, value) {
    try {
      const { comment: c } = await api('PATCH', `/api/comments/${t.id}`, { resolved: value });
      Object.assign(t, c);
      refresh();
      toast(value ? '已标为解决' : '已重新打开');
    } catch (e) { toast(`没有改成：${e.message}`); }
  }

  async function remove(c) {
    if (!confirm('删除这条评论？删除后不能恢复。')) return;
    try {
      await api('DELETE', `/api/comments/${c.id}`);
      if (c.parent_id) replies.set(c.parent_id, (replies.get(c.parent_id) || []).filter((r) => r.id !== c.id));
      else threads = threads.filter((t) => t.id !== c.id);
      refresh();
      toast('评论已删除');
    } catch (e) { toast(`没有删除：${e.message}`); }
  }

  function restore(t) {
    // drop：当前 URL 里的一次性参数，先清掉再换成评论时的那一组
    try { window.NTReview.restore({ ...JSON.parse(t.context), drop: transient().map(([k]) => k) }); } catch (e) { toast('这条评论的现场无法自动还原'); return; }
    focusId = t.id;
    setTimeout(refresh, 400);
  }

  // ---------- 文字索引与定位 ----------
  function buildIndex() {
    const nodes = []; let text = '';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[hidden], [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = w.nextNode())) { nodes.push({ node: n, start: text.length }); text += n.data; }
    return { nodes, text };
  }

  function rangeToOffsets(range, idx) {
    let s = -1, e = -1;
    for (const it of idx.nodes) {
      if (!range.intersectsNode(it.node)) continue;
      if (s < 0) s = it.start + (it.node === range.startContainer ? range.startOffset : 0);
      e = it.start + (it.node === range.endContainer ? range.endOffset : it.node.data.length);
    }
    if (s < 0 || e <= s) return null;
    while (s < e && /\s/.test(idx.text[s])) s++;
    while (e > s && /\s/.test(idx.text[e - 1])) e--;
    return e > s ? { s, e } : null;
  }

  function locateText(c, idx) {
    const q = c.quote; if (!q) return null;
    const np = norm(c.prefix), ns = norm(c.suffix);
    let best = null, bestScore = -1, pos = idx.text.indexOf(q), guard = 0;
    while (pos >= 0 && guard++ < 300) {
      const before = norm(idx.text.slice(Math.max(0, pos - CTX * 2), pos));
      const after = norm(idx.text.slice(pos + q.length, pos + q.length + CTX * 2));
      let a = 0; while (a < np.length && a < before.length && np[np.length - 1 - a] === before[before.length - 1 - a]) a++;
      let b = 0; while (b < ns.length && b < after.length && ns[b] === after[b]) b++;
      if (a + b > bestScore) { bestScore = a + b; best = pos; }
      pos = idx.text.indexOf(q, pos + 1);
    }
    return best == null ? null : { s: best, e: best + q.length };
  }

  function wrapText(off, idx, id, cls) {
    let first = null;
    for (const it of idx.nodes) {
      const len = it.node.data.length, a = it.start, b = a + len;
      if (b <= off.s || a >= off.e) continue;
      const ls = Math.max(off.s, a) - a, le = Math.min(off.e, b) - a;
      if (!it.node.data.slice(ls, le).trim()) continue;
      let node = it.node;
      if (le < len) node.splitText(le);
      if (ls > 0) node = node.splitText(ls);
      const mark = document.createElement('mark');
      mark.className = cls; mark.dataset.rv = id;
      node.parentNode.insertBefore(mark, node);
      mark.append(node);
      first = first || mark;
    }
    return first;
  }

  // ---------- 元素定位 ----------
  function elementLabel(el) {
    const t = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 80);
  }
  function selectorFor(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 12) {
      if (cur.id && !cur.id.startsWith('rv-')) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
      const key = cur.getAttribute('data-rv-key');
      if (key) { parts.unshift(`[data-rv-key="${CSS.escape(key)}"]`); cur = cur.parentElement; continue; }
      const tag = cur.tagName.toLowerCase();
      const sibs = [...(cur.parentElement?.children || [])].filter((s) => s.tagName === cur.tagName);
      parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(cur) + 1})` : tag);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  // 选择器来自评论数据，可能写坏：任何异常都按「没找到」处理，不影响其他评论
  function locateElement(c) {
    let el = null;
    try { el = document.querySelector(c.selector); } catch (e) { el = null; }
    const visible = (x) => x && x.getClientRects().length > 0 && !x.closest('[hidden]');
    if (el && visible(el) && (!c.label || norm(elementLabel(el)) === norm(c.label))) return el;
    // 路径变了：按文字在同类元素里找一次
    if (c.label) {
      const tag = (String(c.selector || '').split('>').pop() || '').trim().split(/[:.[#]/)[0].toLowerCase();
      if (/^[a-z][a-z0-9-]*$/.test(tag)) {
        const cand = [...document.querySelectorAll(tag)].find((x) => !x.closest(SKIP) && visible(x) && norm(elementLabel(x)) === norm(c.label));
        if (cand) return cand;
      }
    }
    return el && visible(el) && !c.label ? el : null;
  }

  // ---------- 高亮与标记 ----------
  function unwrapAll() {
    document.querySelectorAll('mark.rv-hl, mark.rv-pending').forEach((m) => {
      const p = m.parentNode; if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      m.remove(); p.normalize();
    });
    document.querySelectorAll('[data-rv-el]').forEach((el) => el.removeAttribute('data-rv-el'));
  }
  function clearPendingMark() {
    applying = true;
    document.querySelectorAll('mark.rv-pending').forEach((m) => {
      const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize();
    });
    document.querySelectorAll('[data-rv-el="pending"]').forEach((el) => el.removeAttribute('data-rv-el'));
    observer.takeRecords(); applying = false;
  }

  function apply() {
    applying = true;
    try {
      unwrapAll();
      located = new Map();
      const idx = buildIndex();
      const visibleThreads = threads.filter((t) => filter === 'all' || (filter === 'open' ? !t.resolved : t.resolved) || t.id === focusId);
      const textMarks = [];
      // 单条评论定位失败只让它变成「未定位」，不中断整页
      for (const t of visibleThreads) {
        try {
          if (t.kind === 'element') {
            const el = locateElement(t);
            if (el) { el.setAttribute('data-rv-el', t.resolved ? 'done' : 'open'); located.set(t.id, { type: 'el', el }); }
          } else {
            const off = locateText(t, idx);
            if (off) textMarks.push({ t, off });
          }
        } catch (e) { /* 锚点无效：按未定位处理 */ }
      }
      // 从后往前包裹，避免前面的切分改变后面节点的偏移
      textMarks.sort((a, b) => b.off.s - a.off.s).forEach(({ t, off }) => {
        try {
          const m = wrapText(off, buildIndex(), t.id, `rv-hl${t.resolved ? ' is-done' : ''}${t.id === focusId ? ' is-focus' : ''}`);
          if (m) located.set(t.id, { type: 'text', el: m });
        } catch (e) { /* 同上 */ }
      });
      for (const v of located.values()) v.top = v.el.getBoundingClientRect().top + window.scrollY;
    } finally {
      observer.takeRecords();
      applying = false;
    }
    drawPins();
  }

  function drawPins() {
    pins.replaceChildren();
    let n = 0;
    const ordered = [...located.entries()].sort((a, b) => a[1].top - b[1].top);
    for (const [id, v] of ordered) {
      n += 1;
      if (v.type !== 'el') continue;
      const r = v.el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const t = threads.find((x) => x.id === id);
      const pin = h('button', {
        class: `rv-pin${t?.resolved ? ' is-done' : ''}${id === focusId ? ' is-focus' : ''}`, type: 'button', tabindex: '-1',
        style: `top:${r.top + window.scrollY - 9}px;left:${r.right + window.scrollX - 9}px`,
        onclick: () => focus(id, false),
      }, String(n));
      pins.append(pin);
    }
  }

  function refresh() {
    renderLauncher();
    apply();
    renderPanel();
  }

  function focus(id, scrollPage) {
    focusId = id;
    toggle(true);
    apply();
    renderPanel();
    const v = located.get(id);
    if (scrollPage && v) v.el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // ---------- 选中文字 ----------
  function currentRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    if (!host || host.closest(SKIP)) return null;
    if (!sel.toString().trim()) return null;
    return r;
  }
  function showBubble() {
    const r = currentRange();
    if (!r) { bubble.hidden = true; return; }
    const rects = r.getClientRects();
    const last = rects[rects.length - 1] || r.getBoundingClientRect();
    bubble.hidden = false;
    const x = Math.min(window.innerWidth - 72, Math.max(8, last.right - 24));
    const y = last.bottom + 8 > window.innerHeight - 48 ? last.top - 40 : last.bottom + 8;
    bubble.style.left = `${x}px`; bubble.style.top = `${y}px`;
  }
  function startFromSelection() {
    const r = currentRange();
    bubble.hidden = true;
    if (!r) return;
    const idx = buildIndex();
    const off = rangeToOffsets(r, idx);
    if (!off) return;
    commentDraft = '';
    pending = {
      kind: 'text',
      quote: idx.text.slice(off.s, off.e).slice(0, 1000),
      prefix: idx.text.slice(Math.max(0, off.s - CTX), off.s),
      suffix: idx.text.slice(off.e, off.e + CTX),
    };
    window.getSelection().removeAllRanges();
    applying = true;
    wrapText(off, idx, 'pending', 'rv-pending');
    observer.takeRecords(); applying = false;
    toggle(true);
    renderPanel();
  }
  let selTimer = 0;
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(showBubble, 160); });
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.rv-bubble')) bubble.hidden = true; }, true);

  // ---------- 点选元素 ----------
  function pickTarget(e) {
    let el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('#rv-ui, #rv-pins')) return null;
    if (el.closest('svg')) el = el.closest('svg').parentElement || el;
    // 图片、图标这类没有文字的小元素，向上找到带文字的容器，评论更好认
    for (let i = 0; i < 3 && el.parentElement && el.parentElement !== document.body && !elementLabel(el); i++) el = el.parentElement;
    if (el === document.body || el === document.documentElement) return null;
    return el;
  }
  function onPickMove(e) {
    const el = pickTarget(e);
    if (!el) { hover.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(hover.style, { top: `${r.top - 3}px`, left: `${r.left - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    hover.dataset.label = elementLabel(el) || el.tagName.toLowerCase();
    hover.hidden = false;
  }
  function onPickClick(e) {
    const el = pickTarget(e);
    if (!el) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    stopPick();
    commentDraft = '';
    pending = { kind: 'element', selector: selectorFor(el), label: elementLabel(el) };
    clearPendingMark();
    el.setAttribute('data-rv-el', 'pending');
    toggle(true);
    renderPanel();
  }
  function swallow(e) { if (!e.target.closest('#rv-ui')) { e.preventDefault(); e.stopPropagation(); } }
  function onPickKey(e) { if (e.key === 'Escape') stopPick(); }
  function startPick() {
    picking = true;
    document.documentElement.classList.add('rv-picking');
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dragstart'].forEach((t) => document.addEventListener(t, swallow, true));
    document.addEventListener('keydown', onPickKey, true);
    toast('点一下要评论的元素，按 Esc 退出');
    renderPanel();
  }
  function stopPick() {
    if (!picking) return;
    picking = false;
    hover.hidden = true;
    document.documentElement.classList.remove('rv-picking');
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dragstart'].forEach((t) => document.removeEventListener(t, swallow, true));
    document.removeEventListener('keydown', onPickKey, true);
    renderPanel();
  }

  // ---------- 页面变化后重新定位 ----------
  let mutTimer = 0;
  const observer = new MutationObserver((records) => {
    if (applying) return;
    if (records.every((r) => r.target.closest && r.target.closest('#rv-ui, #rv-pins'))) return;
    clearTimeout(mutTimer);
    mutTimer = setTimeout(() => {
      if (pending) { drawPins(); return; }
      const active = document.activeElement;
      if (active && active.tagName === 'TEXTAREA' && panel.contains(active)) {
        apply();
        drawPins();
        return;
      }
      apply();
      renderPanel();
    }, 200);
  });
  let rafPins = 0;
  const schedulePins = () => { cancelAnimationFrame(rafPins); rafPins = requestAnimationFrame(drawPins); };
  window.addEventListener('resize', schedulePins);
  window.addEventListener('scroll', schedulePins, true);

  // ---------- 启动 ----------
  async function load() {
    loadState = 'loading'; renderPanel();
    try {
      const data = await api('GET', `/api/comments?page=${encodeURIComponent(PAGE)}`);
      me = data.me || '';
      threads = []; replies = new Map();
      for (const c of data.comments || []) {
        if (c.parent_id) { const l = replies.get(c.parent_id) || []; l.push(c); replies.set(c.parent_id, l); }
        else threads.push(c);
      }
      loadState = 'ready';
      const want = new URLSearchParams(location.search).get('rvThread');
      if (want && threads.some((t) => t.id === want)) { focus(want, true); }
      refresh();
    } catch (e) {
      loadState = 'error'; loadError = e.message;
      renderLauncher(); renderPanel();
    }
  }

  function boot() {
    document.body.append(ui, pins);
    renderLauncher();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
