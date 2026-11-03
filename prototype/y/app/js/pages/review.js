/* 盘点批次：范围与证据截止、资料缺口、团队分布对比、逐人结论；从这里进入象限校准和调整方案。
   资料不足的人单独列出，不默认归为低潜；团队分布只看数量变化，不给人排名。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;
  const id = NT.param('id') || 'b-xe6-end';
  let team = 'all', show = 'all';
  const drafts = {}; // 逐人结论：切换到别人时没保存的草稿，回来还在

  NT.shell({
    nav: 'review', title: st.batch(id)?.name || '盘点批次', crumbs: [['盘点', 'reviews.html']],
    allow: (r) => st.can('review', null, r) && !!st.batch(id),
    view: () => `盘点批次 · ${team === 'all' ? '全部团队' : st.orgShort(team)}${show !== 'all' ? ` · ${show}` : ''}`,
    state: () => ({ team, show }),
    restore: (s) => { team = s.team || 'all'; show = s.show || 'all'; render($('#main')); },
    render,
  });

  function people(b) {
    if (b.id === 'b-xe6-mid') return Object.entries(st.snaps().find((s) => s.id === 's-mid').entries).map(([pid]) => st.person(pid)).filter((p) => st.scope(p.id) === 'full');
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
    const stepState = [true, na.length === 0 ? true : 'partial', calTeams.length >= teams.length ? true : calTeams.length ? 'partial' : false, concluded >= list.length ? true : concluded ? 'partial' : false, opPlan ? (opPlan.status === 'confirmed' ? true : 'partial') : false, opPlan?.status === 'confirmed'];
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
          <div>资料不足<b>${na.length} 人（${Math.round(na.length / Math.max(1, list.length) * 100)}%）${na.length ? html` <button class="n-link" type="button" data-show="na">看是谁</button>` : ''}</b></div>
          <div>已写逐人结论<b>${concluded} / ${list.length}</b></div>
        </div>
        ${b.log?.length ? html`<ul class="n-log">${b.log.map(([d, by, t]) => html`<li>${NT.md(d)} ${st.person(by).name}：${t}</li>`)}</ul>` : ''}
        ${conf ? html`<p class="nt-caption">${NT.md(b.confirmedAt)} 由${st.person(b.confirmedBy).name}确认，范围内每个人的档案版本已冻结；之后的新事件不会改写它。</p>` : html`
        <ol class="nt-steps">${[['固定范围', null], ['补资料缺口', '#roll'], ['象限校准', st.can('calibrate') ? `calibrate.html?id=${id}` : null], ['逐人结论', '#roll'], ['调整方案', `plan.html?id=${id}`], ['确认版本', `plan.html?id=${id}`]].map(([t, h], i) => html`<li data-s="${stepState[i] === true ? 'done' : stepState[i] === 'partial' ? 'part' : 'todo'}">${h ? html`<a href="${h}" ${NT.raw(i === 1 ? 'data-show="na"' : '')}>${t}</a>` : t}${i === 2 ? html`<small>${calTeams.length}/${teams.length} 个团队</small>` : i === 3 ? html`<small>${concluded}/${list.length}</small>` : ''}</li>`)}</ol>`}
        <section class="n-batch__dist" aria-label="团队分布">
          <div class="n-batch__distH"><h3>团队分布 · 本期${prev ? '（上期）' : ''}</h3>
            ${!conf ? html`<div class="nt-row">${st.can('calibrate') ? html`<a class="n-btn n-btn--sm n-btn--ink" href="calibrate.html?id=${id}">${icon('grid')}去象限校准</a>` : ''}<a class="n-btn n-btn--sm ${st.can('calibrate') ? '' : 'n-btn--ink'}" href="plan.html?id=${id}">调整方案${opPlan ? ` v${opPlan.version}` : ''}</a></div>` : html`<a class="n-btn n-btn--sm" href="plan.html?id=${id}">看组织调整方案</a>`}</div>
          <div class="n-dist is-row">${[['hl', '高潜待练'], ['hh', '双高'], ['ll', '待观察'], ['lh', '专业骨干']].map(([k, l]) => html`<div>${l} <b>${now[k]}${prev ? html` <small>(${prev[k]})</small>` : ''}</b></div>`)}<div class="na">资料不足 <b>${now.na}${prev ? html` <small>(${prev.na})</small>` : ''}</b></div></div>
          <p class="nt-caption">${conf ? (list.some((p) => snap?.entries[p.id]?.uncal) ? '冻结时的位置：已校准的团队是正式位置，未校准的是冻结时的参考位置。' : '冻结时的正式位置。') : '已校准的团队按校准结果，其余按当前参考位置。'}${prev && now.na > prev.na ? '资料不足上升主要来自后几周事件较少的学员，他们的事件待补录。' : ''}</p>
        </section>
      </article>

      <article class="n-card" id="roll" style="margin-top:var(--s-4)">
        <div class="nt-row" style="justify-content:space-between;margin-bottom:var(--s-3)"><h3 class="n-section-title" style="margin:0">人员清单</h3>
          <div class="nt-row"><select class="n-select" id="fteam" style="width:auto" aria-label="团队"><option value="all">全部团队</option>${teams.map((t) => html`<option value="${t}" ${t === team ? 'selected' : ''}>${st.orgShort(t)}</option>`)}</select>
            <div class="n-seg" data-manual role="group" aria-label="筛选" id="fshow">${[['all', '全部'], ['todo', '未写结论', list.length - concluded], ['na', '资料不足', na.length], ['chg', '有变化', list.filter((p) => chOf(p.id).length).length]].map(([k, l, n]) => html`<button type="button" data-k="${k}" aria-pressed="${k === show}">${l}${n ? html`<small class="n-seg__n">${n}</small>` : ''}</button>`)}</div></div></div>
        ${show === 'na' && na.length ? html`<div class="n-roll__gap"><span>${na.length} 人资料不足，缺什么写在「资料」一列；资料不足不会被放进低潜力。</span>${canEdit ? html`<button class="n-btn n-btn--sm" type="button" id="remind">${icon('note')}提醒导师补录</button>` : ''}</div>` : ''}
        <div class="n-rollwrap"><table class="n-roll"><thead><tr><th>人员</th><th>资料</th><th>变化</th><th>位置</th><th>结论</th></tr></thead><tbody>
          ${shown.map((p) => {
            const ps = pos(p.id), r = snap?.entries[p.id] || st.refPos(p.id, b.cutoff), c = S.conclusions[p.id], chs = chOf(p.id);
            return html`<tr><td>${UI.plink(p.id)}<small>${st.orgShort(p.org)}</small></td>
              <td>${r.n} 条分${ps.na ? html`<small>${ps.miss}</small>` : html`<small>${Object.values(r.dims).filter((d) => d.n).length} 个维度有分</small>`}</td>
              <td>${chs.length ? chs.map((x) => html`<span class="n-rule" style="margin:2px 2px 2px 0">${icon('flag')}${x.t === 'trend' ? `${st.dim(x.dim).name}${x.up ? '↑' : '↓'}` : x.t === 'quad' ? '跨象限' : '90 天无事件'}</span>`) : st.needsRecal(p.id) ? html`<span class="n-badge n-badge--recal">可能需要重新校准</span>` : '—'}</td>
              <td>${ps.na ? UI.na() : (ps.frozen && !ps.ref) || isCal(p.id) ? UI.qBadge(ps.q) : html`<span class="n-badge n-badge--ai">${icon('spark')}参考：${st.QN[ps.q]}</span>`}</td>
              <td>${c ? html`<span class="ink-hand" style="font-size:var(--t-body)">${c.text}</span><small>${st.person(c.by).name} · ${NT.md(c.at)}${canEdit ? html` · <button class="n-link" type="button" data-con="${p.id}">改</button>` : ''}</small>` : canEdit ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-con="${p.id}">${icon('pen')}写结论</button>` : html`<span class="n-badge">未写</span>`}</td></tr>`;
          })}</tbody></table></div>
        ${!shown.length ? html`<div class="nt-empty">换个筛选条件试试。</div>` : ''}
        <p class="nt-caption">按团队和姓名排列，不按分数排序。结论是人写的判断，用楷体呈现；AI 不替人写结论。</p>
      </article>`);

    $('#fteam')?.addEventListener('change', (e) => { team = e.target.value; render(main); });
    main.querySelectorAll('[data-show]').forEach((x) => x.addEventListener('click', (e) => {
      e.preventDefault(); show = x.dataset.show; team = 'all'; render(main);
      $('#roll').scrollIntoView({ behavior: NT.reduced ? 'auto' : 'smooth', block: 'start' });
    }));
    $('#fshow')?.addEventListener('click', (e) => { const x = e.target.closest('[data-k]'); if (x) { show = x.dataset.k; render(main); } });
    $('#remind')?.addEventListener('click', () => NT.toast(`已提醒 ${new Set(na.map((p) => p.manager).filter(Boolean)).size} 位导师补录，截止 ${NT.md(b.cutoff)}`));
    $('#cutoff')?.addEventListener('click', async () => {
      const r = await NT.dialog({ title: '改证据截止时间', body: html`<p>范围变动会留下记录。</p><label class="n-field" style="margin-top:var(--s-3)"><span class="n-field__label">新的截止时间</span><input class="n-input" type="date" id="nc" value="${b.cutoff}"></label>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink', read: (d) => d.querySelector('#nc').value }] });
      if (r?.value === 'ok' && r.data && r.data !== b.cutoff) { b.log = [[NT.TODAY, st.me().id, `证据截止时间从 ${NT.md(b.cutoff)} 改为 ${NT.md(r.data)}`], ...(b.log || [])]; b.cutoff = r.data; st.save(); render(main); }
    });
    main.onclick = (e) => {
      const x = e.target.closest('[data-con]'); if (!x) return;
      conclude(shown.map((p) => p.id), x.dataset.con);
    };

    // 逐人结论：浮层里带这个人的参考背景，上一个、下一个直接切换；保存后自动到下一个人
    function conclude(seq, start) {
      let i = Math.max(0, seq.indexOf(start));
      const d = document.createElement('dialog');
      d.className = 'n-dialog n-condlg';
      d.setAttribute('aria-labelledby', 'cd-name');
      d.innerHTML = `<div class="n-condlg__nav"><span class="n-condlg__pos" aria-live="polite"></span>
          <button class="n-btn n-btn--ghost n-btn--icon n-btn--sm" type="button" data-go="-1" aria-label="上一个" title="上一个 · ⌥←"><svg><use href="#i-back"/></svg></button>
          <button class="n-btn n-btn--ghost n-btn--icon n-btn--sm" type="button" data-go="1" aria-label="下一个" title="下一个 · ⌥→"><svg><use href="#i-chev"/></svg></button>
          <button class="n-btn n-btn--ghost n-btn--icon n-btn--sm" type="button" data-x aria-label="关闭"><svg><use href="#i-x"/></svg></button></div>
        <div class="n-condlg__stage"></div>
        <div class="n-dialog__bar"><span class="n-condlg__hint">⌘ ↵ 保存 · ⌥ ← → 切换</span><button class="n-btn n-btn--ghost" type="button" data-x>关闭</button><button class="n-btn n-btn--ink" type="button" data-save></button></div>`;
      document.body.append(d);
      const stage = d.querySelector('.n-condlg__stage');
      const field = () => d.querySelector('#cc');
      const keep = () => { const f = field(); if (!f) return; const pid = seq[i], v = f.value; if (v.trim() && v !== (S.conclusions[pid]?.text || '')) drafts[pid] = v; else delete drafts[pid]; };

      const body = (pid) => {
        const p = st.person(pid), ps = pos(pid), r = snap?.entries[pid] || st.refPos(pid, b.cutoff), c = S.conclusions[pid], chs = chOf(pid);
        const evs = st.eventsOf(pid).filter((e) => e.kind !== 'hist' && (!e.date || e.date <= b.cutoff)).slice(0, 3);
        const place = ps.na ? UI.na() : (ps.frozen && !ps.ref) || isCal(pid) ? UI.qBadge(ps.q) : html`<span class="n-badge n-badge--ai">${icon('spark')}参考：${st.QN[ps.q]}</span>`;
        const draft = drafts[pid];
        return html`<div class="n-condlg__who">${UI.avatar(pid)}<div><h3 id="cd-name">${p.name}</h3><small>${st.orgShort(p.org)}${p.manager ? ` · 导师 ${st.person(p.manager).name}` : ''}</small></div>${place}</div>
          <dl class="n-condlg__ctx">
            <div><dt>资料</dt><dd>${r.n} 条分${ps.na ? ` · ${ps.miss}` : ` · ${Object.values(r.dims).filter((x) => x.n).length} 个维度有分`}</dd></div>
            <div><dt>本期变化</dt><dd>${chs.length ? chs.map((x) => html`<span class="n-rule">${icon('flag')}${x.t === 'trend' ? `${st.dim(x.dim).name}${x.up ? '走高' : '走低'}` : x.t === 'quad' ? '参考位置跨象限' : '90 天无事件'}</span>`) : st.needsRecal(pid) ? html`<span class="n-badge n-badge--recal">可能需要重新校准</span>` : html`<span class="nt-muted">没有符合提醒条件的变化</span>`}</dd></div>
            <div><dt>最近的事</dt><dd>${evs.length ? html`<ul class="n-condlg__evs">${evs.map((e) => html`<li>${e.title}<small>${NT.md(e.date)}${e.project ? ` · ${st.project(e.project)?.name || ''}` : ''}${e.recorder ? ` · ${st.person(e.recorder).name}记录` : ''}</small></li>`)}</ul>` : html`<span class="nt-muted">证据截止前还没有确认的事件</span>`}</dd></div>
          </dl>
          <label class="n-field"><span class="n-field__label">结论和下一步${c ? html`<small>${st.person(c.by).name} · ${NT.md(c.at)} 写过，可以改</small>` : draft ? html`<small>有一份没保存的草稿</small>` : ''}</span>
            <textarea class="n-textarea ink-hand" id="cc" rows="3" placeholder="比如：近期主动性明显提升，可以给更多独立负责的机会。">${draft ?? c?.text ?? ''}</textarea></label>
          <a class="n-link n-condlg__file" href="person.html?id=${pid}" target="_blank" rel="noopener">在新标签页看完整档案</a>`;
      };

      const paint = (dir) => {
        const pid = seq[i];
        const swap = () => {
          mount(stage, body(pid));
          UI.mountIPs?.(stage);
          d.querySelector('.n-condlg__pos').textContent = `逐人结论 · ${i + 1} / ${seq.length}`;
          d.querySelector('[data-go="-1"]').disabled = i === 0;
          d.querySelector('[data-go="1"]').disabled = i === seq.length - 1;
          d.querySelector('[data-save]').textContent = i < seq.length - 1 ? '保存，下一个' : '保存结论';
          const f = field(); f.focus({ preventScroll: true }); f.setSelectionRange(f.value.length, f.value.length);
        };
        if (!dir || NT.reduced) { swap(); return; }
        // 换人时内容沿切换方向滑出、滑入，浮层本身不动
        stage.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 16}px)` }], { duration: 110, easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = () => {
          swap();
          stage.animate([{ opacity: 0, transform: `translateX(${dir * 16}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
        };
      };
      const go = (dir) => { const n = i + dir; if (n < 0 || n >= seq.length) return; keep(); i = n; paint(dir); };
      const save = () => {
        const f = field(), v = f.value.trim(), pid = seq[i];
        if (!v) { f.focus(); f.closest('.n-field').classList.add('is-error'); d.querySelector('.n-dialog__hint')?.remove(); d.querySelector('.n-dialog__bar').insertAdjacentHTML('beforebegin', '<p class="n-dialog__hint" role="alert">先写一句结论再保存</p>'); return; }
        S.conclusions[pid] = { text: v, by: st.me().id, at: NT.TODAY }; delete drafts[pid]; st.save();
        render(main);
        const name = st.person(pid).name;
        if (i < seq.length - 1) { NT.toast(`已保存${name}的结论`); i += 1; paint(1); }
        else { d.close(); NT.toast(`已保存${name}的结论，这一组写完了`); }
      };
      d.addEventListener('click', (e) => {
        if (e.target === d || e.target.closest('[data-x]')) { d.close(); return; }
        const g = e.target.closest('[data-go]'); if (g) { go(+g.dataset.go); return; }
        if (e.target.closest('[data-save]')) save();
      });
      d.addEventListener('input', () => { d.querySelector('.n-dialog__hint')?.remove(); field()?.closest('.n-field').classList.remove('is-error'); });
      d.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
        else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); go(e.key === 'ArrowLeft' ? -1 : 1); }
      });
      d.addEventListener('close', () => { keep(); d.remove(); });
      d.showModal();
      paint(0);
    }
  }
})();
