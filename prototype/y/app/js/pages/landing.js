/* 训练营批次：期次 + 学员 + 课题 + 导师和助教 + 复盘节奏。每周对事复盘，隔周对人复盘，W8 结营评审后形成第一份档案。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount } = NT;

  NT.shell({
    nav: 'programs', title: 'XEngineer 第六期', crumbs: [['人才项目', 'landing.html']],
    allow: (r) => r !== 'self',
    view: () => 'XEngineer 第六期 · 批次概览',
    render(main) {
      const b = st.batch('b-xe6');
      const role = st.role(), me = st.me().id;
      const mine = role === 'mentor' ? b.newcomers.filter((n) => n[2].includes(me)) : b.newcomers;
      const others = b.newcomers.length - mine.length;
      const reviews = b.newcomers.map(([pid]) => st.review(pid, 'W8'));
      const done = reviews.filter((r) => r.state === 'confirmed').length;
      const mentors = [...new Set(b.newcomers.flatMap((n) => n[2]))];
      const quad = st.can('quad');
      const placed = b.newcomers.filter(([pid]) => !st.refPos(pid).na).length;
      mount(main, html`
        ${UI.programHead('landing', role === 'mentor' ? '你带的这一期：学员、课题、每周节奏和结营。' : '各期训练营、校招和黑客松。这里是进行中的一期：学员、课题、每周节奏和结营。')}
        <article class="n-card">
          <div class="n-batch__head">
            <span class="n-avatar n-avatar--lg" style="--hue:220;border-radius:14px">${icon('users', 22)}</span>
            <div><h2 class="n-batch__title">${b.name}</h2><div class="n-batch__meta">${st.orgShort(b.org)} · ${NT.md(b.from)} – ${NT.md(b.to)} · ${b.newcomers.length} 名学员 · ${b.topics.length} 个课题 · 导师 ${new Set(b.newcomers.map((n) => n[2][0])).size} 位、助教 ${new Set(b.newcomers.flatMap((n) => n[2].slice(1))).size} 位 · ${st.person(b.starter).name}发起</div></div>
            <span class="n-badge">${icon('check')}已结营 · ${NT.md(b.to)}</span>
          </div>
          <div class="n-weeks">
            ${b.weeks.map(([w, tag, kind, from, to]) => {
              const now = NT.TODAY >= from && NT.TODAY <= to, past = NT.TODAY > to;
              const extra = w === 'W8' ? `对人复盘 ${done}/${b.newcomers.length} 已确认` : w === 'W5' ? '中期盘点已冻结' : '已完成';
              return html`<div class="n-week ${now ? 'is-now' : past ? 'is-done' : ''}"><b>${w}${tag ? ` ${tag}` : ''}${now ? ' 本周' : ''}</b>${kind}<div class="tags"><span>${extra}</span></div></div>`;
            })}
          </div>
          <h2 class="nt-h2" style="font-size:var(--t-sm)">${role === 'mentor' ? '你带的学员' : '学员'} · W8 对人复盘</h2>
          <ul class="n-roster">${mine.map(([pid, topic, ms]) => {
            const r = st.review(pid, 'W8');
            const badge = r.state === 'confirmed' ? html`<span class="n-badge n-badge--yes">${icon('check')}已确认</span>` : r.conflicts ? html`<span class="n-badge n-badge--conflict">${icon('split')}待校准</span>` : r.ai ? html`<span class="n-badge">待导师确认 ${r.ai} 项</span>` : !r.total ? UI.na() : html`<span class="n-badge">待整份确认</span>`;
            return html`<li><a class="nt-plink" href="landing-review.html?id=${pid}" style="display:contents">${UI.avatar(pid, 'sm')}<div>${st.person(pid).name}<small>${st.project(topic).name} · ${ms.map((m) => st.person(m).name).join('、')}</small></div>${badge}</a></li>`;
          })}</ul>
          ${others ? html`<p class="nt-caption">另外 ${others} 名学员由其他导师负责。</p>` : ''}
        </article>

        <div class="nt-cols" style="margin-top:var(--s-4)">
          <article class="n-card"><h3 class="n-section-title">课题</h3>
            <ul class="nt-list">${b.topics.map((id) => {
              const p = st.project(id);
              // 课题已结营，成员都有退出日期：取所有参与过的人
              const team = st.membersOf(id, true), staff = team.filter((m) => ['导师', '助教'].includes(m.role)), stu = team.filter((m) => m.role === '学员' && st.scope(m.person)); // 只列本视角能看到的学员
              return html`<li><div class="nt-row" style="justify-content:space-between"><a class="nt-plink" href="project.html?id=${id}"><b>${p.name}</b></a>${staff.length ? html`<span class="nt-muted">导师 ${staff.map((m) => `${st.person(m.person).name}${m.role === '助教' ? '（助教）' : ''}`).join('、')}</span>` : ''}</div>
                <p class="nt-muted" style="margin:4px 0 6px">${p.goal}</p>${stu.length ? html`<div class="n-project__members" style="margin:0">${stu.map((m) => UI.avatar(m.person, 'sm'))}<span>${stu.map((m) => st.person(m.person).name).join('、')}</span></div>` : ''}</li>`;
            })}</ul>
          </article>
          <div class="nt-grid">
            <article class="n-card"><h3 class="n-section-title">复盘节点</h3>
              <ul class="n-mhist">${b.milestones.map(([d, t]) => html`<li><time>${NT.md(d)}</time>${t}${d < NT.TODAY ? ' · 已完成' : d === NT.TODAY ? ' · 今天' : ''}</li>`)}</ul>
              <div class="nt-row" style="margin-top:var(--s-3)">${st.canOpenMinutes('w8') ? html`<a class="n-btn n-btn--sm" href="record.html?m=w8">${icon('wave')}W8 导师团复盘纪要</a>` : ''}${role === 'mentor' ? html`<a class="n-btn n-btn--sm n-btn--ghost" href="../m/record.html">${icon('phone')}用手机录一对一</a>` : ''}</div>
            </article>
            ${quad ? html`<article class="n-card"><h3 class="n-section-title">结营</h3>
              <p style="margin:0;font-size:var(--t-sm);line-height:1.7;color:var(--ink-2)">结营盘点做第一次正式校准，形成每个人的第一份档案。现在 ${b.newcomers.length} 人中 ${placed} 人满足落位门槛，其余在「资料不足」区，说明还缺哪类证据。</p>
              <div class="nt-row" style="margin-top:var(--s-3)"><a class="n-btn n-btn--sm ${placed ? 'n-btn--ink' : ''}" href="review.html?id=b-xe6-end">${icon('grid')}去结营盘点</a><a class="n-btn n-btn--sm n-btn--ghost" href="plan.html?id=b-xe6-end">留用与落位方案</a></div>
            </article>` : html`<div class="n-lock">${icon('lock')}导师负责评价和确认分数。结营校准和象限由 HR 完成。</div>`}
          </div>
        </div>`);
    },
  });
})();
