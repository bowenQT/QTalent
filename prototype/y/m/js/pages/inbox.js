/* 手机待办：待核对逐条就地处理（AI 拿不准的人名和项目，一次只问一件事，选完立刻生效，5 秒内可撤销）；
   其他待办（对人复盘、待确认方案、校准、跟踪）列在下面，点进对应流程。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $ } = NT;

  NT.mshell({
    tab: 'todo', title: '待办',
    view: () => `待办 · 待核对剩 ${st.visibleInbox().filter((i) => !i.done && !i.later).length} 处`,
    render,
  });

  const DONE_TEXT = { none: '名单外的人，只留在原件里', rows: '已选定要整理的行', attach: '整张只作附件' };

  function render(main) {
    const todos = st.todos();
    const all = st.visibleInbox();
    const verify = all.filter((i) => !i.done && !i.later);
    const later = all.filter((i) => !i.done && i.later);
    const done = all.filter((i) => i.done);
    const others = todos.filter((t) => t.kind !== 'verify');
    mount(main, html`
      ${html`<h3 class="m-h" style="margin-top:0">待核对${verify.length ? html`<span class="n-count">${verify.length}</span>` : ''}</h3>
        <p class="nt-muted" style="margin:-4px 0 var(--s-3)">选出这几处说的是谁、哪个项目，选完即生效。</p>
        ${verify.length ? verify.map((i) => card(i)) : html`<div class="m-card">${later.length
          ? UI.state({ ip: 'done', size: 40, title: '这一轮核对完了', text: `稍后处理的 ${later.length} 处还在下面，有空再选。` })
          : UI.state({ ip: 'done', size: 40, title: '都核对完了', text: '新的录音或文档里有拿不准的地方时，会出现在这里。' })}</div>`}`}

      ${later.length ? html`<h3 class="m-h" id="m-later">稍后处理<span class="n-count">${later.length}</span></h3>
        <p class="nt-muted" style="margin:-4px 0 var(--s-3)">这几处先放着，待办里仍会保留，选定后就从这里移走。</p>
        ${later.map((i) => card(i, true))}` : ''}

      ${others.length ? html`<h3 class="m-h">其他待办</h3><ul class="m-list">${others.map(M.todoRow)}</ul>`
        : !verify.length && !later.length ? html`<div class="m-card" style="margin-top:var(--s-3)">${UI.state({ ip: 'rest', size: 40, title: '待办都处理完了', text: '新的待确认会出现在这里。' })}</div>` : ''}

      ${done.length ? html`<h3 class="m-h">已核对</h3><ul class="m-list">${done.map((i) => html`<li><div class="m-row">${icon('check')}<span>${i.q.replace(/？$/, '')}<small>→ ${DONE_TEXT[i.choice] || st.person(i.choice)?.name || st.project(i.choice)?.name}</small></span><button class="n-link" type="button" data-undo="${i.id}">撤销</button></div></li>`)}</ul>` : ''}`);
    main.onclick = (e) => {
      const c = e.target.closest('.n-choice');
      if (c) pick(c.closest('[data-item]'), c);
      const u = e.target.closest('[data-undo]');
      if (u) { st.unresolveInbox(u.dataset.undo); render(main); }
    };
  }

  // 图片范围要对着整张图框选行，手机上只说明并给电脑端入口，不在这里处理
  function regionCard(i) {
    return html`<article class="m-card n-verify" data-item="${i.id}" id="${i.id}">
      <span class="n-src n-src--ai">${icon('spark')}${i.src} ${i.at} · ${st.person(i.by).name}</span>
      <p class="n-verify__q" style="margin-top:var(--s-2)">${i.q}</p>
      <p class="nt-muted" style="margin:0 0 var(--s-2)">要对着整张图选行，请在电脑上打开待核对处理。</p>
      <a class="n-btn n-btn--sm" href="../app/inbox.html#${i.id}">${icon('grid')}在电脑上处理</a>
    </article>`;
  }

  function card(i, isLater) {
    if (i.kind === 'region') return regionCard(i);
    const isProj = i.kind === 'project';
    const q = i.kind === 'speaker' ? `说话人 2 · ${i.at}　${i.quote}` : i.quote.replace(new RegExp(`(${i.name || '小孟|分镜那个组'})`), '「$1」');
    return html`<article class="m-card n-verify" data-item="${i.id}" id="${i.id}">
      <span class="n-src n-src--ai">${icon('spark')}${i.src} ${i.at} · ${st.person(i.by).name}</span>
      <p class="n-verify__q" style="margin-top:var(--s-2)">${i.q}</p>
      <div class="n-cite__quote m-quote">${q}<button class="n-player__play nt-play" type="button" aria-label="播放这一段">${icon('play', 9)}</button></div>
      ${i.note ? html`<p class="nt-muted" style="margin:0 0 var(--s-2)">${i.note}</p>` : ''}
      <div class="n-choices m-choices">
        ${i.options.map(([id, why]) => html`<button class="n-choice" type="button" data-v="${id}">${isProj ? html`<span class="n-avatar n-avatar--sm" style="--hue:220;border-radius:6px">${icon('folder', 12)}</span>${st.project(id).name}` : html`${UI.avatar(id, 'sm')}${st.person(id).name}`}<small>${why}</small></button>`)}
        ${i.kind === 'unknown' || i.iv ? html`<button class="n-choice" type="button" data-v="none"><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">${icon('dash', 12)}</span>名单外的人<small>${i.iv ? '这一行收进跳过的行' : '只保留在原件里'}</small></button>` : ''}
        ${isLater ? '' : html`<button class="n-choice" type="button" data-v="skip"><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">?</span>都不是，稍后处理<small></small></button>`}
      </div>
      ${i.draft || (i.ev && st.get().intake?.held?.[i.ev]) ? html`<div class="n-minievent" style="margin-top:var(--s-3)"><div>确认是谁以后，才整理这件事、给建议分<small>现在只保留原件里的这一处</small></div><span class="n-badge">${icon('user')}待认人</span></div>` : ''}
    </article>`;
  }

  function pick(cardEl, btn) {
    if (!cardEl || cardEl.dataset.picking) return;
    cardEl.dataset.picking = '1';
    const id = cardEl.dataset.item, v = btn.dataset.v;
    const item = st.get().inbox.find((x) => x.id === id);
    const wasLater = !!item.later;
    NT.$$('.n-choice', cardEl).forEach((x) => x.classList.toggle('is-picked', x === btn));
    st.resolveInbox(id, v);
    const name = v === 'skip' ? '' : (st.person(v)?.name || st.project(v)?.name);
    NT.toast(v === 'skip' ? '已放到稍后处理，待办里仍会保留' : v === 'none' ? '已记下：名单外的人，只留在原件里' : `已归到${name}${item.draft || item.ev ? '，事件进了待确认' : ''}`, {
      // 撤销回到点选之前：原来在稍后处理里的，仍回到稍后处理
      undo: () => { const ok = st.unresolveInbox(id) !== false; if (ok && wasLater) st.resolveInbox(id, 'skip'); render($('#main')); return ok; },
      undoneText: wasLater ? '已撤销，回到稍后处理' : '已撤销，回到待核对',
    });
    const h = cardEl.offsetHeight;
    cardEl.animate([{ opacity: 1, height: `${h}px` }, { opacity: 0, transform: 'translateX(24px)', height: `${h}px`, offset: 0.6 }, { opacity: 0, height: '0px', paddingTop: 0, paddingBottom: 0, marginTop: 0 }], { duration: NT.reduced ? 1 : 520, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => render($('#main'));
  }
})();
