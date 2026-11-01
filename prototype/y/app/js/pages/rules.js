/* 人才评价规则（v1.6 3.35）：六类规则的总览、详情、版本历史与对比。
   值得关注、维度与锚点、入营选拔标准可以修订：HR 起草 → 写理由与依据 → 预览影响 → 提交，管理者看对比与预览后确认发布（朱印）或退回。
   入营选拔标准只能从判断对照里 HR 已确认、归因含「评价标准」的结论起草；确认发布即成为之后新建期次的默认版本，已建立的期次保持建立时绑定的版本。
   象限落位、对应表、目标角色与发展通道在原型里只读；标签库沿用标签库页面。
   这一页可以出现规则版本号与规则编号（界面文案规范的例外）。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  const role = st.role();
  const kind = NT.param('r'), line = NT.param('line');
  // 前段评价标准按 line 区分；其他规则类别不带 line
  const L = kind === 'front' ? line || undefined : undefined;
  const FRONT_EDITABLE = ['xe-select'];
  const KINDS = Object.fromEntries(st.RULE_KINDS.map(([k, n, w]) => [k, { n, w }]));
  const EDITABLE = ['watch', 'rubric'];
  const name = (pid) => st.person(pid)?.name || '';
  const MGR = st.roles.ceo.person, HR = st.roles.hrbp.person;
  const STATE = { draft: '草稿', pending: '待确认', scheduled: '已排期', live: '生效中', old: '已替代' };
  const rstate = (r, more = '') => html`<span class="n-rstate" data-s="${r.state}">${STATE[r.state]}${more ? ` ${more}` : ''}</span>`;
  const lineName = (l) => st.FRONT_LINES.find((x) => x[0] === l)?.[1] || '';
  let cmp = null; // 版本对比：[旧, 新]

  NT.shell({
    nav: 'rules',
    title: kind ? KINDS[kind]?.n || '人才评价规则' : '人才评价规则',
    crumbs: kind ? [['人才评价规则', 'rules.html']] : [],
    // 评分人本人有待复核的分时，可以进维度与锚点页按新版本复核（v1.6 3.35.5）
    allow: (r) => ['ceo', 'hrbp'].includes(r) || (kind === 'rubric' && st.myHeldScores(r).length > 0),
    denyTitle: '人才评价规则由 HR 和管理者维护',
    denyText: '修订由 HR 起草、管理者确认发布。对锚点有想法，可以在记录页的锚点面板提修订建议。',
    view: () => (kind ? `人才评价规则 · ${KINDS[kind]?.n || '链接失效'}${line && lineName(line) ? ` · ${lineName(line)}` : ''}` : '人才评价规则 · 总览'),
    render,
  });

  function render(main) {
    if (!kind) return renderOverview(main);
    if (!KINDS[kind]) return mount(main, UI.state({ ip: 'confirm', title: '链接失效', text: '这条评价规则不存在，或链接有误。回到人才评价规则重新进入。', actions: html`<a class="n-btn n-btn--sm" href="rules.html">回到人才评价规则</a>` }));
    if (kind === 'tags') return mount(main, UI.state({ ip: 'rest', title: '标签库在单独的页面维护', text: '收录、并入和停用标签都在标签库里完成。', actions: html`<a class="n-btn n-btn--sm" href="tags.html">打开标签库</a>` }));
    if (kind === 'front') return renderFront(main);
    if (kind === 'tpl') return renderTpl(main);
    return renderRule(main);
  }

  // ---------- 总览：规则卡 ----------
  function renderOverview(main) {
    const lock = st.inventoryLock();
    mount(main, html`
      ${UI.evalHead('rules', '人才判断用到的规则都在这里：每条规则按版本保存，修订要写理由、看影响、经管理者确认才生效，已经做出的判断保留原来的版本。')}
      <div class="n-rcards">
        <p class="n-rcards__grp">会改变评价结果 · 修订由 HR 起草、管理者确认</p>
        ${card('rubric', { signal: rubricSignal() })}
        ${card('place', { ro: true, signal: lock ? [icon('lock'), `${lock.name}进行中，所用版本已锁定；新版本从下一个盘点批次开始`] : null })}
        ${card('watch', { signal: watchSignal() })}
        ${frontCard()}
        <p class="n-rcards__grp">找人与整理 · 发布即生效</p>
        ${tplCard()}
        <a class="n-rcard" href="tags.html">
          <div class="n-rcard__head"><span class="n-rcard__name">标签库</span></div>
          <p class="n-rcard__what">${KINDS.tags.w}。</p>
          <div class="n-rcard__ver"><span>在标签库页面维护</span></div>
        </a>
      </div>`);
  }
  function card(k, o = {}) {
    const live = st.ruleLive(k), open = st.ruleOpen(k);
    return html`<a class="n-rcard" href="rules.html?r=${k}">
      <div class="n-rcard__head"><span class="n-rcard__name">${KINDS[k].n}</span>${o.ro ? html`<span class="n-rcard__ro">${icon('lock')}只读</span>` : ''}</div>
      <p class="n-rcard__what">${KINDS[k].w}。</p>
      <div class="n-rcard__ver"><b>${live.v}</b>${live.from ? html`<span>由 ${live.from} 拆出</span>` : ''}<span>${NT.md(live.effAt)} 起生效</span>${live.demo ? UI.demo() : ''}</div>
      ${open ? html`<div class="nt-row">${rstate(open, open.v)}<span class="nt-muted">${openNote(open)}</span></div>` : ''}
      ${o.signal ? html`<div class="n-rcard__signal">${o.signal[0]}<span>${o.signal[1]}</span></div>` : ''}
    </a>`;
  }
  const nextText = () => '从下一个盘点批次开始';
  // 入营选拔标准：确认发布即生效，只作用于之后新建的期次
  const boundText = (v) => NT.SEED.PROGRAMS.filter((g) => g.std === v).map((g) => g.name).join('、');
  const frontEffect = (d) => html`<b>确认发布即生效</b>：成为之后新建期次的默认版本；已建立的期次保持建立时绑定的版本${boundText(d.base) ? `（${boundText(d.base)}保持 ${d.base}）` : ''}。${st.NEXT_PERIOD && !st.NEXT_PERIOD.std ? `${st.NEXT_PERIOD.name}还在筹备，建立时绑定当时的默认版本。` : ''}`;
  const openNote = (r) => (r.state === 'draft' ? `${name(r.by)}起草${r.returned ? ' · 管理者退回' : ''}` : r.state === 'pending' ? `${name(r.by)}提交，等${name(MGR)}确认` : `${name(r.confirmedBy)}已确认 · ${nextText(r)}`);
  function rubricSignal() {
    const open = st.ruleSugs({ state: 'open' });
    if (!open.length) return null;
    if (role === 'hrbp') return [icon('note'), `${open.length} 条修订建议待处理：${open.map((s) => `${name(s.by)}对${st.sugLabel(s)}`).join('、')}`];
    return [icon('note'), `${open.length} 条修订建议，HR 处理中`];
  }
  function watchSignal() {
    const gap = st.watchGap(), P = st.ruleLive('watch').params;
    if (!gap.length) return null;
    return [icon('info'), `入职半年内 ${gap.length} 人同一维度已有 ${P.n1Count} 件以上的事印证，第一件早于近 ${P.n1Days} 天，N1 把这${gap.length > 1 ? '些' : ''}人排除在外`];
  }
  // 判断对照依据的归因：已确认的取 HR 选的类别，没有确认的写待确认
  const CATN = { std: '评价标准', rater: '评价人', method: '评价方式与信息不足', env: '本人或环境变化', later: '后段评价偏差' };
  const judgeCat = (b) => { const a = b.hyp && st.judgeAttrib(b.hyp); return a ? a.cats.map((c) => CATN[c]).join('、') : b.hyp ? '' : b.cat; };
  function judgeSignal(r) {
    const b = (r?.basis || []).find((x) => x.type === 'judge');
    if (!b) return null;
    const cat = judgeCat(b);
    return [icon('split'), `${st.judgeBatch(b.batch)?.name.replace('判断对照', '').trim()} ${b.dim}：${b.n}，${cat ? `归因为${cat}` : '归因待确认'}`];
  }
  function frontCard() {
    const lives = st.FRONT_LINES.map(([l]) => st.ruleLive('front', l)).filter(Boolean);
    const open = st.ruleVers('front').find((r) => ['draft', 'pending', 'scheduled'].includes(r.state));
    const sig = judgeSignal(open);
    return html`<a class="n-rcard" href="rules.html?r=front">
      <div class="n-rcard__head"><span class="n-rcard__name">${KINDS.front.n}</span></div>
      <p class="n-rcard__what">${KINDS.front.w}；判断对照以它为准。</p>
      <div class="n-rcard__ver">${lives.map((r) => html`<b>${r.v}</b>`)}</div>
      ${open ? html`<div class="nt-row">${rstate(open, open.v)}<span class="nt-muted">${openNote(open)}</span></div>` : ''}
      ${sig ? html`<div class="n-rcard__signal">${sig[0]}<span>${sig[1]}</span></div>` : ''}
    </a>`;
  }
  function tplCard() {
    const tpls = st.templates(), last = tpls.map((t) => ({ t, v: t.versions[t.versions.length - 1] })).sort((a, b) => b.v.at.localeCompare(a.v.at))[0];
    return html`<a class="n-rcard" href="rules.html?r=tpl">
      <div class="n-rcard__head"><span class="n-rcard__name">${KINDS.tpl.n}</span><span class="n-rcard__ro">${icon('lock')}只读</span></div>
      <p class="n-rcard__what">${KINDS.tpl.w}。</p>
      <div class="n-rcard__ver"><span>${tpls.length} 个模板，每个模板单独记版本</span><span>最近：${UI.tplTitle(last.t)} v${last.v.v} · ${NT.md(last.v.at)}</span></div>
    </a>`;
  }

  // ---------- 值得关注、维度与锚点、象限落位 ----------
  function renderRule(main) {
    if (!['ceo', 'hrbp'].includes(role)) return renderRaterReview(main);
    const live = st.ruleLive(kind), open = st.ruleOpen(kind);
    const editing = role === 'hrbp' && open && EDITABLE.includes(kind);
    const reviewing = role === 'ceo' && open?.state === 'pending';
    const cur = editing || reviewing ? open : live;
    mount(main, html`
      <header class="nt-head"><div><h1>${KINDS[kind].n}</h1><p>${KINDS[kind].w}。</p></div>
        <div class="nt-head__acts">
          <span class="n-rule">${icon('doc')}生效中 ${live.v}</span>
          ${sealFor(st.ruleVers(kind))}
          ${open && !editing && !reviewing ? html`${rstate(open, open.v)}` : ''}
          ${role === 'hrbp' && !open && EDITABLE.includes(kind) ? html`<button class="n-btn n-btn--ink" type="button" id="start">${icon('pen')}起草修订</button>` : ''}
          ${kind === 'place' ? html`<span class="n-rcard__ro">${icon('lock')}只读</span>` : ''}
        </div></header>
      ${kind === 'rubric' ? holdNote() : ''}
      ${editing ? reviseView(open) : reviewing ? reviewView(open) : html`<div class="nt-split"><div class="nt-grid">${contentCard(cur)}${kind === 'rubric' && role === 'hrbp' ? sugSec() : ''}</div><aside class="nt-grid">${sideNote(live, open)}</aside></div>`}
      ${historySec()}
      ${compareSec()}`);
    wire(main);
  }
  // 当天确认发布的版本在页头压一枚朱印（确认后 5 秒内可以撤销）
  const sealFor = (vers) => { const r = vers.filter((x) => x.confirmedAt === NT.TODAY && ['live', 'scheduled'].includes(x.state)).pop(); return r ? html`<span class="n-seal n-seal--sm" id="seal" title="${name(r.confirmedBy)}确认发布 ${r.v}">定</span>` : ''; };
  // 不兼容版本生效后的复核暂停：原分保留，复核前不参与新版本的取数
  let reviewing = false;
  // 复核入口给第一个在你查看范围内还有待复核分的版本
  const holdNote = () => { const mine = st.reviewHolds().find((h) => st.heldScores(h.ver).some((x) => st.scope(x.s.p) === 'full'))?.ver; return st.reviewHolds().map((h) => html`<div class="n-notice" style="margin-bottom:var(--s-4)">${icon('info')}<div><b>${h.ver} ${NT.md(h.at)} 生效，${h.n} 条旧分待按新版本复核。</b>涉及 ${h.people} 人、${h.raters} 位评分人；原分保留并显示 ${h.base}，复核确认前暂停参与取数，证据少于落位门槛的人进「资料不足」区。
      ${role === 'hrbp' && h.ver === mine ? html`<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" id="rv-toggle" aria-expanded="${reviewing}">${reviewing ? '收起复核' : '逐条复核'}</button></div>` : ''}</div></div>
    ${role === 'hrbp' && reviewing && h.ver === mine ? reviewTable(h) : ''}`); };
  // 逐条复核：AI 按新锚点给建议分（预置），HR 确认后按新版本参与取数
  // 评分人本人：只列自己给的、待按新版本复核的分
  function renderRaterReview(main) {
    const mine = st.myHeldScores(), vers = [...new Set(mine.map((x) => x.ver))];
    mount(main, html`<header class="nt-head"><div><h1>按新版本复核你的评分</h1><p>维度与锚点改了等级含义，你在旧版本下给的分要按新版本再看一遍。原分保留；你确认前，这些分暂停计入档案和象限；你请假或离开时由 HR 代为确认。</p></div></header>
      ${vers.length ? vers.map((v) => reviewTable(st.reviewHolds().find((h) => h.ver === v), true)) : UI.state({ ip: 'done', size: 48, title: '都复核完了', text: '新版本下你的评分已经全部确认。' })}`);
    wire(main);
  }
  function reviewTable(h, own) {
    const me = st.me().id, rows = st.heldScores(h.ver).filter((x) => (own ? x.s.by === me : st.scope(x.s.p) === 'full'));
    return html`<article class="n-card" id="review" data-ver="${h.ver}" style="margin-bottom:var(--s-4)"><h3 class="n-section-title">按 ${h.ver} 复核<span class="nt-muted" style="margin-left:auto;font-weight:400">${own ? '你的评分' : '你的查看范围内'} ${rows.length} 条</span></h3>
      <table class="nt-table"><thead><tr><th>人</th><th>维度</th><th>事件</th><th>原分</th><th>按 ${h.ver}</th><th></th></tr></thead><tbody>
      ${rows.map(({ e, i, s }) => html`<tr data-ev="${e.id}" data-i="${i}">
        <td>${name(s.p)} ${UI.demo()}</td><td>${st.dim(s.d).name}</td><td>${e.title}<small>${NT.md(e.date)} · ${name(s.by)}评分</small></td>
        <td>${s.v} 分<small>${st.eventRubric(e).v}</small></td>
        <td><select class="n-select" style="width:auto" aria-label="${name(s.p)}${st.dim(s.d).name}按 ${h.ver} 的分">${[1, 2, 3, 4, 5].map((v) => html`<option value="${v}" ${NT.raw(v === s.v ? 'selected' : '')}>${v} 分</option>`)}</select><small>AI 建议 ${s.v} 分</small></td>
        <td><button class="n-btn n-btn--sm n-btn--ink" type="button" data-rv>确认</button></td></tr>`)}
      </tbody></table>
      <p class="nt-caption">确认后按 ${h.ver} 参与取数；原分和 ${h.base} 的版本标记保留。</p></article>`;
  }
  function sideNote(live, open) {
    const lock = st.inventoryLock();
    return html`
      <div class="n-card"><h3 class="n-section-title">${live.v}</h3>
        <p class="nt-muted" style="margin:0">${name(live.by)}起草${live.confirmedBy ? ` · ${name(live.confirmedBy)}确认` : ''} · ${NT.md(live.effAt)} 起对新的评价生效</p>
        <p style="margin:var(--s-2) 0 0;font-size:var(--t-sm)">${live.why}</p>
        ${open && role === 'ceo' ? html`<p class="nt-muted" style="margin:var(--s-2) 0 0">${open.v} ${STATE[open.state]} · ${openNote(open)}</p>` : ''}
      </div>
      ${lock && st.lockedKinds.includes(kind) ? html`<div class="n-lock">${icon('lock')}<span>${lock.name}进行中，这次盘点按 ${live.v}；新版本从下一个盘点批次开始。</span></div>` : ''}`;
  }

  // 当前内容：按规则类别呈现
  function contentCard(r, o = {}) {
    if (kind === 'watch') return watchContent(r, o);
    if (kind === 'rubric') return rubricContent(r, o);
    if (kind === 'place') return placeContent(r);
    if (kind === 'front') return frontContent(r, o);
    return '';
  }
  // 入营选拔标准：一段标准要点，草稿里原地改
  function frontContent(r, o = {}) {
    const base = st.ruleVer(r.base), ed = o.edit && r.state === 'draft';
    return html`<article class="n-card"><h3 class="n-section-title">标准要点<span class="nt-muted" style="margin-left:auto;font-weight:400">${r.line ? lineName(r.line) : ''}</span></h3>
      ${ed ? html`<label class="n-field"><span class="n-field__label">改哪一段就直接改；预览会按改后的文字计算</span><textarea class="n-textarea" id="front-note" rows="4">${r.note}</textarea></label>
        ${base && r.note !== base.note ? html`<p class="nt-caption">和 ${base.v} 相比：${diffText(base.note, r.note)}</p>` : html`<p class="nt-caption">还和 ${r.base} 一样。</p>`}`
        : html`<p style="margin:0;font-size:var(--t-sm);line-height:1.7">${r.note}</p>`}
    </article>`;
  }
  // 值得关注：可调的参数 + 七条规则
  const PDEF = {
    n1Days: ['N1', '资料从无到有 · 时间窗', '第一条已确认分落在这段时间里的人，同一维度有足够多的事印证', '近', '天', '时间窗在 30–180 天之间。'],
    n1Count: ['N1', '同一维度不同的事', '只算不同的事，同一件事多次评分计一次', '至少', '件', '件数在 2–5 件之间。'],
    n1Min: ['N1', '每件事的维度分', '只算已确认或已校准的分', '', '分及以上', '分数门槛在 3–5 分之间。'],
    i2Days: ['I2', '「值得聊一聊」待处理', '信号打开之后，过了这么久仍待处理', '', '天以上', '天数在 7–60 天之间。'],
  };
  const pval = (k, v) => `${PDEF[k][3]}${PDEF[k][3] ? ' ' : ''}${v} ${PDEF[k][4]}`;
  function watchContent(r, o = {}) {
    const base = st.ruleVer(r.base), rules = st.watchRulesOf(r);
    const ed = o.edit && r.state === 'draft';
    return html`<article class="n-card">
      <h3 class="n-section-title">可调的参数</h3>
      <ul class="n-params" id="params">${Object.keys(PDEF).map((k) => {
        const [code, label, help, pre, unit, err] = PDEF[k];
        const changed = o.edit && base && r.params[k] !== base.params[k];
        const bad = o.edit && !st.paramOk(k, r.params[k]);
        return html`<li class="n-param ${changed ? 'is-changed' : ''} ${bad ? 'is-error' : ''}" data-k="${k}">
          <span class="n-param__name"><span class="n-rule">${code}</span>${label}<small>${help}</small></span>
          <label class="n-param__val"><span class="n-param__pre">${pre}</span>${o.edit
            ? html`<input class="n-input" type="number" inputmode="numeric" value="${r.params[k]}" aria-label="${code} ${label}（${unit}）" ${NT.raw(ed ? '' : 'disabled')}>`
            : html`<b>${r.params[k]}</b>`}<span>${unit}</span></label>
          ${changed ? html`<span class="n-param__was"><span class="n-diff">原值 <del>${pval(k, base.params[k])}</del></span>${ed ? html`<button class="n-link" type="button" data-reset="${k}">还原</button>` : ''}</span>` : ''}
          ${bad ? html`<p class="n-field__err">${err}</p>` : ''}
        </li>`;
      })}</ul>
      <h3 class="n-section-title" style="margin-top:var(--s-5)">七条入选规则</h3>
      <ul class="nt-list">${st.WATCH_CATS.map(([cat, cn]) => Object.entries(rules).filter(([, x]) => x.cat === cat).map(([code, x]) => html`<li class="nt-row" style="align-items:baseline;flex-wrap:nowrap;padding:6px 0"><span class="n-rule">${code}</span><span style="font-size:var(--t-sm)">${cn} · ${x.text}</span></li>`))}</ul>
      <p class="nt-caption">这里只调已有规则的参数，规则保持七条；按分数挑人的条件始终排除在外。T1、I1 与「变化」同口径，在「变化」的规则里改。</p>
    </article>`;
  }
  const changeCount = (r) => { const n = st.ruleChanges(r).length; return n ? `改了 ${n} 处` : '在原处直接改，改过的地方会标出原值'; };

  // 维度与锚点：心性维度一套，专业度按岗位族
  const DIM_POT = () => st.dims.filter((d) => d.axis === 'pot').map((d) => d.name).join('、');
  function rubricContent(r, o = {}) {
    const base = o.edit ? st.ruleVer(r.base) : null, ed = o.edit && r.state === 'draft';
    const famCount = (f) => st.visiblePeople('ceo').filter((p) => (f === 'all' ? !r.content.prof[st.familyOf(p.id)] : st.familyOf(p.id) === f)).length;
    const fams = Object.keys(r.content.prof).filter((f) => f !== 'all');
    const restFams = st.families.filter(([f]) => !r.content.prof[f]).map(([, n]) => `${n}族`).join('、');
    return html`
      <article class="n-card">
        <h3 class="n-section-title">心性维度 · 全公司一套</h3>
        <p class="nt-muted" style="margin:-6px 0 var(--s-3)">${DIM_POT()}共用这一套 1–5 分锚点</p>
        ${anchorList(r, 'pot', base?.content.pot, ed)}
      </article>
      <article class="n-card">
        <h3 class="n-section-title">专业度 · 按岗位族</h3>
        ${fams.map((f) => html`<div style="margin-bottom:var(--s-4)">
          <div class="nt-row" style="margin-bottom:var(--s-2)"><b style="font-size:var(--t-sm)">${st.familyName(f)}族</b><span class="nt-muted">${famCount(f)} 人</span>${r.demoEng && f === 'eng' ? html`<span class="n-badge n-badge--demo">演示 · 待 HR 确认</span>` : ''}${base && !base.content.prof[f] ? html`<span class="n-badge">首次启用</span>` : ''}</div>
          ${anchorList(r, f, base?.content.prof[f], ed)}
          ${r.content.themes?.[f] ? html`<p class="nt-muted" style="margin:var(--s-2) 0 0">观察主题：${r.content.themes[f].join('、')}（挂在专业度下，用于整理和找人）</p>` : ''}
        </div>`)}
        <div>
          <div class="nt-row" style="margin-bottom:var(--s-2)"><b style="font-size:var(--t-sm)">通用锚点</b><span class="nt-muted">${restFams ? `${restFams}沿用 · ` : ''}${famCount('all')} 人</span></div>
          ${anchorList(r, 'all', base?.content.prof.all, ed)}
        </div>
        ${restFams ? html`<p class="nt-caption">${restFams}的锚点和行为示例尚待确认，确认前沿用通用锚点。</p>` : ''}
      </article>`;
  }
  // 一组 1–5 分锚点；草稿里逐条原地改，改过的标出增删
  function anchorList(r, set, was, ed) {
    const list = set === 'pot' ? r.content.pot : r.content.prof[set];
    const editing = !!was || ed;
    return html`<div class="n-anchor ${editing ? 'is-editing' : ''}" style="box-shadow:none;padding:0;background:none"><ol>${list.map((t, i) => {
      const old = was?.[i], changed = was && old !== t;
      return html`<li data-set="${set}" data-i="${i}" class="${changed ? 'is-changed' : ''}"><b>${i + 1}</b><span>${changed ? diffText(old, t) : t}</span>${ed ? html`<span class="n-anchor__acts"><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-edit aria-label="改锚点 ${i + 1}">${icon('pen')}</button>${changed ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-undo aria-label="还原锚点 ${i + 1}">${icon('retry')}</button>` : ''}</span>` : ''}</li>`;
    })}</ol></div>`;
  }
  // 中性差异：只标出改动的那一段
  function diffText(a, b) {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1;
    const del = a.slice(i, a.length - j), ins = b.slice(i, b.length - j);
    return html`<span class="n-diff">${a.slice(0, i)}${del ? html`<del>${del}</del>` : ''}${ins ? html`<ins>${ins}</ins>` : ''}${a.slice(a.length - j)}</span>`;
  }

  // 象限落位：只读
  function placeContent(r) {
    const c = r.content;
    const rows = [
      ['取数窗口', `近 ${c.window} 天的已确认分`],
      ['高低分界', `均值 ${c.cut} 及以上为高`],
      ['落位门槛 · 专业度', `至少 ${c.profMin} 件不同的事有专业度分`],
      ['落位门槛 · 潜力', `核心维度（内生动力、智慧力、坚毅力）合计至少 ${c.potMin} 件事，且至少 ${c.coreMin} 个核心维度有分`],
      ['加分项', `领导力或开放性均值 ${c.bonus} 分及以上，标为加分项，位置保持原象限`],
    ];
    return html`<article class="n-card"><table class="nt-table"><tbody>${rows.map(([k, v]) => html`<tr><th scope="row" style="width:9em">${k}</th><td>${v}</td></tr>`)}</tbody></table>
      <p class="nt-caption">门槛之下的人放在「资料不足」区；资料不足只说明证据还少。</p></article>`;
  }

  // ---------- HR：原地修订 + 检查栏 ----------
  function reviseView(d) {
    const ch = st.draftChecks(d), ed = d.state === 'draft', lock = st.inventoryLock() && st.lockedKinds.includes(kind);
    const forced = st.forcedBreak(d);
    return html`<div class="n-revise">
      <div class="nt-grid">
        <div class="n-version"><span class="n-version__tag is-draft">${STATE[d.state]} ${d.v}</span><span class="nt-muted">在 ${d.base} 上修订 · ${name(d.by)}起草 · ${NT.md(d.at)} · ${changeCount(d)}</span></div>
        ${d.returned ? html`<div class="n-notice">${icon('info')}<div><b>${name(d.returned.by)} ${NT.md(d.returned.at)} 退回：</b>「${d.returned.why}」改好后重新预览再提交。</div></div>` : ''}
        ${contentCard(d, { edit: true })}
        ${kind === 'rubric' ? sugSec() : ''}
        ${d.preview ? html`<article class="n-card" id="impact"><h3 class="n-section-title">影响预览<span class="nt-muted" style="margin-left:auto;font-weight:400">${d.v} 草稿 · 对比 ${d.base} · ${NT.md(d.preview.at)} 计算</span></h3>${impactFull(d.preview, 'hrbp')}</article>` : ''}
      </div>
      <aside class="n-revise__check" aria-label="发布前检查">
        <div class="n-checkbar">
          <div class="n-checkbar__sec">
            <label class="n-checkbar__label" for="why">修订理由<span class="is-ok">${ch.why ? html`${icon('check')}已写` : '必填'}</span></label>
            <textarea class="n-textarea" id="why" rows="3" placeholder="${kind === 'watch' ? '比如：季度项目的第二件事常落在 90 天外，N1 漏掉了入职半年内的人' : kind === 'front' ? '比如：优先录取一档只看作品成品，组队和个人分不开' : '比如：工程族的专业度按职级预期打分，口径太宽'}" ${NT.raw(ed ? '' : 'disabled')}>${d.why}</textarea>
          </div>
          <div class="n-checkbar__sec">
            <span class="n-checkbar__label">依据</span>
            ${(d.basis || []).length ? html`<div class="nt-row">${d.basis.map((b, i) => basisChip(b, i, ed))}</div>` : html`<p class="n-checkbar__text">可以关联判断对照、校准理由、修订建议或你的核对结果。</p>`}
            ${ed ? html`<span class="n-menuwrap" style="justify-self:start"><button class="n-btn n-btn--sm n-btn--ghost" type="button" id="basis-add">${icon('plus')}关联依据</button></span>` : ''}
          </div>
          <div class="n-checkbar__sec">
            <span class="n-checkbar__label" id="compat-l">兼容声明</span>
            ${kind === 'front' ? html`<p class="n-checkbar__text">选拔标准只影响之后新建的期次怎么评；已有的选拔记录和判断对照保持 ${d.base}。</p>` : kind === 'watch' ? html`<p class="n-checkbar__text">阈值类修订：生效后按新阈值计算，生效前冻结的快照保持原样。</p>` : html`
              <div class="n-seg" role="group" aria-labelledby="compat-l" id="compat"><button type="button" data-v="ok" aria-pressed="${d.compat === 'ok' && !forced}" ${NT.raw(forced || !ed ? 'disabled' : '')}>兼容：措辞澄清、补示例</button><button type="button" data-v="break" aria-pressed="${d.compat === 'break' || forced}" ${NT.raw(!ed ? 'disabled' : '')}>不兼容：等级含义变了</button></div>
              ${forced ? html`<div class="n-lock">${icon('lock')}<span>岗位族锚点首次启用，按不兼容处理：取数窗口内这一族的专业度分都要按新锚点复核。</span></div>` : ''}`}
          </div>
          <div class="n-checkbar__sec">
            <span class="n-checkbar__label" id="eff-l">生效点</span>
            ${kind === 'front' ? html`<p class="n-checkbar__text">${frontEffect(d)}</p>` : html`<div class="n-seg" role="group" aria-labelledby="eff-l" id="eff"><button type="button" data-v="now" aria-pressed="${d.effect === 'now'}" ${NT.raw(lock || !ed ? 'disabled' : '')}>立即对新的评价生效</button><button type="button" data-v="next" aria-pressed="${d.effect === 'next'}" ${NT.raw(!ed ? 'disabled' : '')}>从下一个盘点批次开始</button></div>`}
            ${kind === 'front' ? '' : lock ? html`<div class="n-lock">${icon('lock')}<span>${st.inventoryLock().name}进行中，这次盘点用到${KINDS[kind].n}；新版本从下一个盘点批次开始，之前 ${d.base} 继续生效。</span></div>` : kind === 'watch' ? html`<p class="n-checkbar__text">值得关注和盘点取数分开，盘点进行中也可以立即生效。</p>` : ''}
          </div>
          <div class="n-checkbar__sec">
            <span class="n-checkbar__label">影响预览${ch.preview ? html`<span class="is-ok">${icon('check')}已按当前草稿计算</span>` : ''}</span>
            ${d.preview ? html`<p class="n-checkbar__text">${impactLine(d.preview)}</p><a class="n-link" href="#impact" style="justify-self:start">看完整预览</a>` : html`<p class="n-checkbar__text">${ch.changed ? '草稿改过之后，按当前草稿预览一次再提交。' : '先在左边改，再预览影响。'}</p>`}
            ${ed && !ch.preview ? html`<button class="n-btn n-btn--sm" type="button" id="preview" style="justify-self:start" ${NT.raw(ch.changed && ch.range ? '' : 'disabled')}>${icon('retry')}${d.preview ? '重新预览' : '预览影响'}</button>` : ''}
          </div>
          ${ed ? html`<div class="n-checkbar__foot">
              <button class="n-btn n-btn--ink" type="button" id="submit">提交管理者确认</button>
              <p class="n-field__err" id="sub-err" role="alert" hidden></p>
              <p class="n-checkbar__text">提交给${name(MGR)}确认发布；确认前你可以撤回到草稿。</p>
              <button class="n-link" type="button" id="drop" style="justify-self:start">删除草稿</button>
            </div>` : html`<div class="n-checkbar__foot">
              <div class="nt-row">${rstate(d)}<span class="nt-muted">${d.state === 'pending' ? `已提交给${name(MGR)} · ${NT.md(d.submittedAt)}` : `${name(d.confirmedBy)} ${NT.md(d.confirmedAt)} 确认 · ${nextText(d)}`}</span></div>
              <button class="n-btn n-btn--sm n-btn--ghost" type="button" id="withdraw" style="justify-self:start">撤回到草稿</button>
              ${d.state === 'scheduled' ? html`<p class="n-checkbar__text">撤回后 ${d.base} 继续生效，改完要重新提交确认。</p>` : ''}
            </div>`}
        </div>
      </aside>
    </div>`;
  }
  // 依据：按查看人的权限呈现。管理者看判断对照的批次、维度、偏差人数和归因类别，修订建议与核对只看来源和条数
  const ROLE_OF = (pid) => Object.keys(st.roles).find((r) => st.roles[r].person === pid) || (st.person(pid)?.isLead ? 'lead' : 'mentor');
  const SRC = { lead: '部门负责人', mentor: '导师 / 助教' };
  function basisText(b) {
    if (b.type === 'judge') { const cat = judgeCat(b); return `${st.judgeBatch(b.batch)?.name} · ${b.dim}：${b.n} · ${cat ? `归因：${cat}` : '归因待确认'}`; }
    if (b.type === 'sug') { const s = st.ruleSugs().find((x) => x.id === b.sug); if (!s) return '修订建议'; return role === 'hrbp' ? `${name(s.by)}的修订建议 · ${st.sugLabel(s)}` : `修订建议 · 来自${SRC[ROLE_OF(s.by)]} 1 条`; }
    if (b.type === 'gap') return role === 'hrbp' ? `HR 核对 · ${b.people.map(name).join('、')}的第一件事早于时间窗` : `HR 核对 · ${b.people.length} 人`;
    return b.text;
  }
  const BASIS_ICON = { judge: 'split', sug: 'note', gap: 'users', note: 'doc' };
  const basisChip = (b, i, ed) => (ed
    ? html`<button class="n-casechip" type="button" data-rm="${i}" aria-label="移除依据：${basisText(b)}">${icon(BASIS_ICON[b.type] || 'doc')}${basisText(b)}${icon('x')}</button>`
    : html`<span class="n-casechip">${icon(BASIS_ICON[b.type] || 'doc')}${basisText(b)}</span>`);

  // 纳入草稿：当前版本已提交或已排期时不能再挂依据，写明原因，不弹成功提示
  function adoptSug(id) {
    if (st.handleRuleSug(id, true)) return true;
    const o = st.ruleOpen('rubric');
    NT.toast(o && o.state !== 'draft' ? `${o.v} 处于${STATE[o.state]}，撤回到草稿后再纳入这条建议` : '暂时无法纳入这条建议，刷新页面后重试');
    return false;
  }
  // 修订建议：HR 纳入草稿或不采纳（写理由）；提建议的人能看到处理结果
  function sugSec() {
    const list = st.ruleSugs().filter((s) => s.rule === kind);
    if (!list.length) return '';
    const STATE_S = { open: '待处理', adopted: '已纳入草稿', rejected: '不采纳' };
    // 修订已提交或已排期时不能往里加依据，先撤回到草稿
    const open = st.ruleOpen(kind), locked = open && open.state !== 'draft' ? open : null;
    return html`<article class="n-card" id="sugs"><h3 class="n-section-title">修订建议<span class="nt-muted" style="margin-left:auto;font-weight:400">建议只用于修订规则，分数保持原样</span></h3>
      <ul class="nt-list">${list.map((s) => html`<li style="padding:var(--s-3) 0;border-top:1px solid var(--line)">
        <div class="nt-row"><b style="font-size:var(--t-sm)">${st.sugLabel(s)}</b><span class="nt-muted">${name(s.by)} · ${SRC[ROLE_OF(s.by)]} · ${NT.md(s.at)}</span><span class="n-badge" style="margin-left:auto">${STATE_S[s.state]}</span></div>
        <p style="margin:var(--s-1) 0 0;font-size:var(--t-sm)">「${s.text}」</p>
        ${s.ev && st.event(s.ev) ? html`<p class="nt-muted" style="margin:2px 0 0">例子：${st.event(s.ev).title} · ${NT.md(st.event(s.ev).date)}</p>` : ''}
        ${s.state === 'rejected' ? html`<p class="nt-muted" style="margin:2px 0 0">理由：${s.why}</p>` : ''}
        ${s.state === 'open' && role === 'hrbp' ? html`<div class="nt-row" style="margin-top:var(--s-2)">${locked ? html`<span class="nt-muted">${locked.v} ${STATE[locked.state]}，撤回到草稿后才能纳入</span>` : html`<button class="n-btn n-btn--sm" type="button" data-adopt="${s.id}">${icon('plus')}纳入草稿</button>`}<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-reject="${s.id}">不采纳</button></div>` : ''}
      </li>`)}</ul></article>`;
  }

  // ---------- 影响预览 ----------
  const teamsLine = (p) => (p.teams.length ? p.teams.map((t) => `${st.orgShort(t.team)} ${t.n > 0 ? '+' : ''}${t.n}`).join(' · ') + ' · 其余团队保持' : '各团队人数保持');
  function impactLine(p) {
    if (p.kind === 'watch') return html`值得关注 <b>${p.from} → ${p.to} 人</b>：进入 ${p.enter.length} 人，离开 ${p.leave.length} 人。按团队：${teamsLine(p)}。`;
    if (p.kind === 'map') return html`下一次判断对照里受影响的对照单元 <b>${p.cells} 个</b>。`;
    if (p.kind === 'front') return html`之后新建的期次默认用新版${p.next ? html`，<b>${p.next.name}</b>建立时绑定` : ''}；${p.bound.map((g) => `${g.name}（${g.std}）`).join('、') || '已建立的期次'}保持原版本，<b>${p.keep} 条</b>选拔记录不重算。`;
    return html`取数窗口内用到这些锚点的事件 <b>${p.events} 件</b>，涉及 ${p.people} 人、${p.raters.length} 位评分人；${p.tasks ? html`将生成 <b>${p.tasks} 条复核任务</b>` : '旧分继续参与取数'}。`;
  }
  function impactFull(p, who) {
    if (p.kind === 'map') return html`<p style="margin:0;font-size:var(--t-sm)">${impactLine(p)}</p>`;
    if (p.kind === 'front') {
      return html`<div class="n-scope" style="margin-top:0"><div>适用范围<b>之后新建的期次</b></div><div>保持原版本的期次<b>${p.bound.length} 期</b></div><div>保持旧版的选拔记录<b>${p.keep} 条</b></div><div>汇总依据<b>${p.basis.length + p.notes} 条</b></div></div>
        <p style="margin:0;font-size:var(--t-sm);line-height:1.7">${p.next ? `${p.next.name}还在筹备（${p.next.node} ${NT.md(p.next.at)}），建立时绑定当时的默认版本。` : ''}${p.bound.map((g) => `${g.name}建立时绑定 ${g.std}`).join('，')}，${p.keep} 条选拔记录和 ${p.keepBatch.join('、') || '已有的判断对照'}继续按原版本，结果保持当时的样子；下一次判断对照按选拔标准版本分组。</p>
        ${p.basis.length ? html`<ul class="n-impact__basis">${p.basis.map((b) => html`<li>${icon('split', 12)}${b.batch} · ${b.dim}：${b.n}</li>`)}</ul>` : ''}
        <p class="nt-caption">影响预览只看适用范围、保持原版本的期次与条数和汇总依据；选拔标准改的是之后的期次怎么评，已有的人和分数保持原样。</p>`;
    }
    if (p.kind === 'rubric') {
      const ver = st.ruleVer(st.ruleOpen('rubric')?.base || '') || st.ruleLive('rubric');
      return html`<div class="n-scope" style="margin-top:0"><div>用到这些锚点的事件<b>${p.events} 件</b></div><div>涉及<b>${p.people} 人</b></div><div>评分人<b>${p.raters.length} 位</b></div><div>复核任务<b>${p.tasks} 条</b></div></div>
        <p style="margin:0;font-size:var(--t-sm);line-height:1.7">${p.tasks
          ? `生效时为取数窗口内的 ${p.tasks} 条分生成「按新版本复核」任务${p.held ? `（其中 ${p.held} 条已在按上一版复核，复核后仍要对照这一版）` : ''}${who === 'hrbp' ? `，分给 ${p.raters.map((r) => `${name(r.id)} ${r.n} 条`).join('、')}` : `，分给 ${p.raters.length} 位评分人`}：AI 按新锚点给建议分，原评分人确认，原评分人缺席时由 HR 确认。原分保留并显示 ${ver.v}；复核确认前，这些旧分暂停参与新版本的取数，排除之后证据少于落位门槛的人进「资料不足」区。`
          : `旧分继续参与取数，卡片上照常显示 ${ver.v}。`}</p>`;
    }
    const row = (x) => html`<li>${UI.avatar(x.person, 'sm')}<div><b>${name(x.person)}</b> ${UI.demo()}<small>${st.orgPath(x.team)}</small></div><span class="n-rule">${x.rule}</span></li>`;
    const list = (arr, empty) => (arr.length ? html`<ul class="n-impact__list">${arr.map(row)}</ul>` : html`<p class="n-impact__empty">${empty}</p>`);
    return html`<div class="n-scope" style="margin-top:0">${p.cats.map((c) => html`<div>${c.name}<b>${c.from} → ${c.to} 人</b></div>`)}<div>合计<b>${p.from} → ${p.to} 人</b></div></div>
      ${who === 'hrbp' ? html`<div class="n-impact__groups">
          <div class="n-impact__grp"><h5>进入 · ${p.enter.length} 人</h5>${list(p.enter, '按新版本，现在值得关注之外的人保持原样。')}</div>
          <div class="n-impact__grp"><h5>离开 · ${p.leave.length} 人</h5>${list(p.leave, '按新版本，现在值得关注里的人都还在。')}</div>
        </div>` : html`<div class="n-lock">${icon('lock')}<span>名单只对 HR 展开。你看到的是人数和团队分布；需要了解具体的人，可以请${name(HR)}说明。</span></div>`}
      <p class="n-impact__teams">按团队：${teamsLine(p)}</p>`;
  }

  // ----------管理者：对比、理由、依据、影响预览，确认发布或退回 ----------
  function reviewView(d) {
    const base = st.ruleVer(d.base), ch = st.ruleChanges(d, base);
    return html`<div class="n-revise">
      <div class="nt-grid">
        <div class="n-version"><span class="n-version__tag is-draft">待确认 ${d.v}</span><span class="nt-muted">在 ${d.base} 上修订 · ${name(d.by)}起草 · ${NT.md(d.submittedAt || d.at)} 提交</span></div>
        <article class="n-card"><h3 class="n-section-title">改了什么<span class="nt-muted" style="margin-left:auto;font-weight:400">${ch.length} 处</span></h3>${changeTable(ch)}</article>
        ${d.preview ? html`<article class="n-card" id="impact"><h3 class="n-section-title">影响预览<span class="nt-muted" style="margin-left:auto;font-weight:400">${NT.md(d.preview.at)} 按这份草稿计算</span></h3>${impactFull(d.preview, 'ceo')}</article>` : ''}
        ${kind === 'front' ? '' : contentCard(d)}
      </div>
      <aside class="n-revise__check" aria-label="确认发布">
        <div class="n-checkbar">
          <div class="n-checkbar__sec"><span class="n-checkbar__label">修订理由</span><p style="margin:0;font-size:var(--t-sm);line-height:1.65">${d.why}</p></div>
          ${(d.basis || []).length ? html`<div class="n-checkbar__sec"><span class="n-checkbar__label">依据</span><div class="nt-row">${d.basis.map((b, i) => basisChip(b, i, false))}</div></div>` : ''}
          <div class="n-checkbar__sec"><span class="n-checkbar__label">兼容声明</span><p class="n-checkbar__text">${kind === 'front' ? `选拔标准只影响之后新建的期次怎么评；已有的选拔记录和判断对照保持 ${d.base}。` : d.compat === 'break' ? html`<b>不兼容</b>：生效时为受影响的旧分生成复核任务，原分保留并显示 ${d.base}。` : kind === 'watch' ? '阈值类修订：生效后按新阈值计算，生效前冻结的快照保持原样。' : html`<b>兼容</b>：旧分继续参与取数。`}</p></div>
          <div class="n-checkbar__sec"><span class="n-checkbar__label">生效点</span><p class="n-checkbar__text">${kind === 'front' ? frontEffect(d) : d.effect === 'now' ? html`<b>立即对新的评价生效</b>，${d.base} 变为已替代。` : html`<b>从下一个盘点批次开始</b>，之前 ${d.base} 继续生效。`}</p></div>
          <div class="n-checkbar__foot">
            ${st.lockBlocks(d) ? html`<div class="n-lock">${icon('lock')}<span>${st.inventoryLock().name}进行中，这份草稿选的是立即生效；退回请${name(d.by)}把生效点改为下一个盘点批次。</span></div>` : ''}
            <button class="n-btn n-btn--seal" type="button" id="confirm" ${NT.raw(st.lockBlocks(d) ? 'disabled' : '')}>${icon('stamp')}确认发布 ${d.v}</button>
            <button class="n-btn n-btn--ghost" type="button" id="return">退回修改</button>
          </div>
        </div>
      </aside>
    </div>`;
  }
  function changeTable(ch) {
    const lbl = (c) => {
      if (PDEF[c.key]) return html`<span class="n-rule">${PDEF[c.key][0]}</span> ${PDEF[c.key][1]}`;
      if (c.key === 't2') return html`<span class="n-rule">T2</span> 提名来源`;
      if (c.set === 'pot') return `心性维度锚点 ${c.level} 分`;
      if (c.first || c.removed) return `专业度 · ${st.familyName(c.set)}族锚点`;
      if (c.set) return `专业度 · ${c.set === 'all' ? '通用' : `${st.familyName(c.set)}族`}锚点 ${c.level} 分`;
      return '标准要点';
    };
    const val = (c) => (PDEF[c.key] ? html`<span class="n-diff"><del>${pval(c.key, c.from)}</del> <ins>${pval(c.key, c.to)}</ins></span>` : c.first ? html`<span class="n-diff"><ins>首次启用 ${c.to.length} 条锚点</ins></span>，之前沿用通用锚点` : c.removed ? html`<span class="n-diff"><del>停用 ${c.from.length} 条锚点</del></span>，之后沿用通用锚点` : diffText(c.from, c.to));
    return html`<table class="nt-table"><tbody>${ch.map((c) => html`<tr><th scope="row" style="width:11em">${lbl(c)}</th><td>${val(c)}</td></tr>`)}</tbody></table>`;
  }

  // ---------- 版本历史与对比 ----------
  function historySec(vers = st.ruleVers(kind, line)) {
    const list = vers.slice().reverse();
    return html`<section class="nt-sec" id="history"><h2 class="nt-h2">版本历史</h2>
      <div class="n-card"><table class="nt-table"><thead><tr><th>版本</th><th>状态</th><th>起草 · 确认</th><th>生效点</th><th>修订理由与依据</th></tr></thead><tbody>
        ${list.map((r) => html`<tr>
          <td><b>${r.v}</b>${r.demo ? html` ${UI.demo()}` : ''}${r.from ? html`<small>由 ${r.from} 拆出</small>` : ''}</td>
          <td>${rstate(r)}</td>
          <td>${name(r.by)} ${NT.md(r.at)}${r.confirmedBy ? html`<small>${name(r.confirmedBy)}确认${r.confirmedAt ? ` · ${NT.md(r.confirmedAt)}` : ''}</small>` : ''}</td>
          <td>${r.effAt ? html`${NT.md(r.effAt)} 起${r.line && boundText(r.v) ? html`<small>${boundText(r.v)}绑定</small>` : ''}` : r.effect === 'next' ? '下一个盘点批次' : '确认后立即'}</td>
          <td>${r.why || '—'}${(r.basis || []).length ? html`<small>依据：${r.basis.map(basisText).join('；')}</small>` : ''}</td>
        </tr>`)}
      </tbody></table></div></section>`;
  }
  function compareSec(vers = st.ruleVers(kind, line)) {
    if (vers.length < 2 || kind === 'place') return '';
    if (!cmp || !vers.some((r) => r.v === cmp[0]) || !vers.some((r) => r.v === cmp[1])) cmp = [vers[vers.length - 2].v, vers[vers.length - 1].v];
    const a = st.ruleVer(cmp[0]), b = st.ruleVer(cmp[1]), ch = st.ruleChanges(b, a);
    const opts = (cur) => vers.map((r) => html`<option value="${r.v}" ${NT.raw(r.v === cur ? 'selected' : '')}>${r.v} · ${STATE[r.state]}</option>`);
    return html`<section class="nt-sec" id="compare"><h2 class="nt-h2">版本对比</h2>
      <div class="n-card">
        <div class="nt-row" style="margin-bottom:var(--s-3)"><label class="nt-muted" for="cmp-a">从</label><select class="n-select" id="cmp-a" style="width:auto">${opts(cmp[0])}</select><label class="nt-muted" for="cmp-b">到</label><select class="n-select" id="cmp-b" style="width:auto">${opts(cmp[1])}</select></div>
        ${cmp[0] === cmp[1] ? html`<p class="nt-muted" style="margin:0">选两个不同的版本。</p>` : ch.length ? changeTable(ch) : html`<p class="nt-muted" style="margin:0">这两版的内容相同。</p>`}
      </div></section>`;
  }

  // ---------- 前段评价标准与对应表：入营选拔标准可以修订，对应表只读 ----------
  function renderFront(main) {
    // 每条标准都要有生效中的版本；链接里的 line 不存在时给出路，不渲染半截页面
    const ls = (line ? [line] : st.FRONT_LINES.map(([l]) => l)).filter((l) => st.FRONT_LINES.some(([x]) => x === l) && st.ruleLive('front', l));
    if (!ls.length) return mount(main, UI.state({ ip: 'confirm', title: '链接失效', text: '这条前段评价标准不存在，或链接有误。回到前段评价标准查看现有的几条。', actions: html`<a class="n-btn n-btn--sm" href="rules.html?r=front">查看前段评价标准</a>` }));
    const open = line ? st.ruleOpen('front', line) : null;
    const editing = role === 'hrbp' && open && FRONT_EDITABLE.includes(line);
    const reviewing = role === 'ceo' && open?.state === 'pending';
    const judgeB = (open || st.ruleLive('front', line))?.basis?.find((x) => x.type === 'judge');
    // 入营选拔标准不能在这里直接起草：要从判断对照里 HR 已确认、归因含「评价标准」的结论发起
    const fromJudge = st.judgeBatches().find((b) => b.std && st.ruleVer(b.std)?.line === line);
    const back = role === 'hrbp' && judgeB ? html`<a class="n-btn n-btn--ghost" href="judge.html?id=${judgeB.batch}#attrib">${icon('back')}回到判断对照</a>` : role === 'ceo' && line ? html`<a class="n-btn n-btn--ghost" href="index.html">${icon('back')}回到工作台</a>` : '';
    mount(main, html`
      <header class="nt-head"><div><h1>${line ? lineName(line) : KINDS.front.n}</h1><p>${KINDS.front.w}；判断对照以它为准。</p></div>
        <div class="nt-head__acts">${back}${sealFor(st.ruleVers('front', line))}
          ${open && !editing && !reviewing ? rstate(open, open.v) : ''}
          ${line && !FRONT_EDITABLE.includes(line) ? html`<span class="n-rcard__ro">${icon('lock')}只读</span>` : ''}
          ${role === 'hrbp' && line && !open && FRONT_EDITABLE.includes(line) && fromJudge ? html`<a class="n-btn n-btn--ink" href="judge.html?id=${fromJudge.id}#attrib">${icon('pen')}去判断对照起草</a>` : ''}</div></header>
      ${editing ? reviseView(open) : reviewing ? reviewView(open) : html`<div class="nt-grid">${ls.map(frontLineCard)}</div>`}
      ${line ? historySec(st.ruleVers('front', line)) : ''}
      ${line ? compareSec(st.ruleVers('front', line)) : ''}`);
    wire(main);
  }
  function frontLineCard(l) {
    const live = st.ruleLive('front', l), open = st.ruleOpen('front', l), old = st.ruleVers('front', l).filter((r) => r.state === 'old').pop();
    const g = st.NEXT_PERIOD;
    return html`<article class="n-card">
      <div class="nt-row" style="margin-bottom:var(--s-2)"><h3 class="n-section-title" style="margin:0">${lineName(l)}</h3><span class="n-rule">${icon('doc')}生效中 ${live.v}</span>${open ? rstate(open, open.v) : ''}${!line ? html`<a class="n-link" href="rules.html?r=front&line=${l}" style="margin-left:auto">${FRONT_EDITABLE.includes(l) ? '修订与版本历史' : '版本历史'}</a>` : ''}</div>
      <p style="margin:0;font-size:var(--t-sm);line-height:1.7">${live.note}</p>
      <p class="nt-muted" style="margin:var(--s-2) 0 0">${NT.md(live.effAt)} 起生效 · 之后新建期次的默认版本${boundText(live.v) ? ` · ${boundText(live.v)}绑定这一版` : ''}${old ? ` · ${old.v} 已替代${boundText(old.v) ? `，${boundText(old.v)}保持 ${old.v}` : ''}` : ''}${g && !g.std && FRONT_EDITABLE.includes(l) ? ` · ${g.name}还在筹备，建立时绑定当时的默认版本` : ''}</p>
      ${FRONT_EDITABLE.includes(l) && !open && role === 'hrbp' ? html`<p class="nt-caption" style="margin:var(--s-2) 0 0">修订从判断对照里发起：只有你已确认、归因含「评价标准」的结论可以起草。</p>` : ''}
      ${open ? html`<div class="n-notice" style="margin-top:var(--s-3)">${icon('pen')}<div><b>${open.v} ${STATE[open.state]}</b> · ${openNote(open)}${open.why ? html`<div class="nt-muted">${open.why}</div>` : ''}
        ${line !== l ? html`<a class="n-link" href="rules.html?r=front&line=${l}">${role === 'ceo' && open.state === 'pending' ? '去确认' : '打开草稿'}</a>` : ''}</div></div>` : ''}
    </article>`;
  }

  // ---------- 目标角色与发展通道（只读，沿用 v1.3 模板版本） ----------
  function renderTpl(main) {
    mount(main, html`
      <header class="nt-head"><div><h1>${KINDS.tpl.n}</h1><p>${KINDS.tpl.w}。由 HR 维护，发布即生效。</p></div>
        <div class="nt-head__acts"><span class="n-rcard__ro">${icon('lock')}只读</span></div></header>
      <div class="nt-grid">${st.templates().map((t) => {
        const vs = t.versions.slice().reverse();
        return html`<article class="n-card">
          <div class="nt-row" style="margin-bottom:var(--s-2)"><h3 class="n-section-title" style="margin:0">${UI.tplTitle(t)}</h3><span class="n-rule">${icon('doc')}v${vs[0].v}</span></div>
          <p style="margin:0 0 var(--s-2);font-size:var(--t-sm)">${t.duties}</p>
          <ol class="n-history">${vs.map((v) => html`<li><span class="n-history__v">v${v.v}</span><div>${v.reqs.map((r) => `${r.must ? '必须' : '加分'}：${r.text}`).join('；')}<small>${name(v.by)} · ${NT.md(v.at)}${v.note ? ` · ${v.note}` : ''}</small></div></li>`)}</ol>
        </article>`;
      })}</div>`);
  }

  // ---------- 交互 ----------
  const RETURN_PH = { watch: '比如：先确认 120 天会把哪些更早的事算进来', rubric: '比如：锚点 3 的两种情形先拆开写清楚', front: '比如：刚过线一档也写一句要看到什么' };
  function wire(main) {
    const rerender = () => render($('#main'));
    $('#start')?.addEventListener('click', () => { st.startDraft(kind, [], L); rerender(); NT.toast(`已起草 ${st.ruleOpen(kind, L).v}，改完后预览影响再提交`); });
    // 入营选拔标准：改标准要点，失焦后写进草稿，预览作废
    $('#front-note')?.addEventListener('change', (e) => { st.setDraft(kind, { note: e.target.value.trim() }, L); rerender(); $('#front-note')?.focus(); });
    // 参数：输入时只标错，失焦或回车后写进草稿
    $$('#params .n-param input', main).forEach((inp) => {
      const k = inp.closest('[data-k]').dataset.k;
      inp.addEventListener('change', () => { st.setDraftParam(kind, k, Number(inp.value)); rerender(); $(`[data-k="${k}"] input`)?.focus(); });
    });
    $$('[data-reset]', main).forEach((b) => b.addEventListener('click', () => { const k = b.dataset.reset, d = st.ruleOpen(kind); st.setDraftParam(kind, k, st.ruleVer(d.base).params[k]); rerender(); $(`[data-k="${k}"] input`)?.focus(); }));
    // 锚点：逐条原地改，Esc 取消后焦点回到编辑按钮
    $$('[data-edit]', main).forEach((b) => b.addEventListener('click', () => {
      const li = b.closest('li'), set = li.dataset.set, i = +li.dataset.i, d = st.ruleOpen(kind);
      const cur = set === 'pot' ? d.content.pot[i] : d.content.prof[set][i];
      const span = li.children[1];
      mount(span, html`<span class="n-anchor__edit"><textarea class="n-textarea" rows="2" aria-label="锚点 ${i + 1} 分">${cur}</textarea><span class="nt-row"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-save>保存</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel>取消</button></span></span>`);
      b.closest('.n-anchor__acts').hidden = true;
      const ta = $('textarea', span); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const back = () => { rerender(); $(`li[data-set="${set}"][data-i="${i}"] [data-edit]`)?.focus(); };
      $('[data-save]', span).onclick = () => { const v = ta.value.trim(); if (v && v !== cur) st.setDraftAnchor(kind, set, i, v); back(); };
      $('[data-cancel]', span).onclick = back;
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); back(); } });
    }));
    $$('[data-undo]', main).forEach((b) => b.addEventListener('click', () => {
      const li = b.closest('li'), set = li.dataset.set, i = +li.dataset.i, d = st.ruleOpen(kind), base = st.ruleVer(d.base);
      st.setDraftAnchor(kind, set, i, set === 'pot' ? base.content.pot[i] : base.content.prof[set][i]); rerender();
    }));
    // 理由：随写随存，不影响预览
    const why = $('#why');
    if (why && !why.disabled) why.addEventListener('input', () => { st.setDraft(kind, { why: why.value }, L); const ok = $('label[for="why"] .is-ok'); if (ok) mount(ok, why.value.trim() ? html`${icon('check')}已写` : '必填'); });
    $$('#compat [data-v]', main).forEach((b) => b.addEventListener('click', () => { st.setDraft(kind, { compat: b.dataset.v }); rerender(); }));
    $$('#eff [data-v]', main).forEach((b) => b.addEventListener('click', () => { st.setDraft(kind, { effect: b.dataset.v }); rerender(); $(`#eff [data-v="${b.dataset.v}"]`)?.focus(); }));
    $$('[data-rm]', main).forEach((b) => b.addEventListener('click', () => {
      const sug = st.ruleOpen(kind, L)?.basis?.[+b.dataset.rm]?.type === 'sug';
      const undo = st.removeBasis(kind, +b.dataset.rm, L); if (!undo) return;
      rerender();
      NT.toast(sug ? '已移除这条依据，这条建议回到待处理' : '已移除这条依据', { undo: () => { const ok = undo(); rerender(); return ok; }, failText: '没能撤销：草稿已经变了，移除的依据保持移除' });
    }));
    const add = $('#basis-add');
    if (add) {
      const d = st.ruleOpen(kind, L), has = (t) => (d.basis || []).some((b) => b.type === t);
      const gap = kind === 'watch' ? st.watchGap() : [];
      const items = [];
      if (gap.length && !has('gap')) items.push({ label: `你的核对：第一件事早于时间窗的 ${gap.length} 人`, sub: gap.map((p) => p.name).join('、'), icon: 'users', run: () => { st.setDraft(kind, { basis: [...(d.basis || []), { type: 'gap', people: gap.map((p) => p.id) }] }); rerender(); } });
      if (kind === 'rubric') st.ruleSugs({ state: 'open' }).forEach((s) => items.push({ label: `${s.by ? name(s.by) : ''}的修订建议 · ${st.sugLabel(s)}`, icon: 'note', run: () => { if (adoptSug(s.id)) { rerender(); NT.toast('已把这条建议纳入草稿，提建议的人能看到结果'); } } }));
      items.push({ label: '写一条说明', icon: 'doc', run: async () => {
        const v = await NT.dialog({ title: '写一条依据说明', body: html`<textarea class="n-textarea" rows="3" id="note" placeholder="比如：两次校准会上都提到新人的第一件事落在时间窗外"></textarea>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '加入依据', value: 'ok', cls: 'n-btn--ink', validate: (dl) => !!$('#note', dl).value.trim(), read: (dl) => $('#note', dl).value.trim() }] });
        if (v?.value === 'ok') { st.setDraft(kind, { basis: [...(d.basis || []), { type: 'note', text: v.data }] }, L); rerender(); }
      } });
      NT.menu(add, items);
    }
    $('#preview')?.addEventListener('click', async () => {
      const b = $('#preview'); b.disabled = true; mount(b, html`${icon('retry')}计算中…`);
      await NT.wait(NT.reduced ? 0 : 500);
      const p = st.previewDraft(kind, L); rerender();
      NT.toast(kind === 'watch' ? `预览完成：值得关注 ${p.from} → ${p.to} 人` : kind === 'front' ? `预览完成：之后新建的期次默认用新版，已有 ${p.keep} 条选拔记录保持原版本` : `预览完成：${p.tasks ? `将生成 ${p.tasks} 条复核任务` : '旧分继续参与取数'}`);
      $('#impact')?.scrollIntoView({ behavior: NT.reduced ? 'auto' : 'smooth', block: 'start' });
    });
    $('#submit')?.addEventListener('click', () => {
      const d = st.ruleOpen(kind, L), c = st.draftChecks(d), err = $('#sub-err');
      const miss = !c.lock ? '把生效点改为「从下一个盘点批次开始」' : !c.changed ? '先改至少一处' : !c.why ? '写修订理由' : !c.range ? '把标错的参数改回允许范围' : !c.preview ? '按当前草稿预览一次影响' : '';
      if (miss) { err.hidden = false; err.textContent = `提交前还要：${miss}。`; if (!c.why) $('#why')?.focus(); else $('#preview')?.focus(); return; }
      st.submitDraft(kind, L); rerender();
      NT.toast(`已提交 ${d.v}，待${name(MGR)}确认`, { undo: () => { const ok = st.ruleOpen(kind, L) === d && d.state === 'pending' && !!st.withdrawDraft(kind, L); rerender(); return ok; }, undoneText: `已撤回，${d.v} 回到草稿`, failText: `没能撤回：${d.v} 已经不在待确认，保持现在的状态` });
    });
    $('#withdraw')?.addEventListener('click', async () => {
      const d = st.ruleOpen(kind, L);
      if (d.state === 'scheduled') {
        const v = await NT.dialog({ title: `撤回已排期的 ${d.v}？`, body: html`<p>撤回后回到草稿，${d.base} 继续生效；改完要重新提交${name(MGR)}确认。</p>`, actions: [{ label: '保留排期', value: 'cancel', cls: 'n-btn--ghost' }, { label: '撤回到草稿', value: 'ok', cls: 'n-btn--ink' }] });
        if (v !== 'ok') return;
      }
      st.withdrawDraft(kind, L); rerender(); NT.toast(`${d.v} 已回到草稿`);
    });
    $('#drop')?.addEventListener('click', async () => {
      const d = st.ruleOpen(kind, L);
      const v = await NT.dialog({ title: `删除草稿 ${d.v}？`, body: html`<p>草稿里的改动、理由和预览一起删除；${d.base} 保持生效。</p>`, actions: [{ label: '保留草稿', value: 'cancel', cls: 'n-btn--ghost' }, { label: '删除草稿', value: 'ok', cls: 'n-btn--ink' }] });
      if (v !== 'ok') return;
      const restore = st.deleteDraft(kind, L); rerender();
      NT.toast(`已删除草稿 ${d.v}`, { undo: () => { const ok = restore(); rerender(); return ok; }, failText: '没能撤销：已经有一份新草稿，删除的草稿保持删除' });
    });
    $$('[data-adopt]', main).forEach((b) => b.addEventListener('click', () => {
      const fresh = !st.ruleOpen(kind); // 没有修订时纳入会新起一份草稿；撤销时这份空草稿一并删掉
      if (!adoptSug(b.dataset.adopt)) return; rerender();
      NT.toast(fresh ? `已起草 ${st.ruleOpen(kind).v} 并纳入这条建议，提建议的人能看到结果` : '已纳入草稿作为依据，提建议的人能看到结果', { undo: () => {
        st.unhandleRuleSug(b.dataset.adopt);
        const d = st.ruleOpen(kind);
        if (fresh && d?.state === 'draft' && !d.basis?.length && !d.why && !st.ruleChanges(d).length) st.deleteDraft(kind);
        rerender();
      } });
    }));
    $$('[data-reject]', main).forEach((b) => b.addEventListener('click', async () => {
      const v = await NT.dialog({ title: '不采纳这条修订建议？', body: html`<p>写一句理由，提建议的人能看到。</p><textarea class="n-textarea" rows="2" id="rj" placeholder="比如：锚点 3 的范围本来就包含两种情形，先补示例"></textarea>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '不采纳', value: 'ok', cls: 'n-btn--ink', validate: (dl) => !!$('#rj', dl).value.trim(), read: (dl) => $('#rj', dl).value.trim() }] });
      if (v?.value !== 'ok') return;
      st.handleRuleSug(b.dataset.reject, false, v.data); rerender();
      NT.toast('已记为不采纳，提建议的人能看到理由', { undo: () => { st.unhandleRuleSug(b.dataset.reject); rerender(); } });
    }));
    // 管理者确认发布：朱印压印，5 秒内可以撤销
    $('#confirm')?.addEventListener('click', async () => {
      const k = kind, d = st.ruleOpen(k, L);
      const v = await NT.dialog({
        title: `确认发布 ${d.v}？`,
        body: html`<p>${k === 'front' ? `确认后 ${d.v} 立即成为之后新建期次的默认版本，${d.base} 变为已替代；已建立的期次、选拔记录和判断对照保持原版本。` : d.effect === 'now' ? `确认后新的评价按 ${d.v} 计算，${d.base} 变为已替代。已确认的分数、冻结的快照和档案版本保留原来的版本。` : `确认后进入已排期，${nextText(d)}，在那之前 ${d.base} 继续生效。已确认的分数、冻结的快照和档案版本保留原来的版本。`}</p>`,
        facts: [html`理由：${d.why}`, d.preview ? impactLine(d.preview) : ''].filter(Boolean),
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: `确认发布 ${d.v}`, value: 'ok', cls: 'n-btn--seal', icon: 'stamp' }],
      });
      if (v !== 'ok') return;
      const undo = st.confirmDraft(k, L); rerender();
      if (!undo) { NT.toast('规则状态已变化，无法确认发布，请重新核对'); return; }
      const seal = $('#seal'); seal?.classList.add('is-stamping');
      NT.toast(k === 'front' ? `已发布 ${d.v}，之后新建的期次默认用新版` : d.effect === 'now' ? `已发布 ${d.v}，${k === 'watch' ? '首页「值得关注」按新版本计算' : '新的评价按新版本计算'}` : `已确认 ${d.v}，${nextText(d)}`,
        { undo: () => { const ok = undo(); rerender(); return ok; }, undoneText: `已撤销，${d.v} 回到待确认`, failText: '没能撤销：规则已有后续变更，发布保持' });
    });
    $('#return')?.addEventListener('click', async () => {
      const k = kind, d = st.ruleOpen(k, L);
      const v = await NT.dialog({ title: `退回 ${d.v}？`, body: html`<p>草稿回到${name(d.by)}那里，你写的理由会出现在${name(d.by)}的待办里。</p><textarea class="n-textarea" rows="2" id="rt" placeholder="${RETURN_PH[k] || ''}"></textarea>`,
        actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '退回修改', value: 'ok', cls: 'n-btn--ink', validate: (dl) => !!$('#rt', dl).value.trim(), read: (dl) => $('#rt', dl).value.trim() }] });
      if (v?.value !== 'ok') return;
      st.returnDraft(k, v.data, L); rerender();
      NT.toast(`已退回给${name(d.by)}修改，理由在${name(d.by)}的待办里`, { undo: () => {
        // 退回之后起草人已经改过或重新提交，就不再拉回待确认
        const ok = d.state === 'draft' && !!d.returned && st.ruleOpen(k, L) === d;
        if (ok) { d.state = 'pending'; delete d.returned; st.save(); }
        rerender(); return ok;
      }, undoneText: `已撤销退回，${d.v} 回到待确认`, failText: `没能撤销：${d.v} 已经有了后续处理，保持现在的状态` });
    });
    $('#rv-toggle')?.addEventListener('click', () => { reviewing = !reviewing; rerender(); $('#rv-toggle')?.focus(); });
    $$('[data-rv]', main).forEach((b) => b.addEventListener('click', () => {
      const tr = b.closest('tr'), v = +$('select', tr).value, s = st.event(tr.dataset.ev).scores[+tr.dataset.i];
      const undo = st.reviewScore(tr.dataset.ev, +tr.dataset.i, v, tr.closest('[data-ver]').dataset.ver); if (!undo) return;
      rerender();
      NT.toast(`已按新版本确认${name(s.p)}的${st.dim(s.d).name} ${v} 分`, { undo: () => { undo(); rerender(); } });
    }));
    const ca = $('#cmp-a'), cb = $('#cmp-b');
    [ca, cb].forEach((s) => s?.addEventListener('change', () => { cmp = [ca.value, cb.value]; rerender(); $(s === ca ? '#cmp-a' : '#cmp-b')?.focus(); }));
  }
})();
