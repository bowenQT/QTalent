/* Niu-Talent 原型：共用的界面片段。只拼 HTML 与少量行为，数据和权限从 NT.store 取。 */
(function () {
  'use strict';
  const NT = window.NT;
  const st = NT.store;
  const { html, raw, icon, esc } = NT;
  const UI = (NT.ui = {});
  // 页面所在目录：桌面 app/、手机 m/ 都在 prototype/ 下一级
  UI.root = '..';

  UI.demo = () => html`<span class="n-badge n-badge--demo">演示</span>`;
  UI.avatar = (pid, size = '') => {
    const p = st.person(pid);
    if (!p) return html`<span class="n-avatar ${size ? `n-avatar--${size}` : ''}" style="--hue:0;background:var(--sheet-sunk)">?</span>`;
    return html`<span class="n-avatar ${size ? `n-avatar--${size}` : ''}" style="--hue:${p.hue}">${p.photo ? raw(`<img src="${UI.root}/assets/avatars/${p.photo}.jpg" alt="">`) : ''}${p.name[0]}</span>`;
  };
  UI.plink = (pid, text) => {
    const p = st.person(pid);
    if (!p) return text || '';
    return st.scope(pid) ? html`<a class="nt-plink" href="person.html?id=${pid}">${text || p.name}</a>` : html`<span>${text || p.name}</span>`;
  };
  UI.person = (pid, o = {}) => {
    const p = st.person(pid);
    const meta = o.meta ?? `${st.orgShort(p.org)} · ${p.title}`;
    const name = o.link === false ? p.name : UI.plink(pid);
    return html`<div class="n-person">${UI.avatar(pid, o.size)}<div><div class="n-person__name">${name}${o.demo === false ? '' : UI.demo()}${o.after || ''}</div>${meta ? html`<div class="n-person__meta">${meta}</div>` : ''}${o.meta2 ? html`<div class="n-person__meta">${o.meta2}</div>` : ''}</div></div>`;
  };
  UI.lock = (t) => html`<span class="n-lock">${icon('lock')}${t}</span>`;
  UI.na = (t = '资料不足') => html`<span class="n-badge n-badge--unknown">${icon('dash')}${t}</span>`;
  UI.qBadge = (q) => (q ? html`<span class="n-badge" style="background:var(--q-${q});color:var(--q-${q}-ink)">${st.QN[q]}</span>` : UI.na());
  UI.pstatus = (s) => {
    const cls = { 筹备中: 'n-badge--prep', 进行中: 'n-badge--yes', 已结束: 'n-badge--ended', 已归档: 'n-badge--archived' }[s] || '';
    return html`<span class="n-badge ${cls}">${s === '已归档' ? icon('archive') : ''}${s}</span>`;
  };
  UI.dots = (v, o = {}) => html`<span class="n-score__dots" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => raw(`<i class="n-score__dot${v != null && i <= v ? ' is-on' : ''}${o.ghost && i <= o.ghost && i > v ? ' is-ghost' : ''}"></i>`))}</span>`;
  UI.dotsInline = (v, state = 'confirmed') => html`<span class="n-score" data-state="${state}" style="min-height:0;display:inline-grid;grid-template-columns:auto">${UI.dots(v)}</span>`;
  UI.src = (kind) => ({
    fact: html`<span class="n-src n-src--fact">${icon('doc')}原始事实</span>`,
    hist: html`<span class="n-src n-src--fact">${icon('doc')}历史资料</span>`,
    self: html`<span class="n-src n-src--self">${icon('quote')}本人自述</span>`,
    obs: html`<span class="n-src n-src--obs">${icon('eye')}管理观察</span>`,
    ai: html`<span class="n-src n-src--ai">${icon('spark')}AI 推断</span>`,
    human: html`<span class="n-src n-src--human">${icon('pen')}人工结论</span>`,
  }[kind]);

  // 引用角标：悬停或点按展开原文；录音来源可以就地播放那一段
  let citeN = 0;
  UI.cite = (src, n) => {
    if (!src) return '';
    citeN += 1;
    const audio = src.type === 'audio';
    const ic = { audio: 'wave', doc: 'doc', sheet: 'doc', note: 'note' }[src.type] || 'doc';
    const quote = src.quote ? html`<p class="n-cite__quote">${src.quote}</p>` : '';
    return html`<span class="n-cite"><button class="n-cite__mark" ${raw(audio ? 'data-kind="audio"' : '')} type="button" aria-label="引用 ${n}：${src.label}">${n}</button><span class="n-cite__pop" role="tooltip"><span class="n-cite__src">${icon(ic, 14)}${src.label} · ${src.loc}${src.by ? ` · ${st.person(src.by)?.name}` : ''}</span>${quote}${audio ? html`<span class="n-cite__foot"><button class="n-player__play nt-play" type="button" style="width:26px;height:26px" aria-label="播放这一段">${icon('play', 10)}</button><span style="font-size:var(--t-xs);color:var(--ink-3)">播放 ${src.loc.split('–')[0]} 起的 10 秒</span></span>` : ''}</span></span>`;
  };
  UI.cites = (srcs) => (srcs || []).map((s, i) => UI.cite(s, i + 1));

  UI.scoreState = (s) => (s.st === 'calibrated' ? 'calibrated' : s.st === 'ai' ? 'ai' : s.st === 'unknown' ? 'unknown' : s.st === 'absent' ? 'absent' : 'confirmed');
  // 只读的一行维度分
  UI.scoreLine = (s, o = {}) => {
    const d = st.dim(s.d);
    if (s.st === 'conflict') {
      return html`<div class="n-score" data-state="confirmed"><span class="n-score__dim">${d.name}</span><span class="n-badge n-badge--conflict">${icon('split')}证据冲突 ${s.raters.map((r) => r.v).join(' / ')}</span><span class="n-score__note">${s.raters.map((r) => st.person(r.by).name).join('、')}分差 ≥ 2 · 在 HRBP 校准队列</span></div>`;
    }
    const state = UI.scoreState(s);
    const who = s.by ? st.person(s.by) : null;
    let note = s.note || '';
    if (state === 'confirmed' || state === 'calibrated') {
      note = html`${who ? html`<span class="ink-hand">${who.name}</span>` : ''}${state === 'calibrated' ? '校准' : '确认'}${s.ai != null && s.ai !== s.v ? html` · <span class="n-score__delta">${s.v > s.ai ? '+' : ''}${s.v - s.ai}</span> AI 原为 ${s.ai}` : ''}`;
    } else if (state === 'ai') note = html`<span class="n-src n-src--ai">${icon('spark')}AI 建议</span>${s.note ? ` · ${s.note}` : ''}`;
    const empty = state === 'unknown' ? html`<span class="n-score__empty n-badge n-badge--unknown">${icon('dash')}资料不足</span>` : state === 'absent' ? html`<span class="n-score__empty n-badge">未体现</span>` : '';
    return html`<div class="n-score" data-state="${state}" ${raw(o.hist && s.hist ? `data-hist="1"` : '')}><span class="n-score__dim">${d.name}</span>${UI.dots(s.v, { ghost: s.ai != null && s.ai > s.v && state !== 'ai' ? s.ai : null })}${empty}<span class="n-score__note">${note}${o.hist && s.hist ? html` <button class="nt-linkbtn nt-hist" type="button">修订历史</button>` : ''}</span></div>`;
  };
  UI.history = (s, e) => {
    const rows = (s.hist || []).map((h) => html`<li><span class="n-history__v ${h.kind === 'ai' ? 'is-ai' : ''}">${h.v}</span><div>${h.why ? html`<span class="n-history__why">${h.why}</span>` : h.kind === 'ai' ? 'AI 建议' : h.kind === 'edit' ? '改分' : '确认'}<small>${h.kind === 'ai' ? `模型 qwen-max · rubric-v1 · ${NT.md(h.at)}` : `${st.person(h.by)?.name} · ${{ calib: 'HRBP 校准', confirm: '确认', edit: '改分' }[h.kind]} · ${NT.md(h.at)}`}</small></div></li>`);
    return html`<ul class="n-history">${rows}</ul>`;
  };

  // 关键事件卡（只读）。forPid：从谁的角度看（多人事件只显示此人的分）
  UI.eventCard = (e, o = {}) => {
    const forPid = o.for;
    const canScore = forPid ? st.can('scores', forPid) : st.role() !== 'self';
    const proj = e.project && st.project(e.project);
    const who = e.people.length > 1 && forPid ? html`<span class="n-badge">多人事件 · ${e.people.map((p) => st.person(p).name).join('、')}</span>` : '';
    const roleNote = e.roles && forPid ? html`<span class="n-badge">本人：${e.roles[forPid]}</span>` : '';
    const scores = e.scores.filter((s) => !forPid || s.p === forPid);
    const tags = (e.tags || []).map((t) => html`<span class="n-tag">${t}</span>`).concat((e.tagsAI || []).map((t) => html`<span class="n-tag is-candidate" title="标签库里还没有，等 HRBP 决定是否收录">${t}<small>候选</small></span>`));
    return html`<article class="n-card n-event nt-event" id="ev-${e.id}">
      <div class="n-event__head">${o.showPerson && e.people[0] ? html`${UI.avatar(e.people[0], 'sm')}<b class="n-event__who">${st.person(e.people[0]).name}</b>` : ''}
        ${UI.src(e.kind === 'self' ? 'self' : e.kind === 'hist' ? 'hist' : 'obs')}
        <span>${e.date ? NT.md(e.date) : '时间未知'} · ${st.person(e.recorder)?.name || ''}记录</span>
        ${proj ? html`<a class="n-badge" href="project.html?id=${proj.id}">${icon('folder')}${proj.type === 'Landing 议题' ? '议题' : '项目'}：${proj.name}</a>` : ''}${who}${roleNote}</div>
      <h3 class="n-event__title">${e.title}${e.kind !== 'hist' ? UI.cites(e.srcs) : ''}</h3>
      ${e.bg ? html`<dl class="n-event__sbar"><dt>背景</dt><dd>${e.bg}</dd><dt>行为</dt><dd>${e.act}</dd><dt>结果</dt><dd>${e.res}</dd></dl>` : ''}
      ${e.scale ? html`<div class="n-scale">${e.scale.map(([k, v]) => html`<span>${k} ${v}</span>`)}</div><div class="n-tl__note">保留原量表，不换算成 1–5 的维度分，也不参与象限。${e.srcs?.[0] ? ` 来源：${e.srcs[0].label} · ${e.srcs[0].loc}` : ''}</div>` : ''}
      ${tags.length ? html`<div class="n-tags"><span class="n-tags__label">标签</span>${tags}</div>` : ''}
      ${scores.length ? (canScore ? html`<div class="n-event__scores">${scores.map((s) => UI.scoreLine(s, { hist: true }))}</div>` : html`<div class="n-event__scores">${UI.lock('维度分对本人不可见')}</div>`) : ''}
    </article>`;
  };

  // 个人能力谱
  UI.spectrum = (pid) => {
    const at = (v) => ((v - 1) / 4) * 100;
    const from = NT.addDays(NT.TODAY, -365), recent = NT.addDays(NT.TODAY, -90);
    const groups = [['专业度', ['prof']], ['潜力 · 核心', ['mot', 'wis', 'grit']], ['潜力 · 加分项', ['lead', 'open']]];
    let total = 0;
    const rows = groups.map(([g, ids]) => html`<div class="n-spectrum__group">${g === '专业度' ? `专业度（对标 ${st.person(pid).level}）` : g}</div>${ids.map((id) => {
      const d = st.dim(id);
      const list = st.scoresOf(pid, { dim: id, from, visible: true });
      if (!list.length) {
        return html`<div class="n-spectrum__row"><span class="n-spectrum__dim">${d.name}</span><div class="n-spectrum__track is-unknown">资料不足 · ${UI.missText(pid, id)}</div><span class="n-spectrum__stat"><span class="cnt">0 条</span></span></div>`;
      }
      total += list.length;
      const bins = {};
      list.forEach((s) => { bins[s.v] = bins[s.v] || [0, 0]; bins[s.v][s.date >= recent ? 1 : 0] += 1; });
      const m = st.mean(list.map((s) => s.v));
      const binsHtml = Object.entries(bins).map(([v, [o, c]]) => {
        const all = o + c, dd = Math.min(30, 10 + 6 * Math.sqrt(all - 1)), inner = c ? Math.max(6, dd * Math.sqrt(c / all)) : 0;
        return `<span class="n-spectrum__bin" style="left:${at(+v)}%;width:${dd}px;height:${dd}px" title="${v} 分：${all} 条，其中近 3 个月 ${c} 条"><i style="width:${inner}px;height:${inner}px"></i></span>${all > 1 ? `<em class="n-spectrum__count" style="left:${at(+v)}%">${all}</em>` : ''}`;
      }).join('');
      return html`<button type="button" class="n-spectrum__row" aria-expanded="false" aria-label="${d.name}，均值 ${m.toFixed(1)}，${list.length} 条事件，点开查看">
        <span class="n-spectrum__dim">${icon('chev')}${d.name}</span>
        <span class="n-spectrum__track" aria-hidden="true">${raw([1, 2, 3, 4, 5].map((v) => `<i class="n-spectrum__tick" style="left:${at(v)}%"></i>`).join(''))}${raw(binsHtml)}<i class="n-spectrum__mean" style="left:${at(m)}%"></i></span>
        <span class="n-spectrum__stat"><b>${m.toFixed(1)}</b><span class="cnt">${list.length} 条${list.length < 2 ? ' · 证据少' : ''}</span></span></button>
        <ul class="n-spectrum__list" hidden>${list.slice(0, 6).map((s) => html`<li class="${s.date < recent ? 'is-old' : ''}"><b>${s.v}</b><span>${NT.md(s.date)}</span><span>${st.person(s.by)?.name || ''}</span><span><a href="#ev-${s.ev.id}">${s.ev.title}</a>${s.st === 'calibrated' ? ' · 已校准' : ''}</span></li>`)}${list.length > 6 ? html`<li class="more">还有 ${list.length - 6} 条，在下方时间线查看</li>` : ''}</ul>`;
    })}`);
    return { html: rows, total };
  };
  UI.missText = (pid, dimId) => {
    const any = NT.store.visibleEvents(pid).events.some((e) => e.scores.some((s) => s.p === pid && s.d === dimId));
    if (any) return '有记录，没写具体行为';
    return { grit: '还没有受挫后如何反应的事件', prof: '还没有专业度评分', mot: '还没有主动性相关的事件', wis: '还没有判断与取舍相关的事件', lead: '还没有带动他人的事件', open: '还没有接受反馈相关的事件' }[dimId];
  };
  UI.wireSpectrum = (host) => host.addEventListener('click', (e) => {
    const row = e.target.closest('button.n-spectrum__row'); if (!row) return;
    const open = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', open); row.nextElementSibling.hidden = !open;
  });

  // 小象限：历次校准位置 + 当前参考位置
  UI.miniquad = (pid) => {
    const hist = st.formalHistory(pid);
    const ref = st.refPos(pid);
    const pts = hist.map((h) => ({ x: h.x, y: h.y, t: `${h.snap.label}：${st.QN[h.q]}`, now: false }));
    const cap = hist.length ? `${hist.map((h) => h.snap.label).join(' → ')} · ${st.QN[hist[hist.length - 1].q]}` : '还没有正式校准';
    if (hist.length) pts[pts.length - 1].now = true;
    const path = pts.length > 1 ? `<svg aria-hidden="true"><path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p.x * 132} ${p.y * 80}`).join(' ')}"/></svg>` : '';
    const refPt = !ref.na ? `<span class="n-miniquad__pt nt-ref" style="left:${ref.x * 100}%;top:${ref.y * 83}%" title="当前参考位置：${st.QN[ref.q]}"></span>` : '';
    return html`<div class="n-miniquad" aria-label="历次校准：${cap}"><div class="n-miniquad__plane"></div>${raw(path)}${raw(refPt)}${pts.map((p) => raw(`<span class="n-miniquad__pt${p.now ? ' is-now' : ''}" style="left:${p.x * 100}%;top:${p.y * 83}%" title="${esc(p.t)}"></span>`))}<span class="n-miniquad__cap">${cap}</span></div>`;
  };

  // 状态页：空、无权限、失败
  UI.state = (o) => html`<div class="n-state ${o.cls || ''}"><span class="nt-ip" data-ip="${o.ip || 'rest'}" data-size="${o.size || 56}"></span><p class="n-state__title">${o.title}</p>${o.text ? html`<p class="n-state__text">${o.text}</p>` : ''}${o.actions ? html`<div class="nt-row" style="justify-content:center">${o.actions}</div>` : ''}</div>`;
  UI.mountIPs = (root = document) => NT.$$('.nt-ip[data-ip]', root).forEach((el) => { if (!el.dataset.mounted) { el.dataset.mounted = 1; NT.ip(el, el.dataset.ip, +el.dataset.size || 36); } });

  UI.trail = (title, steps, open = true) => html`<div class="n-trail" data-open="${open}"><button class="n-trail__head" type="button" aria-expanded="${open}"><svg class="n-trail__chev"><use href="#i-chev"/></svg>${title}</button><ol class="n-trail__steps">${steps.map((s) => html`<li class="n-trail__step" data-state="pending">${s}</li>`)}</ol></div>`;

  // 变化流的一行
  UI.change = (c, base) => {
    const p = c.person && st.person(c.person);
    const who = p ? p.name : st.orgShort(c.team);
    const ava = p ? UI.avatar(c.person) : html`<span class="n-change__icon">${icon('layers')}</span>`;
    const delta = c.from != null ? html`<span class="n-delta"><s>${c.unit ? c.from : c.from.toFixed(1)}${c.unit || ''}</s>${icon(c.to > c.from ? 'up-r' : 'down-r')}${c.unit ? c.to : c.to.toFixed(1)}${c.unit || ''}</span>` : '';
    const mini = c.from != null && !c.unit ? raw(`<span class="n-mini" aria-hidden="true"><i class="was" style="left:${((c.from - 1) / 4) * 100}%"></i><i class="now" style="left:${((c.to - 1) / 4) * 100}%"></i></span>`) : '';
    const sub = c.sub || (c.t === 'trend' ? `近 3 个月 ${c.n} 条 · ${base === 'ver' ? '对比 2026 H1 档案版本' : '对比之前 9 个月'}${c.thin ? ' · 证据少' : ''}` : '');
    const evli = (list) => html`<ul>${list.map((s) => html`<li><b>${s.v}</b>${s.ev.title} <small>${NT.md(s.date)} · ${st.person(s.by)?.name || ''}</small></li>`)}</ul>`;
    const why = {
      trend: c.up ? '上升和下降一样按规则提示，便于在盘点里及时看到。先看事件再判断。' : '下降可能和情境变化有关（换了项目、任务更模糊），建议先看事件再判断，不直接下结论。',
      activity: c.hit ? '没有新事件只说明没有被记录，不代表表现下降。' : '这是一条记录层面的变化，没有命中规则。',
      quad: '正式位置不会自动移动，需要在下一次校准时处理。',
      team: '资料不足上升说明需要补录，不是团队能力的变化。',
    }[c.t];
    const acts = {
      trend: [['转为跟踪', `person.html?id=${c.person}&track=1`], ['看档案', `person.html?id=${c.person}`]],
      activity: c.hit ? [['看「值得聊一聊」', `person.html?id=${c.person}#signal`], ['看档案', `person.html?id=${c.person}`]] : [['看档案', `person.html?id=${c.person}`]],
      quad: [['加入下次校准', `calibrate.html?id=b-h2&team=${p?.org || ''}`]],
      team: [['看盘点清单', `review.html?id=b-h2`]],
    }[c.t];
    const detail = c.t === 'trend'
      ? html`<div><h5>${base === 'ver' ? '2026 H1 档案版本' : '之前 9 个月'}</h5>${evli(c.before)}</div><div><h5>近 3 个月</h5>${evli(c.after)}</div><p class="n-change__why">${why}</p>`
      : html`<p class="n-change__why" style="border:0;padding:0">${why}</p>`;
    return html`<div class="n-change ${st.get().seen[c.id] ? 'is-seen' : ''}" data-id="${c.id}"><button class="n-change__row" type="button" aria-expanded="false">${ava}
      <span class="n-change__what"><span class="n-change__line"><b>${who}</b>${c.what}${delta}${mini}${c.hit ? html`<span class="n-rule">${icon('flag')}${c.rule}</span>` : ''}</span><span class="n-change__sub">${sub}</span></span>
      <span class="n-change__side">${NT.md(c.when)}${icon('chev')}</span></button>
      <div class="n-change__detail" hidden>${detail}<div class="n-change__acts">${acts.map(([l, h], k) => html`<a class="n-btn n-btn--sm ${k ? 'n-btn--ghost' : ''}" href="${h}">${l}</a>`)}<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-seen>${st.get().seen[c.id] ? '取消已看过' : '标为已看过'}</button></div></div></div>`;
  };
  UI.wireChanges = (host) => host.addEventListener('click', (e) => {
    const row = e.target.closest('.n-change__row');
    if (row) { const open = row.getAttribute('aria-expanded') !== 'true'; row.setAttribute('aria-expanded', open); row.nextElementSibling.hidden = !open; return; }
    const seen = e.target.closest('[data-seen]');
    if (seen) { const c = seen.closest('.n-change'); const on = c.classList.toggle('is-seen'); seen.textContent = on ? '取消已看过' : '标为已看过'; st.markSeen(c.dataset.id, on); }
  });

  // 播放引用的录音片段（原型里只做进度动画）
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.nt-play'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.playing) return;
    b.dataset.playing = 1; b.innerHTML = '<svg width="10" height="10"><use href="#i-pause"/></svg>';
    NT.toast('正在播放这一段录音（原型不含真实音频）', { duration: 2200 });
    setTimeout(() => { delete b.dataset.playing; b.innerHTML = '<svg width="10" height="10"><use href="#i-play"/></svg>'; }, 2400);
  });
  // ---------- 重点跟踪 ----------
  UI.trackCard = (t) => {
    const p = st.person(t.person);
    const since = st.get().events.filter((e) => e.kind === 'obs' && e.date && e.date > t.since && e.people.includes(t.person));
    const scoreTxt = (e) => e.scores.filter((s) => s.p === t.person).map((s) => (s.v != null ? `${st.dim(s.d).name} ${s.v}${s.st === 'ai' ? '（AI 建议）' : ''}` : `${st.dim(s.d).name}资料不足`)).join('、');
    return html`<article class="n-card n-track ${t.state !== 'on' ? 'is-stopped' : ''}" data-track="${t.id}" id="track">
      <div class="n-track__head">${UI.person(t.person, { meta: `${st.orgShort(p.org)} · ${p.title}` })}<span class="n-badge">${icon('target')}${t.state === 'on' ? '跟踪中' : '已结束'}</span></div>
      <dl class="n-track__dl"><dt>为什么关注</dt><dd>${t.why}</dd><dt>想观察</dt><dd class="n-track__q">${t.q}</dd>
        <dt>负责人</dt><dd>${st.person(t.owner).name}${t.helper ? ` · ${st.person(t.helper).name}协助` : ''}</dd><dt>下次</dt><dd>${NT.md(t.next)} 前，或下一次对人复盘</dd></dl>
      <div class="n-track__new"><h5>上次（${NT.md(t.since)}）之后新增</h5>${since.length ? html`<span class="n-diff"><ins>${since.length} 条事件</ins>：${since.map((e) => `${e.title}（${scoreTxt(e) || '没有评分'}）`).join('；')}</span>` : '还没有新的材料。'}</div>
      ${t.state === 'on' ? html`<div class="n-track__acts"><a class="n-btn n-btn--sm n-btn--ink" href="record.html?person=${t.person}">${icon('plus')}记一条观察</a><button class="n-btn n-btn--sm" type="button" data-edit="${t.id}">改观察问题</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-stop="${t.id}">停止跟踪</button></div>`
        : html`<div class="n-track__acts"><span class="nt-muted">${NT.md(t.stoppedAt || NT.TODAY)} 停止 · 观察问题和期间的事件都还在档案里</span><button class="nt-linkbtn" type="button" data-resume="${t.id}">恢复跟踪</button></div>`}
    </article>`;
  };
  UI.wireTracks = (host, rerender) => host.addEventListener('click', async (e) => {
    const S = st.get();
    const stop = e.target.closest('[data-stop]'), edit = e.target.closest('[data-edit]'), resume = e.target.closest('[data-resume]');
    if (stop) {
      const t = S.tracks.find((x) => x.id === stop.dataset.stop); t.state = 'stopped'; t.stoppedAt = NT.TODAY; st.save(); rerender();
      NT.toast(`已停止跟踪${st.person(t.person).name}`, { undo: () => { t.state = 'on'; st.save(); rerender(); } });
    }
    if (resume) { const t = S.tracks.find((x) => x.id === resume.dataset.resume); t.state = 'on'; st.save(); rerender(); }
    if (edit) {
      const t = S.tracks.find((x) => x.id === edit.dataset.edit);
      const r = await UI.trackDialog(t.person, t);
      if (r) { Object.assign(t, r); st.save(); rerender(); NT.toast('观察问题已更新'); }
    }
  });
  UI.trackDialog = async (pid, t) => {
    const p = st.person(pid);
    const r = await NT.dialog({
      title: t ? `改${p.name}的观察问题` : `重点跟踪${p.name}`,
      body: html`<label class="n-field"><span class="n-field__label">为什么关注</span><input class="n-input" id="tk-why" value="${t?.why || ''}" placeholder="比如：近 3 个月智慧力明显走低"></label>
        <label class="n-field"><span class="n-field__label">具体想观察什么 <small>写成一个能回答的问题</small></span><textarea class="n-textarea ink-hand" id="tk-q" style="font-size:var(--t-md)" placeholder="比如：没有导师在场时，能不能独立做方案取舍？">${t?.q || ''}</textarea></label>
        <label class="n-field"><span class="n-field__label">下次什么时候看</span><select class="n-select" id="tk-next"><option value="2026-11-06">11-06 前</option><option value="2026-11-13">11-13 前</option><option value="2026-11-30">本月底前</option></select></label>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: t ? '保存' : '开始跟踪', value: 'ok', cls: 'n-btn--ink',
        validate: (d) => { const ok = d.querySelector('#tk-q').value.trim(); if (!ok) d.querySelector('#tk-q').focus(); return !!ok; },
        read: (d) => ({ why: d.querySelector('#tk-why').value.trim() || '—', q: d.querySelector('#tk-q').value.trim(), next: d.querySelector('#tk-next').value }) }],
    });
    return r?.value === 'ok' ? r.data : null;
  };

  // ---------- 值得聊一聊 ----------
  UI.signalBlock = (sig) => {
    const p = st.person(sig.person);
    const mgr = p.manager && st.person(p.manager);
    const items = sig.items.map((it, i) => html`<li>${UI.src(it.src)}<span class="n-signal__text ${it.src === 'self' ? 'ink-hand' : ''}">${it.text}</span><button class="n-signal__from" type="button" aria-expanded="false" data-from="${i}">${it.from}</button><div class="n-signal__detail" hidden>${it.src === 'self' ? icon('play') : ''}${it.detail}</div></li>`);
    let tail;
    if (sig.state === 'open') {
      tail = html`<div class="n-signal__actions" data-acts><button class="n-btn n-btn--ink" type="button" data-talk>安排一次沟通</button><button class="n-btn n-btn--ghost" type="button" data-hold>暂不处理</button></div>
        <form class="n-signal__form" data-talkform hidden><label>谁来聊<select name="who">${[p.manager, p.hrbp].filter(Boolean).map((id) => html`<option value="${id}">${st.person(id).name}（${id === p.hrbp ? 'HRBP' : '直属负责人'}）</option>`)}</select></label>
          <label>什么时候前<select name="when"><option>11-06 前</option><option>11-13 前</option><option>本月内</option></select></label>
          <div class="n-signal__formbar"><button class="n-btn n-btn--sm n-btn--ink" type="submit">创建跟进</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel>取消</button></div></form>
        <form class="n-signal__form" data-holdform hidden><label class="is-wide">为什么暂不处理<input class="n-score__why" name="reason" placeholder="写一句原因，比如：上周刚聊过，他在准备转岗" required></label>
          <div class="n-signal__formbar"><button class="n-btn n-btn--sm n-btn--ink" type="submit" disabled data-holdok>确认暂不处理</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel>取消</button></div></form>`;
    } else {
      const r = sig.result;
      const body = sig.state === 'talk' ? html`<div class="n-signal__todo"><span class="n-badge">待沟通</span><b>${st.person(r.who).name}和${p.name}聊一次</b><span>${r.when}</span></div><p>聊完在这里记一笔，沟通结果会作为一条事件回到${p.name}的档案，这几条信号随之收起。</p><div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" data-talked>记录沟通结果</button></div>`
        : sig.state === 'hold' ? html`<p class="n-signal__reason"><span class="n-badge">暂不处理</span><span class="ink-hand">${r.reason}</span></p><p>信号保留在档案里；有新的信号出现时会重新提示。</p>`
          : html`<div class="n-signal__todo"><span class="n-badge n-badge--yes">${icon('check')}已沟通</span><b>${r.note}</b></div>${r.action ? html`<p>已生成行动：<a href="actions.html#${r.action}">${st.get().actions.find((a) => a.id === r.action)?.title || '查看行动'}</a></p>` : ''}`;
      tail = html`<div class="n-signal__result">${body}<div class="n-block__by"><span class="n-block__sig">${st.person(r.by).name}</span>${NT.md(r.at)}</div>${sig.state !== 'acted' ? html`<button type="button" class="n-signal__undo" data-reopen>撤销</button>` : ''}</div>`;
    }
    return html`<article class="n-card n-signal ${sig.state !== 'open' ? 'is-resolved' : ''}" id="signal" data-sig="${sig.person}">
      <header class="n-signal__head"><h3 class="n-section-title" style="margin:0">值得聊一聊</h3><span class="n-signal__vis">${icon('lock')}CEO、归属 HRBP、直属负责人可见</span></header>
      <p class="n-signal__sub" style="margin-top:var(--s-2)">下面 ${sig.items.length} 条信号都能核实，放在一起看，可能值得找${p.name}聊一次。这不是对心态的判断。</p>
      <ul class="n-signal__list">${items}</ul>${tail}</article>`;
  };
  UI.wireSignal = (host, rerender) => {
    host.addEventListener('click', async (e) => {
      const card = e.target.closest('[data-sig]'); if (!card) return;
      const sig = st.get().signals.find((s) => s.person === card.dataset.sig);
      const from = e.target.closest('[data-from]');
      if (from) { const open = from.getAttribute('aria-expanded') !== 'true'; from.setAttribute('aria-expanded', open); from.nextElementSibling.hidden = !open; return; }
      const show = (f) => { NT.$('[data-acts]', card).hidden = true; NT.$('[data-talkform]', card).hidden = f !== 'talk'; NT.$('[data-holdform]', card).hidden = f !== 'hold'; };
      if (e.target.closest('[data-talk]')) show('talk');
      if (e.target.closest('[data-hold]')) { show('hold'); NT.$('[data-holdform] input', card).focus(); }
      if (e.target.closest('[data-cancel]')) { NT.$('[data-acts]', card).hidden = false; NT.$('[data-talkform]', card).hidden = true; NT.$('[data-holdform]', card).hidden = true; }
      if (e.target.closest('[data-reopen]')) { sig.state = 'open'; delete sig.result; st.save(); rerender(); }
      if (e.target.closest('[data-talked]')) {
        const r = await NT.dialog({ title: '记录沟通结果', body: html`<label class="n-field"><span class="n-field__label">聊了什么、结论是什么</span><textarea class="n-textarea ink-hand" id="tk-note" style="font-size:var(--t-md)" placeholder="比如：本人想换个方向，对灰度发布有兴趣，愿意试 3 个月。"></textarea></label>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存到档案', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#tk-note').value.trim(), read: (d) => d.querySelector('#tk-note').value.trim() }] });
        if (r?.value === 'ok') {
          sig.state = 'acted'; sig.result = { ...sig.result, note: r.data, at: NT.TODAY, by: st.me().id };
          st.addEvent({ id: NT.uid('e'), kind: 'obs', date: NT.TODAY, recorder: st.me().id, people: [sig.person], title: '「值得聊一聊」后的沟通', bg: '档案里出现了几条可核实的信号，安排了一次沟通。', act: r.data, res: '', srcs: [{ type: 'note', label: '沟通记录', loc: NT.md(NT.TODAY), quote: r.data }], tags: [], scores: [] });
          rerender(); NT.toast('沟通结果已回到档案时间线');
        }
      }
    });
    host.addEventListener('input', (e) => { const i = e.target.closest('[data-holdform] input'); if (i) i.closest('form').querySelector('[data-holdok]').disabled = !i.value.trim(); });
    host.addEventListener('submit', (e) => {
      const card = e.target.closest('[data-sig]'); if (!card) return;
      e.preventDefault();
      const sig = st.get().signals.find((s) => s.person === card.dataset.sig);
      const f = new FormData(e.target);
      if (e.target.matches('[data-talkform]')) { sig.state = 'talk'; sig.result = { who: f.get('who'), when: f.get('when'), by: st.me().id, at: NT.TODAY }; }
      else { const reason = String(f.get('reason') || '').trim(); if (!reason) return; sig.state = 'hold'; sig.result = { reason, by: st.me().id, at: NT.TODAY }; }
      st.save(); rerender();
    });
  };

  // 重置演示数据：只清本浏览器里的演示状态，评审评论在服务器上不受影响
  NT.resetDemo = async () => {
    const v = await NT.dialog({
      title: '重置演示数据？', body: html`<p>你在本浏览器里做过的确认、校准、方案和记录都会清空，回到初始的演示数据。评审评论保存在服务器上，不受影响。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '重置', value: 'ok', cls: 'n-btn--ink', icon: 'retry' }],
    });
    if (v !== 'ok') return;
    st.reset();
    location.reload();
  };
})();
