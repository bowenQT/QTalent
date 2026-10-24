/* 待核对：AI 拿不准的地方交给人，一次只问一件事。选完立刻生效，事件卡飞入对应人员。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;

  NT.shell({
    nav: 'work', title: '待核对', crumbs: [['工作台', 'index.html']],
    allow: (r) => r !== 'self',
    view: () => `待核对 · 剩 ${st.get().inbox.filter((i) => !i.done).length} 处`,
    render,
  });

  function render(main) {
    const S = st.get();
    const open = S.inbox.filter((i) => !i.done), done = S.inbox.filter((i) => i.done);
    const targets = [...new Set(S.inbox.flatMap((i) => i.options.map((o) => o[0])))].filter((id) => st.person(id) && st.scope(id));
    mount(main, html`
      <header class="nt-head"><div><h1>待核对</h1><p>录音和文档里有几处 AI 拿不准是谁、是哪个项目。选一下就生效；选错了可以撤销。</p></div></header>
      <div class="nt-split">
        <div class="nt-grid" id="cards">
          ${open.length ? open.map(card) : UI.state({ ip: 'done', title: '都核对完了', text: '新的录音或文档里有拿不准的地方时，会出现在这里。', actions: st.canOpenMinutes('w2') && html`<a class="n-btn n-btn--sm" href="record.html?m=w2">回到会议纪要</a>` })}
        </div>
        <aside class="nt-grid nt-sticky">
          <article class="n-card"><h3 class="n-section-title">会归到这些人</h3>
            <div class="nt-grid" style="gap:var(--s-2)" id="dock">${targets.filter((id) => st.person(id)).map((id) => html`<div class="n-person-row" data-dock="${id}" style="padding:var(--s-2)">${UI.person(id, { size: 'sm', meta: `${st.eventsOf(id, { kind: 'obs' }).length} 条事件` })}<span class="n-count is-quiet" data-n="${id}">${st.eventsOf(id, { kind: 'obs' }).length}</span></div>`)}</div>
          </article>
          ${done.length ? html`<article class="n-card"><h3 class="n-section-title">已核对</h3><ul class="nt-list" style="font-size:var(--t-sm)">${done.map((i) => html`<li class="nt-row" style="justify-content:space-between"><span>${i.q.replace(/？$/, '')} → <b>${i.choice === 'skip' ? '稍后处理' : (st.person(i.choice)?.name || st.project(i.choice)?.name)}</b></span><button class="n-link" type="button" data-undo="${i.id}">撤销</button></li>`)}</ul></article>` : ''}
        </aside>
      </div>`);
    main.onclick = (e) => {
      const c = e.target.closest('.n-choice');
      if (c) pick(c.closest('[data-item]').dataset.item, c.dataset.v, c);
      const u = e.target.closest('[data-undo]');
      if (u) { st.unresolveInbox(u.dataset.undo); render(main); }
    };
  }

  function card(i) {
    const isProj = i.kind === 'project';
    const q = i.quote.replace(/(小王|宋老师|海外那个项目)/, '「$1」');
    return html`<article class="n-card n-verify" data-item="${i.id}" id="${i.id}">
      <span class="n-src n-src--ai">${icon('spark')}待核对 · ${i.src} ${i.at} · ${st.person(i.by).name}</span>
      <p class="n-verify__q" style="margin-top:var(--s-2)">${i.q}</p>
      <div class="n-cite__quote" style="margin-bottom:var(--s-3);font-size:var(--t-sm)">${q}<button class="n-player__play nt-play" type="button" style="width:22px;height:22px;display:inline-grid;vertical-align:middle;margin-left:6px" aria-label="播放这一段">${icon('play', 9)}</button></div>
      ${i.note ? html`<p class="nt-muted" style="margin:0 0 var(--s-2)">${i.note}</p>` : ''}
      <div class="n-choices">
        ${i.options.map(([id, why]) => html`<button class="n-choice" type="button" data-v="${id}">${isProj ? html`<span class="n-avatar n-avatar--sm" style="--hue:220;border-radius:6px">${icon('folder', 12)}</span>${st.project(id).name}` : html`${UI.avatar(id, 'sm')}${st.person(id).name}`}<small>${why}</small></button>`)}
        <button class="n-choice" type="button" data-v="skip"><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">?</span>都不是，稍后处理<small></small></button>
      </div>
      ${i.draft ? html`<div class="n-minievent" style="margin-top:var(--s-3)" data-draft><div>${i.draft.title}<small>会生成一条事件 · ${i.draft.scores.map(([d, v]) => `${st.dim(d).name} ${v}`).join('、')}（AI 建议，待导师确认）</small></div><span class="n-badge n-badge--ai">${icon('spark')}待归属</span></div>` : ''}
    </article>`;
  }

  function pick(id, v, btn) {
    const item = st.get().inbox.find((x) => x.id === id);
    const cardEl = btn.closest('.n-verify');
    $$('.n-choice', cardEl).forEach((x) => x.classList.toggle('is-picked', x === btn));
    const draft = $('[data-draft]', cardEl);
    const dock = $(`[data-dock="${v}"]`);
    const finish = () => {
      st.resolveInbox(id, v);
      const n = $(`[data-n="${v}"]`);
      if (n) { n.textContent = +n.textContent + 1; n.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: NT.reduced ? 1 : 360, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
      const name = v === 'skip' ? '' : (st.person(v)?.name || st.project(v)?.name);
      NT.toast(v === 'skip' ? '先放着，稍后处理' : `已归到${name}${item.draft ? '，事件进了待确认' : ''}`, {
        undo: () => { st.unresolveInbox(id); render($('#main')); }, undoneText: '已撤销，回到待核对',
      });
      cardEl.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(12px)' }], { duration: NT.reduced ? 1 : 280 }).onfinish = () => render($('#main'));
    };
    if (draft && dock) NT.flyTo(draft, dock, finish);
    else setTimeout(finish, NT.reduced ? 0 : 240);
  }
})();
