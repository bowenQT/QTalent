/* 行动与复盘：方案确认后的每件事都是一条行动，五种状态；预计日期和实际日期分开记；没执行要写原因，不算员工的失败。
   复盘时左边是当时的判断（冻结的版本），右边是后来的事实，结论只有继续、调整、撤回三种。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const LABEL = { todo: '待沟通', doing: '进行中', done: '已执行待观察', reviewed: '已复盘', cancel: '未执行' };
  let open = NT.param('retro') || (location.hash ? location.hash.slice(1) : 'a-chen');

  NT.shell({
    nav: 'actions', title: '行动与复盘',
    allow: (r) => ['ceo', 'hrbp', 'lead'].includes(r),
    view: () => `行动与复盘 · 复盘「${st.get().actions.find((a) => a.id === open)?.title || ''}」`,
    state: () => ({ open }),
    restore: (s) => { if (s.open) { open = s.open; render($('#main')); } },
    render,
  });

  function from(a) {
    if (a.from === 'signal') return '来自「值得聊一聊」';
    if (st.pushOf(a.from)) return '来自 CEO 推动';
    if (st.judgeBatch(a.from)) return `来自${st.judgeBatch(a.from).name}`;
    const p = st.plan(a.from); if (!p) return '';
    return p.kind === 'staffing' ? `来自项目用人方案 v${p.version}` : `来自组织调整方案 v${p.version}`;
  }

  function render(main) {
    const S = st.get();
    // 判断对照生成的改进动作作用于人才评价规则，只给能看判断对照汇总的视角
    const list = S.actions.filter((a) => (st.judgeBatch(a.from) ? st.canJudge() : !a.person || st.scope(a.person)));
    const order = ['todo', 'doing', 'done', 'reviewed', 'cancel'];
    const sorted = list.slice().sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
    const retro = list.find((a) => a.id === open && a.then);
    mount(main, html`
      <header class="nt-head"><div><h1>行动与复盘</h1><p>行动来自已确认的方案和「值得聊一聊」。执行后按约定时间复盘：对照当时的判断和后来的事实。</p></div></header>
      <div class="nt-split nt-split--wide">
        <article class="n-card"><h3 class="n-section-title">行动<span class="n-count is-quiet">${list.length}</span></h3>
          ${sorted.map((a) => html`<div class="n-action" id="${a.id}"><div><div class="n-action__title">${a.title}${a.kind ? html` <span class="n-kind">${a.kind}</span>` : ''}</div>
            <div class="n-action__meta">${from(a)}${from(a) ? ' · ' : ''}预计 ${NT.md(a.due)}${a.did ? ` · 实际 ${NT.md(a.did)}` : ''}${a.observe && a.state !== 'cancel' ? ` · 观察到 ${NT.md(a.observe)}` : ''} · 负责人 ${st.person(a.owner).name}${a.state === 'reviewed' && a.retro ? ` · ${NT.md(a.retro.at)} 已复盘：${a.retro.verdict}` : ''}${a.state === 'cancel' ? html` · <span class="why">${a.why}</span>` : ''}</div>
            ${a.then && ['done', 'reviewed'].includes(a.state) ? html`<button class="n-link" type="button" data-retro="${a.id}" style="margin-top:4px">${a.state === 'reviewed' ? '看复盘' : '去复盘'}</button>` : ''}</div>
            <span class="n-menuwrap"><button class="n-astate" type="button" data-s="${a.state}" data-act="${a.id}" style="border:0;cursor:pointer" aria-label="改状态：${LABEL[a.state]}">${LABEL[a.state]}</button></span></div>`)}
        </article>
        <aside id="retro">${retro ? retroCard(retro) : html`<div class="n-card">${UI.state({ ip: 'rest', size: 48, title: '选一条已执行的行动去复盘', text: '复盘时左边是当时的判断（冻结的版本），右边是后来的事实。' })}</div>`}</aside>
      </div>`);
    NT.$$('[data-act]', main).forEach((btn) => {
      const a = S.actions.find((x) => x.id === btn.dataset.act);
      NT.menu(btn, order.filter((s) => s !== a.state && s !== 'reviewed').map((s) => ({ label: LABEL[s], run: () => setState(a, s) })));
    });
    main.onclick = (e) => {
      const r = e.target.closest('[data-retro]'); if (r) { open = r.dataset.retro; render(main); $('#retro').scrollIntoView({ block: 'nearest' }); }
      const save = e.target.closest('#retro-save'); if (save) saveRetro(main);
    };
  }

  async function setState(a, s) {
    const hadWhy = Object.prototype.hasOwnProperty.call(a, 'why');
    const prev = { state: a.state, did: a.did, stateAt: a.stateAt, stateTs: a.stateTs, why: a.why };
    if (s === 'cancel') {
      const r = await NT.dialog({ title: '记录未执行的原因', body: html`<p>写一句原因。</p><textarea class="n-calib__reason" id="why" style="margin-top:var(--s-3)" placeholder="比如：项目优先级下调，换到下一期"></textarea>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '记录', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#why').value.trim(), read: (d) => d.querySelector('#why').value.trim() }] });
      if (r?.value !== 'ok') return;
      a.why = r.data;
    }

    a.state = s; a.stateAt = NT.TODAY; a.stateTs = Date.now(); if (s === 'done' && !a.did) a.did = NT.TODAY; // stateAt：关注动态里的行动状态变化（v1.5 3.26.2）
    st.save(); render($('#main'));
    NT.toast(`已改为「${LABEL[s]}」`, { undo: () => { Object.assign(a, prev); if (!hadWhy) delete a.why; st.save(); render($('#main')); } });
  }

  function retroCard(a) {
    const r = a.retro;
    const nowFacts = a.now || (a.person ? st.eventsOf(a.person, { kind: 'obs' }).filter((e) => e.date && e.date >= (a.did || a.due)).slice(0, 3).map((e) => [e.title, e.id]) : []);
    const plan = st.plan(a.from);
    return html`<article class="n-card"><h3 class="n-section-title">任用后复盘 · ${a.title}</h3>
      <div class="n-retro">
        <div class="n-retro__col n-retro__then"><h5>当时的判断 · ${plan ? `${plan.kind === 'org' ? '组织调整方案' : '用人方案'} v${plan.version} · ${NT.md(plan.confirmedAt || plan.at)} 冻结` : st.pushOf(a.from) ? `CEO 推动 · ${NT.md(st.pushOf(a.from).at)} 发起` : '冻结的版本'}</h5><ul>${a.then.map((t) => html`<li>${t}</li>`)}</ul></div>
        <div class="n-retro__col n-retro__now"><h5>后来的事实 · ${NT.md(a.did || a.due)} 至今</h5>${nowFacts.length ? html`<ul>${nowFacts.map(([t, ev]) => html`<li>${t}${ev ? UI.cite(st.event(ev)?.srcs[0] || { type: 'note', label: st.event(ev)?.title, loc: NT.md(st.event(ev)?.date) }, 1) : ''}</li>`)}</ul>` : html`<p class="nt-muted" style="margin:0">新的事实会出现在这里。可以先记一条观察再复盘。</p>`}</div>
        <div class="n-retro__foot">
          ${r ? html`<div class="n-block" data-state="ink"><span class="n-badge n-badge--seal" style="margin-right:6px">${r.verdict}</span>${r.text}<div class="n-block__by"><span class="n-block__sig">${st.person(r.by).name}</span>${NT.md(r.at)} 复盘 · 已回到${a.person ? `${st.person(a.person).name}的档案时间线` : '档案'}</div></div>`
            : html`<div class="n-seg n-seg--md" role="group" aria-label="复盘结论" id="verdict">${['继续', '调整', '撤回'].map((v, i) => html`<button type="button" aria-pressed="${i === 0}">${v}</button>`)}</div>
              <textarea class="n-calib__reason" id="retro-text" aria-label="复盘说明">${a.id === 'a-chen' ? '范围缩小是预算原因；在缩小后的范围内达成了观察目标。' : ''}</textarea>
              <div class="nt-row"><button class="n-btn n-btn--ink" type="button" id="retro-save">记录复盘</button><span class="nt-muted">结果回到${a.person ? `${st.person(a.person).name}的` : ''}档案时间线</span></div>`}
        </div>
      </div></article>`;
  }

  function saveRetro(main) {
    const a = st.get().actions.find((x) => x.id === open);
    const text = $('#retro-text').value.trim();
    if (!text) { $('#retro-text').focus(); return; }
    const verdict = NT.$('#verdict [aria-pressed="true"]').textContent;
    a.retro = { verdict, text, by: st.me().id, at: NT.TODAY }; a.state = 'reviewed'; a.stateAt = NT.TODAY; a.stateTs = Date.now();
    if (a.person) st.addEvent({ id: NT.uid('e'), kind: 'obs', date: NT.TODAY, recorder: st.me().id, people: [a.person], title: `任用后复盘：${a.title}（${verdict}）`, bg: '方案确认后按约定时间复盘。', act: text, res: `结论：${verdict}`, srcs: [{ type: 'note', label: '任用后复盘', loc: NT.md(NT.TODAY), quote: text }], tags: [], scores: [] });
    st.save(); render(main);
    NT.toast(`复盘已记录：${verdict}`);
  }
})();
