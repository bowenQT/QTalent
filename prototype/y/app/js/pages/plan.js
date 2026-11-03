/* 组织调整方案：每条动作写清依据、缺口、本人意愿、可否释放和对两边团队的影响；意愿和释放未知时写「未知」。
   HR 和管理者都能修改和确认；确认后存档（压印）并锁定，之后的调整在下一次盘点里做。确认方案不等于人事动作已执行。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const bid = NT.param('id') || 'b-xe6-end';
  const TYPES = ['落位', '留用', '继续观察', '未接受', '调岗', '负责人安排', '激活'];

  NT.shell({
    nav: 'review', title: '留用与落位方案', crumbs: [['盘点', 'reviews.html'], [st.batch(bid)?.name || '', `review.html?id=${bid}`]],
    allow: (r) => st.canBatch(st.batch(bid), r),
    view: () => { const p = cur(); return `调整方案 v${p?.version} · ${p?.status === 'confirmed' ? '已确认' : '草稿'}`; },
    render,
  });

  const plans = () => st.get().plans.filter((p) => p.kind === 'org' && p.batch === bid).sort((a, b) => a.version - b.version);
  const cur = () => plans()[plans().length - 1];
  const confirmed = () => plans().filter((p) => p.status === 'confirmed').pop();
  const typeLabel = (m) => (m.type === '未接受' ? '未接受 offer' : m.type);

  function render(main) {
    const b = st.batch(bid);
    let p = cur();
    const S = st.get();
    if (!p) { p = { id: NT.uid('op'), kind: 'org', batch: bid, version: 1, status: 'draft', by: st.me().id, at: NT.TODAY, moves: [] }; S.plans.push(p); st.save(); }
    const conf = confirmed();
    const draft = p.status === 'draft';
    // HR 和管理者都能修改和确认；确认后方案和这次盘点一起锁定
    const canEdit = st.can('confirmPlan') && draft && b.status !== 'confirmed';
    const T = p.title || '组织调整方案';
    const hiddenN = p.moves.filter((m) => !st.canSeeMove(m)).length;
    mount(main, html`
      <header class="nt-head"><div><h1>${T}</h1><p>${b.name}。每条动作都能回到依据，确认后生成跟进行动。</p></div>
        <div class="nt-head__acts">${canEdit ? html`<button class="n-btn n-btn--sm" type="button" id="add">${icon('plus')}加一条动作</button>` : ''}</div></header>
      <div class="nt-split">
        <article class="n-card" id="doc" style="position:relative">
          ${!draft ? html`<span class="n-seal" style="position:absolute;right:22px;top:18px" id="seal">定</span>` : ''}
          ${hiddenN ? html`<p class="nt-muted" style="margin:0 0 var(--s-3)">另有 ${hiddenN} 条动作涉及你范围以外的人，已隐藏。</p>` : ''}
          ${p.moves.length ? html`<div class="n-movebar"><div class="n-chips" role="group" aria-label="按类型筛选" id="mvf"></div>
            <input class="n-input n-movebar__q" type="search" placeholder="按姓名或部门筛选" aria-label="按姓名或部门筛选" id="mvq" value="${fq}"></div>
            <div id="moves" aria-live="polite"></div>` : html`<div class="nt-empty">还没有动作。从盘点清单和象限校准的结论出发，加第一条。</div>`}
        </article>
        <aside class="nt-grid nt-sticky">
          <article class="n-card"><h3 class="n-section-title">版本</h3>
            ${plans().slice().reverse().map((x) => html`<div class="n-version" style="margin-bottom:6px"><span class="n-version__tag ${x.status === 'draft' ? 'is-draft' : x.status === 'confirmed' ? 'is-frozen' : ''}">${x.status === 'draft' ? '草稿' : x.status === 'confirmed' ? '已确认' : '已被替代'} v${x.version}</span><span style="color:var(--ink-3)">${st.person(x.confirmedBy || x.by).name} · ${NT.md(x.confirmedAt || x.at)}${x.status === 'confirmed' ? ' · 已存档' : ''}</span>${x.status === 'confirmed' ? html`<span class="n-seal n-seal--sm" style="margin-left:auto">定</span>` : ''}</div>`)}
            ${canEdit ? html`<div class="nt-row" style="margin-top:var(--s-4)"><button class="n-btn n-btn--ink" type="button" id="confirm">${icon('stamp')}确认 v${p.version}</button></div>
              <p class="nt-caption">确认后存档并生成行动，这次盘点也一起确认；之后的调整在下一次盘点里做。</p>` : html`<div class="n-notice is-plain" style="margin-top:var(--s-4)">${icon('lock')}<div>${conf ? `v${conf.version} 已确认，方案不能再修改；之后的调整在下一次盘点里做。` : '方案由 HR 和管理者修改和确认，你在这里查看。'}</div></div>`}
          </article>
          <article class="n-card"><h3 class="n-section-title" style="font-size:var(--t-sm)">写方案时的规则</h3>
            <ul class="nt-list" style="font-size:var(--t-sm);color:var(--ink-2)">
              <li>本人意愿、可否释放待了解时写「未知」。</li><li>资料不足的人放「继续观察」，写清下次补什么、谁负责。</li><li>动作来自「值得聊一聊」的，标为「激活」。</li></ul></article>
        </aside>
      </div>`);
    editable = canEdit;
    if (p.moves.length) drawMoves(p);
    wire(main, p);
  }

  // 列表按类型分组，类型筛选和姓名 / 部门筛选只影响显示，不改方案
  let ftype = 'all', fq = '', editable = false;
  const groupOf = (m) => (m.kind === '激活' ? '激活' : m.type);
  const GROUPS = ['负责人安排', '调岗', '激活', '落位', '留用', '继续观察', '未接受'];
  const groupLabel = (g) => (g === '未接受' ? '未接受 offer' : g);
  function drawMoves(p) {
    const seen = p.moves.map((m, i) => [m, i]).filter(([m]) => st.canSeeMove(m));
    const q = fq.trim().toLowerCase();
    const hit = (m) => !q || [m.person && st.person(m.person).name, m.from, m.to].some((t) => (t || '').toLowerCase().includes(q));
    const byQ = seen.filter(([m]) => hit(m));
    const groups = GROUPS.filter((g) => seen.some(([m]) => groupOf(m) === g));
    if (ftype !== 'all' && !groups.includes(ftype)) ftype = 'all';
    const n = (g) => byQ.filter(([m]) => g === 'all' || groupOf(m) === g).length;
    mount($('#mvf'), html`${['all', ...groups].map((g) => html`<button class="n-chip" type="button" data-g="${g}" aria-pressed="${g === ftype}">${g === 'all' ? '全部' : groupLabel(g)} <b>${n(g)}</b></button>`)}`);
    const shown = groups.filter((g) => ftype === 'all' || g === ftype).map((g) => [g, byQ.filter(([m]) => groupOf(m) === g)]).filter(([, l]) => l.length);
    mount($('#moves'), shown.length
      ? html`${shown.map(([g, l]) => html`<section class="n-movegrp"><h3 class="n-movegrp__title">${groupLabel(g)}<span class="n-count is-quiet">${l.length}</span></h3>${l.map(([m, i]) => move(m, i, editable))}</section>`)}`
      : html`<div class="nt-empty">没有符合条件的动作。<button class="n-link" type="button" id="mvclear">清除筛选</button></div>`);
    NT.$$('[data-menu]', $('#moves')).forEach((btn) => {
      const i = +btn.dataset.menu;
      NT.menu(btn, [{ label: '修改', icon: 'pen', run: () => editMove(p, i) }, { label: '删去这条', icon: 'trash', danger: true, run: () => {
        const [rm] = p.moves.splice(i, 1); st.save(); render($('#main'));
        NT.toast('已删去这条动作', { undo: () => { p.moves.splice(i, 0, rm); st.save(); render($('#main')); } });
      } }]);
    });
  }

  // 本人意愿是落位能否推进的关键，放在每条动作的第一行
  function willBadge(will) {
    const w = (will || '未知').replace(/^已沟通 · /, '');
    const cls = /未接受|拒绝/.test(w) ? 'n-badge--conflict' : /未知|待/.test(w) ? 'n-badge--unknown' : 'n-badge--yes';
    return html`<span class="n-badge ${cls}">${/未知|待/.test(w) ? `本人意愿${w === '未知' ? '未知' : `：${w}`}` : `本人${w}`}</span>`;
  }
  // 依据按「；」分段，「键：值」的段落把键弱化，方便扫读
  function basisLine(t) {
    const segs = (t || '—').split('；');
    return segs.map((x, k) => { const c = x.indexOf('：'); return html`${k ? html`<span class="n-move__sep" aria-hidden="true">·</span>` : ''}${c > 0 ? html`<span class="n-move__k">${x.slice(0, c)}</span>${x.slice(c + 1)}` : x}`; });
  }
  const withNote = (m) => [m.basis, m.note && `补充说明：${m.note}`].filter(Boolean).join('；');
  const metaItem = (k, v) => html`<span>${k}<b style="${/未知/.test(v) ? 'color:var(--unknown)' : ''}">${v}</b></span>`;

  function move(m, i, editable) {
    const who = m.person ? st.person(m.person) : null;
    const pendingLink = m.pending ? (st.project(m.pending) ? `staffing.html?project=${m.pending}` : NT.link('staffing.html', { new: 1, q: '新转化团队要找一个能带 SDR 和 SMB 的 owner，11 月到岗' })) : null;
    const name = who ? html`<b class="n-move__who">${UI.plink(m.person)}</b>` : html`<span class="n-badge n-badge--unknown">${icon('dash')}人选待定</span>`;
    const path = html`<span class="n-move__path">${m.from ? html`${m.from}${icon('chev')}` : ''}<b>${m.to}</b></span>`;
    if (m.type === '继续观察') {
      return html`<div class="n-move" data-i="${i}"><div class="n-move__head">${name}${path}<span class="n-move__end">${m.will ? willBadge(m.will) : ''}${editable ? menu(i) : ''}</span></div>
        <p class="n-move__basis">${basisLine(withNote(m))}</p>
        <div class="n-move__meta">${metaItem('下次补什么', m.next || '—')}${metaItem('负责人', `${st.person(m.owner)?.name || ''} · ${NT.md(m.due)} 前`)}</div></div>`;
    }
    const meta = [m.gap && m.gap !== '—' && metaItem('缺口', m.gap), m.impact && m.impact !== '不涉及' && metaItem('影响', m.impact), metaItem('可否释放', m.release || '未知')].filter(Boolean);
    return html`<div class="n-move" data-i="${i}"><div class="n-move__head">${name}${path}${m.kind === '激活' && ftype !== '激活' ? html`<span class="n-kind">激活 · ${m.type}</span>` : ''}<span class="n-move__end">${willBadge(m.will)}${editable ? menu(i) : ''}</span></div>
      ${!who && pendingLink ? html`<div class="n-ownerless" style="margin-top:var(--s-3)"><span class="n-slot__empty">${icon('plus', 14)}</span><div><b>人选来自项目用人方案</b><div class="nt-muted">项目用人方案确认后，这里自动填上人</div></div><a class="n-btn n-btn--sm n-btn--light" href="${pendingLink}">${icon('spark')}去找 owner</a></div>` : ''}
      <p class="n-move__basis">${basisLine(withNote(m))}${m.ev ? UI.cite(st.event(m.ev)?.srcs[0], 1) : ''}</p>
      <div class="n-move__meta">${meta}</div></div>`;
  }
  const menu = (i) => html`<span class="n-menuwrap"><button class="n-btn n-btn--sm n-btn--ghost n-btn--icon" type="button" data-menu="${i}" aria-label="更多">${icon('more')}</button></span>`;

  // 选人后由系统带出原团队、依据、本人意愿和影响；人只做选择，补充说明和缺口才需要手写
  const student = (pid) => NT.XE6.students.find((x) => x.id === pid);
  const WILLS = [['已沟通 · 接受', '接受'], ['已沟通 · 未接受', '未接受'], ['待沟通', '待沟通'], ['未知', '未知']];
  function derive(pid, type, to) {
    const x = pid && student(pid), per = pid && st.person(pid);
    const from = x ? NT.XE6.teams.find((t) => t.id === x.team)?.name || '' : per ? st.orgShort(per.org) : '';
    const basis = x ? `${x.final}；导师结营建议：${x.adv8 === x.final ? '一致' : x.adv8 || '—'}${x.posFinal || x.posMentor ? `；岗位建议：${x.posFinal || x.posMentor}` : ''}` : '';
    const will = x ? (x.accept === '接受' ? WILLS[0][0] : x.accept === '拒绝' ? WILLS[1][0] : '待沟通') : '';
    const role = x ? x.track.replace('方向', '') : per ? per.title : '人';
    const impact = type === '未接受' || type === '继续观察' ? '不涉及' : !to || to === '部门待定' ? '待和用人部门确认'
      : `${to} 增加 1 名${role}${from && type !== '留用' && type !== '落位' ? `；${from} 少 1 人` : ''}`;
    return { from, basis, will, releases: x ? ['训练营已结束', '未知'] : ['可以释放', '需要交接', '未知'], impact };
  }

  async function editMove(p, i) {
    const m = i == null ? { type: '调岗', person: '', to: '', note: '', gap: '', will: '未知', release: '未知' } : p.moves[i];
    const people = st.visiblePeople().filter((x) => st.scope(x.id) === 'full');
    const dests = [...new Set(['部门待定', ...p.moves.map((x) => x.to).filter((t) => t && !/待沟通|继续/.test(t)), ...st.orgs().filter((o) => !o.group).map((o) => o.name)])];
    const curType = m.kind === '激活' ? '激活' : m.type;
    const seg = (k, opts, v) => html`<div class="n-seg n-seg--md" role="group" data-manual data-seg="${k}">${opts.map(([val, l]) => html`<button type="button" data-v="${val}" aria-pressed="${val === v}">${l}</button>`)}</div><input type="hidden" data-k="${k}" value="${v}">`;
    const r = await NT.dialog({
      title: i == null ? '加一条动作' : '修改这条动作',
      cls: 'n-dialog--wide',
      body: html`<div class="nt-grid n-mvform" style="gap:var(--s-4)">
        <div class="n-field"><span class="n-field__label">类型</span>${seg('type', TYPES.map((t) => [t, t === '未接受' ? '未接受 offer' : t]), curType)}</div>
        <div class="nt-cols" style="gap:var(--s-3)">
          <label class="n-field"><span class="n-field__label">谁</span><select class="n-select" data-k="person"><option value="">人选待定</option>${people.map((x) => html`<option value="${x.id}" ${x.id === m.person ? 'selected' : ''}>${x.name} · ${st.orgShort(x.org)}</option>`)}</select></label>
          <label class="n-field" data-for="to"><span class="n-field__label">去向</span><select class="n-select" data-k="to">${dests.map((t) => html`<option ${t === m.to ? 'selected' : ''}>${t}</option>`)}${m.to && !dests.includes(m.to) ? html`<option selected>${m.to}</option>` : ''}</select></label></div>
        <div class="n-mvform__auto" id="mv-auto" aria-live="polite"></div>
        <div class="nt-cols" style="gap:var(--s-3)">
          <div class="n-field"><span class="n-field__label">本人意愿</span><div id="mv-will"></div></div>
          <div class="n-field"><span class="n-field__label">可否释放</span><div id="mv-rel"></div></div></div>
        <div id="mv-watch"></div>
        <label class="n-field"><span class="n-field__label">补充说明 <small class="nt-muted">选填</small></span><input class="n-input" data-k="note" value="${m.note || ''}" placeholder="系统依据之外，还有什么需要写进方案的事实"></label>
        <label class="n-field" id="mv-gapf"><span class="n-field__label">缺口 <small class="nt-muted">选填</small></span><input class="n-input" data-k="gap" value="${m.gap || ''}" placeholder="还缺什么证据，比如本人意愿还没确认"></label>
        <p class="n-field__err" id="mv-err" role="alert" hidden>请选一个人，或者把类型改成需要找人的动作后选「人选待定」。</p></div>`,
      onOpen: (d) => {
        const val = (k) => d.querySelector(`[data-k="${k}"]`).value;
        const setSeg = (k, v) => { d.querySelector(`[data-k="${k}"]`).value = v; NT.$$(`[data-seg="${k}"] > button`, d).forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v)); };
        let will = m.will || '未知', release = m.release || '未知', touched = { will: i != null, release: i != null };
        const draw = () => {
          const type = val('type'), pid = val('person'), x = derive(pid, type, val('to'));
          if (!touched.will && x.will) will = x.will;
          if (!x.releases.includes(release)) release = x.releases[0];
          d.querySelector('[data-for="to"]').hidden = type === '继续观察';
          mount(d.querySelector('#mv-auto'), html`<span class="n-mvform__tag">${icon('spark', 13)}系统带出</span>
            <dl><div><dt>原团队</dt><dd>${x.from || '—'}</dd></div>
            <div><dt>依据</dt><dd>${x.basis ? basisLine(x.basis) : html`<span class="nt-muted">${pid ? '这个人还没有可引用的结营或盘点结论，请在补充说明里写依据' : '选人后带出'}</span>`}</dd></div>
            <div><dt>影响</dt><dd>${x.impact}</dd></div></dl>`);
          mount(d.querySelector('#mv-will'), seg('will', WILLS, will));
          mount(d.querySelector('#mv-rel'), seg('release', x.releases.map((t) => [t, t]), release));
          mount(d.querySelector('#mv-watch'), type === '继续观察' ? html`<div class="nt-cols" style="gap:var(--s-3)">
            <label class="n-field"><span class="n-field__label">下次补什么</span><input class="n-input" data-k="next" value="${m.next || '实习满 8 周后再评一次'}"></label>
            <label class="n-field"><span class="n-field__label">${st.me().name}负责，截止</span><input class="n-input" type="date" data-k="due" value="${m.due || NT.addDays(NT.TODAY, 30)}"></label></div>` : '');
        };
        d.addEventListener('click', (e) => {
          const b = e.target.closest('[data-seg] > button'); if (!b) return;
          const k = b.closest('[data-seg]').dataset.seg;
          setSeg(k, b.dataset.v);
          if (k === 'will') { will = b.dataset.v; touched.will = true; } else if (k === 'release') { release = b.dataset.v; touched.release = true; } else draw();
        });
        d.querySelector('[data-k="person"]').addEventListener('change', () => { touched.will = false; draw(); });
        d.querySelector('[data-k="to"]').addEventListener('change', draw);
        draw();
      },
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink',
        validate: (d) => {
          const who = d.querySelector('[data-k="person"]'), type = d.querySelector('[data-k="type"]').value;
          const ok = !!who.value || !['落位', '留用', '继续观察', '未接受', '激活'].includes(type);
          d.querySelector('#mv-err').hidden = ok;
          if (!ok) who.focus();
          return ok;
        },
        read: (d) => Object.fromEntries(NT.$$('[data-k]', d).map((x) => [x.dataset.k, x.value.trim()])) }],
    });
    if (r?.value !== 'ok') return;
    const d = r.data, x = derive(d.person, d.type, d.to);
    const next = { ...m, ...d, person: d.person || null, from: x.from || m.from || '', basis: x.basis || m.basis || '', impact: x.impact,
      kind: d.type === '激活' ? '激活' : undefined, type: d.type === '激活' ? '调岗' : d.type };
    if (next.type === '继续观察') Object.assign(next, { to: m.to && /观察/.test(m.to) ? m.to : '继续观察', owner: st.me().id });
    if (i == null) p.moves.push(next); else p.moves[i] = next;
    st.save(); render($('#main'));
    NT.toast(i == null ? '已加入方案草稿' : '已修改');
  }

  function wire(main, p) {
    $('#add')?.addEventListener('click', () => editMove(p, null));
    const redraw = () => drawMoves(p);
    $('#mvf')?.addEventListener('click', (e) => { const c = e.target.closest('[data-g]'); if (!c) return; ftype = c.dataset.g; redraw(); });
    $('#mvq')?.addEventListener('input', (e) => { fq = e.target.value; redraw(); });
    $('#moves')?.addEventListener('click', (e) => { if (!e.target.closest('#mvclear')) return; ftype = 'all'; fq = ''; $('#mvq').value = ''; redraw(); });
    $('#confirm')?.addEventListener('click', () => confirm(p));
  }

  async function confirm(p) {
    const pending = p.moves.filter((m) => !m.person && m.type !== '继续观察');
    // 范围内还没有校准快照的人，确认时按参考位置冻结，记为未校准
    const b = st.batch(bid), sn = st.get().snaps.find((x) => x.batch === bid);
    const uncal = st.people().filter((x) => !x.noReview && st.inOrg(x.org, b.org) && !sn?.entries[x.id]).length;
    const v = await NT.dialog({
      title: `确认${p.title || '组织调整方案'} v${p.version}？`,
      body: html`<p>确认后存档，每条动作生成一条跟进行动。</p>`,
      facts: [uncal ? html`${uncal} 人待校准，确认时按参考位置记为「未校准」` : html`范围内的人都已有校准结果`, html`${p.moves.length} 条动作：${p.moves.slice(0, 6).map((m) => `${m.kind || typeLabel(m)}${m.person ? ` · ${st.person(m.person).name}` : ''}`).join('、')}${p.moves.length > 6 ? ' 等' : ''}`, pending.length ? html`<span style="color:var(--conflict)">${pending.length} 条人选待定，确认后在行动里继续跟进</span>` : html`意愿或释放为「未知」的，行动会先从沟通开始`],
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: `确认并存档 v${p.version}`, value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }],
    });
    if (v !== 'ok') return;
    const created = st.confirmOrg(p);
    if (created == null) { render($('#main')); NT.toast('方案或盘点状态已变化，无法重复确认，请刷新核对'); return; }
    render($('#main'));
    const seal = $('#seal'); seal?.classList.add('is-stamping');
    $('#doc')?.classList.add('is-settling');
    NT.toast(`已确认 v${p.version} 并存档${created ? `，新增 ${created} 条行动` : ''}，在「人才项目」的关键节点复盘里跟进`);
  }
})();
