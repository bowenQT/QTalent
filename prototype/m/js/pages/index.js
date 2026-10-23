/* 手机工作台：一句话入口、按身份的快捷操作、待办摘要、进行中的任务。员工本人只看到发布给自己的事和补充经历。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount } = NT;
  const STATE = { uploading: ['upload', '上传中'], queued: ['clock', '排队中'], transcribing: ['wave', '转写中'], shaping: ['spark', '整理中'], partial: ['spark', '部分完成'], done: ['check', '已完成'], failed: ['info', '整理失败'] };

  NT.mshell({
    tab: 'work', title: '工作台',
    view: () => '手机工作台',
    render,
  });

  function render(main) {
    const role = st.role(), me = st.me();
    const todos = st.todos();
    const hour = new Date().getHours();
    const hello = hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    if (role === 'self') return renderSelf(main, me, todos);
    const quick = [
      ['record.html', 'wave', '录音', '复盘会、一对一'],
      ['quick.html', 'pen', '一句话记录', '说一件具体的事'],
      (role === 'mentor' || role === 'hrbp') && ['mentor.html', 'users', '导师评价', 'Landing W2 对人复盘'],
      (role === 'ceo' || role === 'hrbp' || role === 'lead') && ['plan.html', 'stamp', '确认方案', `${st.get().plans.filter((p) => p.status === 'draft').length} 份草稿`],
    ].filter(Boolean);
    const tasks = st.get().tasks.filter((t) => t.state !== 'done').slice(0, 4);
    mount(main, html`
      <h2 class="m-hello">${hello}，${me.name}<small>${NT.md(NT.TODAY)} 周五 · ${st.roles[role].scope}</small></h2>
      <a class="m-composer" href="quick.html"><span class="nt-ip" data-ip="listening" data-size="32"></span><span>说一件刚发生的事…</span><span class="m-composer__mic" aria-hidden="true">${icon('mic')}</span></a>
      <div class="m-quick">${quick.map(([href, ic, t, sub]) => html`<a href="${href}">${icon(ic)}<b>${t}</b><small>${sub}</small></a>`)}</div>

      <h3 class="m-h">待办${todos.length ? html`<span class="n-count">${todos.length}</span>` : ''}<a class="nt-linkbtn" href="inbox.html" style="margin-left:auto">全部</a></h3>
      ${todos.length ? html`<ul class="m-list">${todos.slice(0, 4).map((t) => M.row(M.todoHref(t), html`<span class="n-badge ${t.cls || ''}" style="flex:none">${t.icon ? icon(t.icon) : ''}${t.badge}</span>`, t.title, t.sub))}</ul>`
        : html`<div class="m-card">${UI.state({ ip: 'done', size: 40, title: '没有待办', text: '新的待核对、待确认会出现在这里。' })}</div>`}

      ${tasks.length ? html`<h3 class="m-h">进行中的任务</h3><div class="m-card m-tasks">${tasks.map((t) => {
        const [ic, label] = STATE[t.state] || ['spark', ''];
        const link = t.state === 'partial' ? (t.link || 'record.html?m=w2') : t.state === 'shaping' && t.live ? 'record.html?step=processing' : '';
        return html`<div class="n-task" data-state="${t.state}"><span class="n-task__icon">${icon(ic)}</span><div style="min-width:0"><div class="n-task__name">${t.name}${t.preset ? html` <span class="n-badge n-badge--preset">演示任务</span>` : ''}</div><div class="n-task__state"><b>${label}</b> · ${t.note}</div>${t.state === 'uploading' ? html`<div class="n-progress"><i style="width:${t.progress}%"></i></div>` : t.state === 'shaping' ? html`<div class="n-progress is-indeterminate"><i></i></div>` : ''}</div>${link ? html`<div class="n-task__acts"><a class="n-btn n-btn--sm" href="${link}">${t.state === 'partial' ? '去看' : '查看'}</a></div>` : ''}</div>`;
      })}</div>` : ''}

      <h3 class="m-h">最近看过</h3>
      <ul class="m-list">${['p-lin', 'p-tangguo', 'p-zhouyu', 'p-heyn'].filter((id) => st.scope(id)).slice(0, 3).map((id) => { const p = st.person(id); return M.row(`person.html?id=${id}`, UI.avatar(id, 'sm'), p.name, `${st.orgShort(p.org)} · ${p.title}`); })}</ul>`);
  }

  function renderSelf(main, me, todos) {
    mount(main, html`
      <h2 class="m-hello">你好，${me.name}<small>Landing 第三期 · W3</small></h2>
      <div class="m-quick">
        <a href="quick.html?k=exp">${icon('plus')}<b>补充经历</b><small>做过的事，你自己说</small></a>
        <a href="quick.html?k=will">${icon('quote')}<b>写意愿</b><small>下一步想做什么</small></a>
      </div>
      <h3 class="m-h">发布给你的</h3>
      ${todos.length ? html`<ul class="m-list">${todos.map((t) => M.row(`person.html?id=${me.id}`, icon('check2'), t.title, t.sub, html`<span class="n-astate" data-s="todo">${t.due}</span>`))}</ul>` : html`<div class="nt-empty">还没有。</div>`}
      <div class="n-lock" style="margin-top:var(--s-4)">${icon('lock')}维度分、象限和他人的评价对本人不可见。</div>`);
  }
})();
