/* 项目复盘：按人才项目的关键节点回看一件事做得怎么样。
   每个节点三段：结果（从现有数据算）、复盘（HR 写做得好和要改进并署名，AI 草拟只作参考）、改进事项（挂在节点下的行动，五种状态跟到完成）。
   不属于任何节点的行动（项目找人、「值得聊一聊」生成的）放在左栏下方的「其他行动」里跟进。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const LABEL = { todo: '待沟通', doing: '进行中', done: '已执行待观察', reviewed: '已复盘', cancel: '未执行' };
  const NODE_LABEL = { done: '已复盘', todo: '待复盘', doing: '进行中', future: '未开始' };
  const FROM = { ai: '采用 AI 草拟', edit: '改写 AI 草拟', new: '写下复盘', fix: '修正复盘' };
  const ORDER = ['todo', 'doing', 'done', 'reviewed', 'cancel'];
  const PROGRAMS = NT.SEED.PROGRAMS;
  const hashAct = location.hash.slice(1);
  let key = NT.param('node') || (hashAct && st.actionNode(st.get().actions.find((a) => a.id === hashAct) || {})) || 'pg-xe6:end';
  let editing = null; // 'new' | 'edit' | 'fix'

  NT.shell({
    nav: 'programs', title: '关键节点复盘', crumbs: [['人才项目', 'landing.html']],
    allow: (r) => ['ceo', 'hrbp', 'lead'].includes(r),
    view: () => { const { g, node } = sel(); return `关键节点复盘 · ${g.name} · ${node.name}`; },
    state: () => ({ key, editing }),
    restore: (s) => { if (s.key) { key = s.key; editing = s.editing || null; render($('#main')); } },
    render,
  });

  function sel() {
    const [pg, id] = key.split(':');
    const g = PROGRAMS.find((x) => x.id === pg) || PROGRAMS[0];
    const nodes = st.programNodes(g.id);
    const node = nodes.find((n) => n.id === id) || nodes[0];
    return { g, node, k: st.nodeKey(g.id, node.id) };
  }

  function from(a) {
    if (a.from === 'signal') return '来自「值得聊一聊」';
    if (st.judgeBatch(a.from)) { const n = st.judgeBatch(a.from).name; return `来自${/^[A-Za-z]/.test(n) ? ' ' : ''}${n}`; }
    if (a.from === 'b-xe6-mid') return '来自中期盘点';
    const p = st.plan(a.from); if (!p) return '';
    return p.kind === 'staffing' ? `来自项目用人方案 v${p.version}` : `来自${p.title || '组织调整方案'} v${p.version}`;
  }
  // 判断对照生成的改进作用于人才评价规则，只给能看判断对照汇总的视角；对人的行动按归属范围过滤
  // 具体人员的管理行动必须有完整管理范围；仅有跨项目可见权限不能读取任用判断。
  const visible = (a) => (st.judgeBatch(a.from) ? st.canJudge() : !a.person || st.can('mgmt', a.person));
  const sorted = (l) => l.slice().sort((a, b) => ORDER.indexOf(st.actionState(a).s) - ORDER.indexOf(st.actionState(b).s));

  function actionRow(a) {
    const x = st.actionState(a);
    // 修订入营选拔标准的动作：状态跟着修订推进，只读，点开到规则页看那份修订
    if (x.derived) {
      return html`<div class="n-action" id="${a.id}"><div><div class="n-action__title">${a.title}${a.kind ? html` <span class="n-kind">${a.kind}</span>` : ''}</div>
        <div class="n-action__meta">${from(a)}${from(a) ? ' · ' : ''}${x.rev ? `修订 ${x.rev.v.replace(/^.*-(v\d+)$/, '$1')} · ` : ''}状态跟着修订自动推进 · 负责人 ${st.person(a.owner).name}</div></div>
        <a class="n-astate" data-s="${x.s}" href="rules.html?r=${a.rule.kind}&line=${a.rule.line}" title="在人才评价规则里看这份修订">${x.label}</a></div>`;
    }
    return html`<div class="n-action" id="${a.id}"><div><div class="n-action__title">${a.title}${a.kind ? html` <span class="n-kind">${a.kind}</span>` : ''}</div>
      <div class="n-action__meta">${from(a)}${from(a) ? ' · ' : ''}预计 ${NT.md(a.due)}${a.did ? ` · 实际 ${NT.md(a.did)}` : ''}${a.observe && a.state !== 'cancel' ? ` · 观察到 ${NT.md(a.observe)}` : ''} · 负责人 ${st.person(a.owner).name}${a.state === 'cancel' ? html` · <span class="why">${a.why}</span>` : ''}</div></div>
      <span class="n-menuwrap"><button class="n-astate" type="button" data-s="${a.state}" data-act="${a.id}" style="border:0;cursor:pointer" aria-label="改状态：${LABEL[a.state]}">${LABEL[a.state]}</button></span></div>`;
  }

  function render(main) {
    const S = st.get();
    const { g, node, k } = sel();
    key = k;
    const others = sorted(S.actions.filter((a) => visible(a) && !st.actionNode(a)));
    mount(main, html`
      ${UI.programHead('actions', '按人才项目的关键节点回看：每个节点做得怎么样、哪里要改。改进事项挂在节点下，跟到完成。')}
      <div class="nt-split nt-split--nav">
        <aside class="nt-grid">
          <nav class="n-card" aria-label="人才项目与关键节点">${PROGRAMS.map((p) => html`<div class="n-pgroup">
            <h3 class="n-pgroup__name">${p.name}<small>${NT.md(p.from)}–${NT.md(p.to)}</small></h3>
            <ol class="n-pnodes">${st.programNodes(p.id).map((n) => { const s = st.nodeState(p.id, n), nk = st.nodeKey(p.id, n.id); return html`<li><button class="n-pnode" type="button" data-node="${nk}" aria-current="${nk === k}">
              <span class="n-pnode__date">${n.at ? NT.md(n.at) : '—'}</span><span class="n-pnode__dot" data-s="${s}" aria-hidden="true"></span><span class="n-pnode__name">${n.name}${n.sub ? html`<small>${n.sub}</small>` : ''}</span><span class="n-pstate" data-s="${s}">${NODE_LABEL[s]}</span></button></li>`; })}</ol></div>`)}
          </nav>
          ${others.length ? html`<article class="n-card"><h3 class="n-section-title">其他行动<span class="n-count is-quiet">${others.length}</span></h3><p class="nt-muted" style="margin:0 0 var(--s-2)">项目找人和「值得聊一聊」生成的行动在这里跟进。</p>${others.map(actionRow)}</article>` : ''}
        </aside>
        <article class="n-card" id="retro">${detail(g, node, k)}</article>
      </div>`);
    NT.$$('[data-act]', main).forEach((btn) => {
      const a = S.actions.find((x) => x.id === btn.dataset.act);
      NT.menu(btn, ORDER.filter((s) => s !== a.state).map((s) => ({ label: LABEL[s], run: () => setState(a, s) })));
    });
    main.onclick = (e) => {
      const n = e.target.closest('[data-node]'); if (n) { key = n.dataset.node; editing = null; render(main); if (matchMedia('(max-width: 900px)').matches) $('#retro').scrollIntoView({ block: 'start' }); return; }
      const b = e.target.closest('[data-retro]'); if (b) retroAction(b.dataset.retro);
      if (e.target.closest('[data-add-act]')) addAction();
    };
    if (hashAct && document.getElementById(hashAct)) document.getElementById(hashAct).scrollIntoView({ block: 'center' });
  }

  function detail(g, node, k) {
    const s = st.nodeState(g.id, node), facts = st.nodeFacts(g.id, node);
    const acts = sorted(st.get().actions.filter((a) => visible(a) && st.actionNode(a) === k));
    return html`<div class="nt-row" style="justify-content:space-between;align-items:baseline"><h2 class="n-section-title" style="margin:0">${g.name} · ${node.name}</h2><span class="n-pstate" data-s="${s}">${node.at ? `${NT.md(node.at)} · ` : ''}${NODE_LABEL[s]}</span></div>
      <h3 class="n-pnode-h">结果</h3>
      ${facts.length ? html`<dl class="n-pfacts">${facts.map((f) => html`<div><dt>${f.k}</dt><dd>${f.v}${f.href ? html` <a class="n-link" href="${f.href}">查看</a>` : ''}</dd></div>`)}</dl>`
        : html`<p class="nt-muted" style="margin:0">这一期的结果明细待导入。</p>`}
      <h3 class="n-pnode-h">复盘</h3>
      ${retroBlock(g, node, k, s)}
      <h3 class="n-pnode-h">改进事项${acts.length ? html`<span class="n-count is-quiet">${acts.length}</span>` : ''}</h3>
      ${acts.length ? acts.map(actionRow) : html`<p class="nt-muted" style="margin:0">改进事项会出现在这里。</p>`}
      ${st.canWriteRetro() && s !== 'future' ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-add-act style="margin-top:var(--s-2)">${icon('plus')}加一条改进事项</button>` : ''}`;
  }

  const lists = (r) => html`<div><h5>做得好</h5>${r.good.length ? html`<ul>${r.good.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="nt-muted" style="margin:0">待补充</p>`}</div>
    <div><h5>要改进</h5>${r.improve.length ? html`<ul>${r.improve.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="nt-muted" style="margin:0">待补充</p>`}</div>`;

  function retroBlock(g, node, k, s) {
    if (s === 'future') return html`<p class="nt-muted" style="margin:0">${node.at ? `${NT.md(node.at)} 之后` : '节点结束后'}再复盘。</p>`;
    const saved = st.nodeRetro(k), can = st.canWriteRetro();
    const draft = s === 'doing' ? null : st.nodeDraft(g.id, node);
    if (can && editing) {
      const base = editing === 'fix' ? saved : editing === 'edit' ? draft : { good: [], improve: [] };
      return html`<div class="n-pretro__edit">
          <div><label for="rt-good">做得好 · 一行一条</label><textarea class="n-calib__reason" id="rt-good" rows="4" placeholder="比如：导师都按时交了周评">${base.good.join('\n')}</textarea></div>
          <div><label for="rt-improve">要改进 · 一行一条</label><textarea class="n-calib__reason" id="rt-improve" rows="4" placeholder="比如：中间档没有写行为要求，区分不开">${base.improve.join('\n')}</textarea></div>
        </div>
        <div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-retro="save">保存复盘</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-retro="cancel">取消</button><span class="nt-muted">保存后署名，旧版本保留</span></div>`;
    }
    if (saved) {
      const n = st.nodeRetroHist(k).length;
      return html`<div class="n-block n-pretro" data-state="ink">${lists(saved)}<div class="n-block__by"><span class="n-block__sig">${st.person(saved.by).name}</span>${NT.md(saved.at)} ${FROM[saved.from] || '写下复盘'}${n > 1 ? ` · 改过 ${n - 1} 次` : ''}${can ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-retro="fix" style="margin-left:auto">${icon('pen')}修正</button>` : ''}</div></div>`;
    }
    if (s === 'doing') return html`<p class="nt-muted" style="margin:0">${node.name}还在进行，方案确认后再复盘。</p>`;
    if (!can) return html`<p class="nt-muted" style="margin:0">待 HR 复盘。</p>`;
    if (draft) {
      return html`<div class="n-block n-pretro" data-state="light">${lists(draft)}<div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}AI 草拟 · 仅供参考</span><span class="n-review__evact"><button class="n-btn n-btn--sm" type="button" data-retro="adopt">${icon('check')}采用</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-retro="edit">${icon('pen')}改写</button></span></div></div>`;
    }
    return html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-retro="new">${icon('pen')}写复盘</button>`;
  }

  function retroAction(kind) {
    const main = $('#main'), { g, node, k } = sel();
    if (kind === 'cancel') { editing = null; render(main); return; }
    if (['new', 'edit', 'fix'].includes(kind)) { editing = kind; render(main); $('#rt-good')?.focus(); return; }
    let good, improve, fromKind;
    if (kind === 'adopt') { ({ good, improve } = st.nodeDraft(g.id, node)); fromKind = 'ai'; }
    else {
      const read = (id) => $(id).value.split('\n').map((t) => t.trim()).filter(Boolean);
      good = read('#rt-good'); improve = read('#rt-improve');
      if (!good.length && !improve.length) { const t = $('#rt-good'); t.focus(); t.placeholder = '至少写一条；保持原样就点取消'; return; }
      fromKind = editing;
    }
    const undo = st.setNodeRetro(k, good, improve, fromKind);
    editing = null; render(main);
    NT.toast(`已记下${node.name}的复盘`, { undo: () => { undo(); render($('#main')); } });
  }

  async function addAction() {
    const { node, k } = sel();
    const r = await NT.dialog({ title: `加一条改进事项 · ${node.name}`, body: html`<label class="nt-muted" for="na-title">要改什么</label><input class="n-input" id="na-title" style="margin:var(--s-1) 0 var(--s-3)" placeholder="比如：下一期中期盘点前先补齐周评">
        <label class="nt-muted" for="na-due">预计完成</label><input class="n-input" id="na-due" type="date" value="${NT.addDays(NT.TODAY, 14)}" style="margin-top:var(--s-1)">`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '加上', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#na-title').value.trim() && !!d.querySelector('#na-due').value, read: (d) => ({ title: d.querySelector('#na-title').value.trim(), due: d.querySelector('#na-due').value }) }] });
    if (r?.value !== 'ok') return;
    const undo = st.addNodeAction(k, r.data.title, r.data.due);
    render($('#main'));
    NT.toast('已加上改进事项，负责人是你', { undo: () => { undo(); render($('#main')); } });
  }

  async function setState(a, s) {
    if (a.rule) return; // 跟着修订推进的动作不手工改
    const hadWhy = Object.prototype.hasOwnProperty.call(a, 'why');
    const prev = { state: a.state, did: a.did, stateAt: a.stateAt, stateTs: a.stateTs, why: a.why };
    if (s === 'cancel') {
      const r = await NT.dialog({ title: '记录未执行的原因', body: html`<p>写一句原因。</p><textarea class="n-calib__reason" id="why" aria-label="原因" style="margin-top:var(--s-3)" placeholder="比如：项目优先级下调，换到下一期"></textarea>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '记录', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#why').value.trim(), read: (d) => d.querySelector('#why').value.trim() }] });
      if (r?.value !== 'ok') return;
      a.why = r.data;
    }

    a.state = s; a.stateAt = NT.TODAY; a.stateTs = Date.now(); if (s === 'done' && !a.did) a.did = NT.TODAY; // stateAt：关注动态里的行动状态变化（v1.5 3.26.2）
    // 不持久化的操作标记：新一次状态修改会让旧 Toast 的撤销失效。
    const undoKey = Symbol.for('qtalent.action-state-undo'), revision = {};
    a[undoKey] = revision;
    st.save(); render($('#main'));
    NT.toast(`已改为「${LABEL[s]}」`, { undo: () => {
      if (a[undoKey] !== revision) return;
      delete a[undoKey];
      Object.assign(a, prev); if (!hadWhy) delete a.why;
      st.save(); render($('#main'));
    } });
  }
})();
