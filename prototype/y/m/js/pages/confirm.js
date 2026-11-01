/* 手机回执确认：从企业微信回执里的链接打开。先核对拿不准的人名和说话人，再一件一件确认或改分；没有「全部确认」。
   和桌面回执页用同一套确认卡；只显示本人有评价关系的事，其余隐藏。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('r');
  const d = st.drop(id);

  NT.mshell({
    tab: 'todo', title: '回执确认', back: 'inbox.html',
    allow: () => !!d && st.canSeeDrop(d),
    denyTitle: d ? '这份回执属于其他人' : '回执链接失效',
    denyText: d ? '回执只给提交人和要确认其中事项的评价人。回到待办看你自己的事。' : '可能已删除，或链接有误。回到待办，从回执消息重新打开。',
    demos: [['桌面版回执', `../app/receipt.html?id=${id || 'd-ms2'}&as=mentor`], ['失效的链接', 'confirm.html?r=d-x']],
    view: () => `回执确认 · ${d?.title || ''}`,
    render,
  });

  let timer = 0;
  function render(main) {
    st.tickDrops();
    const s = st.dropSummary(d), items = st.dropItems(d);
    const mine = items.filter((x) => x.mine);
    const open = s.verify.filter((i) => !i.done && i.by === st.me().id);
    // 角标和上方「件待你确认」同一个数：待认人只算在待核对里，认出人以后才算
    const left = s.mineToConfirm, held = mine.some((x) => x.state === 'held');
    mount(main, html`
      <section class="m-card">
        <p class="nt-muted" style="margin:0 0 4px">${st.ENTRY[d.entry]} · ${d.at.slice(5)}</p>
        <h2 style="margin:0 0 var(--s-2);font-size:var(--t-lg)">${d.title}</h2>
        <ul class="n-rsum" style="margin:0"><li><b>${s.people}</b>人</li><li><b>${s.events}</b>件事</li><li><b>${s.verifyOpen}</b>处待核对</li><li><b>${s.mineToConfirm}</b>件待你确认</li></ul>
      </section>
      ${open.length ? html`<h3 class="m-h">先核对 ${open.length} 处</h3><ul class="m-list">${open.map((i) => html`<li><a class="m-row" href="inbox.html#${i.id}">${icon('spark')}<span>${i.q.replace(/？$/, '')}<small>${i.src} · ${i.at}</small></span>${icon('chev')}</a></li>`)}</ul>` : ''}
      <h3 class="m-h" id="confirm">逐条确认${left ? html`<span class="n-count">${left}</span>` : ''}</h3>
      ${left ? html`<p class="nt-muted" style="margin:-4px 0 var(--s-3)">看证据和出处，确认或改分；确认后才进入档案。</p>` : mine.length && !held ? html`<div class="m-card">${UI.state({ ip: 'done', size: 40, title: '这份回执里的事都确认完了', text: '已进入档案。' })}</div>` : ''}
      ${!mine.length && st.dropPending(d) ? html`<div class="m-card"><p class="nt-muted" style="margin:0">材料还在处理，整理出的事会出现在这里；可以先离开。</p></div>` : ''}
      <div class="nt-grid" id="rc-list">${mine.map(UI.receiptItem)}</div>
      ${s.hidden ? html`<p class="nt-muted" style="margin:var(--s-3) 0 0">部分内容已按权限隐藏</p>` : ''}`);
    UI.wireReceipt($('#rc-list'), () => render($('#main')));
    // 批次还在处理时继续推进；文件状态变了或整理出的事就绪了才重画，不打断正在改的分
    clearInterval(timer);
    if (st.dropPending(d)) {
      const ready = items.length;
      timer = setInterval(() => { if (st.tickDrops() || st.dropItems(d).length !== ready || !st.dropPending(d)) render($('#main')); }, 600);
    }
  }
})();
