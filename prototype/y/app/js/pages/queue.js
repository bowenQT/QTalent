/* HR 校准队列：证据冲突、导师与 AI 分差大、参考位置跨象限。逐条看双方分数与证据 → 校准并写理由。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  let openId = location.hash.slice(1) || null;

  NT.shell({
    nav: 'queue', title: '评分复核',
    allow: (r) => st.can('calibrate', null, r),
    denyText: `校准分数由 HR 处理。分数有疑问，请联系 HR ${st.person(st.roles.hrbp.person).name}。`,
    view: () => `评分复核 · ${st.queue().length} 条`,
    state: () => ({ openId }),
    restore: (s) => { openId = s.openId; render($('#main')); },
    render,
  });

  function render(main) {
    const q = st.queue();
    const kept = st.recalKeptList();
    const done = st.get().events.flatMap((e) => e.scores.filter((s) => s.st === 'calibrated' && s.hist?.[0]?.kind === 'calib' && st.scope(s.p)).map((s) => ({ e, s })));
    if (!openId && q[0]) openId = q[0].id;
    mount(main, html`
      <header class="nt-head"><div><h1>评分复核</h1><p>两位评价人打分差 2 分以上、改了 AI 的分还没写理由、新事件让象限位置变了的，都在这里复核。复核后定下的分数带朱点，理由留在修订历史里。</p></div></header>
      <div class="nt-split nt-split--wide">
        <article class="n-card"><h3 class="n-section-title">待处理${q.length ? html`<span class="n-count">${q.length}</span>` : ''}</h3>
          ${q.length ? html`<ul class="n-queue">${q.map((it) => html`<li id="${it.id}"><button class="nt-qrow" type="button" data-open="${it.id}" aria-expanded="${it.id === openId}"><div><span class="n-badge ${it.kind === 'conflict' ? 'n-badge--conflict' : it.kind === 'recal' ? 'n-badge--recal' : ''}">${it.kind === 'conflict' ? icon('split') : ''}${it.kind === 'conflict' ? '证据冲突' : it.kindLabel}</span> ${it.kind === 'conflict' ? `${st.person(it.s.p).name} · ${st.dim(it.s.d).name} · ${it.ev.title}` : it.title}<small>${it.sub}</small></div><span class="n-queue__pair">${it.pair}</span></button>
            ${it.id === openId ? detail(it) : ''}</li>`)}</ul>`
            : UI.state({ ip: 'done', size: 48, title: '队列清空了', text: '新的冲突和大分差会出现在这里。' })}
        </article>
        <aside class="nt-grid">
          <article class="n-card"><h3 class="n-section-title">已校准</h3>
            ${done.length ? html`<ul class="nt-list" style="font-size:var(--t-sm)">${done.map(({ e, s }) => html`<li><div class="nt-row" style="justify-content:space-between"><span>${UI.plink(s.p)} · ${st.dim(s.d).name}</span>${UI.dotsInline(s.v, 'calibrated')}</div><div class="ink-hand" style="font-size:var(--t-body);margin-top:2px">${s.hist[0].why}</div><div class="nt-muted">${st.person(s.hist[0].by).name} · ${NT.md(s.hist[0].at)} · ${e.title}</div></li>`)}</ul>` : html`<p class="nt-muted">校准过的分数会出现在这里。</p>`}
          </article>
          ${kept.length ? html`<article class="n-card"><h3 class="n-section-title">保持正式位置</h3>
            <ul class="nt-list" style="font-size:var(--t-sm)">${kept.map((k) => html`<li><div class="nt-row" style="justify-content:space-between"><span>${UI.plink(k.person)}</span>${UI.qBadge(k.q)}</div><div class="ink-hand" style="font-size:var(--t-body);margin-top:2px">${k.why}</div><div class="nt-muted">${st.person(k.by).name} · ${NT.md(k.at)} · 参考位置在「${st.QN[k.refQ]}」</div></li>`)}</ul></article>` : ''}
          <div class="n-notice is-plain">${icon('info')}<div>导师和助教各自的分数、理由都保留在修订历史里，校准分作为新的一条记下。</div></div>
        </aside>
      </div>`);
    main.onclick = (e) => {
      const o = e.target.closest('[data-open]'); if (o) { openId = openId === o.dataset.open ? null : o.dataset.open; render(main); return; }
      const c = e.target.closest('[data-cal]'); if (c) cal(c.dataset.cal);
      const k = e.target.closest('[data-keep]'); if (k) keep(k.dataset.keep);
      const kf = e.target.closest('[data-keepformal]'); if (kf) keepFormal(kf.dataset.keepformal);
    };
  }

  function detail(it) {
    if (it.kind === 'recal') {
      const f = st.formal(it.person), r = st.refPos(it.person);
      return html`<div class="nt-qdetail"><p style="margin:0">冻结后的新事件让参考位置从「${st.QN[f.q]}」移到了「${st.QN[r.q]}」。正式位置保持冻结时的样子：可以去象限校准里调整，也可以写明理由保持正式位置。</p>
        <textarea class="n-calib__reason" id="kr" aria-label="保持正式位置的理由" placeholder="写一句理由，会留在这个人的档案里。比如：新增的两件事都在同一个项目里，等下一次盘点再看"></textarea>
        <div class="nt-row">${st.recalTarget(it.person) ? html`<a class="n-btn n-btn--sm n-btn--ink" href="${st.recalTarget(it.person)}">${icon('grid')}去象限校准</a>` : html`<a class="n-btn n-btn--sm n-btn--ink" href="reviews.html">${icon('grid')}发起新的盘点后校准</a>`}<button class="n-btn n-btn--sm" type="button" data-keepformal="${it.person}">${icon('check')}保持正式位置</button><a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${it.person}#spectrum">看能力谱</a></div></div>`;
    }
    const e = it.ev, s = it.s;
    const audio = e.srcs.filter((x) => x.type === 'audio');
    const sides = it.kind === 'conflict' ? s.raters.map((r) => ({ who: `${st.person(r.by).name} · ${st.person(r.by).staff === 'ta' ? '助教' : '导师'}`, v: r.v, why: r.why, src: audio.find((a) => a.by === r.by) }))
      : [{ who: `${st.person(s.by).name} · 确认`, v: s.v, why: '理由待补' }, { who: 'AI 建议', v: s.ai, why: s.note || '按锚点给出', ai: true }];
    const suggest = it.kind === 'conflict' ? Math.round((s.raters[0].v + s.raters[1].v) / 2) : s.v;
    return html`<div class="nt-qdetail">
      <div class="nt-qdetail__src">${e.title} · ${NT.md(e.date)} · ${st.person(e.recorder).name}记录 ${UI.cites(e.srcs)}</div>
      <div class="n-calib__pair">${sides.map((x) => html`<div class="n-calib__side"><span style="color:${x.ai ? 'var(--light)' : 'var(--ink-3)'}">${x.who}</span><b ${NT.raw(x.ai ? 'style="color:var(--light)"' : '')}>${x.v}</b>「${x.why}」${x.src ? html`<div style="margin-top:4px">${UI.cite(x.src, 1)} <span class="nt-muted">${x.src.loc}</span></div>` : ''}</div>`)}</div>
      <div class="n-anchor"><b>${st.dim(s.d).name} · 锚点</b><ol>${st.anchors(s.d, s.p, st.eventRubric(e)).list.map((t, i) => html`<li class="${[...sides.map((x) => x.v)].includes(i + 1) ? 'is-hit' : ''}"><b>${i + 1}</b>${t}</li>`)}</ol></div>
      <div class="nt-qdetail__form"><label class="nt-qdetail__label" for="cv">校准为 <select class="n-select" id="cv">${[1, 2, 3, 4, 5].map((v) => html`<option ${v === suggest ? 'selected' : ''}>${v}</option>`)}</select> 分，理由</label>
      <textarea class="n-calib__reason" id="cr" aria-label="校准理由" placeholder="${it.kind === 'conflict' ? '写一句理由，会留在修订历史里。比如：两位评价人各有依据，取中间值，因为……' : '写一句理由，会留在修订历史里'}"></textarea></div>
      <div class="nt-row"><button class="n-btn n-btn--ink" type="button" data-cal="${it.id}">校准</button>${it.kind === 'gap' ? html`<button class="n-btn n-btn--ghost" type="button" data-keep="${it.id}">保留 ${s.v} 分，补一句理由</button>` : ''}<button class="n-btn n-btn--ghost" type="button" data-open="${it.id}">稍后</button></div>
    </div>`;
  }

  function cal(id) {
    const it = st.queue().find((x) => x.id === id);
    const why = $('#cr').value.trim();
    if (!why) { $('#cr').focus(); $('#cr').placeholder = '校准需要写一句理由'; return; }
    const v = +$('#cv').value;
    st.calibrate(it.ev.id, it.i, v, why);
    openId = null; render($('#main'));
    NT.toast(`已把${st.person(it.s.p).name}的${st.dim(it.s.d).name}校准为 ${v} 分，计入档案`);
  }
  function keepFormal(pid) {
    const why = $('#kr').value.trim();
    if (!why) { $('#kr').focus(); $('#kr').placeholder = '保持正式位置需要写一句理由'; return; }
    const undo = st.keepFormal(pid, why);
    if (!undo) return;
    openId = null; render($('#main'));
    NT.toast(`已保持${st.person(pid).name}的正式位置，理由记在档案里`, {
      // 撤销结果如实交给 Toast：这条决定之后被更新、或校准权限已收回时，撤销失败并保留当前记录
      undo: () => { const ok = undo(); render($('#main')); return ok; },
      failText: '撤销失败：这条决定已更新，已保留当前记录',
    });
  }
  function keep(id) {
    const it = st.queue().find((x) => x.id === id);
    const why = $('#cr').value.trim();
    if (!why) { $('#cr').focus(); $('#cr').placeholder = '写一句为什么保留'; return; }
    st.calibrate(it.ev.id, it.i, it.s.v, why);
    openId = null; render($('#main'));
    NT.toast('已保留原分，理由写进修订历史');
  }
})();
