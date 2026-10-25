/* 手机工作台（导师）：一句话入口、录音和导师评价的快捷入口、待办摘要、所带学员、进行中的任务。
   手机上只记录和确认，不发起推荐；人点开是底部速览。 */
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
    UI.peek.changed = () => render(main);
    const quick = [
      ['record.html', 'wave', '录音', '复盘会、一对一'],
      ['quick.html', 'pen', '一句话记录', '说一件具体的事'],
      ['mentor.html', 'users', '导师评价', 'W8 对人复盘'],
    ];
    const open = st.visibleTasks().filter((t) => t.state !== 'done');
    const tasks = open.filter((t) => t.state !== 'failed').slice(0, 4), failed = open.filter((t) => t.state === 'failed');
    const taskRow = (t) => {
      const [ic, label] = STATE[t.state] || ['spark', ''];
      const link = t.state === 'partial' ? (t.link || 'record.html?m=w8') : t.state === 'shaping' && t.live ? 'record.html?step=processing' : '';
      const act = t.state === 'failed' ? html`<button class="n-btn n-btn--sm" type="button" data-retry="${t.id}">${icon('retry')}重试整理</button>` : link ? html`<a class="n-btn n-btn--sm" href="${link}">${t.state === 'partial' ? '去看' : '查看'}</a>` : '';
      return html`<div class="n-task" data-state="${t.state}"><span class="n-task__icon">${icon(ic)}</span><div style="min-width:0"><div class="n-task__name">${t.name}${t.preset ? html` <span class="n-badge n-badge--preset">演示任务</span>` : ''}</div><div class="n-task__state"><b>${label}</b> · ${t.note}</div>${t.state === 'uploading' ? html`<div class="n-progress"><i style="width:${t.progress}%"></i></div>` : t.state === 'shaping' ? html`<div class="n-progress is-indeterminate"><i></i></div>` : ''}</div>${act ? html`<div class="n-task__acts">${act}</div>` : ''}</div>`;
    };
    mount(main, html`
      <h2 class="m-hello">${hello}，${me.name}<small>${NT.md(NT.TODAY)} 周五 · ${st.roles[role].scope}</small></h2>
      <a class="m-composer" href="quick.html"><span class="nt-ip" data-ip="listening" data-size="32"></span><span>说一件刚发生的事…</span><span class="m-composer__mic" aria-hidden="true">${icon('mic')}</span></a>
      <div class="m-quick">${quick.map(([href, ic, t, sub]) => html`<a href="${href}">${icon(ic)}<b>${t}</b><small>${sub}</small></a>`)}</div>

      <h3 class="m-h">待办${todos.length ? html`<span class="n-count">${todos.length}</span>` : ''}<a class="n-link" href="inbox.html">全部</a></h3>
      ${todos.length ? html`<ul class="m-list">${todos.slice(0, 4).map(M.todoRow)}</ul>`
        : html`<div class="m-card">${UI.state({ ip: 'done', size: 40, title: '待办都处理完了', text: '新的待核对、待确认会出现在这里。' })}</div>`}

      ${mentorBlocks()}
      ${tasks.length ? html`<h3 class="m-h">进行中的任务</h3><div class="m-card m-tasks">${tasks.map(taskRow)}</div>` : ''}
      ${failed.length ? html`<h3 class="m-h">待重试的任务</h3><div class="m-card m-tasks" id="m-failed">${failed.map(taskRow)}</div>` : ''}

      <h3 class="m-h">最近看过</h3>
      <ul class="m-list">${['p-x11', 'p-x07', 'p-x15', 'p-x06'].filter((id) => st.scope(id)).slice(0, 3).map((id) => { const p = st.person(id); return M.prow(id, p.name, `${st.orgShort(p.org)} · ${p.title}`); })}</ul>`);
    main.onclick = (e) => { const r = e.target.closest('[data-retry]'); if (r) retry(main, r.dataset.retry); };
  }

  // 失败任务重试：重新整理几秒后回到工作台，结果和桌面一致
  async function retry(main, id) {
    const t = st.get().tasks.find((x) => x.id === id); if (!t) return;
    t.state = 'shaping'; t.note = '重新提取人员和事件'; st.save(); render(main);
    await NT.wait(2400);
    const done = st.finishTask(id);
    render(main);
    if (done) NT.toast(done.state === 'partial' ? `「${done.name}」整理完成，1 处人名待核对` : `「${done.name}」整理完成`);
  }

  // 我的推荐：本人提交的推荐与处理状态
  const recoBlock = () => {
    const recos = st.myRecos(), RS = { pending: 'HR 核实中', verified: '已核实', rejected: '不采纳' };
    return recos.length ? html`<h3 class="m-h">我的推荐</h3><ul class="m-list">${recos.map((c) => M.prow(c.person, `${st.person(c.person).name} · ${st.fitText(c.dir)}`, c.state === 'rejected' ? `不采纳：${c.rejectWhy}` : c.why, html`<span class="n-astate" data-s="${c.state === 'verified' ? 'done' : c.state === 'pending' ? 'doing' : 'cancel'}">${RS[c.state]}</span>`))}</ul>` : '';
  };
  function mentorBlocks() {
    const me = st.me().id, since = NT.addDays(NT.TODAY, -6), S = st.get();
    const list = st.visiblePeople().filter((p) => st.scope(p.id) === 'mentor');
    return html`<h3 class="m-h">我带的学员<span class="n-count is-quiet">${list.length} 人</span></h3>
      <ul class="m-list">${list.map((p) => {
        const land = st.landingOf(p.id), week = S.events.filter((e) => e.kind === 'obs' && e.people.includes(p.id) && e.recorder === me && e.date && e.date >= since).length;
        return M.prow(p.id, p.name, `${land ? `课题「${st.project(land.row[1])?.name}」 · ` : ''}${week ? `本周记了 ${week} 件` : '本周还没记'}`);
      })}</ul>
      ${recoBlock()}`;
  }
})();
