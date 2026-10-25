/* 手机导师评价：复盘后对所带学员逐个评价。选学员 → 说一段话 → AI 整理成事件和建议分 → 逐项确认 → 确认这次对人复盘。
   分差 ≥ 2 的冲突交给 HR 校准，导师在这里只看到状态，不能改。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $, $$ } = NT;
  const pid = NT.param('id');
  const WEEK = 'W8';
  const SAY = {
    'p-x11': '孟逸尘这周把任务池同步给了全组，下午组员就接上了。核心接口也是孟逸尘独立跑通的，结营演示没出问题。',
    'p-x07': '孟映雪这周把数据可视化面板搭起来了，先找组员确认要看哪些指标，改了两版。面板上线后大家查进度快多了。',
    'p-x15': '周初晴这周把九宫格和光影一致性那块攻下来了。先做了两个方案对比，再选了更稳的一个，最后的打磨也是周初晴牵头做的。',
  };
  const SAY_ANY = (name) => `${name}这周主动认领了结营演示的联调，先把问题列成清单再逐个排查，演示前一天全部跑通。`;
  const batch = st.batch('b-xe6');
  const mine = () => batch.newcomers.filter((n) => st.role() !== 'mentor' || n[2].includes(st.me().id)).map((n) => n[0]);

  NT.mshell({
    tab: 'todo', title: pid ? `${st.person(pid)?.name || ''} · ${WEEK} 对人复盘` : '导师评价', back: pid ? 'mentor.html' : 'index.html',
    allow: (r) => ['mentor', 'hrbp', 'ceo'].includes(r) && (!pid || mine().includes(pid)),
    denyText: '导师评价只对所带学员的导师、HR 和管理者开放。',
    demos: [['孟映雪：说一段话', 'mentor.html?id=p-x07'], ['孟逸尘：有冲突', 'mentor.html?id=p-x11']],
    view: () => (pid ? `${WEEK} 对人复盘 · ${st.review(pid, WEEK).state === 'confirmed' ? '已确认' : '草稿'}` : '选学员'),
    render: (main) => (pid ? renderOne(main) : renderList(main)),
  });

  function renderList(main) {
    const ids = mine();
    const rv = st.review(ids[0] || batch.newcomers[0][0], WEEK);
    mount(main, html`
      <div class="m-card"><b>XEngineer 第六期 · ${WEEK} 对人复盘</b><p class="nt-muted" style="margin:4px 0 0">${NT.md(rv.from)} – ${NT.md(rv.to)} · 自动带入这段时间的事件、录音证据和导师评价。逐个确认分数后，复盘计入学员档案。</p>
        <a class="m-link" href="record.html?m=w8">${icon('wave')}W8 导师团复盘纪要 · ${NT.SEED.MINUTES.w8.events.length} 条事件已整理${icon('chev')}</a></div>
      <h3 class="m-h">${st.role() === 'mentor' ? '你带的学员' : '全部学员'} · ${ids.length} 人</h3>
      <ul class="m-list">${ids.map((id) => {
        const r = st.review(id, WEEK), p = st.person(id);
        const badge = r.state === 'confirmed' ? html`<span class="n-badge n-badge--yes">${icon('check')}已确认</span>`
          : r.conflicts ? html`<span class="n-badge n-badge--conflict">${icon('split')}有冲突</span>`
            : r.ai ? html`<span class="n-badge n-badge--ai">${icon('spark')}${r.ai} 项待确认</span>` : html`<span class="n-badge">可确认</span>`;
        return M.row(`mentor.html?id=${id}`, UI.avatar(id, 'sm'), p.name, `${st.project(batch.newcomers.find((n) => n[0] === id)[1]).name} · 已确认 ${r.confirmed}/${r.total}`, badge);
      })}</ul>`);
  }

  function renderOne(main) {
    const r = st.review(pid, WEEK), p = st.person(pid), land = st.landingOf(pid);
    const done = r.state === 'confirmed';
    const canCal = st.can('calibrate');
    const pending = r.rows.filter((x) => x.state === 'ai').length;
    const ids = mine(), next = ids[ids.indexOf(pid) + 1];
    mount(main, html`
      <div class="m-card m-rvhead">${done ? html`<span class="n-seal n-seal--sm" id="rv-seal">已<br>确认</span>` : ''}
        ${UI.person(pid, { size: '', meta: `课题「${st.project(land.row[1]).name}」 · 导师 ${land.row[2].map((m) => st.person(m).name).join('、')}` })}
        <div class="m-rvprog"><span style="width:${r.total ? (r.confirmed / r.total) * 100 : 0}%"></span></div>
        <p class="nt-muted" style="margin:6px 0 0">${NT.md(r.from)} – ${NT.md(r.to)} · 带入 ${r.events.length} 条事件 · 已确认 ${r.confirmed}/${r.total}${r.conflicts ? ` · ${r.conflicts} 项在 HR 校准队列` : ''}</p>
      </div>

      ${done ? '' : html`<section class="m-card m-say" id="say">
        <b>说一段话</b><p class="nt-muted" style="margin:2px 0 var(--s-3)">复盘后对${p.name}的观察，AI 整理成事件和建议分，加入下面逐项确认。</p>
        <textarea class="n-eventin__field" id="say-text" rows="3" placeholder="按住下面的按钮说，或者直接打字"></textarea>
        <div class="m-say__bar"><button class="m-hold m-hold--sm" type="button" id="say-hold" aria-label="按住说话，松开结束">${icon('mic')}</button><span class="nt-muted" id="say-hint">按住说话，松开结束</span><button class="n-btn n-btn--sm n-btn--light" type="button" id="say-go">${icon('spark')}整理</button></div>
        <div id="say-out"></div>
      </section>`}

      <h3 class="m-h">逐项确认<span class="nt-muted" style="font-weight:400">${r.confirmed}/${r.total}</span></h3>
      <div class="m-dims">${r.rows.map((row) => dimRow(row, st.canEditReview(pid) && !done, canCal))}</div>

      <div class="m-actions">
        ${done ? html`<p class="nt-muted" style="text-align:center;margin:0"><span class="ink-hand" style="font-size:var(--t-md);color:var(--ink)">${st.person(r.by).name}</span> ${NT.md(r.at)} 确认 · 已计入${p.name}的档案</p>
          ${next ? html`<a class="n-btn n-btn--ink m-big" href="mentor.html?id=${next}">下一位：${st.person(next).name}</a>` : html`<a class="n-btn n-btn--ink m-big" href="mentor.html">回到学员列表</a>`}`
          : html`<p class="nt-muted" style="text-align:center;margin:0">${r.conflicts ? `还有 ${r.conflicts} 项冲突等 HR 校准，校准后才能确认` : pending ? `还有 ${pending} 项 AI 建议分待确认` : '分数都已确认，可以确认这次复盘'}</p>
            <button class="n-btn n-btn--ink m-big" type="button" id="rv-ok" ${NT.raw(r.conflicts || pending ? 'disabled' : '')}>确认这次复盘</button>`}
      </div>`);
    wire(main);
  }

  function evLine({ e, s }) {
    const quote = e.srcs.find((x) => x.type === 'audio' && (s.st === 'conflict' || x.by === s.by)) || e.srcs[0];
    return html`<div class="n-review__ev">${e.title}${UI.cite(quote, 1)} <span class="nt-muted">· ${NT.md(e.date)} · ${st.person(e.recorder).name}</span></div>`;
  }

  function dimRow(row, canConfirm, canCal) {
    const d = row.d;
    const theme = NT.SEED.THEMES[d.id] ? html`<span class="n-theme">${NT.SEED.THEMES[d.id]}</span>` : '';
    const head = (badge) => html`<div class="n-review__dimhead"><h4>${d.name}</h4>${theme}${badge}</div>`;
    if (row.state === 'conflict') {
      const { s } = row.items.find((x) => x.s.st === 'conflict');
      return html`<div class="n-review__dim m-card" data-dim="${d.id}">${head(html`<span class="n-badge n-badge--conflict">${icon('split')}证据冲突 ${s.raters.map((x) => x.v).join(' / ')}</span>`)}
        ${row.items.map(evLine)}
        ${UI.reviewEval(pid, WEEK, row)}
        <div class="n-calib__pair">${s.raters.map((x) => html`<div class="n-calib__side"><span style="color:var(--ink-3)">${st.person(x.by).name}</span><b>${x.v}</b>「${x.why}」</div>`)}</div>
        <div class="n-lock">${icon('split')}${canCal ? html`在桌面版校准队列里处理：<a href="queue.html">去校准</a>` : '两位评价人分差 ≥ 2，已进 HR 校准队列。校准后这一项才计入档案。'}</div></div>`;
    }
    if (row.state === 'ai') {
      return html`<div class="n-review__dim m-card" data-dim="${d.id}">${head(html`<span class="n-badge n-badge--ai">${icon('spark')}AI 建议，待确认</span>`)}
        ${row.items.map(evLine)}
        ${UI.reviewEval(pid, WEEK, row)}
        ${row.items.filter((x) => x.s.st === 'ai').map(({ e, i }) => html`<div class="m-pick" data-ev="${e.id}" data-i="${i}"></div>${canConfirm ? html`<button class="n-btn n-btn--sm n-btn--ink" type="button" data-ok="${e.id}:${i}" style="margin-top:var(--s-2)">${icon('check')}确认</button>` : ''}`)}</div>`;
    }
    if (row.state === 'confirmed') {
      const counted = row.items.filter((x) => ['confirmed', 'calibrated'].includes(x.s.st));
      const last = counted[0].s;
      return html`<div class="n-review__dim m-card" data-dim="${d.id}">${head(html`${UI.dotsInline(Math.round(st.mean(counted.map((x) => x.s.v))), last.st === 'calibrated' ? 'calibrated' : 'confirmed')}<span class="n-badge">${[...new Set(counted.map((x) => st.person(x.s.by).name))].join('、')}${last.st === 'calibrated' ? '校准' : '已确认'}</span>`)}${counted.map(evLine)}${UI.reviewEval(pid, WEEK, row)}</div>`;
    }
    if (row.state === 'unknown') {
      return html`<div class="n-review__dim m-card" data-dim="${d.id}">${head(UI.na())}<div class="n-review__ev" style="color:var(--ink-3)">${d.id === 'grit' ? '待补受挫后的反应。可以留意：方案被否之后怎么做。' : '待补具体行为的记录。'}</div></div>`;
    }
    return html`<div class="n-review__dim m-card is-quiet" data-dim="${d.id}">${head(html`<span class="n-badge">未体现</span>`)}<div class="n-review__ev" style="color:var(--ink-3)">加分项在出现对应行为后计入。</div></div>`;
  }

  // 整份复盘确认后，更早的「撤销」提示一并收起
  const scoreToasts = [];
  function wire(main) {
    const picks = {};
    $$('.m-pick', main).forEach((el) => {
      const e = st.event(el.dataset.ev), s = e.scores[+el.dataset.i];
      const sc = { d: s.d, v: s.ai, ai: s.ai, note: s.note };
      const r = M.scoreRow(sc, { pid: () => s.p, ver: () => st.eventRubric(e), onChange: () => { const b = el.nextElementSibling; if (b?.dataset.ok) b.innerHTML = `<svg><use href="#i-check"/></svg>确认 ${sc.v} 分`; } });
      picks[`${el.dataset.ev}:${el.dataset.i}`] = sc;
      el.append(r.el);
      const b = el.nextElementSibling; if (b?.dataset.ok) b.innerHTML = `<svg><use href="#i-check"/></svg>确认 ${sc.v} 分`;
    });
    main.onclick = (ev) => {
      if (UI.reviewEvalClick(ev, pid, WEEK, () => renderOne(main))) return;
      const ok = ev.target.closest('[data-ok]');
      if (ok) {
        const [evId, i] = ok.dataset.ok.split(':');
        const sc = picks[ok.dataset.ok];
        st.confirmScore(evId, +i, sc.v, sc.why || '');
        ok.closest('.n-review__dim').classList.add('is-settling');
        const opts = { undo: () => {
          if (st.review(pid, WEEK).state === 'confirmed') { opts.undoneText = '复盘已确认，撤销只在确认前可用'; return; }
          st.unconfirmScore(evId, +i); renderOne(main);
        } };
        scoreToasts.push(NT.toast(`已确认 ${sc.v} 分，署名 ${st.me().name}${sc.ai != null && Math.abs(sc.v - sc.ai) >= 2 && !sc.why ? '，和 AI 差 2 分以上，进了校准队列' : ''}`, opts));
        setTimeout(() => renderOne(main), NT.reduced ? 0 : 450);
        return;
      }
      if (ev.target.closest('#rv-ok')) {
        const key = st.review(pid, WEEK).key;
        st.confirmReview(pid, WEEK);
        scoreToasts.splice(0).forEach((close) => close());
        renderOne(main);
        $('#rv-seal')?.classList.add('is-stamping');
        $('#m-scroll').scrollTop = 0;
        NT.toast(`${WEEK} 对人复盘已确认，计入${st.person(pid).name}的档案`, {
          undo: () => { delete st.get().reviews[key]; st.save(); renderOne(main); }, undoneText: '已撤销确认，复盘回到草稿',
        });
      }
    };
    const field = $('#say-text'); if (!field) return;
    const go = () => shapeSay(main, field.value.trim());
    M.hold($('#say-hold'), field, SAY[pid] || SAY_ANY(st.person(pid).name), {
      onStart: () => { $('#say-hint').textContent = '正在听…'; },
      onEnd: () => { $('#say-hint').textContent = '转写完成'; setTimeout(go, 300); },
      onCancel: () => { $('#say-hint').textContent = '按住说话，松开结束'; },
    });
    $('#say-go').onclick = () => (field.value.trim() ? go() : field.focus());
  }

  async function shapeSay(main, text) {
    if (!text) return;
    const out = $('#say-out');
    const s = NT.parse.shape(text, pid);
    const proj = NT.parse.findProject(text) || st.project(st.landingOf(pid).row[1]);
    mount(out, html`<div class="m-sayev">
      <div class="nt-row"><span class="n-src n-src--ai">${icon('spark')}AI 整理</span><span class="nt-ip" data-ip="thinking" data-size="24" id="say-ip"></span></div>
      <b class="m-sayev__t" id="say-t"></b>
      <dl class="n-event__sbar"><dt>情境</dt><dd id="say-bg"></dd><dt>行为</dt><dd id="say-act"></dd><dt>影响</dt><dd id="say-res"></dd></dl>
      <div class="m-sayev__scores" id="say-sc"></div>
      <div class="nt-row" id="say-acts" hidden><button class="n-btn n-btn--sm n-btn--ink" type="button" id="say-add">加入复盘，逐项确认</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" id="say-x">删掉这条</button></div>
    </div>`);
    UI.mountIPs(out);
    await NT.stream($('#say-t'), s.title, 16);
    for (const k of ['bg', 'act', 'res']) { if (s[k]) await NT.stream($(`#say-${k}`), s[k], 12); else $(`#say-${k}`).innerHTML = '<span class="nt-muted">待补充</span>'; }
    mount($('#say-sc'), s.scores.map((x) => (x.v == null ? html`<span class="n-badge n-badge--unknown">${icon('dash')}${st.dim(x.d).name} 资料不足</span>` : html`<span class="n-badge n-badge--ai">${icon('spark')}${st.dim(x.d).name} ${x.ai}</span>`)));
    NT.ipState($('#say-ip'), 'confirm');
    $('#say-acts').hidden = false;
    $('#say-x').onclick = () => { out.innerHTML = ''; $('#say-text').value = ''; };
    $('#say-add').onclick = () => {
      const { e } = NT.parse.commit({ pid, proj, text, ...s, label: `${WEEK} 导师评价`, review: `${pid}-${WEEK}`, pending: true });
      renderOne(main);
      const first = $(`.m-pick[data-ev="${e.id}"]`);
      first?.closest('.n-review__dim')?.scrollIntoView({ block: 'center' });
      first?.closest('.n-review__dim')?.classList.add('nt-flash');
      NT.toast('已加入复盘，AI 建议分等你逐项确认', { undo: () => { st.removeEvent(e.id); renderOne(main); } });
    };
  }
})();
