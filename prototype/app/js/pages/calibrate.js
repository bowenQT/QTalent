/* 团队象限校准（光点落位）：小犇根据已确认的维度分算出参考位置，化作光点落下；人把头像拖到自己判断的位置，
   光点留在原处，中间连一道由光到墨的痕迹。拖到另一个象限时小犇问一句理由；全部确认后光点消散、盖印冻结。
   资料不足的人不进象限，单独列出缺什么。部门负责人可以参与、提出调整，确认需要 HRBP 或 CEO。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  const id = NT.param('id') || 'b-h2';
  const b = st.batch(id);
  const isLanding = b?.kind === 'landing';
  const LABEL = isLanding ? 'Landing 结营' : '2026 H2';
  const QN = st.QN;
  const qOf = ([x, y]) => (y < 0.5 ? 'h' : 'l') + (x < 0.5 ? 'l' : 'h');
  const clamp = (v) => Math.min(0.95, Math.max(0.05, v));
  let team = NT.param('team');
  let people = [], asking = null, selected = null;

  NT.shell({
    nav: isLanding ? 'landing' : 'review', title: `${LABEL} · 象限校准`, crumbs: isLanding ? [['Landing 第三期', 'landing.html']] : [['盘点', 'reviews.html'], [b?.name || '', `review.html?id=${id}`]],
    allow: (r) => ['ceo', 'hrbp', 'lead'].includes(r) && !!b,
    denyText: '象限仅 CEO、HRBP 和部门负责人可见。',
    view: () => `象限校准 · ${isLanding ? '新人' : st.orgShort(team)}${frozen() ? ' · 已冻结' : ''}`,
    state: () => ({ team }),
    restore: (s) => { if (s.team) { team = s.team; render($('#main')); } },
    render,
  });

  const snap = () => st.get().snaps.find((s) => s.batch === id);
  const frozen = () => !!snap()?.teams?.includes(team);
  function scopeTeams() {
    if (isLanding) return ['newcomers'];
    return [...new Set(st.people().filter((p) => !p.noReview && st.inOrg(p.org, b.org) && st.scope(p.id) === 'full').map((p) => p.org))];
  }
  function members() {
    if (isLanding) return b.newcomers.map((n) => n[0]).filter((pid) => st.scope(pid) === 'full');
    return st.people().filter((p) => !p.noReview && p.org === team && st.scope(p.id) === 'full').map((p) => p.id).sort((a, c) => st.person(a).name.localeCompare(st.person(c).name, 'zh'));
  }

  function render(main) {
    const teams = scopeTeams();
    if (!team || !teams.includes(team)) team = teams.includes('gp-ops') ? 'gp-ops' : teams[0];
    const ids = members();
    const sn = snap(), isFrozen = frozen();
    const placed = [], na = [];
    const sugs = isFrozen ? {} : st.calibSuggestions(id, team);
    ids.forEach((pid) => {
      // 冻结后整份读快照：位置、维度均值、证据条数都是冻结那一刻的，不随新事件变化
      const e = isFrozen ? sn.entries[pid] : null;
      if (isFrozen && !e) { na.push({ pid, miss: '快照冻结后加入' }); return; }
      const r = e ? { ...e, q: e.ref } : st.refPos(pid);
      if (r.na) { na.push({ pid, miss: r.miss }); return; }
      const prev = st.formal(pid);
      const ref = e ? [e.x, e.y] : [r.x, r.y];
      placed.push({ pid, p: st.person(pid), ref, pos: ref.slice(), refQ: r.q, reason: e?.reason || '', bonus: r.bonus, r, sug: sugs[pid], prevQ: prev && prev.snap.batch !== id ? prev.q : null, prevLabel: prev?.snap.label });
    });
    people = placed;
    const conflicts = ids.filter((pid) => st.get().events.some((ev) => ev.scores.some((s) => s.p === pid && s.st === 'conflict')));
    const canConfirm = st.can('quadConfirm');
    const nScores = placed.reduce((n, x) => n + x.r.n, 0);
    mount(main, html`
      <header class="nt-head"><div><h1>${LABEL} · 象限校准</h1><p>${isLanding ? 'Landing 第三期结营：新人第一次落位，形成第一份档案。' : `${b.name} · HRBP 发起，部门负责人参与。`}同意参考位置的人不用动；和参考不同的要写一句理由。</p></div>
        ${!isLanding ? html`<div class="nt-head__acts"><a class="n-btn n-btn--sm n-btn--ghost" href="review.html?id=${id}">回到盘点清单</a></div>` : ''}</header>
      ${!isLanding ? html`<div class="n-seg n-seg--md" role="group" aria-label="团队" data-manual id="teams" style="margin-bottom:var(--s-4)">${teams.map((t) => html`<button type="button" data-t="${t}" aria-pressed="${t === team}">${st.orgShort(t)}${sn?.teams?.includes(t) ? ' · 已冻结' : ''}</button>`)}</div>` : ''}
      <div class="nt-split nt-split--wide">
        <div class="n-quad" id="quad-wrap">
          <span class="n-seal n-quad__seal" id="quad-seal" ${NT.raw(isFrozen ? 'style="opacity:1"' : '')}>冻<br>结</span>
          <div class="n-quad__frame">
            <div class="n-quad__y">潜力 →</div>
            <div class="n-quad__plane" id="quad" ${NT.raw(isFrozen ? 'data-frozen="true"' : '')}>
              <div class="n-quad__cell" data-q="hl">高潜待练</div><div class="n-quad__cell" data-q="hh">双高</div>
              <div class="n-quad__cell" data-q="ll">待观察</div><div class="n-quad__cell" data-q="lh">专业骨干</div>
              <span class="n-quad__axis n-quad__axis--h" aria-hidden="true"></span><span class="n-quad__axis n-quad__axis--v" aria-hidden="true"></span>
              <svg class="n-quad__trail" id="quad-trail" aria-hidden="true"></svg>
            </div>
            <div class="n-quad__x">专业度（对标当前职级）→</div>
          </div>
          <div class="n-quad__foot">
            <span id="quad-ip"></span>
            <div class="n-quad__say ${isFrozen ? 'is-ink' : ''}" id="quad-say" aria-live="polite"><span id="quad-say-text">${isFrozen ? NT.raw(frozenText(sn)) : `正在根据 ${nScores} 条已确认的维度分计算参考位置……`}</span>
              <textarea id="quad-reason" hidden placeholder="写一句理由" aria-label="和参考位置不同的理由"></textarea></div>
            ${na.length ? html`<div class="n-quad__wait"><b>还在等材料 · ${na.length} 人</b>${na.map((x) => html`<a class="nt-plink" href="person.html?id=${x.pid}"><span class="chip">${UI.avatar(x.pid, 'sm')}${st.person(x.pid).name} <small>${x.miss}</small></span></a>`)}</div>` : ''}
            ${conflicts.length && !isFrozen ? html`<div class="n-quad__wait" style="border-top:0;margin-top:0"><b>证据冲突 · ${conflicts.length} 人</b>${conflicts.map((pid) => html`<a class="n-badge n-badge--conflict" href="queue.html">${icon('split')}${st.person(pid).name} · 先在校准队列处理</a>`)}</div>` : ''}
          </div>
        </div>
        <aside class="nt-grid nt-sticky">
          <div class="n-card" id="panel"></div>
          <div class="n-card">
            ${isFrozen ? html`<p class="nt-muted" style="margin:0">${NT.md(sn.at)} 由${st.person(sn.by).name}确认冻结。之后有新证据时，只提示「可能需要重新校准」，不会挪动位置。</p>`
              : html`<div class="nt-row"><button class="n-btn n-btn--ink" type="button" id="quad-confirm" ${NT.raw(canConfirm ? '' : 'disabled')}>${icon('stamp')}确认并冻结${isLanding ? '' : `「${st.orgShort(team)}」`}</button><button class="n-btn n-btn--ghost" type="button" id="quad-reset">${icon('retry')}重新给出参考位置</button></div>
              ${!canConfirm ? html`<div class="n-notice is-deny" style="margin-top:var(--s-3)">${icon('lock')}<div><b>部门负责人可以参与校准、提出调整。</b>由 HRBP 或 CEO 确认冻结，你的拖动和理由会作为建议交给苏晚。</div></div>` : ''}
              <p class="nt-caption">选中头像后可以用方向键移动，点头像查看维度分和证据。</p>`}
          </div>
        </aside>
      </div>`);
    const plane = $('#quad');
    people.forEach((x) => {
      x.light = document.createElement('span'); x.light.className = `n-quad__light${isFrozen ? ' is-gone' : ''}`;
      x.dot = document.createElement('button'); x.dot.type = 'button'; x.dot.className = `n-quad__dot${isFrozen ? ' is-confirmed' : ''}`;
      x.dot.dataset.bonus = !!x.bonus; x.dot.dataset.pid = x.pid;
      x.dot.innerHTML = String(UI.avatar(x.pid));
      x.dot.title = x.p.name;
      plane.append(x.light, x.dot);
      place(x); if (!isFrozen) drag(x);
      x.dot.addEventListener('click', () => select(x));
    });
    NT.ip($('#quad-ip'), isFrozen ? 'done' : 'rest', 48);
    $('#teams')?.addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (!t || t.dataset.t === team) return; team = t.dataset.t; history.replaceState(null, '', NT.link('calibrate.html', { id, team })); render(main); });
    $('#quad-reason')?.addEventListener('input', (e) => { if (!asking) return; asking.reason = e.target.value; keep(asking); NT.ipState($('#quad-ip'), e.target.value.trim() ? 'listening' : 'confirm'); });
    $('#quad-reset')?.addEventListener('click', () => intro());
    $('#quad-confirm')?.addEventListener('click', confirmTeam);
    window.onresize = drawTrails;
    select(people.find((x) => x.pid === NT.param('person')) || people.find((x) => x.prevQ && x.prevQ !== x.refQ) || people[0]);
    if (!isFrozen) intro(); else drawTrails();
  }

  function frozenText(sn) {
    const moved = people.filter((x) => x.reason).map((x) => `${x.p.name}（${NT.esc(x.reason)}）`);
    return `已冻结快照 · <span class="ink-hand">${NT.esc(st.person(sn.by).name)}</span> · ${NT.md(sn.at)}。${moved.length ? `调整：${moved.join('；')}。` : ''}之后有新证据时，我只提示可能需要重新校准，不会挪动位置。`;
  }

  function place(x) {
    x.light.style.left = `${x.ref[0] * 100}%`; x.light.style.top = `${x.ref[1] * 100}%`;
    x.dot.style.left = `${x.pos[0] * 100}%`; x.dot.style.top = `${x.pos[1] * 100}%`;
    x.dot.setAttribute('aria-label', `${x.p.name}，在${QN[qOf(x.pos)]}；参考位置是${QN[x.refQ]}`);
    drawTrails();
  }
  function drawTrails() {
    const plane = $('#quad'), trail = $('#quad-trail'); if (!plane || !trail) return;
    const w = plane.clientWidth, h = plane.clientHeight;
    const moved = people.filter((x) => x.dot && Math.hypot(x.pos[0] - x.ref[0], x.pos[1] - x.ref[1]) > 0.03 && !plane.dataset.frozen);
    trail.innerHTML = `<defs>${moved.map((x, i) => { const [x1, y1, x2, y2] = [x.ref[0] * w, x.ref[1] * h, x.pos[0] * w, x.pos[1] * h]; return `<linearGradient id="qt${i}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="#8fa0ff" stop-opacity=".7"/><stop offset=".45" stop-color="#6fd6e2" stop-opacity=".6"/><stop offset="1" stop-color="#1b1e25" stop-opacity=".75"/></linearGradient>`; }).join('')}</defs>${moved.map((x, i) => {
      const [x1, y1, x2, y2] = [x.ref[0] * w, x.ref[1] * h, x.pos[0] * w, x.pos[1] * h];
      const mx = (x1 + x2) / 2 - (y2 - y1) * 0.18, my = (y1 + y2) / 2 + (x2 - x1) * 0.18;
      return `<path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" stroke="url(#qt${i})"/>`;
    }).join('')}`;
  }
  function target(q) { $$('.n-quad__cell').forEach((c) => c.classList.toggle('is-target', c.dataset.q === q)); }
  function drag(x) {
    const plane = $('#quad');
    let rect, moved = false;
    x.dot.addEventListener('pointerdown', (e) => {
      if (plane.dataset.frozen) return;
      rect = plane.getBoundingClientRect(); moved = false;
      x.dot.setPointerCapture(e.pointerId); x.dot.classList.add('is-dragging');
    });
    x.dot.addEventListener('pointermove', (e) => {
      if (!x.dot.classList.contains('is-dragging')) return;
      moved = true;
      x.pos = [clamp((e.clientX - rect.left) / rect.width), clamp((e.clientY - rect.top) / rect.height)];
      place(x); target(qOf(x.pos));
    });
    const end = () => { if (!x.dot.classList.contains('is-dragging')) return; x.dot.classList.remove('is-dragging'); target(null); if (moved) { select(x); settle(x); } };
    x.dot.addEventListener('pointerup', end); x.dot.addEventListener('pointercancel', end);
    x.dot.addEventListener('keydown', (e) => {
      const k = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[e.key];
      if (!k || plane.dataset.frozen) return;
      e.preventDefault();
      x.pos = [clamp(x.pos[0] + k[0]), clamp(x.pos[1] + k[1])];
      place(x); select(x); settle(x);
    });
  }
  const pending = () => people.filter((x) => qOf(x.pos) !== x.refQ && !x.reason.trim());
  function ask(x) {
    asking = x;
    NT.ipState($('#quad-ip'), 'confirm');
    $('#quad-say-text').textContent = `你把${x.p.name}从「${QN[x.refQ]}」放到了「${QN[qOf(x.pos)]}」，和我给的参考不同。为什么？`;
    const r = $('#quad-reason'); r.hidden = false; r.value = x.reason; r.focus({ preventScroll: true });
  }
  // 不能确认的人（部门负责人）每次调整都存成建议，离开页面也不丢
  function keep(x) { if (!st.can('quadConfirm')) st.suggestCalib(id, team, x.pid, { pos: x.pos.slice(), reason: x.reason }); }
  function settle(x) {
    keep(x);
    if (qOf(x.pos) !== x.refQ) { ask(x); return; }
    if (asking === x) { asking = null; $('#quad-reason').hidden = true; }
    const next = pending()[0];
    if (next) { ask(next); return; }
    NT.ipState($('#quad-ip'), 'rest');
    sayIdle();
  }
  function sayIdle() {
    const n = people.filter((x) => Math.hypot(x.pos[0] - x.ref[0], x.pos[1] - x.ref[1]) > 0.03).length;
    const shift = people.filter((x) => x.prevQ && x.prevQ !== x.refQ);
    const sg = st.can('quadConfirm') ? people.filter((x) => x.sug).length : 0;
    $('#quad-say-text').textContent = sg && !n ? `部门负责人对 ${sg} 人提了建议，点头像查看，可以按建议放。` : n ? `已调整 ${n} 人的位置。确认后冻结。`
      : `参考位置已给出。把头像拖到你判断的位置，同意参考位置的人保持原位。${shift.length ? `${shift.map((x) => `${x.p.name}的参考位置移出了上次的正式位置（${QN[x.prevQ]}）`).join('；')}，请你判断。` : ''}`;
  }

  async function intro() {
    const plane = $('#quad');
    delete plane.dataset.frozen;
    $('#quad-say').classList.remove('is-ink'); $('#quad-reason').hidden = true; asking = null;
    const mine = (x) => !st.can('quadConfirm') && x.sug?.by === st.me().id;
    people.forEach((x) => { x.pos = mine(x) ? x.sug.pos.slice() : x.ref.slice(); x.reason = mine(x) ? x.sug.reason : ''; x.light.classList.remove('is-gone'); x.dot.classList.remove('is-confirmed'); x.light.style.opacity = 0; x.dot.style.opacity = 0; place(x); });
    NT.ipState($('#quad-ip'), 'searching');
    await NT.wait(900);
    const pr = plane.getBoundingClientRect(), ir = $('#quad-ip').getBoundingClientRect();
    const ix = ir.left + ir.width / 2 - pr.left, iy = ir.top + ir.height / 3 - pr.top;
    people.forEach((x, i) => {
      const fx = x.ref[0] * pr.width, fy = x.ref[1] * pr.height, dx = ix - fx, dy = iy - fy;
      x.light.style.opacity = '';
      x.light.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0 }, { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(.9)`, opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }],
        { duration: NT.reduced ? 1 : 720, delay: NT.reduced ? 0 : i * 140, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      x.dot.style.opacity = '';
      x.dot.animate([{ opacity: 0, transform: 'scale(1.6)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: NT.reduced ? 1 : 520, delay: NT.reduced ? 0 : i * 140 + 640, easing: 'cubic-bezier(.7,0,.15,1)', fill: 'backwards' });
    });
    await NT.wait(people.length * 140 + 1200);
    NT.ipState($('#quad-ip'), 'rest');
    sayIdle();
  }

  function select(x) {
    if (!x) { mount($('#panel'), html`<p class="nt-muted" style="margin:0">满足落位门槛的人会出现在象限里。</p>`); return; }
    selected = x;
    people.forEach((o) => o.dot.classList.toggle('is-selected', o === x));
    const r = x.r;
    const line = (label, m, n, extra) => html`<div class="n-score" data-state="confirmed"><span class="n-score__dim">${label}</span>${UI.dots(m == null ? null : Math.round(m))}<span class="n-score__note">${m == null ? '资料不足' : `均值 ${m.toFixed(1)} · ${n} 条`}${extra || ''}</span></div>`;
    const core = ['mot', 'wis', 'grit'].map((d) => r.dims[d]);
    const coreN = core.reduce((a, d) => a + d.n, 0);
    mount($('#panel'), html`
      <div style="margin-bottom:var(--s-3)">${UI.person(x.pid, { size: 'lg', meta: `${st.orgPath(x.p.org)} · ${x.p.level}${x.p.landing ? ' · Landing 第三期' : ''}` })}</div>
      ${line('专业度', r.dims.prof.m, r.dims.prof.n)}
      ${line('潜力核心', r.py, coreN)}
      ${core.map((d, i) => html`<div class="nt-muted" style="margin-left:calc(5.5em + var(--s-3))">${st.dim(['mot', 'wis', 'grit'][i]).name} ${d.m == null ? '资料不足' : `${d.m.toFixed(1)}（${d.n} 条）`}</div>`)}
      ${['lead', 'open'].map((d) => r.dims[d].m != null && r.dims[d].m >= 4 ? line(st.dim(d).name, r.dims[d].m, r.dims[d].n, ' · 加分项 ≥ 4') : '')}
      <dl class="nt-dl" style="margin-top:var(--s-3)"><dt>参考位置</dt><dd>${QN[x.refQ]}</dd><dt>你放在</dt><dd>${QN[qOf(x.pos)]}${x.reason ? html` · <span class="ink-hand">${x.reason}</span>` : ''}</dd>${x.prevQ ? html`<dt>上次正式</dt><dd>${QN[x.prevQ]} · ${x.prevLabel}${x.prevQ !== x.refQ ? html` <span class="n-badge n-badge--recal">可能需要重新校准</span>` : ''}</dd>` : ''}</dl>
      ${x.sug && st.can('quadConfirm') && !frozen() ? html`<div class="n-notice" style="margin-top:var(--s-3)">${icon('pen')}<div><b>${st.person(x.sug.by).name}建议放在「${QN[qOf(x.sug.pos)]}」</b>${x.sug.reason ? `：${x.sug.reason}` : ''}<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" id="use-sug">按建议放</button></div></div></div>` : ''}
      <div class="nt-row" style="margin-top:var(--s-3)"><a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${x.pid}#spectrum">看能力谱和证据</a></div>`);
    $('#use-sug')?.addEventListener('click', () => {
      x.pos = x.sug.pos.slice();
      x.reason = x.sug.reason ? `${x.sug.reason}（采纳${st.person(x.sug.by).name}的建议）` : '';
      place(x); select(x); settle(x);
    });
  }

  async function confirmTeam() {
    const next = pending()[0];
    if (next) { ask(next); NT.toast('还有和参考不同的位置没写理由'); return; }
    const v = await NT.dialog({
      title: `确认并冻结${isLanding ? '结营校准' : `「${st.orgShort(team)}」的校准`}？`,
      body: html`<p>冻结为快照：当时的位置、维度分、证据和规则版本都保存下来，成为每个人${isLanding ? '的第一份' : '这一期的'}档案版本。</p>`,
      facts: [html`${people.length} 人落位 · ${people.filter((x) => x.reason).length} 人和参考不同`, html`规则版本 rubric-v1 · 证据截止 ${NT.md(NT.TODAY)}`],
      actions: [{ label: '再看看', value: 'cancel', cls: 'n-btn--ghost' }, { label: '确认并冻结', value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }],
    });
    if (v !== 'ok') return;
    const S = st.get();
    let sn = snap();
    if (!sn) { sn = { id: `s-${id}`, batch: id, label: LABEL, org: b.org, cutoff: NT.TODAY, at: NT.TODAY, by: st.me().id, entries: {}, teams: [] }; S.snaps.push(sn); }
    people.forEach((x) => { sn.entries[x.pid] = { q: qOf(x.pos), x: x.pos[0], y: x.pos[1], ref: x.refQ, na: false, miss: '', reason: x.reason.trim(), dims: x.r.dims, n: x.r.n, py: x.r.py, bonus: !!x.bonus, org: x.p.org }; });
    members().filter((pid) => !people.some((x) => x.pid === pid)).forEach((pid) => { const r = st.refPos(pid); sn.entries[pid] = { q: null, na: true, miss: r.miss, dims: r.dims, n: r.n, org: st.person(pid).org }; });
    sn.teams = [...new Set([...(sn.teams || []), team])];
    sn.at = NT.TODAY; sn.by = st.me().id;
    st.save();
    // 冻结动效：光点消散、拖痕褪去、压印
    const plane = $('#quad'); plane.dataset.frozen = 'true';
    $('#quad-reason').hidden = true;
    people.forEach((x) => { x.light.classList.add('is-gone'); x.dot.classList.add('is-confirmed'); x.dot.classList.remove('is-selected'); });
    $$('#quad-trail path').forEach((t) => { t.style.opacity = 0; });
    const seal = $('#quad-seal'); seal.style.opacity = 1; seal.classList.remove('is-stamping'); void seal.offsetWidth; seal.classList.add('is-stamping');
    NT.ipState($('#quad-ip'), 'done');
    $('#quad-say').classList.add('is-ink');
    $('#quad-say-text').innerHTML = frozenText(sn);
    NT.toast(`已冻结${isLanding ? '结营校准' : `「${st.orgShort(team)}」`}，档案版本随之生成`);
    setTimeout(() => render($('#main')), NT.reduced ? 0 : 1400);
  }
})();
