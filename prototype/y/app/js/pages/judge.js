/* 判断对照（需求里的「判断复盘」）：把同一个人同一维度在前后两个阶段的判断放在一起对照，找出评价体系的系统性偏差，归因后生成改进动作。
   归在「评价体系」下，和规则是同一个闭环：规则定标准，判断对照检验标准，结论回到规则修订。
   对照的对象是判断，不是被评价的人：结论只作用于评价标准、评价人与评价方式，不改变任何人的分数、象限和档案。
   两段都是判断，后段不当作正确答案。按评价人的偏差只给 HR 和评价人本人看；管理者只看汇总与结论；被评价人看不到这一页。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  const id = NT.param('id');
  const role = st.role(), me = st.me();
  const raterId = NT.param('rater') === 'me' ? me.id : NT.param('rater');
  // 管理者只看汇总与结论：圆点不带姓名，维度行不展开案例，不出现按评价人的内容
  const sumOnly = role !== 'hrbp';
  let openDim = sumOnly ? null : NT.param('dim') || null, focus = null, marking = null;

  const STATE = { same: '一致', high: '前段偏高', low: '前段偏低', nc: '不可比', na: '资料不足' };
  const CAT = { std: '评价标准', rater: '评价人', method: '评价方式与信息不足', env: '本人或环境变化', later: '后段评价偏差' };
  // 复核方向的问题式说明（v1.4 3.22）
  const CAT_Q = { std: '等级定义和观察锚点是否一致？', rater: '提问、追问和评分是否有偏差？', method: '两个阶段观察到的是同一种能力吗？', env: '任务难度、带教、资源是否影响了表现？', later: '后段评价口径是否偏严、证据够不够？' };
  const GAP = ['', '一档', '两档', '三档', '四档'];
  const stateText = (u) => (u.gap ? `${STATE[u.state]} · ${u.state === 'high' ? '高' : '低'}${GAP[u.gap]}` : STATE[u.state]);
  const jstate = (u) => html`<span class="n-jstate" data-s="${u.state}">${stateText(u)}</span>`;
  const name = (pid) => st.person(pid)?.name || '';
  // 判断对照的链对应评价体系里的前段评价标准；没有对应条目的链不跳转
  const FRONT_LINE = { xe: 'xe-weekly' };
  const frontLink = (chain) => (FRONT_LINE[chain.id] ? NT.link('rules.html', { r: 'front', line: FRONT_LINE[chain.id] }) : null);

  NT.shell({
    nav: st.canJudge() ? 'rules' : 'judge',
    title: raterId ? (raterId === me.id ? '我的判断对照' : `${name(raterId)}的判断`) : id ? st.judgeBatch(id)?.name || '判断对照' : '判断对照',
    crumbs: !st.canJudge() ? [] : id || raterId ? [['评价体系', 'rules.html'], ['判断对照', 'judge.html']] : [['评价体系', 'rules.html']],
    allow: (r) => {
      if (raterId) return !!st.person(raterId) && st.canSeeRater(raterId, r);
      if (id) return st.canJudge(r) && !!st.judgeBatch(id);
      return st.canJudge(r) || st.isRater(r);
    },
    denyText: raterId ? (role === 'ceo' ? html`按评价人的偏差仅 HR 和评价人本人可见。<a href="judge.html">查看判断对照汇总</a>` : '按评价人的偏差仅 HR 和评价人本人可见。') : st.isRater() ? '这个视角只显示你作为评价人做出的判断。' : '',
    view: () => (id ? `判断对照 · ${st.judgeBatch(id)?.name}${openDim ? ` · 展开「${openDim}」` : ''}` : raterId ? `判断对照 · 评价人 ${name(raterId)}` : '判断对照 · 列表'),
    state: () => ({ openDim }),
    restore: (s) => { openDim = s.openDim || null; render($('#main')); },
    render,
  });

  function render(main) {
    if (raterId) return renderRater(main);
    if (id) return renderBatch(main);
    if (!st.canJudge()) { history.replaceState(null, '', NT.link('judge.html', { rater: 'me' })); location.reload(); return; }
    return renderList(main);
  }

  // ---------- 汇总口径 ----------
  const tallyText = (units, chain) => {
    const t = st.judgeTally(units), n = units.length;
    if (chain.scale === 'grade') {
      const c = st.judgeClear(units, chain);
      if (!c.clear.length && !c.mid.length) return `${n} 人的判断都标为不可比或资料不足`;
      const h = c.diff.filter((u) => u.state === 'high').length, l = c.diff.length - h;
      const mid = chain.grades[Math.floor(chain.grades.length / 2)];
      const back = (chain.backGrades || chain.grades).slice().reverse().map((g) => [g, c.mid.filter((u) => u.back.v === g).length]).filter(([, k]) => k);
      return `前段评为最高或最低一档的 ${c.clear.length} 人里，${c.diff.length ? `${c.diff.length} 人前后判断不一致（${[h && `${h} 人前段偏高`, l && `${l} 人前段偏低`].filter(Boolean).join('、')}）` : '前后判断都一致'}${c.mid.length ? `；前段「${mid}」的 ${c.mid.length} 人没有表态，${chain.back}${back.map(([g, k]) => `${g} ${k}`).join('、')}` : ''}`;
    }
    const parts = [t.high && `${t.high} 人前段偏高`, t.low && `${t.low} 人前段偏低`, t.same && `${t.same} 人一致`].filter(Boolean);
    return parts.length ? `${n} 人中 ${parts.join('，')}` : `${n} 人的判断都标为不可比或资料不足`;
  };
  const restText = (units) => { const t = st.judgeTally(units); return [t.nc && `不可比 ${t.nc}`, t.na && `资料不足 ${t.na}`].filter(Boolean).join(' · '); };
  // 前段等级过于集中：作为归因参考提示「区分度低」，不作为评价人的分数
  function spread(chain, units) {
    const vals = units.map((u) => u.front.v).filter((v) => v != null);
    if (!vals.length) return '';
    const keys = chain.scale === 'grade' ? chain.grades.slice().reverse() : [5, 4, 3, 2, 1];
    const c = keys.map((k) => [k, vals.filter((v) => v === k).length]);
    const top = Math.max(...c.map(([, n]) => n));
    const low = vals.length >= 6 && top / vals.length >= 0.75;
    return `${chain.front} ${c.filter(([, n]) => n).map(([k, n]) => `${k}${chain.scale === 'grade' ? '' : ' 分'} ${n}`).join(' · ')}${low ? ' · 区分度低' : ''}`;
  }
  const unitsOf = (bid) => st.judgeUnits(bid).filter((u) => st.judgeScope(u));
  const dimsOf = (chain, units) => chain.dims.filter((d) => units.some((u) => u.dim === d.id));
  // 批次头的范围说明：多少人进入对照，其余因缺少前段或后段判断、或标为不可比没有进入（按数据计算）
  function scopeLine(units, chain) {
    const byP = new Map();
    units.forEach((u) => { if (!byP.has(u.person)) byP.set(u.person, []); byP.get(u.person).push(u); });
    const groups = [...byP.values()];
    const cmp = groups.filter((us) => us.some(st.judgeComparable)).length;
    const nc = groups.filter((us) => !us.some(st.judgeComparable) && us.some((u) => u.state === 'nc')).length;
    const pool = chain.id === 'xe' ? st.people().filter((p) => p.xe && st.judgeScope({ person: p.id })).length : 0;
    const total = Math.max(pool, groups.length);
    if (!total) return '';
    const miss = total - cmp - nc;
    return `共 ${total} 人，${cmp} 人进入对照${miss > 0 ? `；另有 ${miss} 人缺少 ${chain.front}或${chain.back}的判断` : ''}${nc ? `；${nc} 人标为不可比` : ''}`;
  }

  // ---------- 列表 ----------
  function renderList(main) {
    const S = st.get();
    const chains = [...new Set(st.judgeBatches().map((b) => b.chain))].map((c) => st.judgeChain(c));
    mount(main, html`
      ${UI.evalHead('judge', '把招聘、入营这类前段判断，和后一阶段对同一个人同一维度的判断放在一起对照，找出评价标准、评价人和评价方式里的系统性偏差，结论回到规则修订。')}
      <div class="nt-split">
        <div class="nt-grid">${chains.map((c) => html`<section><h2 class="nt-h2">${c.name}<small>${c.front} → ${c.back}</small></h2><div class="nt-grid" style="gap:var(--s-3)">${st.judgeBatches(c.id).slice().reverse().map((b) => batchCard(b, c, S))}</div></section>`)}</div>
        <aside class="nt-grid">
          ${role === 'hrbp' ? raterCard(st.judgeBatches().flatMap((b) => unitsOf(b.id))) : ''}
          ${st.isRater() ? html`<a class="n-btn" href="judge.html?rater=me">${icon('user')}我作为评价人的判断</a>` : ''}
          ${lockNote()}
        </aside>
      </div>`);
  }
  function batchCard(b, chain, S) {
    const units = unitsOf(b.id);
    const dims = dimsOf(chain, units).map((d) => ({ d, us: units.filter((u) => u.dim === d.id) }));
    const worst = dims.slice().sort((x, y) => st.judgeClear(y.us, chain).diff.length - st.judgeClear(x.us, chain).diff.length)[0];
    const pending = st.judgeHyps(b.id).filter((h) => !st.judgeAttrib(h.id)).length;
    const acts = st.judgeHyps(b.id).flatMap((h) => st.judgeAttrib(h.id)?.actions || []).length;
    return html`<a class="n-card nt-plink" href="judge.html?id=${b.id}" style="display:block">
      <div class="nt-row" style="justify-content:space-between"><b>${b.name}</b>${b.status === 'concluded' ? html`<span class="n-badge n-badge--seal">${icon('stamp')}已归因</span>` : html`<span class="n-badge">进行中</span>`}</div>
      <div class="nt-muted" style="margin-top:2px">${b.range} · 标准 ${b.std} · 对应表 ${b.map}</div>
      ${worst ? html`<p style="margin:var(--s-2) 0 0;font-size:var(--t-sm)">${worst.d.name}：${tallyText(worst.us, chain)}</p>` : ''}
      <div class="nt-row" style="margin-top:var(--s-2)">${pending && role === 'hrbp' ? html`<span class="n-badge n-badge--ai">${icon('spark')}${pending} 条 AI 假设待确认</span>` : ''}${acts ? html`<span class="n-badge">${acts} 条改进动作</span>` : ''}</div>
    </a>`;
  }
  const lockNote = () => html`<div class="n-lock">${icon('lock')}对照结论只用于修订评价体系。</div>`;

  // ---------- 一次判断对照 ----------
  function renderBatch(main) {
    const b = st.judgeBatch(id), chain = st.judgeChain(b.chain), map = st.judgeMap(b.map), std = st.judgeStd(b.std);
    const units = unitsOf(id);
    const dims = dimsOf(chain, units);
    const siblings = st.judgeBatches(b.chain);
    mount(main, html`
      <header class="nt-head"><div><h1>${b.name}</h1><p>${chain.name}：${chain.front} → ${chain.back} · ${b.range} · ${name(b.by)} ${NT.md(b.at)} 发起</p>
          ${scopeLine(units, chain) ? html`<p class="nt-muted" style="margin-top:2px">${scopeLine(units, chain)}</p>` : ''}</div>
        <div class="nt-head__acts"><span class="n-rule">${icon('doc')}标准 ${std.id}</span><span class="n-rule">${icon('swap')}对应表 ${map.id}</span>${b.status === 'concluded' ? html`<span class="n-badge n-badge--seal">${icon('stamp')}已归因</span>` : ''}</div></header>
      <div class="nt-split nt-split--wide">
        <div class="nt-grid">
          <article class="n-card" id="dims">
            <h3 class="n-section-title">按维度<small class="nt-muted" style="font-weight:400;margin-left:auto">${sumOnly ? '每个点代表一人' : '每个点是一个人 · 点一行看案例'}</small></h3>
            <div class="n-jdist" role="list">
              <div class="n-jdist__head" aria-hidden="true"><span></span><span>前段低两档+</span><span>前段低一档</span><span class="is-mid">一致</span><span>前段高一档</span><span>前段高两档+</span></div>
              ${dims.map((d) => dimRow(d, units.filter((u) => u.dim === d.id), chain, map))}
            </div>
            <p class="nt-caption">前段和后段按对应表 ${map.id} 换算到同一档后对照，偏差人数只算可对照的案例。</p>
          </article>
          ${siblings.length > 1 ? versionCard(chain, siblings) : ''}
          <article class="n-card" id="attrib"><h3 class="n-section-title">归因</h3>${attribBody(b, chain, units)}</article>
        </div>
        <aside class="nt-grid">
          ${ruleCard(chain, map, std)}
          ${role === 'hrbp' ? raterCard(units, b.id) : ''}
          ${actionsCard(b)}
          ${lockNote()}
        </aside>
      </div>`);
    wireBatch(main, b, chain, units);
    if (focus) { const el = document.getElementById(`case-${focus}`); el?.scrollIntoView({ block: 'center', behavior: NT.reduced ? 'auto' : 'smooth' }); el?.classList.add('is-focus'); focus = null; }
  }

  // 一行 = 一个维度。中间是「一致」，左边前段偏低、右边前段偏高，越远差得越多
  function dimRow(d, us, chain, map) {
    const col = (u) => (u.state === 'same' ? 2 : u.state === 'high' ? (u.gap >= 2 ? 4 : 3) : u.state === 'low' ? (u.gap >= 2 ? 0 : 1) : -1);
    const cells = [0, 1, 2, 3, 4].map((i) => us.filter((u) => col(u) === i));
    const open = !sumOnly && openDim === d.id;
    const rest = restText(us), sp = spread(chain, us);
    const inner = html`<span class="n-jdist__dim">${d.name}</span>
        ${cells.map((c, i) => html`<span class="n-jdist__cell ${i === 2 ? 'is-mid' : ''}" aria-hidden="true">${c.map((u) => (sumOnly
          ? html`<span class="n-jdot is-anon" data-s="${u.state}"></span>`
          : html`<span class="n-jdot" data-s="${u.state}" title="${name(u.person)} · ${stateText(u)}">${name(u.person).slice(0, 1)}</span>`))}</span>`)}
        <span class="n-jdist__sum">${tallyText(us, chain)}${rest || sp ? html`<small>${[rest, sp].filter(Boolean).join(' · ')}</small>` : ''}</span>`;
    return html`<div role="listitem">${sumOnly
      ? html`<div class="n-jdist__row is-static">${inner}</div>`
      : html`<button class="n-jdist__row" type="button" data-dim="${d.id}" aria-expanded="${open}" aria-label="${d.name}：${tallyText(us, chain)}${rest ? `，${rest}` : ''}。${open ? '收起' : '展开'}案例">${inner}</button>`}
      ${open ? html`<div class="nt-grid" style="gap:0;padding:var(--s-3) 0 var(--s-4)">${sortCases(us).map((u) => caseCard(u, chain, map))}</div>` : ''}</div>`;
  }
  const ORDER = ['high', 'low', 'nc', 'same', 'na'];
  const sortCases = (us) => us.slice().sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || name(a.person).localeCompare(name(b.person), 'zh'));

  // 对照单元：左右两段同样的排版
  function caseCard(u, chain, map, o = {}) {
    const showBackNote = !o.raterOnly;
    const fEv = u.front.ev && st.event(u.front.ev);
    const fv = u.front.v == null ? '—' : u.front.v;
    const bv = u.back.na ? '—' : u.back.v;
    // 等级制两段的来源是原始表格的单元格；评价人本人看不到后段评语，也不给后段引用
    const backDetail = chain.scale === 'grade'
      ? (showBackNote && u.back.note ? html`<p class="n-jcase__note">${u.back.note}${UI.cite(u.back.src, 2)}</p>` : '')
      : u.back.na ? html`<div>${u.back.miss}${u.back.to ? ` · 窗口到 ${NT.md(u.back.to)}` : ''}</div>`
        : html`<div>均值 ${u.back.mean.toFixed(1)} · ${u.back.n} 条已确认分，来自 ${u.back.evs.length} 条事件${showBackNote ? html` · 记录人 ${u.back.by.map(name).join('、')}${u.back.evs.map((e, i) => UI.cite(citeOf(e), i + 2))}` : ''}</div>`;
    const canMark = role === 'hrbp' && !o.raterOnly && u.front.v != null && !u.back.na;
    return html`<article class="n-jcase" id="case-${u.id}">
      <div class="n-jcase__head">${UI.avatar(u.person, 'sm')}<b>${name(u.person)}</b><span class="n-badge n-badge--demo">演示</span><span class="nt-muted">${u.dimName}${o.batch ? ` · ${st.judgeBatch(u.batch).name}` : ''}</span>
        ${!o.raterOnly && chain.scale === 'score' && !u.back.na && u.back.n >= 4 ? html`<span class="nt-muted" style="margin-left:auto">后段证据更多（${u.back.n} 条），仍不当作真值</span>` : ''}</div>
      <div class="n-jcase__side"><div class="n-jcase__stage"><span>${chain.front}</span><span>${u.front.std}</span></div>
        <div class="n-jcase__val"><b>${fv}</b><span>${name(u.front.by)}</span></div>
        ${u.front.v == null ? html`<div>${u.front.miss || '前段评价未体现这个维度'}</div>` : html`<p class="n-jcase__note">${u.front.note}</p>`}
        ${fEv ? UI.cite({ ...fEv.srcs[0], quote: fEv.quote }, 1) : u.front.src ? UI.cite(u.front.src, 1) : ''}</div>
      <div class="n-jcase__mid">${jstate(u)}<span>按 ${map.id}</span></div>
      <div class="n-jcase__side"><div class="n-jcase__stage"><span>${chain.back}</span><span>${chain.scale === 'grade' ? `评审 ${name(u.back.by[0])}` : '按对应表取档'}</span></div>
        <div class="n-jcase__val"><b>${bv}</b>${chain.scale === 'grade' && !u.back.na ? html`<span>${name(u.back.by[0])}</span>` : ''}</div>
        ${u.back.na && chain.scale === 'grade' ? html`<div>${u.back.miss}</div>` : ''}${backDetail}
        ${o.raterOnly ? html`<div class="nt-muted" style="margin-top:var(--s-1)">评价人视角已隐藏后段评语和档案的其他内容</div>` : ''}</div>
      ${u.mark ? html`<div class="n-jcase__mark">${icon('pen', 12)}标为不可比：<span class="n-jcase__why">${u.mark.reason}</span>· ${name(u.mark.by)} ${NT.md(u.mark.at)}${role === 'hrbp' && !o.raterOnly ? html`<button class="n-link" type="button" data-unmark="${u.id}">撤销</button>` : ''}</div>`
        : canMark && marking === u.id ? html`<div class="n-jcase__mark"><input class="n-input" id="nc-why" placeholder="为什么不可比？比如：两段考的是不同的能力" aria-label="不可比的理由"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-markok="${u.id}">标为不可比</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-markx>取消</button></div>`
          : canMark ? html`<div class="n-jcase__mark"><button class="n-link" type="button" data-mark="${u.id}">两段情境不同？标为不可比</button></div>` : ''}
    </article>`;
  }
  const citeOf = (evId) => { const e = st.event(evId); const s = e.srcs[0]; return { ...s, quote: s.quote || e.act || e.title }; };

  function versionCard(chain, bs) {
    const per = bs.map((b) => ({ b, units: unitsOf(b.id) }));
    return html`<article class="n-card" id="ver"><h3 class="n-section-title">按标准版本对比</h3>
      <div class="n-jver">
        <span class="is-h">维度</span>${per.map(({ b }) => html`<span class="is-h">${b.name.replace('判断对照', '')} · ${b.std}</span>`)}
        ${chain.dims.map((d) => html`<span class="is-dim">${d.name}</span>${per.map(({ units }) => { const us = units.filter((u) => u.dim === d.id); const t = st.judgeTally(us); return html`<span><b>${t.high}</b> 人前段偏高${t.low ? html`，<b>${t.low}</b> 人偏低` : ''}<span class="nt-muted"> / ${us.length} 人</span></span>`; })}`)}
      </div>
      <p class="nt-caption">第二期的后段来自 10-17 完成的训练营评审（演示用的历史时间线）。每期只有 8 人，偏差减少只作为提示，不能据此下「改进有效」的结论。</p>
    </article>`;
  }

  function ruleCard(chain, map, std) {
    return html`<article class="n-card"><h3 class="n-section-title">对照规则</h3>
      <dl class="nt-dl"><dt>对应表</dt><dd>${map.id} · ${name(map.by)} ${NT.md(map.at)} 确认</dd><dt>前段标准</dt><dd>${std.id}<div class="nt-muted">${std.note}</div></dd></dl>
      <table class="n-maptable" style="width:100%;margin-top:var(--s-3);border-collapse:collapse;font-size:var(--t-xs)">
        <thead><tr><th scope="col" style="text-align:left;color:var(--ink-3);font-weight:500;padding:4px 0">${chain.front}</th><th scope="col" style="text-align:left;color:var(--ink-3);font-weight:500">${chain.back}</th><th scope="col" style="text-align:left;color:var(--ink-3);font-weight:500">等级</th></tr></thead>
        <tbody>${map.rows.map(([k, to, g]) => html`<tr style="border-top:1px solid var(--line)"><td style="padding:6px 8px 6px 0">${chain.dims.find((d) => d.id === k).name}</td><td style="padding-right:8px">${to}</td><td>${g}</td></tr>`)}</tbody>
      </table>
      <p class="nt-caption">${chain.scale === 'score' ? '后段取对照窗口内对应维度已确认分的均值所在档；同一维度至少 2 条来自不同事件的分数才参与对照。' : ''}对应表只用于判断对照；改版后，已有的对照保持当时的结果。</p>
    </article>`;
  }

  // 评价人：按姓名排列，不排行、不给准确率；可对照案例不到门槛只说「样本不足」
  function raterCard(units, bid) {
    const raters = [...new Set(units.map((u) => u.front.by))].sort((a, b) => name(a).localeCompare(name(b), 'zh'));
    return html`<article class="n-card"><h3 class="n-section-title">按评价人<small class="nt-muted" style="font-weight:400;margin-left:auto">按姓名排列</small></h3>
      <div>${raters.map((r) => { const x = st.raterStats(units, r); const t = x.tally; return html`<a class="n-rater" href="${NT.link('judge.html', { rater: r, ...(bid ? { from: bid } : {}) })}">${UI.avatar(r, 'sm')}<b>${name(r)}</b>${x.enough ? html`<span class="nt-muted">${x.cases.length} 个案例</span>` : html`<span class="n-rater__few">样本不足</span>`}
        <small>${x.enough ? [t.high && `前段偏高 ${t.high}`, t.low && `前段偏低 ${t.low}`, t.same && `一致 ${t.same}`].filter(Boolean).join(' · ') : `只有 ${x.cases.length} 个可对照案例（门槛 ${st.RATER_MIN} 个），只列案例`}</small></a>`; })}</div>
      <p class="nt-caption">仅 HR 和评价人本人可见，评价人只看自己的部分。</p></article>`;
  }

  function actionsCard(b) {
    const S = st.get();
    const ids = st.judgeHyps(b.id).flatMap((h) => st.judgeAttrib(h.id)?.actions || []);
    const acts = ids.map((x) => S.actions.find((a) => a.id === x)).filter(Boolean);
    const LABEL = { todo: '待沟通', doing: '进行中', done: '已执行待观察', reviewed: '已复盘', cancel: '未执行' };
    return html`<article class="n-card" id="acts"><h3 class="n-section-title">改进动作</h3>
      ${acts.length ? html`<ul class="nt-list">${acts.map((a) => html`<li><a class="nt-plink" href="actions.html#${a.id}"><b style="font-weight:600">${a.title}</b></a><div class="nt-muted">${a.kind} · 负责人 ${name(a.owner)} · ${LABEL[a.state]}${a.did ? ` · ${NT.md(a.did)} 执行` : ` · 预计 ${NT.md(a.due)}`}</div></li>`)}</ul>`
        : html`<div class="nt-empty">归因确认后，改进动作会出现在这里。</div>`}
      <p class="nt-caption">改进动作挂在「项目复盘」对应的节点下跟进；修订评价标准会产生新版本，新记录按新版本，旧记录保留原版本。</p></article>`;
  }

  // ---------- 归因：AI 提出带证据的假设（光），HR 选类别、写理由、确认后落墨 ----------
  const ACT = {
    std: '修订评价标准', method: '修订评价标准', rater: '评价人培训', later: '后段评价校准',
  };
  const EXTRA = { method: '补充评价方式', rater: '调整评价人组合' };
  function actTitle(kind, chain, dim) {
    const xe = chain.id === 'xe';
    return {
      修订评价标准: xe ? `修订周评标准：${dim}每一档都写明行为证据` : `修订社招面试评价表：${dim}必须写出具体行为（hire-v2）`,
      补充评价方式: xe ? `周评之外增加一次现场观察，补充${dim}的依据` : `社招面试增加行为追问环节：${dim}`,
      评价人培训: xe ? `${chain.front}评价人培训：${dim}怎么写出具体行为` : `${chain.front}面试官培训：${dim}怎么追问具体行为`,
      调整评价人组合: xe ? `调整${chain.front}评价人组合：同一学员至少两位评价人分别给${dim}` : `调整${chain.front}面试官组合：同一人至少两位面试官分别给${dim}`,
      后段评价校准: `请后段记录人补充${dim}的证据，必要时进入校准`,
    }[kind];
  }
  const suggestionsFor = (cats) => [...new Set(cats.flatMap((c) => [ACT[c], EXTRA[c]]).filter(Boolean))];
  const hypDim = (h, units) => { const u = st.judgeUnits(h.cases[0].split(':')[0]).find((x) => x.id === h.cases[0]); return u ? u.dimName : ''; };
  let drafting = null; // 正在确认的假设

  function attribBody(b, chain, units) {
    const hyps = st.judgeHyps(b.id);
    if (role !== 'hrbp') {
      const done = hyps.filter((h) => st.judgeAttrib(h.id));
      const wait = hyps.length - done.length;
      return html`${done.length ? done.map((h) => conclusion(h, chain, true)) : html`<div class="nt-empty">还没有确认的归因。</div>`}
        ${wait ? html`<p class="nt-caption">另有 ${wait} 条 AI 假设待 HR 确认。</p>` : ''}`;
    }
    return html`<div class="nt-grid">${hyps.map((h) => (st.judgeAttrib(h.id) ? conclusion(h, chain, false) : hypBlock(h, chain)))}</div>
      <p class="nt-caption">AI 提出带证据的假设，HR 选类别、写理由并确认归因。结论用于修订评价体系。</p>`;
  }
  // 依据变化的说明：评价人只在 HR 视角下点名
  const checkText = (h, chk, forCeo) => [chk.dropped.length && `${chk.dropped.length} 个依据案例已标为不可比或资料不足`, chk.few && (forCeo ? '涉及的评价人可对照案例不到门槛，样本不足' : `${name(h.rater)}的可对照案例不到 ${st.RATER_MIN} 个，样本不足`), chk.changed && !chk.dropped.length && '依据范围内的事件或分数有变化，正文里的统计可能已经过时'].filter(Boolean).join('；');
  function caseChips(h, chk) {
    return html`<div class="n-attrib__cases">${h.cases.map((cid) => { const [bid, pid, dim] = cid.split(':'); const u = st.judgeUnits(bid).find((x) => x.id === cid); const out = chk?.dropped.includes(cid); return html`<button class="n-casechip ${out ? 'is-out' : ''}" type="button" data-case="${cid}" ${NT.raw(out ? 'title="已标为不可比或资料不足，不再作为依据"' : '')}>${name(pid)} · ${u?.dimName || dim}${bid !== id ? ` · ${st.judgeBatch(bid).name.replace(/判断对照|XEngineer /g, '')}` : ''}${out ? '（已排除）' : ''}</button>`; })}${h.std ? html`<span class="n-casechip" style="cursor:default">标准 ${h.std}</span>` : ''}</div>`;
  }
  function hypBlock(h, chain) {
    const chk = st.hypCheck(h);
    const isDraft = chk.ok && drafting?.id === h.id;
    return html`<div class="n-attrib" data-hyp="${h.id}">
      <div class="n-block" data-state="light"><span class="nt-hyp-text">${isDraft ? drafting.text : h.text}</span>${caseChips(h, chk)}
        <div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}AI 假设</span>建议归为${h.cats.map((c) => `「${CAT[c]}」`).join('')} · 依据 ${h.cases.length} 个案例</div></div>
      ${isDraft ? html`<div class="n-card" style="box-shadow:var(--e-0)">
          <div class="n-field__label" id="cats-${h.id}">归为哪一类（可多选）</div>
          <div class="n-attrib__cats" role="group" aria-labelledby="cats-${h.id}">${Object.entries(CAT).map(([k, l]) => html`<button class="n-chip" type="button" data-cat="${k}" aria-pressed="${drafting.cats.includes(k)}" title="${CAT_Q[k]}">${l}</button>`)}</div>
          <ul class="n-attrib__qs">${Object.entries(CAT).map(([k, l]) => html`<li><b>${l}</b>${CAT_Q[k]}</li>`)}</ul>
          <label class="n-field" style="margin-top:var(--s-3)"><span class="n-field__label">理由（必填，会署名留档）</span><textarea class="n-textarea" id="why-${h.id}" rows="2" placeholder="比如：两期都偏高，记录多是印象描述；先培训，再看下一期">${drafting.reason}</textarea></label>
          <div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-confirm="${h.id}">${icon('check')}确认归因</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel>取消</button><span class="nt-muted">确认后署名留档，之后从这条结论生成改进动作${h.rater || drafting.cats.includes('rater') ? '；涉及评价人，管理者只看到类别和动作' : '；结论和理由管理者可见'}</span></div></div>`
        : !chk.ok ? html`<div class="n-notice">${icon('split')}<div><b>依据有变化，这条假设要重新核对后再确认。</b>${checkText(h, chk, false)}。${chk.dropped.length ? '撤销相关标注后可以继续；否则等 AI 按现在的案例重新整理。' : '等 AI 按现在的数据重新整理后再确认。'}</div></div>`
        : html`<div class="nt-row"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-adopt="${h.id}">${icon('check')}采纳并归因</button><button class="n-btn n-btn--sm" type="button" data-rewrite="${h.id}">${icon('pen')}改写</button><span class="nt-muted">未确认的假设不能生成改进动作</span></div>`}
    </div>`;
  }
  function conclusion(h, chain, forCeo) {
    const a = st.judgeAttrib(h.id), S = st.get();
    const acts = a.actions.map((x) => S.actions.find((y) => y.id === x)).filter(Boolean);
    // 涉及具体评价人的假设，管理者一律只看类别和动作，不随 HR 改动类别而解除
    const hideRater = forCeo && (!!h.rater || a.cats.includes('rater'));
    const chk = st.hypCheck(h);
    const made = acts.map((x) => x.kind);
    const sug = forCeo || !chk.ok ? [] : suggestionsFor(a.cats).filter((k) => !made.includes(k));
    const dim = hypDim(h);
    return html`<div class="n-attrib" data-hyp="${h.id}">
      <div class="n-block" data-state="ink" style="padding-left:0;padding-right:0">
        <div class="n-attrib__done">${a.cats.map((c) => html`<span class="n-badge" style="background:var(--ink);color:#fff">${CAT[c]}</span>`)}<span class="nt-muted">${dim}</span></div>
        ${hideRater ? html`<p style="margin:var(--s-2) 0 0" class="nt-muted">这条归因的依据涉及评价人，此处显示归因类别和改进动作。</p>` : html`<p style="margin:var(--s-2) 0 0">${a.text || h.text}</p><p class="n-jcase__why" style="margin:var(--s-1) 0 0">${a.reason}</p>`}
        <div class="n-block__by"><span class="n-block__sig">${name(a.by)}</span>${NT.md(a.at)} 确认归因${a.text && a.text !== h.text ? ' · 改写过 AI 假设' : ''}</div>
      </div>
      ${acts.length ? html`<div class="nt-row">${acts.map((x) => html`<a class="n-badge" href="actions.html#${x.id}">${icon('check2')}${x.title}</a>`)}${acts.some((x) => x.kind === '修订评价标准') && frontLink(chain) ? html`<a class="n-link" href="${frontLink(chain)}">在评价体系里看这条标准</a>` : ''}</div>` : ''}
      ${!chk.ok ? html`<p class="nt-caption" style="margin:0">确认后依据有变化：${checkText(h, chk, forCeo)}。这条结论需要复核，暂不能生成新的改进动作。</p>` : ''}
      ${chk.ok && a.cats.includes('env') && !sug.length && !acts.length ? html`<p class="nt-caption" style="margin:0">本人或环境变化：记录情境，评价标准保持原样；需要时转为跟踪或沟通。</p>` : ''}
      ${sug.length ? html`<div class="nt-row">${sug.map((k) => (k === '修订评价标准' // v1.6 3.35.7：归因到评价标准的，直接打开评价体系里对应规则的草稿
          ? html`<button class="n-btn n-btn--sm" type="button" data-act="${h.id}" data-kind="${k}">${icon('pen')}起草修订</button>`
          : html`<button class="n-btn n-btn--sm" type="button" data-act="${h.id}" data-kind="${k}">${icon('plus')}生成「${k}」动作</button>`))}</div>` : ''}
    </div>`;
  }

  // 不可比标注：批次页和按评价人页共用
  function markClick(e, main) {
    const mk = e.target.closest('[data-mark]'); if (mk) { marking = mk.dataset.mark; render(main); $('#nc-why')?.focus(); return true; }
    if (e.target.closest('[data-markx]')) { marking = null; render(main); return true; }
    const ok = e.target.closest('[data-markok]');
    if (ok) {
      const why = $('#nc-why').value.trim();
      if (!why) { $('#nc-why').focus(); NT.toast('标为不可比要写一句理由'); return true; }
      st.markJudge(ok.dataset.markok, why); marking = null; focus = ok.dataset.markok; render(main);
      NT.toast('已标为不可比，不计入偏差人数', { undo: () => { st.unmarkJudge(ok.dataset.markok); render(main); } });
      return true;
    }
    const um = e.target.closest('[data-unmark]'); if (um) { st.unmarkJudge(um.dataset.unmark); render(main); return true; }
    return false;
  }

  function wireBatch(main, b, chain, units) {
    main.onclick = (e) => {
      const row = !sumOnly && e.target.closest('[data-dim]');
      if (row) { openDim = openDim === row.dataset.dim ? null : row.dataset.dim; render(main); $(`[data-dim="${row.dataset.dim}"]`)?.focus(); return; }
      const chip = !sumOnly && e.target.closest('[data-case]');
      if (chip) {
        const [bid, , dim] = chip.dataset.case.split(':');
        if (bid !== id) { location.href = NT.link('judge.html', { id: bid, dim }); return; }
        openDim = dim; focus = chip.dataset.case; render(main); return;
      }
      if (markClick(e, main)) return;
      const ad = e.target.closest('[data-adopt]');
      if (ad) { const h = st.judgeHyps(id).find((x) => x.id === ad.dataset.adopt); if (!st.hypCheck(h).ok) { render(main); return; } drafting = { id: h.id, text: h.text, cats: h.cats.slice(), reason: '' }; render(main); $(`#why-${h.id}`)?.focus(); return; }
      const rw = e.target.closest('[data-rewrite]');
      if (rw) {
        const box = rw.closest('[data-hyp]'), t = $('.nt-hyp-text', box);
        t.contentEditable = 'plaintext-only'; t.classList.add('n-edit'); t.focus();
        rw.outerHTML = `<button class="n-btn n-btn--sm" type="button" data-adopt-edit="${rw.dataset.rewrite}"><svg><use href="#i-check"/></svg>改好了，归因</button>`;
        return;
      }
      const ae = e.target.closest('[data-adopt-edit]');
      if (ae) { const h = st.judgeHyps(id).find((x) => x.id === ae.dataset.adoptEdit); const t = $('.nt-hyp-text', ae.closest('[data-hyp]')).textContent.trim(); drafting = { id: h.id, text: t || h.text, cats: h.cats.slice(), reason: '' }; render(main); $(`#why-${h.id}`)?.focus(); return; }
      const cat = e.target.closest('[data-cat]');
      if (cat && drafting) { drafting.reason = $(`#why-${drafting.id}`).value; const k = cat.dataset.cat; drafting.cats = drafting.cats.includes(k) ? drafting.cats.filter((x) => x !== k) : [...drafting.cats, k]; render(main); return; }
      if (e.target.closest('[data-cancel]')) { drafting = null; render(main); return; }
      const cf = e.target.closest('[data-confirm]');
      if (cf) {
        const h = st.judgeHyps(id).find((x) => x.id === cf.dataset.confirm);
        const reason = $(`#why-${h.id}`).value.trim();
        if (!drafting.cats.length) { NT.toast('至少选一个归因类别'); return; }
        if (!reason) { $(`#why-${h.id}`).focus(); NT.toast('写一句理由再确认'); return; }
        if (!st.confirmAttrib(id, h, { cats: drafting.cats, reason, text: drafting.text })) { drafting = null; render(main); NT.toast('依据已经变化，这条假设不能按原文确认'); return; }
        drafting = null; render(main);
        $(`[data-hyp="${h.id}"] .n-block`)?.classList.add('is-settling');
        NT.toast('归因已确认并署名。结论只作用于评价体系，不改变被评价人的档案');
        return;
      }
      const ac = e.target.closest('[data-act]');
      if (ac) {
        const h = st.judgeHyps(id).find((x) => x.id === ac.dataset.act), kind = ac.dataset.kind, dim = hypDim(h);
        const t = st.judgeTally(units.filter((u) => u.dimName === dim));
        const a = st.addJudgeAction(id, h.id, { title: actTitle(kind, chain, dim), kind,
          then: [`目标：下一批判断对照里「${dim}」前段偏差的人数减少`, `依据：${b.name}，${dim} ${t.high + t.low} 人有偏差（${CAT[st.judgeAttrib(h.id).cats[0]]}）`, '观察：下一批判断对照按标准版本分组对比，样本够了再看改进效果'] });
        render(main);
        if (!a) { NT.toast('依据已经变化，这条结论要先复核，暂不能生成动作'); return; }
        if (kind === '修订评价标准' && frontLink(chain)) { location.href = frontLink(chain); return; }
        NT.toast(`已生成「${a.title}」，在「项目复盘」对应的节点下跟进`);
      }
    };
  }

  // ---------- 按评价人：HR 看任何一位；评价人本人只看自己 ----------
  function renderRater(main) {
    const self = raterId === me.id && role !== 'hrbp';
    const all = st.judgeBatches().flatMap((b) => st.judgeUnits(b.id)).filter((u) => u.front.by === raterId && (self || st.judgeScope(u)));
    const cases = all.filter(st.judgeComparable);
    const enough = cases.length >= st.RATER_MIN;
    const t = st.judgeTally(cases);
    const batches = [...new Set(all.map((u) => u.batch))].map((x) => st.judgeBatch(x));
    const vals = all.map((u) => u.front.v).filter((v) => v != null);
    if (!all.length) {
      return mount(main, html`
        <header class="nt-head"><div><h1>${self ? '我的判断对照' : `${name(raterId)}的判断`}</h1></div></header>
        ${UI.state({ ip: 'rest', title: self ? '你作为评价人给出的判断会出现在这里' : '这位评价人的判断会出现在这里', text: '每条判断和后一阶段对同一个人同一维度的结论放在一起，供修订评价体系参考。' })}`);
    }
    mount(main, html`
      <header class="nt-head"><div><h1>${self ? '我的判断对照' : `${name(raterId)}的判断`}</h1>
        <p>${self ? '这里是你做过的判断，和后一阶段对同一个人同一维度的等级与差异状态。' : '按评价人看偏差，按姓名排列。案例少于门槛时只列案例。'}</p></div></header>
      <div class="nt-split">
        <div class="nt-grid">
          <article class="n-card"><h3 class="n-section-title">${enough ? `${cases.length} 个可对照案例` : '样本不足'}</h3>
            ${enough ? html`<p style="margin:0">${[t.high && `前段偏高 ${t.high} 个`, t.low && `前段偏低 ${t.low} 个`, t.same && `一致 ${t.same} 个`].filter(Boolean).join('，')}。${byDimLine(cases)}</p>`
              : html`<p style="margin:0">样本不足：可对照案例 ${cases.length} 个，门槛 ${st.RATER_MIN} 个。下面列出案例。</p>`}
            <p class="nt-caption">${gradeLine(self ? '你' : name(raterId), vals, batches)}${all.length - cases.length ? ` 另有 ${all.length - cases.length} 个判断是不可比或资料不足。` : ''}</p>
          </article>
          ${batches.map((b) => { const chain = st.judgeChain(b.chain), map = st.judgeMap(b.map); const us = sortCases(all.filter((u) => u.batch === b.id)); return html`<section><h2 class="nt-h2">${b.name}<small>${b.std} · ${b.range}</small></h2>${us.map((u) => caseCard(u, chain, map, { raterOnly: self }))}</section>`; })}
        </div>
        <aside class="nt-grid">
          ${self ? html`<div class="n-lock">${icon('lock')}这里只显示你本人做过的判断和对应的后段等级。</div>` : html`<a class="n-btn n-btn--ghost" href="${NT.param('from') ? `judge.html?id=${NT.param('from')}` : 'judge.html'}">${icon('back')}回到判断对照</a>`}
          <div class="n-lock">${icon('info')}这些对照只用来修正评价体系：结论不改变被评价人的分数、象限和档案，也不进入评价人本人的档案。</div>
        </aside>
      </div>`);
    main.onclick = (e) => { markClick(e, main); };
  }
  // 等级从高到低：S / A / B，或 5 到 1 分
  const RANK = ['S', 'A', 'B', 5, 4, 3, 2, 1];
  // 前段是等级（S / A / B 或 1–5 分）时列出分布；前段是文字判断时如实说明条数
  function gradeLine(who, vals, batches) {
    const line = countLine(vals);
    if (line) return `${who}给出的等级：${line}。`;
    const labels = [...new Set(batches.flatMap((b) => st.judgeChain(b.chain).grades || []))];
    const dist = labels.map((g) => [g, vals.filter((v) => v === g).length]).filter(([, n]) => n).map(([g, n]) => `${g} ${n}`).join(' · ');
    return `${who}的前段是文字判断，共 ${vals.length} 条${dist ? `（${dist}）` : ''}。`;
  }
  const countLine = (vals) => RANK.map((k) => [k, vals.filter((v) => v === k).length]).filter(([, n]) => n).map(([k, n]) => `${k}${typeof k === 'number' ? ' 分' : ''} ${n}`).join(' · ');
  const byDimLine = (cases) => {
    const dims = [...new Set(cases.map((u) => u.dimName))];
    return dims.map((d) => { const us = cases.filter((u) => u.dimName === d); const h = us.filter((u) => u.state === 'high').length; return `${d} ${us.length} 个${h ? `里 ${h} 个前段偏高` : ''}`; }).join('；');
  };
})();
