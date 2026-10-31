/* 手机 · 我的判断对照：导师作为入营选拔评委做过的判断，和结营评审放在一起看。
   只列评价关系有效期里做过的判断；结营评审这一段没有评价关系或关系已到期的，显示无权限。不排行、不给准确率，样本不到门槛只显示「样本不足」。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount } = NT;
  const STATE = { same: '一致', high: '前段偏高', low: '前段偏低', nc: '不可比', na: '资料不足' };

  NT.mshell({
    tab: 'me', title: '我的判断对照', back: 'me.html',
    allow: () => st.isRater(),
    denyTitle: '你还没有可对照的判断', denyText: '你作为评价人给出的判断，和后一阶段的结论放在一起后会出现在这里。',
    view: () => '我的判断对照',
    render,
  });

  function render(main) {
    const me = st.me(), all = st.myJudgeUnits(), x = st.raterStats(all, me.id), t = x.tally;
    const chain = st.judgeChain('xe');
    const mid = (u) => !u.denied && st.judgeComparable(u) && !st.judgeClear([u], chain).clear.length;
    const order = (u) => (u.denied ? 4 : mid(u) ? 2 : ['high', 'low'].includes(u.state) ? 0 : u.state === 'same' ? 1 : 3);
    mount(main, html`
      <section class="m-card">
        <h2 style="margin:0 0 var(--s-1);font-size:var(--t-lg)">${x.enough ? `${x.cases.length} 个可对照案例` : '样本不足'}</h2>
        <p style="margin:0;font-size:var(--t-sm);line-height:1.6">${x.enough ? [t.high && `前段偏高 ${t.high} 个`, t.low && `前段偏低 ${t.low} 个`, t.same && `一致 ${t.same} 个`].filter(Boolean).join('，') : `可对照案例 ${x.cases.length} 个，门槛 ${st.RATER_MIN} 个，下面只列案例。`}</p>
        <p class="nt-muted" style="margin:var(--s-2) 0 0;font-size:var(--t-xs)">只算你在入营选拔给了优先录取或刚过线的判断；中间档「通过」不计。</p>
      </section>
      <h3 class="m-h">XEngineer 第六期 · 入营选拔 → 结营评审</h3>
      <ul class="m-list m-jlist">${all.slice().sort((a, b) => order(a) - order(b)).map((u) => html`<li class="m-jrow">
        ${UI.avatar(u.person, 'sm')}<span class="m-jrow__who"><b>${st.person(u.person).name}</b>${UI.demo()}<small>${u.front.v}${u.front.team ? ` · 组队作品 ${u.front.team}` : ''}</small></span>
        <span class="m-jrow__to">${u.denied ? html`<span class="n-badge">${icon('lock', 11)}无权限</span>` : mid(u) ? html`<span class="n-badge">中间档 · 不计</span><small class="is-nw">结营 ${u.back.v}</small>` : html`<span class="n-jstate" data-s="${u.state}">${STATE[u.state]}</span><small class="is-nw">结营 ${u.back.na ? '—' : u.back.v}</small>`}</span>
        ${u.denied ? html`<small class="m-jrow__why">${u.denied}</small>` : ''}
      </li>`)}</ul>
      <div class="n-lock" style="margin-top:var(--s-3)">${icon('lock')}这些对照只用来修订人才评价规则；学员的分数和档案保持原样。</div>
      <a class="n-btn n-btn--ghost" href="../app/judge.html?rater=me&as=mentor" style="margin-top:var(--s-3);width:100%">${icon('up-r')}在桌面看每条判断的出处</a>`);
    UI.mountIPs(main);
  }
})();
