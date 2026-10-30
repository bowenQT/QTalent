/* 盘点批次：范围与证据截止、资料缺口、团队分布对比、逐人结论；从这里进入象限校准和调整方案。
   资料不足的人单独列出，不默认归为低潜；团队分布只看数量变化，不给人排名。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('id') || 'b-h2';
  let team = 'all', show = 'all';

  NT.shell({
    nav: 'review', title: st.batch(id)?.name || '盘点批次', crumbs: [['盘点', 'reviews.html']],
    allow: (r) => st.can('review', null, r) && !!st.batch(id),
    view: () => `盘点批次 · ${team === 'all' ? '全部团队' : st.orgShort(team)}${show !== 'all' ? ` · ${show}` : ''}`,
    state: () => ({ team, show }),
    restore: (s) => { team = s.team || 'all'; show = s.show || 'all'; render($('#main')); },
    render,
  });

  function people(b) {
    if (b.id === 'b-h1') return Object.entries(st.snaps().find((s) => s.id === 's-h1').entries).map(([pid]) => st.person(pid)).filter((p) => st.scope(p.id) === 'full');
    return st.people().filter((p) => !p.noReview && st.inOrg(p.org, b.org) && st.scope(p.id) === 'full');
  }
  const snapOf = (b) => st.snaps().find((s) => s.batch === b.id);

  function render(main) {
    const b = st.batch(id), S = st.get();
    const conf = b.status === 'confirmed';
    const list = people(b);
    const snap = snapOf(b);
    const prevSnap = b.compareTo && snapOf(st.batch(b.compareTo));
    const pos = (pid) => {
      if (snap?.entries[pid]) { const e = snap.entries[pid]; return e.uncal ? { q: e.ref, na: e.na, miss: e.miss, ref: true, frozen: true } : { q: e.q, na: e.na, miss: e.miss, frozen: true }; }
      const r = st.refPos(pid, b.cutoff); return { q: r.na ? null : r.q, na: r.na, miss: r.miss, ref: true };
    };
    const dist = (fn) => { const d = { hl: 0, hh: 0, ll: 0, lh: 0, na: 0 }; fn.forEach((x) => { d[x || 'na'] += 1; }); return d; };
    const now = dist(list.map((p) => pos(p.id).q));
    // 上期分布只统计当前视角有权看到的人，不泄露范围外的聚合数据
    const prev = prevSnap ? dist(Object.entries(prevSnap.entries).filter(([pid]) => st.scope(pid) === 'full').map(([, e]) => e.q)) : null;
    const na = list.filter((p) => pos(p.id).na);
    const concluded = list.filter((p) => S.conclusions[p.id]).length;
    const teams = [...new Set(list.map((p) => p.org))];
    const changes = conf ? [] : st.changes();
    const chOf = (pid) => changes.filter((c) => c.person === pid && c.hit);
    const isCal = (pid) => S.snaps.some((s) => s.batch === id && s.entries[pid] && !s.entries[pid].uncal);
    const calTeams = S.snaps.find((s) => s.batch === id)?.teams || [];
    const opPlan = S.plans.filter((p) => p.kind === 'org' && p.batch === id).pop();
    const stepState = [true, na.length === 0 ? true : 'partial', calTeams.length >= teams.length ? true : calTeams.length ? 'partial' : false, concluded >= list.length ? true : concluded ? 'partial' : false, !!opPlan, opPlan?.status === 'confirmed'];
    const shown = list.filter((p) => (team === 'all' || p.org === team) && (show === 'all' || (show === 'na' && pos(p.id).na) || (show === 'chg' && chOf(p.id).length) || (show === 'todo' && !S.conclusions[p.id])))
      .sort((a, c) => a.org.localeCompare(c.org) || a.name.localeCompare(c.name, 'zh'));
    const canEdit = !conf && st.can('calibrate');

    mount(main, html`
      <article class="n-card" style="position:relative">
        <div class="n-batch__head"><div><h1 class="n-batch__title">${b.name}</h1><div class="n-batch__meta">${st.person(b.starter).name}发起${b.startedAt ? ` · ${NT.md(b.startedAt)}` : ''}${b.compareTo ? ` · 与 ${st.batch(b.compareTo).name} 的档案版本对比` : ''} · 规则 ${b.rubric}</div></div>
          ${conf ? html`<span class="n-seal" style="margin-left:auto">已<br>确认</span>` : html`<span class="n-badge n-version__tag is-draft" style="background:var(--light-soft)">草稿</span>`}</div>
        <div class="n-scope">
          <div>范围<b>${list.length} 人 · ${teams.length} 个二级团队</b></div>
          <div>证据截止<b>${NT.md(b.cutoff)}${canEdit ? html` <button class="n-link" type="button" id="cutoff">改</button>` : ''}</b></div>
          <div>资料不足<b>${na.length} 人（${Math.round(na.length / Math.max(1, list.length) * 100)}%）</b></div>
          <div>已写逐人结论<b>${concluded} / ${list.length}</b></div>
        </div>
        ${b.log?.length ? html`<ul class="n-log">${b.log.map(([d, by, t]) => html`<li>${NT.md(d)} ${st.person(by).name}：${t}</li>`)}</ul>` : ''}
        ${conf ? html`<p class="nt-caption">${NT.md(b.confirmedAt)} 由${st.person(b.confirmedBy).name}确认，范围内每个人的档案版本已冻结；之后的新事件不会改写它。</p>` : html`
        <ol class="nt-steps">${[['固定范围', null], ['补资料缺口', '#gaps'], ['象限校准', `calibrate.html?id=${id}`], ['逐人结论', '#roll'], ['调整方案', `plan.html?id=${id}`], ['确认版本', `plan.html?id=${id}`]].map(([t, h], i) => html`<li data-s="${stepState[i] === true ? 'done' : stepState[i] === 'partial' ? 'part' : 'todo'}">${h ? html`<a href="${h}">${t}</a>` : t}${i === 2 ? html`<small>${calTeams.length}/${teams.length} 个团队</small>` : i === 3 ? html`<small>${concluded}/${list.length}</small>` : ''}</li>`)}</ol>`}
      </article>

      <div class="nt-cols" style="margin-top:var(--s-4)">
        <article class="n-card"><h3 class="n-section-title" style="font-size:var(--t-sm)">团队分布 · 本期${prev ? '（上期）' : ''}</h3>
          <div class="n-dist">${[['hl', '高潜待练'], ['hh', '双高'], ['ll', '待观察'], ['lh', '专业骨干']].map(([k, l]) => html`<div>${l} <b>${now[k]}${prev ? html` <small style="color:var(--ink-3);font-weight:400">(${prev[k]})</small>` : ''}</b></div>`)}<div class="na">资料不足 <b>${now.na}${prev ? html` <small style="color:var(--ink-3);font-weight:400">(${prev.na})</small>` : ''}</b></div></div>
          <p class="nt-caption">${conf ? (list.some((p) => snap?.entries[p.id]?.uncal) ? '冻结时的位置：已校准的团队是正式位置，未校准的是冻结时的参考位置。' : '冻结时的正式位置。') : '已校准的团队按校准结果，其余按当前参考位置。'}${prev && now.na > prev.na ? '资料不足上升主要来自新并入的人和 Landing 新人，他们的事件待补录。' : ''}</p>
          ${!conf ? html`<div class="nt-row" style="margin-top:var(--s-3)"><a class="n-btn n-btn--sm n-btn--ink" href="calibrate.html?id=${id}">${icon('grid')}去象限校准</a><a class="n-btn n-btn--sm" href="plan.html?id=${id}">调整方案${opPlan ? ` v${opPlan.version}` : ''}</a></div>` : html`<div class="nt-row" style="margin-top:var(--s-3)"><a class="n-btn n-btn--sm" href="plan.html?id=${id}">看组织调整方案</a></div>`}
        </article>
        <article class="n-card" id="gaps"><h3 class="n-section-title" style="font-size:var(--t-sm)">资料缺口 · ${na.length} 人</h3>
          ${na.length ? html`<ul class="n-pending">${na.slice(0, 8).map((p) => html`<li>${UI.avatar(p.id, 'sm')}${UI.plink(p.id)}<small>${pos(p.id).miss}${p.merged ? ' · 并入' : NT.days(p.joined) < 90 ? ' · 新人' : ''}</small></li>`)}${na.length > 8 ? html`<li class="nt-muted">还有 ${na.length - 8} 人，在下方清单里筛「资料不足」</li>` : ''}</ul>` : html`<p class="nt-muted">没有资料不足的人。</p>`}
          ${canEdit && na.length ? html`<div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--sm" type="button" id="remind">提醒负责人补录</button><span class="nt-muted">资料不足不会被放进低潜力</span></div>` : ''}
        </article>
      </div>

      <article class="n-card" id="roll" style="margin-top:var(--s-4)">
        <div class="nt-row" style="justify-content:space-between;margin-bottom:var(--s-3)"><h3 class="n-section-title" style="margin:0">人员清单</h3>
          <div class="nt-row"><select class="n-select" id="fteam" style="width:auto" aria-label="团队"><option value="all">全部团队</option>${teams.map((t) => html`<option value="${t}" ${t === team ? 'selected' : ''}>${st.orgShort(t)}</option>`)}</select>
            <div class="n-seg" data-manual role="group" aria-label="筛选" id="fshow">${[['all', '全部'], ['todo', '未写结论'], ['na', '资料不足'], ['chg', '有变化']].map(([k, l]) => html`<button type="button" data-k="${k}" aria-pressed="${k === show}">${l}</button>`)}</div></div></div>
        <div class="n-rollwrap"><table class="n-roll"><thead><tr><th>人员</th><th>资料</th><th>变化</th><th>位置</th><th>结论</th></tr></thead><tbody>
          ${shown.map((p) => {
            const ps = pos(p.id), r = snap?.entries[p.id] || st.refPos(p.id, b.cutoff), c = S.conclusions[p.id], chs = chOf(p.id);
            return html`<tr><td>${UI.plink(p.id)}<small>${st.orgShort(p.org)}${p.merged ? ' · 并入' : ''}${p.landing ? ' · Landing' : ''}</small></td>
              <td>${r.n} 条分${ps.na ? html`<small>${ps.miss}</small>` : html`<small>${Object.values(r.dims).filter((d) => d.n).length} 个维度有分</small>`}</td>
              <td>${chs.length ? chs.map((x) => html`<span class="n-rule" style="margin:2px 2px 2px 0">${icon('flag')}${x.t === 'trend' ? `${st.dim(x.dim).name}${x.up ? '↑' : '↓'}` : x.t === 'quad' ? '跨象限' : '90 天无事件'}</span>`) : st.needsRecal(p.id) ? html`<span class="n-badge n-badge--recal">可能需要重新校准</span>` : '—'}</td>
              <td>${ps.na ? UI.na() : (ps.frozen && !ps.ref) || isCal(p.id) ? UI.qBadge(ps.q) : html`<span class="n-badge n-badge--ai">${icon('spark')}参考：${st.QN[ps.q]}</span>`}</td>
              <td>${c ? html`<span class="ink-hand" style="font-size:var(--t-body)">${c.text}</span><small>${st.person(c.by).name} · ${NT.md(c.at)}${canEdit ? html` · <button class="n-link" type="button" data-con="${p.id}">改</button>` : ''}</small>` : canEdit ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-con="${p.id}">${icon('pen')}写结论</button>` : html`<span class="n-badge">未写</span>`}</td></tr>`;
          })}</tbody></table></div>
        ${!shown.length ? html`<div class="nt-empty">换个筛选条件试试。</div>` : ''}
        <p class="nt-caption">按团队和姓名排列，不按分数排序。结论是人写的判断，用楷体呈现；AI 不替人写结论。</p>
      </article>`);

    $('#fteam')?.addEventListener('change', (e) => { team = e.target.value; render(main); });
    $('#fshow')?.addEventListener('click', (e) => { const x = e.target.closest('[data-k]'); if (x) { show = x.dataset.k; render(main); } });
    $('#remind')?.addEventListener('click', () => NT.toast(`已提醒 ${new Set(na.map((p) => p.manager).filter(Boolean)).size} 位负责人补录，截止 ${NT.md(b.cutoff)}`));
    $('#cutoff')?.addEventListener('click', async () => {
      const r = await NT.dialog({ title: '改证据截止时间', body: html`<p>范围变动会留下记录。</p><label class="n-field" style="margin-top:var(--s-3)"><span class="n-field__label">新的截止时间</span><input class="n-input" type="date" id="nc" value="${b.cutoff}"></label>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink', read: (d) => d.querySelector('#nc').value }] });
      if (r?.value === 'ok' && r.data && r.data !== b.cutoff) { b.log = [[NT.TODAY, st.me().id, `证据截止时间从 ${NT.md(b.cutoff)} 改为 ${NT.md(r.data)}`], ...(b.log || [])]; b.cutoff = r.data; st.save(); render(main); }
    });
    main.onclick = async (e) => {
      const x = e.target.closest('[data-con]'); if (!x) return;
      const p = st.person(x.dataset.con), cur = S.conclusions[p.id];
      const r = await NT.dialog({ title: `${p.name} · 逐人结论`, body: html`<p>写下你对这个人这一期的判断。依据在档案里；这里写结论和下一步。</p><textarea class="n-calib__reason" id="cc" style="margin-top:var(--s-3)" placeholder="比如：近期主动性明显提升，可以给更多独立负责的机会。">${cur?.text || ''}</textarea>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存结论', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#cc').value.trim(), read: (d) => d.querySelector('#cc').value.trim() }] });
      if (r?.value === 'ok') { S.conclusions[p.id] = { text: r.data, by: st.me().id, at: NT.TODAY }; st.save(); render(main); NT.toast(`已保存${p.name}的结论`); }
    };
  }
})();
