/* 双周对人复盘：一份活文档。自动带入两周内的事件、录音证据和导师评价；导师逐项确认分数，HR 处理冲突后整份确认。
  管理者关心的「判断力、推动力」作为观察主题挂在对应维度下，不改维度名。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  const pid = NT.param('id') || 'p-x11';
  const week = NT.param('w') || 'W8';
  const THEME = NT.SEED.THEMES;

  NT.shell({
    nav: 'programs', title: `${st.person(pid)?.name || ''} · ${week} 对人复盘`, crumbs: [['人才项目', 'landing.html'], ['XEngineer 第六期', 'landing.html']],
    allow: () => ['full', 'mentor'].includes(st.scope(pid)) && st.role() !== 'self',
    view: () => `${week} 对人复盘 · ${st.review(pid, week).state === 'confirmed' ? '已确认' : '草稿'}`,
    render,
  });

  function render(main) {
    const r = st.review(pid, week);
    const p = st.person(pid), land = st.landingOf(pid);
    const role = st.role();
    const canConfirm = st.canEditReview(pid); // 分数和评价由 HR 和所带导师修正
    const canCal = st.can('calibrate');
    const audio = r.events.flatMap((e) => e.srcs.filter((s) => s.type === 'audio')).length;
    const pendingAll = r.rows.filter((x) => x.state === 'ai').length;
    const done = r.state === 'confirmed';
    mount(main, html`
      <article class="n-card n-review" style="position:relative">
        ${done ? html`<span class="n-seal" style="position:absolute;right:24px;top:20px">已<br>确认</span>` : ''}
        <div class="n-batch__head" style="margin-bottom:var(--s-4)">${UI.person(pid, { meta: `${NT.md(r.from)} – ${NT.md(r.to)} · 带入 ${r.events.length} 条事件、${audio} 段录音 · 导师 ${land.row[2].map((m) => st.person(m).name).join('、')}` , after: html` · ${week} 对人复盘` })}</div>
        ${r.rows.map((row) => dimRow(row, canConfirm && !done, canCal && !done))}
        <div class="n-review__foot">导师确认 ${r.confirmed}/${r.total}${r.conflicts ? ` · ${r.conflicts} 项冲突待 HR 复核` : ''}${pendingAll ? ` · ${pendingAll} 项 AI 建议分待确认` : ''}
          ${done ? html`<span class="ink-hand" style="margin-left:auto;font-size:var(--t-md);color:var(--ink)">${st.person(r.by).name}</span><span>${NT.md(r.at)} 确认</span>`
            : html`<button class="n-btn n-btn--ink" type="button" id="rv-ok" ${NT.raw(r.conflicts || pendingAll || !canConfirm ? 'disabled' : '')} title="${r.conflicts ? '还有冲突未校准' : pendingAll ? '还有 AI 建议分未确认' : ''}">确认这次复盘</button>`}
        </div>
      </article>
      <div id="after"></div>`);
    wire(main);
    if (done && st.can('quad', pid)) afterBlock();
  }

  function evText(items) {
    return items.map(({ e, s }) => {
      const quote = e.srcs.find((x) => x.type === 'audio' && (s.st === 'conflict' || x.by === s.by)) || e.srcs[0];
      return html`<div class="n-review__ev">${e.title}：${e.act || ''}${UI.cite(quote, 1)} <span class="nt-muted">· ${NT.md(e.date)} · ${st.person(e.recorder).name}记录</span></div>`;
    });
  }

  function dimRow(row, canConfirm, canCal) {
    const d = row.d;
    const theme = THEME[d.id] ? html`<span class="n-theme">${THEME[d.id]}</span>` : '';
    if (row.state === 'conflict') {
      const { e, s, i } = row.items.find((x) => x.s.st === 'conflict');
      return html`<div class="n-review__dim" data-dim="${d.id}"><div class="n-review__dimhead"><h4>${d.name}</h4>${theme}<span class="n-badge n-badge--conflict">${icon('split')}证据冲突 ${s.raters.map((x) => x.v).join(' / ')}</span></div>
        ${evText(row.items)}
        ${UI.reviewEval(pid, week, row)}
        <div class="n-calib__pair">${s.raters.map((x) => html`<div class="n-calib__side"><span style="color:var(--ink-3)">${st.person(x.by).name} · ${st.person(x.by).staff === 'ta' ? '助教' : '导师'}</span><b>${x.v}</b>「${x.why}」</div>`)}</div>
        ${canCal ? html`<div class="n-calib" data-ev="${e.id}" data-i="${i}"><label class="nt-muted" for="cr-${d.id}">校准为 <select class="n-select" style="width:auto;min-height:28px;display:inline-block" id="cv-${d.id}">${[2, 3, 4].map((v) => html`<option ${v === 3 ? 'selected' : ''}>${v}</option>`)}</select> 分，理由</label>
          <textarea class="n-calib__reason" id="cr-${d.id}" placeholder="写一句理由，会留在修订历史里。比如：方案表达到位，排查过程发散，各取一半"></textarea>
          <div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-cal>校准</button><span class="nt-muted">HR 校准后，这一项计入档案</span></div></div>`
          : html`<div class="n-lock">${icon('split')}两位评价人分差 ≥ 2，已转给 HR 复核。复核后这一项才计入档案。</div>`}
      </div>`;
    }
    if (row.state === 'ai') {
      return html`<div class="n-review__dim" data-dim="${d.id}"><div class="n-review__dimhead"><h4>${d.name}</h4>${theme}<span class="n-badge n-badge--ai">${icon('spark')}AI 建议，待导师确认</span></div>
        ${evText(row.items)}
        ${UI.reviewEval(pid, week, row)}
        ${row.items.filter((x) => x.s.st === 'ai').map(({ e, s, i }) => html`<div class="n-score nt-pick" data-state="ai" data-ev="${e.id}" data-i="${i}" data-ai="${s.ai}"><span class="n-score__dim">建议 ${s.ai} 分</span><span class="n-score__dots" role="radiogroup" aria-label="${d.name}分数">${[1, 2, 3, 4, 5].map((v) => html`<button type="button" class="n-score__dot ${v <= s.ai ? 'is-on' : ''}" role="radio" aria-checked="${v === s.ai}" aria-label="${v} 分" data-v="${v}" ${NT.raw(canConfirm ? '' : 'disabled')}></button>`)}</span><span class="n-score__note">${s.note || ''}</span></div>
          ${canConfirm ? html`<div class="nt-row" style="margin:var(--s-2) 0 0 calc(5.5em + var(--s-3))"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-ok="${e.id}:${i}">${icon('check')}确认 ${s.ai} 分</button><span class="nt-muted">点圆点可以改分</span></div>` : ''}`)}
      </div>`;
    }
    if (row.state === 'confirmed') {
      const counted = row.items.filter((x) => ['confirmed', 'calibrated'].includes(x.s.st));
      const last = counted[0].s;
      return html`<div class="n-review__dim" data-dim="${d.id}"><div class="n-review__dimhead"><h4>${d.name}</h4>${theme}${UI.dotsInline(Math.round(st.mean(counted.map((x) => x.s.v))), last.st === 'calibrated' ? 'calibrated' : 'confirmed')}<span class="n-badge">${[...new Set(counted.map((x) => st.person(x.s.by).name))].join('、')}${last.st === 'calibrated' ? '校准' : '已确认'}</span></div>${evText(counted)}${UI.reviewEval(pid, week, row)}</div>`;
    }
    if (row.state === 'unknown') {
      return html`<div class="n-review__dim" data-dim="${d.id}"><div class="n-review__dimhead"><h4>${d.name}</h4>${theme}${UI.na()}</div><div class="n-review__ev" style="color:var(--ink-3)">${d.id === 'grit' ? '待补受挫后的反应。下次复盘可以留意：方案被否之后怎么做。' : `${row.items.length ? '只记到参与，待补具体行为' : '待补相关行为的记录'}。`}</div></div>`;
    }
    return html`<div class="n-review__dim" data-dim="${d.id}"><div class="n-review__dimhead"><h4>${d.name}</h4>${theme}<span class="n-badge">未体现</span></div><div class="n-review__ev" style="color:var(--ink-3)">加分项在出现对应行为后计入。</div></div>`;
  }

  function wire(main) {
    main.onclick = (e) => {
      if (UI.reviewEvalClick(e, pid, week, () => render(main))) return;
      const dot = e.target.closest('.nt-pick .n-score__dot');
      if (dot && !dot.disabled) {
        const row = dot.closest('.nt-pick'), v = +dot.dataset.v, ai = +row.dataset.ai;
        row.dataset.state = 'confirmed'; row.dataset.v = v;
        $$('.n-score__dot', row).forEach((b) => { const x = +b.dataset.v; b.classList.toggle('is-on', x <= v); b.classList.toggle('is-ghost', x <= ai && x > v); b.setAttribute('aria-checked', x === v); });
        $('.n-score__note', row).innerHTML = v !== ai ? `<span class="n-score__delta">${v > ai ? '+' : ''}${v - ai}</span>AI 原为 ${ai}` : '和 AI 建议一致';
        const ok = row.nextElementSibling?.querySelector('[data-ok]');
        if (ok) ok.innerHTML = `<svg><use href="#i-check"/></svg>确认 ${v} 分`;
        let why = $('.n-score__why', row);
        if (Math.abs(v - ai) >= 2) {
          if (!why) {
            why = document.createElement('input'); why.className = 'n-score__why';
            why.setAttribute('aria-label', `${row.closest('[data-dim]').querySelector('h4').textContent}改分理由`);
            row.append(why); why.focus({ preventScroll: true });
          }
          why.placeholder = `为什么改成 ${v} 分？留空会转给 HR 复核`;
        } else why?.remove();
        return;
      }
      const ok = e.target.closest('[data-ok]');
      if (ok) {
        const [evId, i] = ok.dataset.ok.split(':');
        const row = ok.closest('.n-review__dim').querySelector(`.nt-pick[data-i="${i}"]`);
        const v = +(row.dataset.v || row.dataset.ai), ai = +row.dataset.ai;
        const why = ($('.n-score__why', row)?.value || '').trim();
        st.confirmScore(evId, +i, v, why);
        const dimEl = ok.closest('.n-review__dim');
        dimEl.classList.add('n-block', 'is-settling');
        const opts = { undo: () => {
          if (st.review(pid, week).state === 'confirmed') { opts.undoneText = '复盘已确认，撤销只在确认前可用'; return; }
          st.unconfirmScore(evId, +i); render(main);
        } };
        scoreToasts.push(NT.toast(`已确认 ${v} 分，署名 ${st.me().name}${Math.abs(v - ai) >= 2 && !why ? '，和 AI 差 2 分以上，转给了 HR 复核' : ''}`, opts));
        setTimeout(() => render(main), NT.reduced ? 0 : 500);
        return;
      }
      const cal = e.target.closest('[data-cal]');
      if (cal) {
        const box = cal.closest('.n-calib'), dimId = box.closest('[data-dim]').dataset.dim;
        const why = $(`#cr-${dimId}`).value.trim();
        if (!why) { $(`#cr-${dimId}`).focus(); return; }
        st.calibrate(box.dataset.ev, +box.dataset.i, +$(`#cv-${dimId}`).value, why);
        NT.toast('已校准，理由留在修订历史里');
        render(main);
        return;
      }
      if (e.target.closest('#rv-ok')) confirmReview(main);
    };
  }

  // 整份确认后，更早的「撤销」提示一并收起；确认本身可以在 5 秒内撤销，回到草稿
  const scoreToasts = [];
  function confirmReview(main) {
    const key = st.review(pid, week).key;
    st.confirmReview(pid, week);
    scoreToasts.splice(0).forEach((close) => close());
    render(main);
    const seal = $('.n-seal', main); seal?.classList.add('is-stamping');
    NT.toast(`${week} 对人复盘已确认，计入${st.person(pid).name}的档案`, {
      undo: () => { delete st.get().reviews[key]; st.save(); render(main); }, undoneText: '已撤销确认，复盘回到草稿',
    });
  }

  function afterBlock() {
    const ref = st.refPos(pid);
    mount($('#after'), html`<div class="n-block" data-state="light" style="margin-top:var(--s-4)">${ref.na
      ? `复盘已确认。${st.person(pid).name}还在「资料不足」区：${ref.miss}。结营复盘时再看。`
      : `复盘已确认。${st.person(pid).name}现在满足落位门槛，参考位置在「${st.QN[ref.q]}」。正式位置在结营校准时由 HR 确认。`}
      <div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}参考位置</span>导师视角已隐藏这一段</div></div>
      ${!ref.na ? html`<div class="nt-row" style="margin-top:var(--s-2)"><a class="n-btn n-btn--sm" href="review.html?id=b-xe6-end">${icon('grid')}去结营盘点</a></div>` : ''}`);
  }
})();
