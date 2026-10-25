/* 手机工作台：一句话入口、按身份的快捷操作、待办摘要、进行中的任务。员工本人只看到发布给自己的事和补充经历。
   CEO（v1.5 3.26）：找人 → 需要我看 → 我的关注 → 值得关注 → 判断提醒；负责人加本团队的值得关注与我的关注，导师先看所带学员（3.29、3.30）。
   手机上只查看，不发起推动、推荐和复核请求；人点开是底部速览，可以加关注。 */
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
    if (role === 'ceo') return renderCeo(main, me, hello);
    UI.peek.changed = () => render(main); // 速览里加关注、取消关注后刷新首页的人数和动态
    const quick = [
      ['record.html', 'wave', '录音', '复盘会、一对一'],
      ['quick.html', 'pen', '一句话记录', '说一件具体的事'],
      (role === 'mentor' || role === 'hrbp') && ['mentor.html', 'users', '导师评价', 'Landing W2 对人复盘'],
      (role === 'ceo' || role === 'hrbp' || role === 'lead') && ['plan.html', 'stamp', '确认方案', `${st.get().plans.filter((p) => p.status === 'draft').length} 份草稿`],
    ].filter(Boolean);
    const tasks = st.visibleTasks().filter((t) => t.state !== 'done').slice(0, 4);
    mount(main, html`
      <h2 class="m-hello">${hello}，${me.name}<small>${NT.md(NT.TODAY)} 周五 · ${st.roles[role].scope}</small></h2>
      <a class="m-composer" href="quick.html"><span class="nt-ip" data-ip="listening" data-size="32"></span><span>说一件刚发生的事…</span><span class="m-composer__mic" aria-hidden="true">${icon('mic')}</span></a>
      <div class="m-quick">${quick.map(([href, ic, t, sub]) => html`<a href="${href}">${icon(ic)}<b>${t}</b><small>${sub}</small></a>`)}</div>

      <h3 class="m-h">待办${todos.length ? html`<span class="n-count">${todos.length}</span>` : ''}<a class="n-link" href="inbox.html">全部</a></h3>
      ${todos.length ? html`<ul class="m-list">${todos.slice(0, 4).map(M.todoRow)}</ul>`
        : html`<div class="m-card">${UI.state({ ip: 'done', size: 40, title: '没有待办', text: '新的待核对、待确认会出现在这里。' })}</div>`}

      ${role === 'lead' ? leadBlocks() : ''}${role === 'mentor' ? mentorBlocks() : ''}
      ${tasks.length ? html`<h3 class="m-h">进行中的任务</h3><div class="m-card m-tasks">${tasks.map((t) => {
        const [ic, label] = STATE[t.state] || ['spark', ''];
        const link = t.state === 'partial' ? (t.link || 'record.html?m=w2') : t.state === 'shaping' && t.live ? 'record.html?step=processing' : '';
        return html`<div class="n-task" data-state="${t.state}"><span class="n-task__icon">${icon(ic)}</span><div style="min-width:0"><div class="n-task__name">${t.name}${t.preset ? html` <span class="n-badge n-badge--preset">演示任务</span>` : ''}</div><div class="n-task__state"><b>${label}</b> · ${t.note}</div>${t.state === 'uploading' ? html`<div class="n-progress"><i style="width:${t.progress}%"></i></div>` : t.state === 'shaping' ? html`<div class="n-progress is-indeterminate"><i></i></div>` : ''}</div>${link ? html`<div class="n-task__acts"><a class="n-btn n-btn--sm" href="${link}">${t.state === 'partial' ? '去看' : '查看'}</a></div>` : ''}</div>`;
      })}</div>` : ''}

      <h3 class="m-h">最近看过</h3>
      <ul class="m-list">${['p-lin', 'p-tangguo', 'p-zhouyu', 'p-heyn'].filter((id) => st.scope(id)).slice(0, 3).map((id) => { const p = st.person(id); return M.prow(id, p.name, `${st.orgShort(p.org)} · ${p.title}`); })}</ul>`);
    wireFollow(main, () => render(main));
  }

  const STATE_S = { 待你确认: 'todo', 待处理: 'todo', 进行中: 'doing', 'HRBP 复核中': 'doing', 已有结果: 'done', 已复核: 'done', 已取消: 'cancel' };
  const FEED_KIND = { event: '关键事件', push: '推动', watch: '值得关注', action: '行动', track: '重点跟踪', reco: '推荐方向' };
  const watchList = (watch, n) => {
    const cat = Object.fromEntries(st.WATCH_CATS);
    return html`<div class="m-watchcats">${st.WATCH_CATS.map(([k, l]) => { const c = watch.filter((w) => w.cat === k).length; return html`<span>${l}<b>${c ? `${c} 人` : '暂无'}</b></span>`; })}</div>
      ${watch.length ? html`<ul class="m-list">${watch.slice(0, n).map((w) => M.prow(w.person, html`${st.person(w.person).name} <span class="n-watch__cat" data-cat="${w.cat}">${cat[w.cat]}</span>`, w.why))}</ul>` : html`<div class="nt-empty">暂时没有人。没有命中规则不代表有问题。</div>`}`;
  };
  // 我的关注：默认看动态，「全部名单」列出每个关注的人并可取消（没有新动态的人也在名单里）
  let followView = 'feed';
  const followBlock = () => {
    const list = st.followList(), feed = st.followFeed().slice(0, 5), all = followView === 'list' && list.length;
    return html`<h3 class="m-h">我的关注<span class="n-count is-quiet">${list.length} 人</span>${list.length ? html`<button class="n-link" type="button" data-mfv aria-pressed="${!!all}">${all ? '看动态' : '全部名单'}</button>` : ''}</h3>
      ${!list.length ? html`<div class="nt-empty">点开一个人，在速览里加关注，之后他们的新进展会出现在这里。</div>`
        : all ? html`<ul class="m-list">${list.map((f) => html`<li class="has-act"><a href="person.html?id=${f.person}" data-peek="p:${f.person}">${UI.avatar(f.person, 'sm')}<span>${st.person(f.person).name}<small>${NT.md(f.at)} 加关注${f.via ? ' · 因推动' : ''}${((x) => (x ? ` · 最近：${NT.md(x.at)} ${x.text}` : ''))(st.followFeed(f.person)[0])}</small></span></a><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-munf="${f.person}">取消关注</button></li>`)}</ul>`
          : feed.length ? html`<ul class="m-list">${feed.map((x) => M.prow(x.person, html`${st.person(x.person).name} <span class="nt-muted">${FEED_KIND[x.kind]}</span>`, `${NT.md(x.at)} ${x.text}`))}</ul>`
            : html`<div class="nt-empty">关注之后还没有新的已确认进展。点「全部名单」可以看所有关注的人。</div>`}`;
  };
  const wireFollow = (main, rerender) => {
    main.querySelector('[data-mfv]')?.addEventListener('click', () => { followView = followView === 'list' ? 'feed' : 'list'; rerender(); });
    main.querySelectorAll('[data-munf]').forEach((b) => b.addEventListener('click', () => UI.toggleFollow(b.dataset.munf, rerender)));
  };
  // 我的推荐：本人提交的推荐与处理状态，导师和部门负责人共用
  const recoBlock = () => {
    const recos = st.myRecos(), RS = { pending: 'HRBP 核实中', verified: '已核实', rejected: '不采纳' };
    return recos.length ? html`<h3 class="m-h">我的推荐</h3><ul class="m-list">${recos.map((c) => M.prow(c.person, `${st.person(c.person).name} · ${st.fitText(c.dir)}`, c.state === 'rejected' ? `不采纳：${c.rejectWhy}` : c.why, html`<span class="n-astate" data-s="${c.state === 'verified' ? 'done' : c.state === 'pending' ? 'doing' : 'cancel'}">${RS[c.state]}</span>`))}</ul>` : '';
  };
  function leadBlocks() {
    return html`<h3 class="m-h">值得关注 · 本团队<span class="n-count is-quiet">${st.watch().length} 人</span></h3>${watchList(st.watch(), 3)}${followBlock()}${recoBlock()}`;
  }
  function mentorBlocks() {
    const me = st.me().id, since = NT.addDays(NT.TODAY, -6), S = st.get();
    const list = st.visiblePeople().filter((p) => st.scope(p.id) === 'mentor');
    return html`<h3 class="m-h">我带的学员<span class="n-count is-quiet">${list.length} 人</span></h3>
      <ul class="m-list">${list.map((p) => {
        const land = st.landingOf(p.id), week = S.events.filter((e) => e.kind === 'obs' && e.people.includes(p.id) && e.recorder === me && e.date && e.date >= since).length;
        return M.prow(p.id, p.name, `${land ? `议题「${st.project(land.row[1])?.name}」 · ` : ''}${week ? `本周记了 ${week} 件` : '本周还没记'}`);
      })}</ul>
      ${recoBlock()}`;
  }

  let needOpen = false;
  function renderCeo(main, me, hello) {
    const m = st.myPushes(), watch = st.watch(), sigs = st.judgeSignals().slice(0, 2);
    const mineHref = (it) => (it.kind === 'plan' ? `plan.html?id=${it.plan}` : it.kind === 'push' ? `person.html?id=${it.person}` : it.kind === 'rule' ? `#rule-${it.v}` : `../app/${it.href}`);
    const going = [...m.doing, ...m.done]; // 手机上是 CEO 查看推动进展的入口之一，不截断
    mount(main, html`
      <h2 class="m-hello">${hello}，${me.name}<small>${NT.md(NT.TODAY)} 周五 · 全公司</small></h2>
      <form class="m-find" id="m-find" role="search"><span class="nt-ip" data-ip="rest" data-size="28"></span><input class="m-find__input" id="m-find-q" aria-label="描述你要找什么样的人" placeholder="描述你需要什么样的人"><button class="n-btn n-btn--sm n-btn--ink" type="submit">开始找人</button></form>

      <h3 class="m-h">需要我看${m.confirm.length ? html`<span class="n-count is-seal">${m.confirm.length}</span>` : ''}</h3>
      ${m.confirm.length ? html`<ul class="m-list">${m.confirm.map((it) => M.row(mineHref(it), icon('stamp'), it.title, it.sub))}</ul>` : html`<div class="nt-empty">暂时没有要你决定的事。</div>`}
      ${going.length ? html`<button class="n-todomore" type="button" id="m-need-more" aria-expanded="${needOpen}">${icon('clock')}你发起的 ${m.doing.length} 件在推进${m.done.length ? `，近 7 天有结果 ${m.done.length} 件` : ''}<span style="margin-left:auto">${needOpen ? '收起' : '展开'}</span></button>
        ${needOpen ? html`<ul class="m-list" style="margin-top:var(--s-2)">${going.map((it) => M.row(mineHref(it), it.owner ? UI.avatar(it.owner, 'sm') : icon('check2'), it.title, it.sub, html`<span class="n-astate" data-s="${STATE_S[it.state] || 'todo'}">${it.state}</span>`))}</ul>` : ''}` : ''}

      ${followBlock()}

      <h3 class="m-h">值得关注<span class="n-count is-quiet">${watch.length} 人</span></h3>
      ${watchList(watch, 3)}
      <p class="nt-caption">按写明的规则入选，按触发时间排列，不按分数挑人。点人看依据；推动请在电脑上发起。</p>

      <h3 class="m-h">判断提醒</h3>
      ${sigs.length ? html`<ul class="m-list">${sigs.map((g) => M.row(`../app/judge.html?id=${g.b.id}`, icon('swap'), g.b.name.replace('判断复盘', ''), UI.judgeTipText(g)))}</ul>`
        : html`<div class="nt-empty">需要复核的差异会出现在这里。</div>`}`);
    NT.$('#m-find').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = NT.$('#m-find-q').value.trim();
      if (!q) { NT.$('#m-find-q').focus(); return; }
      location.href = NT.link('../app/staffing.html', { new: 1, q });
    });
    NT.$('#m-need-more')?.addEventListener('click', () => { needOpen = !needOpen; renderCeo(main, me, hello); });
    NT.$$('a[href^="#rule-"]', main).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ruleSheet(a.getAttribute('href').slice(6)); }));
    wireFollow(main, () => renderCeo(main, me, hello));
    UI.peek.changed = () => renderCeo(main, me, hello);
  }

  // 评价规则修订（v1.6 4.2）：手机上看摘要和影响人数，确认发布在电脑上完成
  function ruleSheet(v) {
    const r = st.ruleVer(v), k = st.ruleKind(v), p = r.preview;
    const impact = !p ? '' : p.kind === 'watch' ? `值得关注 ${p.from} → ${p.to} 人：进入 ${p.enter.length} 人，离开 ${p.leave.length} 人${p.teams.length ? `；${p.teams.map((t) => `${st.orgShort(t.team)} ${t.n > 0 ? '+' : ''}${t.n}`).join('、')}` : ''}`
      : p.kind === 'map' ? `下一次判断复盘里受影响的对照单元 ${p.cells} 个` : `用到这些锚点的事件 ${p.events} 件；${p.tasks ? `生效时生成 ${p.tasks} 条复核任务` : '旧分继续参与取数'}`;
    M.sheet({
      title: `${st.ruleKindName(k)} ${v}`,
      sub: `${st.person(r.by).name}起草 · 在 ${r.base} 上修订 · ${r.state === 'pending' ? '待你确认' : '已排期，从下一个盘点批次开始'}`,
      body: html`<p>${r.why}</p>`,
      facts: [impact && html`影响：${impact}`, html`生效点：${r.effect === 'now' ? '确认后立即对新的评价生效' : '从下一个盘点批次开始'}`, r.state === 'pending' && html`确认发布在电脑上完成：评价体系 · ${st.ruleKindName(k)}`].filter(Boolean),
    });
  }

  function renderSelf(main, me, todos) {
    mount(main, html`
      <h2 class="m-hello">你好，${me.name}<small>Landing 第三期 · W3</small></h2>
      <div class="m-quick">
        <a href="quick.html?k=exp">${icon('plus')}<b>补充经历</b><small>做过的事，你自己说</small></a>
        <a href="quick.html?k=will">${icon('quote')}<b>写意愿</b><small>下一步想做什么</small></a>
      </div>
      <h3 class="m-h">发布给你的</h3>
      ${todos.length ? html`<ul class="m-list">${todos.map((t) => M.row(`person.html?id=${me.id}`, icon('check2'), t.title, t.sub, html`<span class="n-astate" data-s="todo">${t.due}</span>`))}</ul>` : html`<div class="nt-empty">还没有。</div>`}`);
  }
})();
