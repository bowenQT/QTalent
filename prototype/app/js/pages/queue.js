/* HRBP 校准队列：证据冲突、导师与 AI 分差大、参考位置跨象限。逐条看双方分数与证据 → 校准并写理由。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  let openId = location.hash.slice(1) || null;
  let userClosed = false;
  const drafts = {};

  NT.shell({
    nav: 'queue', title: '评分复核',
    allow: (r) => st.can('calibrate', null, r),
    denyText: '校准分数只对 CEO 和 HRBP 开放。部门负责人可以在事件上提出异议。',
    view: () => `评分复核 · ${st.queue().length} 条`,
    state: () => ({ openId }),
    restore: (s) => { openId = s.openId; render($('#main')); },
    render,
  });

  function remember() {
    const cr = $('#cr');
    if (!openId || !cr) return;
    drafts[openId] = { why: cr.value, v: $('#cv')?.value };
  }

  function render(main) {
    const q = st.queue();
    const done = st.get().events.flatMap((e) => e.scores.filter((s) => s.st === 'calibrated' && s.hist?.[0]?.kind === 'calib' && st.scope(s.p)).map((s) => ({ e, s })));
    if (!userClosed && !openId && q[0]) openId = q[0].id;
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
            ${done.length ? html`<ul class="nt-list" style="font-size:var(--t-sm)">${done.map(({ e, s }) => html`<li><div class="nt-row" style="justify-content:space-between"><span>${UI.plink(s.p)} · ${st.dim(s.d).name}</span>${UI.dotsInline(s.v, 'calibrated')}</div><div class="ink-hand" style="font-size:var(--t-body);margin-top:2px">${s.hist[0].why}</div><div class="nt-muted">${st.person(s.hist[0].by).name} · ${NT.md(s.hist[0].at)} · ${e.title}</div></li>`)}</ul>` : html`<p class="nt-muted">还没有。</p>`}
          </article>
          <div class="n-notice is-plain">${icon('info')}<div>校准不会改写原评价：导师和助教各自的分数、理由都保留在修订历史里，校准分是新的一条。</div></div>
        </aside>
      </div>`);
    main.onclick = (e) => {
      const later = e.target.closest('.nt-qdetail [data-open]');
      if (later) { remember(); userClosed = true; openId = null; render(main); return; }
      const o = e.target.closest('[data-open]');
      if (o) {
        remember();
        openId = openId === o.dataset.open ? null : o.dataset.open;
        userClosed = !openId;
        render(main);
        return;
      }
      const c = e.target.closest('[data-cal]'); if (c) cal(c.dataset.cal);
      const k = e.target.closest('[data-keep]'); if (k) keep(k.dataset.keep);
    };
  }

  function detail(it) {
    if (it.kind === 'recal') return html`<div class="nt-qdetail"><p style="margin:0">冻结后的新事件让参考位置离开了正式象限。正式位置不会自动移动，在下一次象限校准时处理。</p><div class="nt-row"><a class="n-btn n-btn--sm n-btn--ink" href="calibrate.html?id=b-h2&team=${st.person(it.person).org}&person=${it.person}">${icon('grid')}去象限校准</a><a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${it.person}#spectrum">看能力谱</a></div></div>`;
    const e = it.ev, s = it.s;
    const audio = e.srcs.filter((x) => x.type === 'audio');
    const sides = it.kind === 'conflict' ? s.raters.map((r) => ({ who: `${st.person(r.by).name} · ${r.by === 'p-songchuan' ? '助教' : '导师'}`, v: r.v, why: r.why, src: audio.find((a) => a.by === r.by) }))
      : [{ who: `${st.person(s.by).name} · 确认`, v: s.v, why: '理由待补' }, { who: 'AI 建议', v: s.ai, why: s.note || '按锚点给出', ai: true }];
    const suggest = it.kind === 'conflict' ? Math.round((s.raters[0].v + s.raters[1].v) / 2) : s.v;
    const draft = drafts[it.id];
    const selected = draft?.v ? +draft.v : suggest;
    const why = draft ? draft.why : (it.kind === 'conflict' ? '方案表达到位，排查过程确实发散，各取一半。' : '');
    return html`<div class="nt-qdetail">
      <div class="nt-qdetail__src">${e.title} · ${NT.md(e.date)} · ${st.person(e.recorder).name}记录 ${UI.cites(e.srcs)}</div>
      <div class="n-calib__pair">${sides.map((x) => html`<div class="n-calib__side"><span style="color:${x.ai ? 'var(--light)' : 'var(--ink-3)'}">${x.who}</span><b ${NT.raw(x.ai ? 'style="color:var(--light)"' : '')}>${x.v}</b>「${x.why}」${x.src ? html`<div style="margin-top:4px">${UI.cite(x.src, 1)} <span class="nt-muted">${x.src.loc}</span></div>` : ''}</div>`)}</div>
      <div class="n-anchor"><b>${st.dim(s.d).name} · 锚点</b><ol>${st.anchors(s.d, s.p, st.eventRubric(e)).list.map((t, i) => html`<li class="${[...sides.map((x) => x.v)].includes(i + 1) ? 'is-hit' : ''}"><b>${i + 1}</b>${t}</li>`)}</ol></div>
      <div class="nt-qdetail__form"><label class="nt-qdetail__label" for="cv">校准为 <select class="n-select" id="cv">${[1, 2, 3, 4, 5].map((v) => html`<option ${v === selected ? 'selected' : ''}>${v}</option>`)}</select> 分，理由</label>
      <textarea class="n-calib__reason" id="cr" placeholder="写一句理由，会留在修订历史里">${why}</textarea></div>
      <div class="nt-row"><button class="n-btn n-btn--ink" type="button" data-cal="${it.id}">校准</button>${it.kind === 'gap' ? html`<button class="n-btn n-btn--ghost" type="button" data-keep="${it.id}">保留 ${s.v} 分，补一句理由</button>` : ''}<button class="n-btn n-btn--ghost" type="button" data-open="${it.id}">稍后</button></div>
    </div>`;
  }

  function cal(id) {
    const it = st.queue().find((x) => x.id === id);
    const why = $('#cr').value.trim();
    if (!why) { $('#cr').focus(); $('#cr').placeholder = '校准需要写一句理由'; return; }
    const v = +$('#cv').value;
    st.calibrate(it.ev.id, it.i, v, why);
    delete drafts[id];
    userClosed = false;
    openId = null; render($('#main'));
    NT.toast(`已把${st.person(it.s.p).name}的${st.dim(it.s.d).name}校准为 ${v} 分，计入档案`);
  }
  function keep(id) {
    const it = st.queue().find((x) => x.id === id);
    const why = $('#cr').value.trim();
    if (!why) { $('#cr').focus(); $('#cr').placeholder = '写一句为什么保留'; return; }
    st.calibrate(it.ev.id, it.i, it.s.v, why);
    delete drafts[id];
    userClosed = false;
    openId = null; render($('#main'));
    NT.toast('已保留原分，理由写进修订历史');
  }
})();
