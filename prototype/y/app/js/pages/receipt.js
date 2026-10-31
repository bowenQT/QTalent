/* 回执：一次投递的材料走同一条流程，回执告诉提交人读到了什么。
   文件各自显示处理中、已解析、失败；涉及哪些人、整理出几件事；几处待核对；几件事的建议分待确认。
   确认在这里一条一条做，企业微信和 Claude Code 里的回执只带链接；没有「全部确认」。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('id');

  NT.shell({
    nav: 'work', title: '回执', crumbs: [['工作台', 'index.html']],
    allow: (r) => r !== 'ceo' && st.canSeeDrop(st.drop(id)),
    denyTitle: st.drop(id) ? '这份回执属于其他人' : '回执链接失效',
    denyText: st.drop(id) ? '回执只给提交人、要确认其中事项的评价人和负责的 HR。回到工作台看你自己的材料。' : '可能已删除，或链接有误。回到工作台，从「进行中的任务」重新进入。',
    view: () => `回执 · ${st.drop(id)?.title || ''}`,
    render,
  });

  let timer = 0;
  function render(main) {
    const d = st.drop(id);
    if (d.kind === 'interview') { location.replace(st.dropHref(d)); return; }
    st.tickDrops();
    const s = st.dropSummary(d), [stateKey, stateLabel] = st.dropState(d);
    const items = st.dropItems(d);
    const mine = items.filter((x) => x.mine), others = items.filter((x) => !x.mine);
    const canSeeOthers = st.role() === 'hrbp';
    const raters = [...new Set(others.map((x) => x.ev.recorder))].map((p) => st.person(p)?.name).join('、');
    document.title = `回执 · ${d.title} · Niu-Talent`;
    mount(main, html`
      <header class="nt-head"><div><h1>${d.title}</h1><p>${st.ENTRY[d.entry]}${d.tool ? ` · ${d.tool}` : ''} · ${st.person(d.by).name}交 · ${d.at.slice(5)}</p></div><span class="n-rstate" data-s="${stateKey}">${stateLabel}</span></header>
      <ul class="n-rsum" aria-label="这次读到了什么">
        <li><b>${s.files}</b>个文件${s.processing ? html`<small>${s.processing} 个处理中</small>` : ''}${s.failed ? html`<small class="is-err">${s.failed} 个失败</small>` : ''}</li>
        <li><b>${s.people}</b>人</li>
        <li><b>${s.events}</b>件事</li>
        <li><b>${s.verifyOpen}</b>处待核对</li>
        <li><b>${s.toConfirm}</b>件待确认${s.confirmed ? html`<small>已确认 ${s.confirmed}</small>` : ''}</li>
      </ul>
      <div class="nt-split">
        <div class="nt-grid">
          <article class="n-card"><h3 class="n-section-title">文件</h3>
            <ul class="n-files" style="margin:0">${d.files.map((f) => fileRow(d, f))}</ul>
            ${s.processing ? html`<p class="nt-caption">还在处理的文件读完后，这份回执会更新；可以先离开。</p>` : ''}
          </article>
          ${s.verify.length ? html`<article class="n-card"><h3 class="n-section-title">待核对${s.verifyOpen ? html`<span class="n-count">${s.verifyOpen}</span>` : ''}</h3>
            <ul class="nt-list">${s.verify.map((i) => html`<li class="nt-row" style="justify-content:space-between;gap:var(--s-3)"><span><span class="n-kind">${Object.fromEntries(st.INBOX_KINDS)[i.kind]}</span> ${i.q.replace(/？$/, '')}${i.done ? html` → <b>${i.choice === 'none' ? '名单外的人' : i.choice === 'rows' ? '整理范围内的部分' : i.choice === 'attach' ? '只作附件' : st.person(i.choice)?.name || ''}</b>` : ''}</span>${i.done ? html`<span class="n-badge n-badge--yes">${icon('check')}已核对</span>` : i.by === st.me().id || st.role() === 'hrbp' ? html`<a class="n-btn n-btn--sm" href="inbox.html#${i.id}">去核对</a>` : ''}</li>`)}</ul>
          </article>` : ''}
          <section id="confirm" class="nt-grid" aria-labelledby="rc-h">
            <h3 class="n-section-title" id="rc-h" style="margin:0">${mine.length ? '等你确认' : raters ? `等${raters}确认` : '整理出的事'}${s.mineToConfirm ? html`<span class="n-count">${s.mineToConfirm}</span>` : ''}</h3>
            ${mine.length ? html`<p class="nt-muted" style="margin:0">一件一件看证据和出处，确认或改分；确认后才进入档案、象限和找人证据。</p>` : ''}
            ${items.length ? '' : html`<div class="nt-empty">${s.processing ? '整理出的事会出现在这里。' : '这次的材料里整理出 0 件事，原件已保存。'}</div>`}
            ${mine.map(UI.receiptItem)}
            ${canSeeOthers ? others.map(UI.receiptItem) : others.length ? html`<p class="nt-muted" style="margin:0">另有 ${others.length} 件事属于其他评价人，已隐藏。</p>` : ''}
          </section>
        </div>
        <aside class="nt-grid nt-sticky">
          ${channelCard(d, s)}
          <article class="n-card"><h3 class="n-section-title">涉及的人</h3>
            <div class="nt-grid" style="gap:var(--s-2)">${d.mentions.filter((p) => st.scope(p)).map((p) => UI.person(p, { size: 'sm', meta: st.orgShort(st.person(p).org) }))}</div>
            ${d.mentions.some((p) => !st.scope(p)) ? html`<p class="nt-muted" style="margin:var(--s-2) 0 0">另有 ${d.mentions.filter((p) => !st.scope(p)).length} 人在你的查看范围之外，已隐藏。</p>` : ''}
          </article>
        </aside>
      </div>`);
    UI.wireReceipt($('#confirm'), () => render($('#main')));
    main.onclick = (e) => {
      const r = e.target.closest('[data-retry]');
      if (r) { st.retryFile(d.id, r.dataset.retry); render(main); NT.toast('已重新上传，读完后回执会更新'); }
    };
    // 有文件在处理时按约定时间刷新
    clearInterval(timer);
    if (d.files.some((f) => f.steps?.some((x) => !x.done))) timer = setInterval(() => { if (st.tickDrops()) render($('#main')); }, 600);
  }

  function fileRow(d, f) {
    const [ic, label] = st.FILE_STATE[f.state];
    const k = UI.attachKind(f.name);
    const busy = ['uploading', 'queued', 'parsing', 'transcribing'].includes(f.state);
    return html`<li class="n-file" data-state="${f.state}"><span class="n-file__ext">${f.kind === 'code' ? 'PR' : k.ext}</span><div style="min-width:0"><div class="n-file__name">${f.name}</div>
      <div class="n-file__state"><span class="${f.state === 'failed' ? 'err' : f.state === 'done' ? 'ok' : ''}">${icon(ic, 12)} ${label}</span> · ${f.meta}</div>${busy ? html`<div class="n-progress is-indeterminate"><i></i></div>` : ''}</div>
      ${f.state === 'failed' && d.by === st.me().id && st.canConvert(f) ? html`<button class="n-btn n-btn--sm" type="button" data-retry="${f.name}">${icon('upload')}转成 JPG 重传</button>` : html`<span></span>`}</li>`;
  }

  // 提交人在入口里看到的回执：企业微信单聊回一张卡，Claude Code 里回一段文字；确认都回到这一页
  function channelCard(d, s) {
    const line = `读完了「${d.title}」：${s.files} 个文件，涉及 ${s.people} 人，整理出 ${s.events} 件事。${s.verifyOpen ? `${s.verifyOpen} 处等你核对，` : ''}${s.toConfirm ? `${s.toConfirm} 件事的建议分等你确认。` : ''}`;
    if (d.entry === 'wecom') {
      return html`<article class="n-card n-imcard" aria-label="企业微信里的回执"><h3 class="n-section-title">企业微信里的回执 ${UI.demo()}</h3>
        <div class="n-imcard__bubble"><span class="nt-ip" data-ip="rest" data-size="24"></span><div><b>小犇</b><p>${line}</p><a class="n-btn n-btn--sm" href="#confirm">${icon('up-r')}到 Web 确认</a></div></div>
        <p class="nt-caption">回执和确认链接发到提交人的单聊；在群里交的，群里只回「收到了」。</p></article>`;
    }
    if (d.entry === 'mcp') {
      return html`<article class="n-card n-imcard" aria-label="Claude Code 里的回执"><h3 class="n-section-title">Claude Code 里的回执 ${UI.demo()}</h3>
        <pre class="n-term">⏺ 调用 niu · ${d.tool}
  涉及的人  ${d.mentions.map((p) => st.person(p).name).join('、')}
  出处      ${d.files[0].name} ${d.files[0].meta}
⏺ 已交给 Niu-Talent，整理出 ${s.events} 件事
  建议分等你确认 → 在 Web 上确认</pre>
        <p class="nt-caption">桌面 agent 只能交材料、看人和起草需求；确认回到这一页做。</p></article>`;
    }
    return html`<article class="n-card n-imcard"><h3 class="n-section-title">回执也会发到</h3><p class="nt-muted" style="margin:0">你的企业微信单聊，带这一页的链接；手机上也能打开确认。</p></article>`;
  }
})();
