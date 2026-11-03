/* 新手引导：小犇从输入框里飞出来，带着聚光依次停在几处关键位置，每处只说一句话；
   最后飞回输入框，替用户写好一句示例，发出去后在结果页再落一次，指出这一步省掉了什么。
   每个视角在同一浏览器里只自动出现一次；?tour=1 或侧栏「新手引导」可重看。 */
(function () {
  const NT = window.NT;
  const { html, icon, mount, $ } = NT;
  const KEY = (role) => `nty-onb:${role}`;
  const LAND = 'nty-onb-land';
  const IP = 56;

  const FINALE_REC = '我就待在输入框里。<b>发出这句话</b>，看看一条记录是怎么整理出来的。';
  // 引导里替用户写的那段话要有情境、做法和结果，整理出来才看得出差别
  const SAY = {
    hrbp: '谷嘉树这周赶上发布前 CI 频繁失败。他主动认领了排查，先对比了两种方案再动手，独立定位到缓存配置的问题。当天修复上线，构建全部恢复，还整理成文档发给了全组。',
    mentor: '孟逸尘今天碰上需求临时变更，组里的任务一下乱了。他主动把任务池拆成三块同步给全组，还协调后端对齐了接口。下午组员就接上了，当天按时交付。',
  };
  const SCRIPTS = {
    ceo: [
      { at: '#composer', ip: 'listening', type: true, text: '想找什么样的人，<b>直接说一句话</b>，我去翻已确认的记录，把有依据的人找出来。' },
      { at: '#watch', ip: 'searching', text: '<b>值得关注的人</b>都经 HR 核实过；点名字就能看速览，不用跳页。' },
      { at: '#composer', ip: 'confirm', finale: true, cta: ['search', '开始找人'], text: '我就待在输入框里。<b>发出这句话</b>，看看我怎么找人。' },
    ],
    hrbp: [
      { at: '#composer', ip: 'listening', type: true, text: '刚发生的事，<b>说一句就行</b>：我拆成情境、行为、影响，附上原话出处。' },
      { at: '#todo', ip: 'confirm', text: '等你拍板的事都在<b>待办</b>里，按类型分好了，从上往下处理就行。' },
      { at: '#changes', tray: '#chg-toggle', ip: 'searching', text: '谁的情况有变化，<b>收在这一条里</b>，需要时再展开。' },
      { at: '#composer', ip: 'confirm', finale: true, text: FINALE_REC },
    ],
    mentor: [
      { at: '#composer', ip: 'listening', type: true, text: '学员做了件事？<b>说一句就行</b>，我整理成一条带原话出处的记录。' },
      { at: '#stu-tray', tray: '#stu-toggle', ip: 'searching', text: '你带的学员都在这一条里，<b>谁本周还没记</b>一眼就能看到。' },
      { at: '#todo', ip: 'confirm', text: '等你确认的事在<b>待办</b>里，处理完就清掉。' },
      { at: '#composer', ip: 'confirm', finale: true, text: FINALE_REC },
    ],
  };
  // 发出示例后，在结果页落最后一次：等结果真正出来再指给用户看
  const LANDINGS = {
    record: { at: '#scores', also: '#ev-actions', ready: () => $('#ev-actions') && !$('#ev-actions').hidden, text: '整理好了：<b>每个建议分都引着你的原话</b>，没说到的不打分；点「确认并保存」才进档案。' },
    staffing: { at: '#cands > *', ready: () => $('#cands')?.children.length, text: '候选人<b>按必须项的证据排列</b>，每条判断都能点开看出处。' },
  };

  const store = {
    get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
    set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* 隐私模式下不记，下次再出现一次 */ } },
    del: (k, s = localStorage) => { try { s.removeItem(k); } catch { /* 同上 */ } },
  };

  let layer = null; // 当前这一轮引导的全部浮层

  // 比一屏还高的区块只照上半截，下面留给气泡
  const tall = (el) => el.getBoundingClientRect().height > innerHeight * 0.6;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect(), vh = innerHeight;
    const top = Math.max(r.top, 8), bottom = Math.min(r.bottom, vh - 8, tall(el) ? top + Math.max(200, vh - top - 220) : Infinity);
    return { left: r.left, top, width: r.width, height: Math.max(bottom - top, 40), right: r.right, bottom: Math.max(bottom, top + 40) };
  };
  // 顶栏是吸顶的，目标上方再留出小犇站的位置
  const scrollTo_ = (el, block) => {
    el.style.scrollMarginTop = '104px';
    el.scrollIntoView({ block, behavior: NT.reduced ? 'auto' : 'smooth' });
    setTimeout(() => { el.style.scrollMarginTop = ''; }, 600);
  };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  function build() {
    const root = document.createElement('div');
    root.className = 'n-onb';
    mount(root, html`
      <div class="n-onb__veil"></div>
      <div class="n-onb__spot" aria-hidden="true"></div>
      <div class="n-onb__ip" aria-hidden="true"><span class="nt-ip" data-ip="rest" data-size="${IP}"></span></div>
      <div class="n-onb__bubble" role="dialog" aria-modal="true" aria-labelledby="onb-text" tabindex="-1">
        <p class="n-onb__text" id="onb-text" aria-live="polite"></p>
        <div class="n-onb__bar"><span class="n-onb__dots" aria-hidden="true"></span><span class="n-onb__sr" id="onb-step"></span><span class="spacer"></span><span class="n-onb__acts"></span></div>
      </div>`);
    document.body.append(root);
    NT.ui.mountIPs(root);
    return { root, spot: $('.n-onb__spot', root), fly: $('.n-onb__ip', root), ip: $('.n-onb__ip .nt-ip', root), bubble: $('.n-onb__bubble', root), text: $('#onb-text', root), dots: $('.n-onb__dots', root), step: $('#onb-step', root), acts: $('.n-onb__acts', root) };
  }

  // 小犇沿弧线飞到目标附近，身后留下几点流光
  let pos = null;
  function flyTo(L, x, y, scale = 1) {
    const to = `translate(${x}px, ${y}px) scale(${scale})`;
    const from = pos;
    pos = { x, y, scale };
    if (!from || NT.reduced) {
      L.fly.style.transform = to;
      if (NT.reduced) L.fly.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      return Promise.resolve();
    }
    const mx = (from.x + x) / 2, my = Math.min(from.y, y) - Math.min(90, Math.abs(x - from.x) / 3 + 40);
    L.fly.style.transform = to;
    const anim = L.fly.animate([
      { transform: `translate(${from.x}px, ${from.y}px) scale(${from.scale})` },
      { transform: `translate(${mx}px, ${my}px) scale(${Math.max(from.scale, scale) * 1.08}) rotate(-6deg)`, offset: 0.5 },
      { transform: to },
    ], { duration: 680, easing: 'cubic-bezier(.45,.05,.25,1)' });
    [0.2, 0.35, 0.5, 0.65, 0.8].forEach((t, i) => setTimeout(() => {
      if (!layer) return;
      const u = 1 - t, px = u * u * from.x + 2 * u * t * mx + t * t * x, py = u * u * from.y + 2 * u * t * my + t * t * y;
      const d = document.createElement('i');
      d.className = 'n-onb__trail';
      d.style.transform = `translate(${px + IP / 2}px, ${py + IP / 2}px)`;
      d.style.animationDelay = `${i * 20}ms`;
      L.root.append(d);
      setTimeout(() => d.remove(), 900);
    }, t * 680));
    return anim.finished.catch(() => {}).then(() => { L.fly.classList.remove('is-land'); void L.fly.offsetWidth; L.fly.classList.add('is-land'); });
  }

  function placeSpot(L, r) {
    const pad = 8;
    Object.assign(L.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  }

  // 气泡贴着目标放：下方放得下放下方，否则上方，都不够就压在目标顶部
  function placeBubble(L, r, ipX, ipY) {
    const b = L.bubble, vw = innerWidth, vh = innerHeight, gut = 16;
    b.style.left = '0px'; b.style.top = '0px';
    const bw = b.offsetWidth, bh = b.offsetHeight;
    const left = clamp(ipX + IP * 0.6, gut, vw - bw - gut);
    let top;
    if (r.bottom + 14 + bh < vh - gut) top = r.bottom + 14;
    else if (r.top - 14 - bh > gut) top = r.top - 14 - bh;
    else top = clamp(ipY + IP + 6, gut, vh - bh - gut);
    b.style.left = `${left}px`; b.style.top = `${top}px`;
  }

  async function show(L, s, i, n, ctl) {
    const el = $(s.at);
    if (!el) return ctl.next();
    if (s.tray) {
      const t = $(s.tray);
      if (t && t.getAttribute('aria-expanded') !== 'true') { t.click(); ctl.restore = () => t.isConnected && t.getAttribute('aria-expanded') === 'true' && t.click(); await NT.wait(340); }
    }
    scrollTo_(el, s.finale || s.type ? 'center' : tall(el) ? 'start' : 'nearest');
    await NT.wait(NT.reduced ? 0 : 380);
    if (ctl.dead()) return;
    const r = rectOf(el);
    L.bubble.classList.remove('is-in');
    L.fly.classList.remove('is-home');
    placeSpot(L, r);
    const slot = s.finale && $('#composer-ip');
    let x, y, scale = 1;
    if (slot) {
      const sr = slot.getBoundingClientRect();
      scale = sr.width / IP; x = sr.left - (IP - sr.width) / 2; y = sr.top - (IP - sr.height) / 2;
    } else {
      x = clamp(r.left - IP * 0.45, 6, innerWidth - IP - 6);
      y = clamp(r.top - IP * 0.55, 6, innerHeight - IP - 6);
    }
    NT.ipState(L.ip, s.finale ? 'done' : s.ip);
    await flyTo(L, x, y, scale);
    if (ctl.dead()) return;
    L.text.innerHTML = s.text;
    L.dots.innerHTML = Array.from({ length: n }, (_, k) => `<i${k === i ? ' class="is-on"' : ''}></i>`).join('');
    L.step.textContent = `第 ${i + 1} 步，共 ${n} 步`;
    mount(L.acts, s.finale
      ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-onb="close">我先看看</button><button class="n-btn n-btn--sm n-btn--ink" type="button" data-onb="send">${icon((s.cta || ['up'])[0])}${(s.cta || [0, '发出这句话'])[1]}</button>`
      : html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-onb="close">跳过</button>${i ? html`<button class="n-btn n-btn--sm" type="button" data-onb="prev">上一步</button>` : ''}<button class="n-btn n-btn--sm n-btn--ink" type="button" data-onb="next">下一步</button>`);
    placeBubble(L, r, x, y);
    L.bubble.classList.add('is-in');
    $('.n-btn--ink', L.acts).focus({ preventScroll: true });
    if (s.finale) {
      // 小犇落进输入框：浮层里的那只隐去，输入框里的接着做「完成」
      L.fly.classList.add('is-home');
      const home = $('#composer-ip');
      home.style.visibility = '';
      NT.ipState(home, 'done');
      $('#composer-send')?.classList.add('is-onb-pulse');
    }
    if (s.type) {
      const field = $('#composer-field');
      if (field && !field.value) await NT.stream(field, ctl.say, 34, { onTick: () => field.dispatchEvent(new Event('input')), stop: ctl.dead });
    }
  }

  function start(role, opts = {}) {
    const steps = SCRIPTS[role];
    if (!steps || layer || !$('#composer')) return;
    const L = layer = build();
    const home = $('#composer-ip');
    const prevFocus = document.activeElement;
    let i = 0, run = 0;
    const ctl = { say: SAY[role] || opts.say || '', restore: null, dead: () => layer !== L };
    // 起点：从输入框里的小犇长出来
    if (home) {
      const hr = home.getBoundingClientRect();
      pos = { x: hr.left - (IP - hr.width) / 2, y: hr.top - (IP - hr.height) / 2, scale: hr.width / IP };
      L.fly.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${pos.scale})`;
      home.style.visibility = 'hidden';
    } else pos = null;
    requestAnimationFrame(() => L.root.classList.add('is-on'));

    const leaveStep = () => { if (ctl.restore) { ctl.restore(); ctl.restore = null; } };
    const go = async (k) => {
      leaveStep();
      i = k;
      const me = ++run;
      await show(L, steps[i], i, steps.length, { ...ctl, dead: () => ctl.dead() || me !== run, next: () => (i < steps.length - 1 ? go(i + 1) : close()), set restore(f) { ctl.restore = f; } });
    };
    const close = (send) => {
      if (layer !== L) return;
      leaveStep();
      store.set(KEY(role), '1');
      layer = null; pos = null;
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('resize', onResize);
      if (home) home.style.visibility = '';
      L.root.classList.remove('is-on');
      setTimeout(() => L.root.remove(), NT.reduced ? 0 : 240);
      const sendBtn = $('#composer-send');
      if (send) {
        store.set(LAND, JSON.stringify({ role, at: Date.now() }), sessionStorage);
        sendBtn?.click();
        return;
      }
      if (sendBtn) setTimeout(() => sendBtn.classList.remove('is-onb-pulse'), 4000);
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.target.closest && e.target.closest('.n-onb__acts') && e.key === 'Enter') return; // 按钮自己的回车
      if (e.key === 'ArrowRight') { e.preventDefault(); if (i < steps.length - 1) go(i + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (i > 0) go(i - 1); }
      if (e.key === 'Tab') { // 焦点留在气泡里
        const bs = [...L.acts.querySelectorAll('button')];
        if (!bs.length) return;
        const at = bs.indexOf(document.activeElement);
        e.preventDefault();
        bs[(at + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
      }
    };
    let rz = 0;
    const onResize = () => { clearTimeout(rz); rz = setTimeout(() => { if (layer === L) go(i); }, 200); };
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', onResize);
    L.acts.addEventListener('click', (e) => {
      const a = e.target.closest('[data-onb]')?.dataset.onb;
      if (a === 'next') (i < steps.length - 1 ? go(i + 1) : close());
      if (a === 'prev') go(i - 1);
      if (a === 'close') close();
      if (a === 'send') close(true);
    });
    go(0);
  }

  // 工作台：首次进入这个视角时自动开始；地址带 ?tour=1 时总是开始
  function auto(role, opts) {
    if (!SCRIPTS[role]) return;
    const forced = NT.param('tour') === '1';
    if (!forced && store.get(KEY(role))) return;
    if (forced) history.replaceState(null, '', location.pathname + location.search.replace(/([?&])tour=1(&|$)/, (m, a, b) => (b ? a : '')).replace(/\?$/, '') + location.hash);
    setTimeout(() => start(role, opts), NT.reduced ? 0 : 500);
  }

  // 结果页：示例发出后结果一出来，小犇落在结果旁边说最后一句
  function land(page) {
    const spec = LANDINGS[page];
    let flag;
    try { flag = JSON.parse(store.get(LAND, sessionStorage) || 'null'); } catch { flag = null; }
    if (!spec || !flag) return;
    if (Date.now() - flag.at > 60000) { store.del(LAND, sessionStorage); return; }
    const t0 = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - t0 > 20000) { clearInterval(poll); return; } // 这一页没等到结果（例如还要跳转一次），留给下一页
      if (!spec.ready()) return;
      clearInterval(poll);
      store.del(LAND, sessionStorage);
      await NT.wait(500);
      const el = $(spec.at);
      if (!el || layer) return;
      const L = layer = build();
      L.root.classList.add('is-land', 'is-on');
      const done = () => {
        if (layer !== L) return;
        layer = null; pos = null;
        document.removeEventListener('keydown', onKey, true);
        L.root.classList.remove('is-on');
        setTimeout(() => L.root.remove(), NT.reduced ? 0 : 240);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } };
      document.addEventListener('keydown', onKey, true);
      scrollTo_(el, tall(el) ? 'start' : 'center');
      await NT.wait(NT.reduced ? 0 : 420);
      let r = rectOf(el);
      const extra = spec.also && $(spec.also);
      if (extra) { const e2 = rectOf(extra); r = { left: Math.min(r.left, e2.left), top: r.top, right: Math.max(r.right, e2.right), bottom: Math.max(r.bottom, e2.bottom) }; r.width = r.right - r.left; r.height = r.bottom - r.top; }
      placeSpot(L, r);
      const x = clamp(r.left - IP * 0.45, 6, innerWidth - IP - 6), y = clamp(r.top - IP * 0.55, 6, innerHeight - IP - 6);
      // 从页面上的小犇那里飞过来
      const src = $('#ev-ip') || $('#composer-ip') || $('.nt-brand .nt-ip');
      if (src) { const sr = src.getBoundingClientRect(); pos = { x: sr.left - (IP - sr.width) / 2, y: sr.top - (IP - sr.height) / 2, scale: sr.width / IP }; L.fly.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${pos.scale})`; }
      NT.ipState(L.ip, 'done');
      await flyTo(L, x, y);
      L.text.innerHTML = spec.text;
      L.dots.remove();
      mount(L.acts, html`<button class="n-btn n-btn--sm n-btn--ink" type="button" data-onb="ok">${icon('check')}知道了</button>`);
      placeBubble(L, r, x, y);
      L.bubble.classList.add('is-in');
      $('[data-onb="ok"]', L.acts).addEventListener('click', done);
      $('[data-onb="ok"]', L.acts).focus({ preventScroll: true });
      L.veil = $('.n-onb__veil', L.root);
      L.veil.addEventListener('click', done); // 结果页的这一句不挡路：点空白处就收起
    }, 200);
  }

  const reset = () => Object.keys(SCRIPTS).forEach((r) => store.del(KEY(r)));
  const page = location.pathname.split('/').pop().replace('.html', '');
  if (LANDINGS[page]) NT.ready(() => land(page));
  NT.onboard = { start, auto, land, reset, has: (role) => !!SCRIPTS[role] };
})();
