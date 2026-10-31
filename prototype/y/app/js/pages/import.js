/* 面评导入：北森只能导出 PDF，系统按版式读出每位候选人的面评，HR 在预览里逐行确认「这是谁」。
   - 只导入已入职的人；淘汰、未入职、已经导入过的行跳过。
   - 面试原量表原样保存，不换算成维度分；非管理岗的「管理能力」写不适用。
   - 面试官不在人员目录里时进待核对，关联到目录里的人以后这一行才能导入；没读出的分对照页面图补录。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('id') || 'imp-1';
  const STATE = {
    confirm: ['待确认是谁', ''], confirmed: ['已确认', 'n-badge--yes'], verify: ['面试官待核对', 'n-badge--ai'], unread: ['有分待补录', 'n-badge--unknown'],
    unknown: ['认不出', 'n-badge--unknown'], sent: ['已放进待核对', 'n-badge--ai'], imported: ['已导入', 'n-badge--yes'], skip: ['将跳过', ''], dup: ['已导入过', ''],
  };

  NT.shell({
    nav: 'work', title: '面评导入', crumbs: [['工作台', 'index.html']],
    allow: (r) => r === 'hrbp' && !!st.importOf(id),
    denyTitle: st.importOf(id) ? '面评导入由 HR 处理' : '导入链接失效',
    denyText: st.importOf(id) ? '切换到 HR 视角，或回到工作台。' : '可能已删除，或链接有误。回到工作台，从「进行中的任务」重新进入。',
    view: () => `面评导入 · ${st.importOf(id)?.file || ''}`,
    render,
  });

  function render(main) {
    const imp = st.importOf(id);
    const rows = imp.rows.map((r) => ({ r, s: st.ivRowState(r) }));
    const n = (k) => rows.filter((x) => x.s === k).length;
    const live = rows.filter((x) => !['skip', 'dup'].includes(x.s)), skipped = rows.filter((x) => ['skip', 'dup'].includes(x.s));
    const ready = n('confirmed');
    mount(main, html`
      <header class="nt-head"><div><h1>面评导入</h1><p>${imp.file} · ${imp.pages} 页 · ${st.person(imp.by).name} ${imp.at.slice(5)} 上传 · 按版式读分</p></div>${imp.state === 'done' ? html`<span class="n-rstate" data-s="done">已导入</span>` : html`<span class="n-rstate" data-s="confirm">待逐行确认</span>`}</header>
      ${imp.prior ? html`<p class="n-note">${icon('info')}<span>这份文件 ${NT.md(imp.prior.at)} 导入过一次，那次已导入的 ${imp.prior.rows.length} 行这次跳过，其余行照常确认。</span></p>` : ''}
      <ul class="n-rsum" aria-label="这份面评">
        <li><b>${live.length}</b>行可导入</li>
        <li><b>${n('confirm')}</b>行待确认是谁</li>
        <li><b>${n('verify') + n('unread') + n('unknown')}</b>行待处理<small>面试官 ${n('verify')} · 补录 ${n('unread')} · 认不出 ${n('unknown')}</small></li>
        <li><b>${skipped.length}</b>行跳过</li>
      </ul>
      <div class="nt-grid" id="iv-rows">${live.map(({ r, s }) => rowCard(imp, r, s))}</div>
      ${skipped.length ? html`<details class="n-card nt-fold" style="margin-top:var(--s-4)"><summary><h3 class="n-section-title">跳过的 ${skipped.length} 行</h3><span class="nt-muted">淘汰和未入职的候选人跳过，只导入已入职的人</span>${icon('chev')}</summary>
        <ul class="nt-list" style="margin-top:var(--s-3)">${skipped.map(({ r, s }) => html`<li class="nt-row" style="justify-content:space-between;gap:var(--s-3)"><span><b style="font-weight:600">${r.name}</b> · ${r.pages} · ${st.ivTemplate(r.tpl).name}</span><span class="nt-muted">${s === 'dup' ? `${NT.md(imp.prior.at)} 已导入过` : `北森状态：${r.hr}`}</span></li>`)}</ul></details>` : ''}
      <div class="n-ivbar">
        <span class="nt-muted">${ready ? `已确认 ${ready} 行；导入后写进这些人的档案，作为面试段的历史评价` : '逐行确认「这是谁」以后，就能导入'}</span>
        <button class="n-btn n-btn--ink" type="button" id="iv-go" ${NT.raw(ready ? '' : 'disabled')}>${icon('upload')}导入已确认的 ${ready} 行</button>
      </div>`);
    main.onclick = async (e) => {
      const b = e.target.closest('[data-iv]'); if (b) act(imp, b.dataset.iv, b.dataset.row);
      if (e.target.closest('#iv-go')) go(imp);
    };
    main.onchange = (e) => { const f = e.target.closest('[data-fill]'); if (f) { st.ivFill(imp.id, f.dataset.fill, f.value); render(main); } };
  }

  function rowCard(imp, r, s) {
    const t = st.ivTemplate(r.tpl), p = r.match && st.person(r.match);
    const [label, cls] = STATE[s];
    const who = p ? html`<div class="n-ivrow__match">${UI.avatar(p.id, 'sm')}<span>人员目录：<b>${p.name}</b>${UI.demo()}<small>${st.orgShort(p.org)} · ${p.title} · ${NT.md(r.joined)} 入职</small></span></div>`
      : html`<div class="n-ivrow__match"><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">?</span><span>人员目录里查到 0 人<small>北森状态是${r.hr}；同步后再核对一次</small></span></div>`;
    const interviewer = r.interviewer ? html`面试官 ${st.person(r.interviewer).name}` : (r.verify ? html`面试官「${r.interviewerName}」待核对 <a class="n-link" href="inbox.html#${r.verify}">去核对</a>` : html`面试官待补：面评里没有写`);
    const scale = html`<div class="n-scale n-ivscale"><span class="n-scale__tag">原量表 · 不是维度分</span>${r.scores.map(([k, v]) => (v == null
      ? html`<span class="is-na">${k} 不适用<small>非管理岗</small></span>`
      : v === '?' ? html`<span class="${r.filled ? '' : 'is-miss'}">${k} ${r.filled || '待补录'}</span>` : html`<span>${k} ${v}</span>`))}<span>面试结论 ${r.verdict}</span></div>`;
    const unread = r.unread ? html`<div class="n-ivunread">
        <figure class="n-pdfcrop" aria-label="${r.pages}「${r.unread.item}」一栏的页面图"><figcaption>${r.pages} · ${r.unread.item}</figcaption><div class="n-pdfcrop__opts">${['A', 'B', 'C', 'D'].map((o) => html`<span class="${o === 'A' || o === 'B' ? 'is-on' : ''}"><i></i>${o}</span>`)}</div></figure>
        ${r.imported ? html`<p class="nt-caption">「${r.unread.item}」已补录为 ${r.filled}，随这一行导入档案；要更正，先撤销这次导入。</p>` : html`<label class="n-field"><span class="n-field__label">「${r.unread.item}」待补录：${r.unread.why}，对照页面图选一个</span><select class="n-input" data-fill="${r.id}"><option value="">选一个</option>${['A', 'B', 'C', 'D'].map((o) => NT.raw(`<option${r.filled === o ? ' selected' : ''}>${o}</option>`))}</select></label>`}</div>` : '';
    let acts = '';
    if (s === 'confirm') acts = html`<button class="n-btn n-btn--sm n-btn--ink" type="button" data-iv="ok" data-row="${r.id}">${icon('check')}是${p.name}</button>`;
    else if (s === 'confirmed') acts = html`<span class="n-badge n-badge--yes">${icon('check')}已确认是${p.name}</span><button class="n-link" type="button" data-iv="undo" data-row="${r.id}">改回</button>`;
    else if (s === 'unknown') acts = html`<button class="n-btn n-btn--sm" type="button" data-iv="send" data-row="${r.id}">${icon('spark')}放进待核对</button>`;
    else if (s === 'sent') acts = html`<a class="n-btn n-btn--sm n-btn--ghost" href="inbox.html#i-iv-${r.id}">查看待核对</a>`;
    else if (s === 'imported') acts = html`<a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${r.match}">查看档案</a>`;
    else if (s === 'verify' && r.verify) acts = html`<a class="n-btn n-btn--sm" href="inbox.html#${r.verify}">关联面试官</a>`;
    return html`<article class="n-card n-ivrow" data-state="${s}" id="iv-${r.id}">
      <div class="n-ivrow__head"><span class="n-ivrow__page">${r.pages}</span><b class="n-ivrow__name">${r.name}</b><span class="nt-muted">北森 · ${r.hr}</span><span class="n-badge ${cls}">${label}</span></div>
      ${who}
      <div class="n-ivrow__meta">${t.name} · ${t.scale} · ${NT.md(r.at)} 面试 · ${interviewer}</div>
      ${scale}${unread}
      ${r.note ? html`<p class="n-ivrow__note">${icon('quote', 13)}${r.note}${r.redacted ? html`<small>已隐去 ${r.redacted} 处学历类描述</small>` : ''}</p>` : ''}
      ${acts ? html`<div class="n-ivrow__acts">${acts}</div>` : ''}
    </article>`;
  }

  function act(imp, kind, rid) {
    if (kind === 'ok') { st.ivConfirm(imp.id, rid, true); render($('#main')); $(`#iv-${rid}`)?.classList.add('nt-flash'); }
    if (kind === 'undo') { st.ivConfirm(imp.id, rid, false); render($('#main')); }
    if (kind === 'send') { st.ivSend(imp.id, rid); render($('#main')); NT.toast('已放进待核对，北森同步后再确认是谁'); }
  }

  async function go(imp) {
    const rows = imp.rows.filter((r) => st.ivRowState(r) === 'confirmed');
    const v = await NT.dialog({
      title: `导入 ${rows.length} 行面评？`,
      body: html`<p>写进 ${rows.map((r) => st.person(r.match).name).join('、')} 的档案，作为面试段的历史评价，保留原量表。</p>`,
      facts: [html`来源：${imp.file}`, '待处理的行留在预览里，处理完再导入'],
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '导入', value: 'ok', cls: 'n-btn--ink', icon: 'upload' }],
    });
    if (v !== 'ok') return;
    const res = st.ivImport(imp.id);
    render($('#main'));
    NT.toast(`已导入 ${res.n} 行面评，在档案的时间线里`, { undo: () => { res.undo(); render($('#main')); }, undoneText: '已撤销导入，回到预览' });
  }
})();
