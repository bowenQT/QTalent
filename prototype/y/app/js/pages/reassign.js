/* 重新分派：评价人只看本节点，评价关系到期后，没做完的事交 HR 选接手人。
   接手人在本节点获得这几位的评价关系，到这批事里最晚的截止日；被评价人本人、关系已到期的人选不了。
   提交时如果某件事在打开之后已有变化（比如原评价人到期前的修改刚同步进来），这件不分派，单独说明。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  let to = null;
  const skipped = new Set(); // 默认全选，取消勾选的记在这里
  const notices = []; // 提交后发现已有变化的事

  NT.shell({
    nav: 'work', title: '重新分派', crumbs: [['工作台', 'index.html']],
    allow: (r) => r === 'hrbp',
    denyTitle: '重新分派由 HR 处理', denyText: '切换到 HR 视角，或回到工作台。',
    view: () => `重新分派 · ${st.reassignItems().length} 件待分派`,
    render,
  });

  function render(main) {
    const items = st.reassignItems();
    const groups = [...new Set(items.map((x) => x.rel))].map((rid) => ({ rel: st.relation(rid), list: items.filter((x) => x.rel === rid) }));
    const sel = items.filter((x) => !skipped.has(x.id));
    const cands = st.reassignCandidates(sel.length ? sel : items);
    if (to && !cands.some((c) => c.id === to && c.ok)) to = null;
    const done = st.reassignDone();
    mount(main, html`
      <header class="nt-head"><div><h1>重新分派</h1><p>评价关系到期后待完成的事，选一位接手人。接手人在本节点获得这几位的评价关系，到这批事里最晚的截止日。</p></div></header>
      ${notices.length ? html`<div class="n-note is-warn" role="alert">${icon('info')}<div><b>${notices.length} 件已有变化，以原评价人的结果为准</b><ul>${notices.map((x) => html`<li>${st.person(x.person).name} · ${st.reassignTask(x).label}：${x.gone}</li>`)}</ul><button class="n-link" type="button" id="ra-ok">知道了</button></div></div>` : ''}
      ${items.length ? html`<div class="nt-split">
        <div class="nt-grid">${groups.map(({ rel, list }) => html`<article class="n-card">
          <div class="n-ra__head">${UI.avatar(rel.rater, 'sm')}<div><b>${st.person(rel.rater).name}</b> · ${rel.label} · XEngineer 第六期<small>评价关系 ${NT.md(rel.from)}–${NT.md(rel.to)}，已到期${rel.ended ? ` · ${rel.ended}` : ''}</small></div></div>
          <ul class="n-ra">${list.map((x) => html`<li><label><input type="checkbox" data-pick="${x.id}" ${NT.raw(skipped.has(x.id) ? '' : 'checked')}>${UI.avatar(x.person, 'sm')}<span><b>${st.person(x.person).name}</b>${UI.demo()}<small>${st.reassignTask(x).label}</small></span><span class="due">截止 ${NT.md(x.due)}</span></label></li>`)}</ul>
        </article>`)}</div>
        <aside class="nt-grid nt-sticky"><article class="n-card"><h3 class="n-section-title">接手人</h3>
          <div class="n-choices" role="radiogroup" aria-label="接手人">${cands.map((c) => html`<button class="n-choice ${to === c.id ? 'is-picked' : ''}" type="button" role="radio" aria-checked="${to === c.id}" data-to="${c.id}" ${NT.raw(c.ok ? '' : 'disabled aria-disabled="true"')}>${UI.avatar(c.id, 'sm')}${st.person(c.id).name}<small>${c.label}</small></button>`)}</div>
          <p class="nt-caption">名单里是本期关系有效的评价人和你自己；关系已到期的人置灰。</p>
          <button class="n-btn n-btn--ink" type="button" id="ra-go" style="width:100%;margin-top:var(--s-3)" ${NT.raw(to && sel.length ? '' : 'disabled')}>${to ? `交给${st.person(to).name}` : '选接手人'}${sel.length ? ` · ${sel.length} 件` : ''}</button>
        </article></aside>
      </div>` : UI.state({ ip: 'done', title: '需要重新分派的事都处理完了', text: '评价关系到期后待完成的事会出现在这里。', actions: html`<a class="n-btn n-btn--sm" href="index.html">回到工作台</a>` })}
      ${done.length ? html`<article class="n-card" style="margin-top:var(--s-4)"><h3 class="n-section-title">处理记录</h3><ul class="nt-list" style="font-size:var(--t-sm)">${done.map((x) => html`<li class="nt-row" style="justify-content:space-between;gap:var(--s-3)"><span>${st.person(x.person).name} · ${st.reassignTask(x).label}</span><span class="nt-muted">${x.to ? `${NT.md(x.at)} 交给${st.person(x.to).name}${st.reassignTask(x).done ? ' · 已办完' : ''}` : '已有变化，以原评价人的结果为准'}</span></li>`)}</ul></article>` : ''}`);
    UI.mountIPs(main);
    main.onclick = async (e) => {
      if (e.target.closest('#ra-ok')) { notices.length = 0; render(main); return; }
      const t = e.target.closest('[data-to]'); if (t && !t.disabled) { to = t.dataset.to; render(main); return; }
      if (e.target.closest('#ra-go')) submit(sel);
    };
    main.onchange = (e) => {
      const c = e.target.closest('[data-pick]'); if (!c) return;
      if (c.checked) skipped.delete(c.dataset.pick); else skipped.add(c.dataset.pick);
      render(main);
    };
  }

  async function submit(sel) {
    const name = st.person(to).name, late = sel.map((x) => x.due).sort().pop();
    const v = await NT.dialog({
      title: `交给${name}？`,
      body: html`<p>${name}会在待办里看到这 ${sel.length} 件事${to === st.me().id ? '' : `，并获得 ${[...new Set(sel.map((x) => st.person(x.person).name))].join('、')} 在本节点的评价关系，到 ${NT.md(late)}`}。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: `交给${name}`, value: 'ok', cls: 'n-btn--ink' }],
    });
    if (v !== 'ok') return;
    const res = st.reassign(sel.map((x) => x.id), to);
    notices.push(...res.conflicts);
    render($('#main'));
    if (res.done.length) NT.toast(`已交给${name} ${res.done.length} 件${res.conflicts.length ? `，${res.conflicts.length} 件已有变化` : ''}`, { undo: () => { const ok = res.undo(); render($('#main')); return ok; }, undoneText: '已撤销分派', failText: '撤销失败：接手的事已经有人开始办，已保留这次分派' });
    else if (res.conflicts.length) $('#ra-ok')?.focus();
  }
})();
