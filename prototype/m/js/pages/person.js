/* 手机人员档案：单列版本，事件卡纵向排列。按视角显示或隐藏分数、象限、变化和「值得聊一聊」：
   导师看不到象限和管理观察；员工本人只看到自己的经历、参与的项目和发布给自己的行动。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $ } = NT;
  const pid = NT.param('id') || st.me().id;

  NT.mshell({
    tab: 'people', title: st.person(pid)?.name || '人员档案', back: st.role() === 'self' ? false : 'people.html',
    allow: () => !!st.scope(pid),
    denyTitle: '这个人在你的查看范围之外',
    denyText: '只有 CEO、归属 HRBP、范围内的负责人和所带学员的导师能看这份档案。在「我的」里切换演示视角。',
    demos: [['HRBP 看林知远', 'person.html?id=p-lin&as=hrbp'], ['导师看林知远', 'person.html?id=p-lin&as=mentor'], ['林知远看自己', 'person.html?id=p-lin&as=self'], ['部门负责人看林知远', 'person.html?id=p-lin&as=lead']],
    view: () => `档案 · ${st.roles[st.role()].label}视角`,
    render,
  });

  function render(main) {
    const p = st.person(pid), role = st.role();
    if (st.scope(pid) === 'self') return renderSelf(main, p);
    const S = st.get();
    const canScore = st.can('scores', pid), canQuad = st.can('quad', pid), canSig = st.can('signals', pid), canChg = st.can('changes', pid);
    const land = st.landingOf(pid);
    const { events, hidden } = st.visibleEvents(pid);
    const sig = canSig && S.signals.find((s) => s.person === pid);
    const tracks = S.tracks.filter((t) => t.person === pid);
    const changes = canChg ? st.changes().filter((c) => c.person === pid) : [];
    const f = st.formal(pid), ref = st.refPos(pid);
    const spec = canScore ? UI.spectrum(pid) : null;
    const obs = events.filter((e) => e.kind === 'obs');
    mount(main, html`
      <div class="m-card m-phead">
        ${UI.person(pid, { size: 'lg', link: false, meta: `${st.orgShort(p.org)} · ${p.title} · ${p.level}`, meta2: `${st.tenure(p)}${land ? ` · ${land.batch.name} · 导师 ${land.row[2].map((m) => st.person(m).name).join('、')}` : ''}` })}
        <div class="nt-row" style="margin-top:var(--s-3)">
          ${st.can('record', pid) ? html`<a class="n-btn n-btn--sm n-btn--ink" href="quick.html?person=${pid}">${icon('pen')}记一条事件</a>` : ''}
          ${land && ['mentor', 'hrbp'].includes(role) ? html`<a class="n-btn n-btn--sm" href="mentor.html?id=${pid}">${icon('users')}W2 对人复盘</a>` : ''}
        </div>
      </div>

      ${canQuad ? html`<div class="m-card"><h3 class="m-h" style="margin-top:0">能力象限</h3>
        <dl class="nt-dl"><dt>正式位置</dt><dd>${f ? html`${UI.qBadge(f.q)}<div class="nt-muted">${f.snap.label} · ${NT.md(f.snap.at)} ${st.person(f.snap.by).name}确认</div>` : html`<span class="nt-muted">还没有正式校准</span>`}</dd>
          <dt>参考位置</dt><dd>${ref.na ? html`${UI.na()}<div class="nt-muted">${ref.miss}</div>` : html`<span class="n-badge n-badge--ai">${icon('spark')}${st.QN[ref.q]}</span>${ref.bonus ? html` <span class="n-badge">加分项 ≥ 4</span>` : ''}`}</dd></dl>
        ${st.needsRecal(pid) ? html`<div class="n-notice" style="margin-top:var(--s-3)">${icon('split')}<div><b>可能需要重新校准。</b>冻结后的新事件让参考位置移到了「${st.QN[ref.q]}」。正式位置不会自动移动。</div></div>` : ''}
        
      </div>` : ''}

      ${summary(p, obs, canScore, ref, canQuad)}
      <div style="margin-top:var(--s-3)">${UI.directionBlock(pid)}</div>

      ${spec ? html`<section class="m-card n-spectrum m-spectrum" id="spectrum"><h3 class="m-h" style="margin-top:0">个人能力谱<span class="nt-muted" style="font-weight:400">近 12 个月 · ${spec.total} 条</span></h3>
        <div id="spec-rows">${spec.html}</div>
        <div class="n-spectrum__legend"><span><i class="k-all"></i>全部</span><span><i class="k-recent"></i>近 3 个月</span><span><i class="k-mean"></i>均值</span><span>点一行展开</span></div></section>`
        : role === 'lead' ? '' : ''}

      ${changes.length ? html`<h3 class="m-h">变化标记</h3><ul class="m-list">${changes.map((c) => html`<li><div class="m-row">${icon(c.up ? 'up-r' : c.t === 'idle' ? 'clock' : 'split')}<span>${c.what}<small>${c.from != null ? `${c.from.toFixed(1)} → ${c.to.toFixed(1)} · ` : ''}${c.rule}</small></span><span></span></div></li>`)}</ul>` : ''}
      ${sig ? html`<div id="sigwrap" style="margin-top:var(--s-3)">${UI.signalBlock(sig)}</div>` : ''}
      ${tracks.length ? html`<div id="trackwrap" class="nt-grid" style="margin-top:var(--s-3)">${tracks.map((t) => UI.trackCard(t))}</div>` : ''}

      <h3 class="m-h" id="timeline">时间线<span class="nt-muted" style="font-weight:400">${obs.length} 条关键事件 · 按真实发生时间</span></h3>
      <div class="m-tl">${timeline(events)}</div>
      ${hidden ? html`<div class="n-lock m-lockline">${icon('lock')}${role === 'mentor' ? `另有 ${hidden} 条管理观察和受限资料，导师视角已隐藏` : `另有 ${hidden} 条资料属于你负责范围以外的项目，已隐藏`}。</div>` : ''}

      <h3 class="m-h">参与的项目</h3>
      ${st.projectsOf(pid, true).length ? html`<ul class="m-list">${st.projectsOf(pid, true).map((m) => M.row(UI.appHref(`project.html?id=${m.p.id}`), icon('folder'), m.p.name, `${m.role} · ${m.mode} · ${NT.md(m.from)}${m.to ? ` – ${NT.md(m.to)}` : ' 起'}`))}</ul>` : html`<div class="nt-empty">还没有参与项目。</div>`}`);

    if (spec) UI.wireSpectrum($('#spec-rows'));
    if ($('#sigwrap')) UI.wireSignal($('#sigwrap'), () => render(main));
    if ($('#trackwrap')) UI.wireTracks($('#trackwrap'), () => render(main));
    main.onclick = (e) => {
      const h = e.target.closest('.nt-hist');
      if (h) {
        const row = h.closest('.n-score'), card = h.closest('.nt-event');
        const ev = st.event(card.id.slice(3)), dimName = row.querySelector('.n-score__dim').textContent;
        const s = ev.scores.find((x) => x.p === pid && st.dim(x.d).name === dimName);
        const next = row.nextElementSibling;
        if (next?.classList.contains('n-history')) { next.remove(); return; }
        row.insertAdjacentHTML('afterend', String(UI.history(s, ev)));
        return;
      }
      const a = e.target.closest('a[href^="#ev-"]');
      if (a) { e.preventDefault(); document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ block: 'start', behavior: NT.reduced ? 'auto' : 'smooth' }); }
      const sum = e.target.closest('[data-sum]');
      if (sum) {
        st.adoptSummary(pid, $('#sum-text').textContent, st.can('quad', pid));
        const b = $('#summary'); b.dataset.state = 'ink'; b.classList.add('is-settling');
        $('.n-block__by', b).innerHTML = `<span class="n-block__sig">${NT.esc(st.me().name)}</span>刚刚采纳 AI 摘要`;
        sum.remove();
      }
    };
  }

  function summary(p, obs, canScore, ref, canQuad) {
    const saved = st.summaryFor(pid);
    if (saved) return html`<div class="n-block m-block" data-state="ink" id="summary">${saved.text}<div class="n-block__by"><span class="n-block__sig">${st.person(saved.by).name}</span>${NT.md(saved.at)} 采纳 AI 摘要</div></div>`;
    const dated = obs.filter((e) => e.date);
    const recent = dated.filter((e) => e.date >= NT.addDays(NT.TODAY, -90)).length;
    let text = `近 12 个月有 ${dated.length} 条关键事件，其中近 3 个月 ${recent} 条。`;
    // 两轴均值和落位缺口都是象限信息，只给能看象限的人
    if (canQuad && !ref.na) text += `已确认的分数里，专业度均值 ${ref.px.toFixed(1)}，潜力核心均值 ${ref.py.toFixed(1)}。`;
    if (canQuad && ref.na) text += `落位还差：${ref.miss}。`;
    if (canQuad && st.needsRecal(pid)) text += '冻结后的新事件让参考位置离开了正式象限，建议在下次校准时讨论。';
    return html`<div class="n-block m-block" data-state="light" id="summary"><span id="sum-text">${text}</span><div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}AI 摘要</span>只用你有权限查看的资料</div>
      ${st.role() !== 'mentor' ? html`<button class="n-btn n-btn--sm" type="button" data-sum style="margin-top:var(--s-2)">${icon('check')}采纳</button>` : ''}</div>`;
  }

  function timeline(events) {
    const known = events.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));
    const unknown = events.filter((e) => !e.date);
    const out = []; let month = '';
    const one = (e) => {
      if (e.kind === 'obs') return UI.eventCard(e, { for: pid });
      const meta = e.kind === 'self' ? html`${UI.src('self')}${e.srcs[0]?.label} ${e.srcs[0]?.loc || ''}`
        : e.restricted ? html`<span class="n-badge">${icon('lock')}管理受限</span> 含评价成分，不当作客观事实` : html`${UI.src(e.group ? 'fact' : 'hist')}${e.srcs[0]?.label} · ${e.srcs[0]?.loc}`;
      return html`<div class="m-card m-tlmini" id="ev-${e.id}"><b>${e.title}</b><div class="n-tl__meta">${NT.md(e.date) || '时间未知'} · ${meta}</div>${e.scale ? html`<div class="n-scale">${e.scale.map(([k, v]) => html`<span>${k} ${v}</span>`)}</div>` : ''}</div>`;
    };
    known.forEach((e) => {
      const label = e.date < '2026-01-01' ? '更早' : NT.monthLabel(e.date);
      if (label !== month) { month = label; out.push(html`<div class="m-tlmonth">${label}</div>`); }
      out.push(one(e));
    });
    if (unknown.length) { out.push(html`<div class="m-tlmonth">时间未知</div>`); unknown.forEach((e) => out.push(one(e))); }
    return out.length ? out : html`<div class="nt-empty">还没有记录。</div>`;
  }

  function renderSelf(main, p) {
    const S = st.get();
    const own = S.events.filter((e) => e.people.includes(p.id) && e.kind === 'self').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const pub = S.pubActions.filter((a) => a.person === p.id);
    const corr = S.corrections.filter((c) => c.person === p.id);
    mount(main, html`
      <div class="m-card m-phead">${UI.person(p.id, { size: 'lg', link: false, meta: `${st.orgShort(p.org)} · ${p.title} · ${p.level}`, meta2: `${st.tenure(p)} · Landing 第三期` })}
        <div class="nt-row" style="margin-top:var(--s-3)"><a class="n-btn n-btn--sm n-btn--ink" href="quick.html?k=exp">${icon('plus')}补充经历</a><a class="n-btn n-btn--sm" href="quick.html?k=will">${icon('quote')}写意愿</a><a class="n-btn n-btn--sm n-btn--ghost" href="quick.html?k=fix">提出纠错</a></div></div>
      <div id="mydir" style="margin-top:var(--s-3)">${UI.directionBlock(p.id, { canWrite: 'self' })}</div>
      <h3 class="m-h">发布给你的</h3>
      ${pub.length ? html`<ul class="m-list">${pub.map((a) => html`<li><div class="m-row">${icon('check2')}<span>${a.title}<small>${st.person(a.by).name}发布给你 · ${NT.md(a.at)}</small></span><span class="n-astate" data-s="todo">待安排</span></div></li>`)}</ul>` : html`<div class="nt-empty">还没有。</div>`}
      <h3 class="m-h">我的经历</h3>
      <div class="m-tl">
        ${own.map((e) => html`<div class="m-card m-tlmini"><b>${e.title}</b><div class="n-tl__meta">${NT.md(e.date)} · ${UI.src('self')}${e.srcs[0]?.label}</div></div>`)}
        ${st.projectsOf(p.id, true).map((m) => html`<div class="m-card m-tlmini"><b>${m.to ? '参与' : '加入'}「${m.p.name}」</b><div class="n-tl__meta">${NT.md(m.from)} · ${UI.src('fact')}项目成员记录 · ${m.role}</div></div>`)}
        ${corr.map((c) => html`<div class="m-card m-tlmini"><b>我提出的纠错：${c.text}</b><div class="n-tl__meta">${NT.md(c.at)} · ${c.done ? '已处理' : '等录入人处理'}</div></div>`)}
      </div>`);
    const dir = NT.$('#mydir');
    UI.wireDirection(dir, p.id, () => mount(dir, UI.directionBlock(p.id, { canWrite: 'self' })));
  }
})();
