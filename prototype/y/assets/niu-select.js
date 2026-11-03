/* Niu-Talent 下拉选择：页面里的 <select> 一律换成自绘的按钮和列表。
   原生 select 留在原处管值和 change 事件，页面代码照常读写 value、监听 change；
   列表放在顶层（popover），对话框里打开也不会被裁掉。选项多时顶部带筛选框。 */
(function () {
  const FILTER_MIN = 10; // 选项达到这个数量才出现筛选框
  const proto = HTMLSelectElement.prototype;
  const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
  const indexDesc = Object.getOwnPropertyDescriptor(proto, 'selectedIndex');
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let uid = 0;
  let open = null; // 当前打开的 { sel, btn, pop, close }

  function labelOf(sel) {
    const o = sel.options[sel.selectedIndex];
    return o ? o.textContent : '';
  }

  function enhance(sel) {
    if (sel.dataset.picker || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
    sel.dataset.picker = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    const text = document.createElement('span');
    text.className = 'n-picker__text';
    btn.append(text);
    const sync = () => {
      btn.className = `${sel.className.replace(/\bn-(input|picker__native)\b/g, '').trim()} n-select n-picker`;
      btn.style.cssText = sel.style.cssText;
      btn.disabled = sel.disabled;
      const al = sel.getAttribute('aria-label');
      if (al) btn.setAttribute('aria-label', `${al}：${labelOf(sel)}`); else btn.removeAttribute('aria-label');
      if (sel.id) btn.dataset.for = sel.id;
      text.textContent = labelOf(sel);
    };
    // 按钮放在 select 前面：外层 <label> 点文字时激活的是第一个可标注的控件，也就是这个按钮
    sel.before(btn);
    sel.classList.add('n-picker__native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    // 页面代码直接改 value / selectedIndex 时，按钮上的文字跟着变
    Object.defineProperty(sel, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); sync(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); sync(); } });
    sel.focus = (o) => btn.focus(o);
    sel.addEventListener('change', sync);
    new MutationObserver(sync).observe(sel, { attributes: true, attributeFilter: ['disabled', 'class', 'style', 'aria-label'], childList: true, subtree: true, characterData: true });
    sync();

    btn.addEventListener('click', () => (open?.sel === sel ? open.close() : show(sel, btn)));
    btn.addEventListener('keydown', (e) => {
      if (open?.sel === sel) return; // 打开后由列表的键盘处理接管
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(sel, btn); }
    });
  }

  function show(sel, btn) {
    open?.close(true);
    const opts = [...sel.options].filter((o) => !o.hidden);
    const pop = document.createElement('div');
    pop.className = 'n-listbox';
    const listId = `n-lb-${++uid}`;
    const hasFilter = opts.length >= FILTER_MIN;
    pop.innerHTML = `${hasFilter ? '<div class="n-listbox__filter"><input type="text" autocomplete="off" spellcheck="false" placeholder="筛选" aria-label="筛选选项"></div>' : ''}<div class="n-listbox__list" role="listbox" id="${listId}"></div><p class="n-listbox__empty" hidden>没有匹配的选项</p>`;
    const list = pop.querySelector('[role="listbox"]');
    const al = sel.getAttribute('aria-label');
    if (al) list.setAttribute('aria-label', al);
    const rows = opts.map((o, i) => {
      const r = document.createElement('div');
      r.className = 'n-listbox__opt';
      r.id = `${listId}-${i}`;
      r.setAttribute('role', 'option');
      r.setAttribute('aria-selected', String(o.selected));
      if (o.disabled) r.setAttribute('aria-disabled', 'true');
      r.innerHTML = `<span></span>${CHECK}`;
      r.firstChild.textContent = o.textContent;
      r._opt = o;
      list.append(r);
      return r;
    });
    const input = pop.querySelector('input');
    const empty = pop.querySelector('.n-listbox__empty');
    const usePopover = typeof pop.showPopover === 'function';
    if (usePopover) pop.setAttribute('popover', 'manual');
    document.body.append(pop);
    if (usePopover) pop.showPopover();

    let active = null;
    const visible = () => rows.filter((r) => !r.hidden && !r.hasAttribute('aria-disabled'));
    const setActive = (r, scroll) => {
      active?.classList.remove('is-active');
      active = r || null;
      if (!active) { (input || btn).removeAttribute('aria-activedescendant'); return; }
      active.classList.add('is-active');
      (input || btn).setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    };

    const place = () => {
      const r = btn.getBoundingClientRect();
      if (!btn.isConnected || r.bottom < 0 || r.top > innerHeight) { close(true); return; }
      const gap = 6, margin = 8;
      const below = innerHeight - r.bottom - gap - margin, above = r.top - gap - margin;
      const want = Math.min(pop.scrollHeight, 340);
      const up = below < Math.min(want, 220) && above > below;
      pop.style.maxHeight = `${Math.max(140, Math.min(340, up ? above : below))}px`;
      const w = Math.max(r.width, Math.min(pop.scrollWidth, 360));
      pop.style.minWidth = `${r.width}px`;
      pop.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - w - margin))}px`;
      pop.style.top = up ? 'auto' : `${r.bottom + gap}px`;
      pop.style.bottom = up ? `${innerHeight - r.top + gap}px` : 'auto';
      pop.classList.toggle('is-up', up);
    };
    place();
    const cur = rows.find((r) => r._opt.selected) || visible()[0];
    setActive(cur);
    // 当前选中项放在列表中间附近，长列表打开就能看到自己选的是哪一项
    if (cur) list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 2 + cur.offsetHeight / 2;
    const edges = () => {
      list.classList.toggle('has-above', list.scrollTop > 1);
      list.classList.toggle('has-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
    };
    list.addEventListener('scroll', edges, { passive: true });
    edges();
    requestAnimationFrame(() => pop.classList.add('is-in'));
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', listId);
    btn.classList.add('is-open');
    if (input) input.focus({ preventScroll: true });

    const filter = () => {
      const q = input.value.trim().toLowerCase();
      rows.forEach((r) => { r.hidden = !!q && !r.textContent.toLowerCase().includes(q); });
      const v = visible();
      empty.hidden = !!v.length;
      edges();
      setActive(v.includes(active) ? active : v[0], true);
    };
    input?.addEventListener('input', filter);

    const pick = (r) => {
      if (!r || r.hasAttribute('aria-disabled')) return;
      const changed = !r._opt.selected;
      rows.forEach((x) => x.setAttribute('aria-selected', String(x === r)));
      r.classList.add('is-picked');
      // 选中的一行先亮一下再收起，手上有落点的感觉
      setTimeout(() => {
        close();
        if (changed) {
          valueDesc.set.call(sel, r._opt.value);
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, reduced() ? 0 : 90);
    };
    list.addEventListener('pointermove', (e) => { const r = e.target.closest('[role="option"]'); if (r && r !== active && !r.hasAttribute('aria-disabled')) setActive(r); });
    list.addEventListener('click', (e) => pick(e.target.closest('[role="option"]')));

    const onKey = (e) => {
      const v = visible();
      const i = v.indexOf(active);
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(v[Math.min(v.length - 1, i + 1)] || v[0], true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(v[Math.max(0, i - 1)] || v[0], true); }
      else if (e.key === 'Home' && !input) { e.preventDefault(); setActive(v[0], true); }
      else if (e.key === 'End' && !input) { e.preventDefault(); setActive(v[v.length - 1], true); }
      else if (e.key === 'Enter' || (e.key === ' ' && !input)) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') close(false, true);
    };
    const keyHost = input || btn;
    keyHost.addEventListener('keydown', onKey);
    const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(false, true); };
    const onScroll = (e) => { if (!pop.contains(e.target)) place(); };
    document.addEventListener('pointerdown', outside, true);
    addEventListener('scroll', onScroll, true);
    addEventListener('resize', place);

    function close(instant, keepFocusAway) {
      if (open?.pop !== pop) return;
      open = null;
      keyHost.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', outside, true);
      removeEventListener('scroll', onScroll, true);
      removeEventListener('resize', place);
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
      btn.classList.remove('is-open');
      if (!keepFocusAway && !instant) btn.focus({ preventScroll: true });
      const done = () => pop.remove();
      if (instant || reduced()) { done(); return; }
      pop.classList.remove('is-in');
      pop.classList.add('is-out');
      setTimeout(done, 160);
    }
    open = { sel, btn, pop, close };
  }

  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'SELECT') enhance(root);
    else root.querySelectorAll?.('select').forEach(enhance);
  };
  const start = () => {
    scan(document.body);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
