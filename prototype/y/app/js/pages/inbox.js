/* 待核对：AI 拿不准的地方交给人，一次只问一件事。选完立刻生效，事件卡飞入对应人员。
   类型：说话人、人名、未知人员、课题、图片范围、面试官。每类都能撤销；面试官只能关联到人员目录里已有的人。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  const KIND = Object.fromEntries(st.INBOX_KINDS);
  let kind = 'all';
  const q = {}; // 未知人员、面试官的搜索词，按条目记

  NT.shell({
    nav: 'work', title: '待核对', crumbs: [['工作台', 'index.html']],
    allow: (r) => r !== 'self',
    view: () => `待核对 · 剩 ${st.visibleInbox().filter((i) => !i.done).length} 处${kind !== 'all' ? ` · 只看${KIND[kind]}` : ''}`,
    state: () => ({ kind }),
    restore: (s) => { kind = s.kind || 'all'; render($('#main')); },
    render,
  });

  function render(main) {
    const all = st.visibleInbox();
    const kinds = st.INBOX_KINDS.filter(([k]) => all.some((i) => i.kind === k && !i.done));
    if (kind !== 'all' && !kinds.some(([k]) => k === kind)) kind = 'all';
    const pick = (l) => l.filter((i) => kind === 'all' || i.kind === kind);
    const open = pick(all.filter((i) => !i.done && !i.later)), later = all.filter((i) => !i.done && i.later), done = all.filter((i) => i.done);
    const targets = [...new Set(all.filter((i) => ['person', 'speaker', 'unknown'].includes(i.kind)).flatMap((i) => i.options.map((o) => o[0])))].filter((id) => st.person(id) && st.scope(id));
    const nOpen = all.filter((i) => !i.done && !i.later).length;
    mount(main, html`
      <header class="nt-head"><div><h1>待核对</h1><p>选出这几处说的是谁、哪个课题、整理哪一部分，选完即生效，随时可以撤销。</p></div></header>
      ${kinds.length > 1 ? html`<div class="n-chips" role="group" aria-label="按类型筛选" id="ib-kinds"><button class="n-chip" type="button" data-k="all" aria-pressed="${kind === 'all'}">全部<b>${nOpen}</b></button>${kinds.map(([k, l]) => html`<button class="n-chip" type="button" data-k="${k}" aria-pressed="${kind === k}">${l}<b>${all.filter((i) => i.kind === k && !i.done && !i.later).length || ''}</b></button>`)}</div>` : ''}
      <div class="nt-split">
        <div class="nt-grid" id="cards">
          ${open.length ? open.map(card) : later.length ? UI.state({ ip: 'rest', title: kind === 'all' ? '现在没有要核对的' : `${KIND[kind]}都核对完了`, text: `${later.length} 处放在了稍后处理，在右侧继续核对。` }) : UI.state({ ip: 'done', title: '都核对完了', text: '新的录音、文档、截图或面评里有需要确认的地方时，会出现在这里。', actions: st.canOpenMinutes('w8') && html`<a class="n-btn n-btn--sm" href="record.html?m=w8">回到会议纪要</a>` })}
        </div>
        <aside class="nt-grid nt-sticky">
          ${targets.length && ['all', 'person', 'speaker', 'unknown'].includes(kind) ? html`<article class="n-card"><h3 class="n-section-title">会归到这些人</h3>
            <div class="nt-grid" style="gap:var(--s-2)" id="dock">${targets.map((id) => html`<div class="n-person-row" data-dock="${id}" style="padding:var(--s-2)">${UI.person(id, { size: 'sm', meta: `${st.eventsOf(id, { kind: 'obs' }).length} 条事件` })}<span class="n-count is-quiet" data-n="${id}">${st.eventsOf(id, { kind: 'obs' }).length}</span></div>`)}</div>
          </article>` : ''}
          ${later.length ? html`<article class="n-card"><h3 class="n-section-title">稍后处理<span class="n-count is-quiet">${later.length}</span></h3><ul class="nt-list" style="font-size:var(--t-sm)">${later.map((i) => html`<li class="nt-row" style="justify-content:space-between"><span><span class="n-kind">${KIND[i.kind]}</span> ${i.q.replace(/？$/, '')}</span><button class="n-link" type="button" data-undo="${i.id}">继续核对</button></li>`)}</ul></article>` : ''}
          ${done.length ? html`<article class="n-card"><h3 class="n-section-title">已核对</h3><ul class="nt-list" style="font-size:var(--t-sm)">${done.map((i) => html`<li class="nt-row" style="justify-content:space-between"><span><span class="n-kind">${KIND[i.kind]}</span> ${i.q.replace(/？$/, '')} → <b>${result(i)}</b></span><button class="n-link" type="button" data-undo="${i.id}">撤销</button></li>`)}</ul></article>` : ''}
        </aside>
      </div>`);
    main.onclick = (e) => {
      const k = e.target.closest('[data-k]');
      if (k) { kind = k.dataset.k; render(main); return; }
      const c = e.target.closest('.n-choice');
      if (c && !c.disabled) pick1(c.closest('[data-item]').dataset.item, c.dataset.v, c);
      const u = e.target.closest('[data-undo]');
      if (u) { st.unresolveInbox(u.dataset.undo); render(main); }
    };
    main.oninput = (e) => {
      const f = e.target.closest('[data-find]'); if (!f) return;
      q[f.dataset.find] = f.value.trim();
      const it = all.find((i) => i.id === f.dataset.find);
      mount($(`[data-found="${it.id}"]`, main), found(it));
    };
  }

  // 处理结果的一句话：归到谁、关联到谁、怎么处理这张图
  function result(i) {
    if (i.choice === 'none') return '名单外的人，只留在原件里';
    if (i.choice === 'rows') return `整理范围内的 ${i.rows.filter((r) => r[0]).length} 行`;
    if (i.choice === 'attach') return '整张只作附件';
    const name = st.person(i.choice)?.name || st.project(i.choice)?.name;
    return i.kind === 'interviewer' ? `关联到${name}` : name;
  }

  const playBtn = html`<button class="n-player__play nt-play" type="button" style="width:22px;height:22px;display:inline-grid;vertical-align:middle;margin-left:6px" aria-label="播放这一段">${icon('play', 9)}</button>`;
  const skipChoice = (label = '都不是，稍后处理') => html`<button class="n-choice" type="button" data-v="skip"><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">?</span>${label}<small></small></button>`;
  const personChoice = (id, why) => html`<button class="n-choice" type="button" data-v="${id}">${UI.avatar(id, 'sm')}${st.person(id).name}<small>${why}</small></button>`;

  // 未知人员在本人查看范围里找；面试官在人员目录里找
  function found(i) {
    const word = q[i.id] || '';
    if (!word) return '';
    const list = i.kind === 'interviewer' ? st.directory(word) : st.visiblePeople().filter((p) => p.name.includes(word));
    return list.length ? list.slice(0, 5).map((p) => personChoice(p.id, i.kind === 'interviewer' ? `${st.orgShort(p.org)} · ${p.title}` : `${st.orgShort(p.org)}`))
      : html`<p class="nt-muted" style="margin:0">${i.kind === 'interviewer' ? `人员目录里查到 0 人。这一处先留在待核对，关联后面评那一行再导入。` : `你的查看范围里查到 0 人，换个写法试试。`}</p>`;
  }

  function card(i) {
    const head = html`<span class="n-src n-src--ai">${icon('spark')}待核对 · ${KIND[i.kind]} · ${i.src} ${i.at} · ${st.person(i.by).name}</span>`;
    if (i.kind === 'region') {
      const inside = i.rows.filter((r) => r[0]).length, outside = i.rows.length - inside;
      return html`<article class="n-card n-verify" data-item="${i.id}" id="${i.id}">${head}
        <p class="n-verify__q" style="margin-top:var(--s-2)">${i.q}</p>
        <figure class="n-shot" aria-label="${i.src}">${i.rows.map(([pid, text]) => (pid
          ? html`<div class="n-shot__row is-in"><span class="n-shot__who">${st.person(pid).name}</span><span>${text}</span></div>`
          : html`<div class="n-shot__row is-out"><span class="n-shot__who">${icon('lock', 12)}范围外</span><span>已遮挡</span></div>`))}
          <figcaption>${inside} 行在你的查看范围里，另有 ${outside} 处已遮挡；只把范围里的部分交给 AI 整理</figcaption></figure>
        <div class="n-choices">
          <button class="n-choice" type="button" data-v="rows"><span class="n-avatar n-avatar--sm" style="--hue:220;border-radius:6px">${icon('check', 12)}</span>整理范围内的 ${inside} 行<small>其余部分保持遮挡</small></button>
          <button class="n-choice" type="button" data-v="attach"><span class="n-avatar n-avatar--sm" style="--hue:220;border-radius:6px">${icon('clip', 12)}</span>整张只作附件<small>只给对整张图有权限的人看</small></button>
          ${skipChoice('稍后处理')}
        </div></article>`;
    }
    if (i.kind === 'interviewer') {
      return html`<article class="n-card n-verify" data-item="${i.id}" id="${i.id}">${head}
        <p class="n-verify__q" style="margin-top:var(--s-2)">${i.q}</p>
        <div class="n-cite__quote" style="margin-bottom:var(--s-3);font-size:var(--t-sm)">${i.quote}</div>
        <label class="n-field" style="margin-bottom:var(--s-2)"><span class="n-field__label">在人员目录里找</span><input class="n-input" data-find="${i.id}" value="${q[i.id] || ''}" placeholder="输入姓名，比如：许致远" autocomplete="off"></label>
        <div class="n-choices"><div class="n-choices" data-found="${i.id}">${found(i)}</div>${skipChoice('稍后处理')}</div>
        <p class="nt-caption" style="margin-top:var(--s-2)">关联到目录里的人以后，面评那一行才能导入。</p></article>`;
    }
    const isProj = i.kind === 'project';
    const quote = i.kind === 'speaker' ? i.quote : i.quote.replace(new RegExp(`(${i.name || '小孟|分镜那个组'})`), '「$1」');
    return html`<article class="n-card n-verify" data-item="${i.id}" id="${i.id}">${head}
      <p class="n-verify__q" style="margin-top:var(--s-2)">${i.q}</p>
      <div class="n-cite__quote" style="margin-bottom:var(--s-3);font-size:var(--t-sm)">${i.kind === 'speaker' ? html`<b class="nt-muted" style="font-weight:600">说话人 2 · ${i.at}</b> ` : ''}${quote}${['person', 'speaker', 'project'].includes(i.kind) && !/表|docx|pdf/.test(i.src) ? playBtn : ''}</div>
      ${i.kind === 'speaker' ? html`<p class="nt-muted" style="margin:0 0 var(--s-2)">选完后，这段录像里说话人 2 的 ${i.lines} 句都归到这个人。</p>` : ''}
      ${i.note ? html`<p class="nt-muted" style="margin:0 0 var(--s-2)">${i.note}</p>` : ''}
      <div class="n-choices">
        ${i.options.map(([id, why]) => (isProj ? html`<button class="n-choice" type="button" data-v="${id}"><span class="n-avatar n-avatar--sm" style="--hue:220;border-radius:6px">${icon('folder', 12)}</span>${st.project(id).name}<small>${why}</small></button>` : personChoice(id, why)))}
        ${i.kind === 'unknown' || (i.kind === 'person' && !i.options.length) ? html`<label class="n-field" style="margin:var(--s-1) 0"><span class="n-field__label">在名单里找</span><input class="n-input" data-find="${i.id}" value="${q[i.id] || ''}" placeholder="输入姓名" autocomplete="off"></label><div class="n-choices" data-found="${i.id}">${found(i)}</div>` : ''}
        ${i.kind === 'unknown' ? html`<button class="n-choice" type="button" data-v="none"><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">${icon('dash', 12)}</span>名单外的人<small>只保留在原件里</small></button>` : ''}
        ${skipChoice()}
      </div>
      ${heldDraft(i)}
    </article>`;
  }

  // 这一处对上人以后会生成或归属的事件
  function heldDraft(i) {
    const d = i.draft ? { title: i.draft.title, scores: i.draft.scores } : i.ev ? st.get().intake?.held?.[i.ev] && { title: st.get().intake.held[i.ev].title, scores: st.get().intake.held[i.ev].scores.map((s) => [s.d, s.v]) } : null;
    if (!d) return '';
    return html`<div class="n-minievent" style="margin-top:var(--s-3)" data-draft><div>${d.title}<small>会生成一条事件 · ${d.scores.map(([dim, v]) => `${st.dim(dim).name} ${v}`).join('、')}（AI 建议，待评价人确认）</small></div><span class="n-badge n-badge--ai">${icon('spark')}待归属</span></div>`;
  }

  function pick1(id, v, btn) {
    const cardEl = btn.closest('.n-verify');
    if (!cardEl || cardEl.dataset.picking) return;
    cardEl.dataset.picking = '1';
    const item = st.get().inbox.find((x) => x.id === id);
    $$('.n-choice', cardEl).forEach((x) => x.classList.toggle('is-picked', x === btn));
    const draft = $('[data-draft]', cardEl);
    const dock = $(`[data-dock="${v}"]`);
    const finish = () => {
      st.resolveInbox(id, v);
      const n = $(`[data-n="${v}"]`);
      if (n) { n.textContent = +n.textContent + 1; n.animate([{ transform: 'scale(1.5)' }, { transform: 'none' }], { duration: NT.reduced ? 1 : 360, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
      const msg = v === 'skip' ? '已放到稍后处理，待办里仍会保留'
        : v === 'none' ? '已记下：名单外的人，只留在原件里'
        : v === 'rows' ? '已选好范围，整理结果会回到这次投递的回执'
        : v === 'attach' ? '这张图只作附件保存'
        : item.kind === 'interviewer' ? `已关联到${st.person(v).name}，面评那一行可以导入了`
        : `已归到${st.person(v)?.name || st.project(v)?.name}${item.draft || item.ev ? '，事件进了待确认' : ''}`;
      NT.toast(msg, { undo: () => { st.unresolveInbox(id); render($('#main')); }, undoneText: '已撤销，回到待核对' });
      cardEl.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(12px)' }], { duration: NT.reduced ? 1 : 280 }).onfinish = () => render($('#main'));
    };
    if (draft && dock) NT.flyTo(draft, dock, finish);
    else setTimeout(finish, NT.reduced ? 0 : 240);
  }
})();
