/* 标签库：分组平铺，数字是事件数；候选标签由 HRBP 收录、并入或不要。标签只用于检索和找人，不参与打分。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount } = NT;

  NT.shell({
    nav: 'tags', title: '标签库',
    allow: (r) => ['ceo', 'hrbp', 'lead'].includes(r),
    view: () => '标签库与候选',
    render,
  });

  function render(main) {
    const S = st.get();
    const counts = st.tagCounts();
    const can = st.can('approveTags');
    const lib = NT.clone(NT.SEED.TAGLIB);
    S.taglibAdd.forEach(([g, t]) => lib.find((x) => x.group === g)?.tags.push([t, 0, true]));
    const total = lib.reduce((n, g) => n + g.tags.length, 0);
    mount(main, html`
      <header class="nt-head"><div><h1>标签库</h1><p>AI 记录事件时从这里打标签；新标签先列为候选，等 HRBP 决定。标签只用于检索和找人。</p></div></header>
      <div class="nt-cols">
        <article class="n-card n-taglib"><div class="n-taglib__head"><h3>已收录</h3><span class="n-taglib__meta">${total} 个 · 4 组</span></div>
          <div id="taglib-groups">${lib.map((g) => html`<div class="n-taglib__group"><h4>${g.group}</h4><div class="n-taglib__tags">${g.tags.map(([t, extracted, isNew]) => html`<span class="n-tag ${isNew ? 'is-new' : ''}">${extracted ? html`<svg aria-label="从历史资料提取"><use href="#i-spark"/></svg>` : ''}${t}<b>${counts[t] || 0}</b></span>`)}</div></div>`)}</div>
          <div class="n-taglib__legend"><span><i class="k-pre"></i>预置</span><span><svg><use href="#i-spark"/></svg>从历史资料提取</span><span>数字是当前事件数</span></div>
        </article>
        <article class="n-card n-cand"><div class="n-taglib__head"><h3>候选标签</h3><span class="n-taglib__meta">${S.tagCands.filter((c) => !c.done).length} 个待定</span></div>
          ${S.tagCands.map((c, i) => html`<div class="n-cand__item" data-i="${i}">
            <div class="n-cand__title"><span class="n-tag ${c.done === 'merge' ? 'is-merged' : c.done === 'drop' ? 'is-dropped' : c.done ? '' : 'is-candidate'}">${c.name}${c.done ? '' : html`<small>候选</small>`}</span>${c.done === 'merge' ? html`<span class="nt-muted">→ ${c.similar}</span>` : ''}<span class="n-cand__src">${c.count} 条事件 · ${c.people} 人 · 首次出现 ${NT.md(c.at)}</span></div>
            <dl class="n-cand__body">
              <dt>草拟定义</dt><dd>${c.def ? html`<span class="n-edit is-light" contenteditable="${!c.done && can ? 'plaintext-only' : 'false'}" spellcheck="false" data-def="${i}">${c.def}</span>` : html`<span class="nt-muted">没有草拟定义</span>`}</dd>
              ${c.events.length ? html`<dt>出处</dt><dd><ul class="n-cand__ev">${c.events.filter((id) => st.event(id)).map((id) => { const e = st.event(id); return html`<li>${UI.avatar(e.people[0], 'sm')}<a class="nt-plink" href="person.html?id=${e.people[0]}#ev-${id}">${e.title}</a><small>${NT.md(e.date)}</small></li>`; })}${c.count > c.events.length ? html`<li class="more">还有 ${c.count - c.events.length} 条</li>` : ''}</ul></dd>` : ''}
              <dt>判断</dt><dd><div class="n-cand__why">${c.why}</div></dd>
            </dl>
            ${c.done ? html`<div class="n-cand__done"><span class="ink-hand">${st.person(c.by).name}</span>${{ add: '收录进库', merge: `并入「${c.similar}」`, drop: '不要' }[c.done]} · ${NT.md(c.doneAt)}<button type="button" data-undo="${i}">撤销</button></div>`
              : can ? html`<div class="n-cand__actions"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-add="${i}">收录</button>${c.similar ? html`<button class="n-btn n-btn--sm" type="button" data-merge="${i}">并入「${c.similar}」</button>` : ''}<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-drop="${i}">不要</button></div>`
                : html`<div class="n-lock" style="margin-top:var(--s-3)">${icon('lock')}收录候选标签需要 HRBP 或 CEO。</div>`}
          </div>`)}
        </article>
      </div>`);
    main.onclick = (e) => {
      const b = e.target.closest('[data-add],[data-merge],[data-drop],[data-undo]'); if (!b) return;
      const i = +(b.dataset.add ?? b.dataset.merge ?? b.dataset.drop ?? b.dataset.undo);
      const c = S.tagCands[i];
      if (b.dataset.undo != null) { if (c.done === 'add') S.taglibAdd = S.taglibAdd.filter(([, t]) => t !== c.name); delete c.done; st.save(); render(main); return; }
      const def = main.querySelector(`[data-def="${i}"]`); if (def) c.def = def.textContent.trim();
      c.done = b.dataset.add != null ? 'add' : b.dataset.merge != null ? 'merge' : 'drop';
      c.by = st.me().id; c.doneAt = NT.TODAY;
      if (c.done === 'add') S.taglibAdd.push([c.name === '灰度发布' ? '技术方向' : '做事方式', c.name]);
      st.save(); render(main);
      NT.toast({ add: `已收录「${c.name}」，相关事件上的候选标签随之落墨`, merge: `已并入「${c.similar}」`, drop: `不收录「${c.name}」` }[c.done]);
    };
  }
})();
