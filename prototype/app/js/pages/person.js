/* 人员档案：摘要、个人能力谱、小象限与校准轨迹、值得聊一聊、档案版本与变化、时间线、参与的项目、重点跟踪。
   按视角逐块过滤：员工看不到分数和象限，导师看不到象限、变化、管理观察。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, raw, icon, mount, $, $$ } = NT;
  const pid = NT.param('id') || st.me().id;
  let ver = 'now';

  NT.shell({
    nav: 'people', title: st.person(pid)?.name || '人员档案', crumbs: st.role() === 'self' ? [] : [['人才', 'people.html']],
    allow: () => !!st.scope(pid),
    denyTitle: '你没有查看这个人的权限',
    denyText: '档案只对 CEO、归属 HRBP、范围内的负责人和所带学员的导师开放。切换演示视角，或回到人才列表。',
    view: () => `档案 · ${ver === 'now' ? '当前版本' : ver}`,
    state: () => ({ ver }),
    restore: (s) => { if (s.ver) { ver = s.ver; render($('#main')); } },
    render,
  });

  function render(main) {
    const p = st.person(pid), role = st.role(), scope = st.scope(pid);
    if (scope === 'self') return renderSelf(main, p);
    const S = st.get();
    const canScore = st.can('scores', pid), canQuad = st.can('quad', pid), canSig = st.can('signals', pid), canChg = st.can('changes', pid), mgmt = st.can('mgmt', pid);
    const land = st.landingOf(pid);
    const projs = st.projectsOf(pid, true);
    const { events, hidden: hiddenN } = st.visibleEvents(pid);
    const sig = canSig && S.signals.find((s) => s.person === pid);
    const tracks = S.tracks.filter((t) => t.person === pid);
    const changes = canChg ? st.changes().filter((c) => c.person === pid) : [];
    const snapsWith = st.snaps().filter((s) => s.entries[pid]);
    const verSnap = ver !== 'now' ? snapsWith.find((s) => s.id === ver) : null;
    const f = st.formal(pid), ref = st.refPos(pid);
    const spec = canScore ? UI.spectrum(pid) : null;
    const obsN = events.filter((e) => e.kind === 'obs').length;

    mount(main, html`
      <header class="nt-head" style="align-items:center">
        ${UI.person(pid, { size: 'lg', link: false, meta: `${st.orgPath(p.org)} · ${p.title} · ${p.level}`, meta2: `${st.tenure(p)}${land ? ` · ${land.batch.name} · 议题「${st.project(land.row[1]).name}」 · 导师 ${land.row[2].map((m) => st.person(m).name).join('、')}` : ''}${p.merged ? ' · SDR 与 SMB 并入（10-20）' : ''}` })}
        <div class="nt-head__acts">
          ${st.can('record', pid) ? html`<a class="n-btn n-btn--sm n-btn--ink" href="record.html?person=${pid}">${icon('pen')}记一条事件</a>` : ''}
          ${canQuad && !tracks.some((t) => t.state === 'on') ? html`<button class="n-btn n-btn--sm" type="button" id="btn-track">${icon('target')}重点跟踪</button>` : ''}
          ${st.can('record', pid) ? html`<a class="n-btn n-btn--sm n-btn--ghost" href="index.html#upload">${icon('upload')}上传材料</a>` : ''}
        </div>
      </header>

      ${canQuad && snapsWith.length ? html`<div class="n-pver" style="margin-bottom:var(--s-4)">
        <span class="n-pver__label">档案版本</span>
        <div class="n-seg" role="group" aria-label="档案版本" data-manual id="pver">
          <button type="button" data-v="now" aria-pressed="${ver === 'now'}">当前</button>
          ${snapsWith.map((s) => html`<button type="button" data-v="${s.id}" aria-pressed="${ver === s.id}">${s.label} · 已冻结</button>`)}
        </div>
        <span class="n-pver__label">${verSnap ? `${NT.md(verSnap.at)} 冻结 · 包含 ${NT.md(verSnap.cutoff)} 前已确认的事件 · 之后的新事件不会改写它` : `实时更新 · 包含 ${NT.md(NT.TODAY)} 前已确认的事件`}</span>
        ${verSnap ? html`<div class="n-pver__cmp">${verCompare(verSnap.entries[pid], ref, f)}</div>` : ''}
      </div>` : ''}

      <div class="nt-split nt-split--wide">
        <div class="nt-grid">
          ${summaryBlock(p, events, canScore, ref, f, canQuad)}
          <div id="dirwrap">${UI.directionBlock(pid, { canWrite: mgmt ? 'mgmt' : '' })}</div>
          ${spec ? html`<article class="n-card n-spectrum" id="spectrum">
            <div class="n-spectrum__head"><div><h3 class="n-section-title" style="margin:0">个人能力谱</h3><div class="nt-muted">近 12 个月 · 已确认 ${spec.total} 条事件分 · rubric-v1</div></div>${canQuad ? UI.miniquad(pid) : ''}</div>
            <div class="n-spectrum__scale"><span></span><div class="n-spectrum__ticks">${[1, 2, 3, 4, 5].map((v, i) => html`<span style="left:${i * 25}%">${v}</span>`)}</div><span></span></div>
            <div id="spec-rows">${spec.html}</div>
            <div class="n-spectrum__legend"><span><i class="k-all"></i>外圈：这个分值的全部事件</span><span><i class="k-recent"></i>实心：其中近 3 个月</span><span><i class="k-mean"></i>均值</span><span><i class="k-unknown"></i>资料不足</span><span>点一行展开事件</span></div>
          </article>` : ''}

          <article class="n-card" id="timeline">
            <h3 class="n-section-title">时间线<small class="nt-muted" style="font-weight:400;margin-left:auto">${obsN} 条关键事件 · 按事件真实发生的时间</small></h3>
            ${timeline(events, changes, verSnap)}
            ${hiddenN ? html`<div class="n-lock" style="margin-top:var(--s-3)">${icon('lock')}另有 ${hiddenN} 条${role === 'mentor' ? '管理观察或管理受限资料，对导师不可见' : '与你负责的项目无关的资料，不在你的查看范围'}。</div>` : ''}
          </article>
        </div>

        <aside class="nt-grid">
          ${canQuad ? html`<article class="n-card"><h3 class="n-section-title">能力象限</h3>
            <dl class="nt-dl"><dt>正式位置</dt><dd>${f ? html`${UI.qBadge(f.q)} <span class="nt-muted">${f.snap.label} 校准 · ${NT.md(f.snap.at)} · ${st.person(f.snap.by).name}确认</span>` : html`<span class="nt-muted">还没有正式校准</span>`}</dd>
              <dt>参考位置</dt><dd>${ref.na ? html`${UI.na()} <span class="nt-muted">${ref.miss}</span>` : html`<span class="n-badge n-badge--ai">${icon('spark')}${st.QN[ref.q]}</span>${ref.bonus ? html` <span class="n-badge">加分项 ≥ 4</span>` : ''}`}</dd></dl>
            ${st.needsRecal(pid) ? html`<div class="n-notice" style="margin-top:var(--s-3)">${icon('split')}<div><b>可能需要重新校准。</b>冻结后新增的已确认事件让参考位置移到了「${st.QN[ref.q]}」。正式位置不会自动移动。<div class="nt-row" style="margin-top:var(--s-2)"><a class="n-btn n-btn--sm" href="calibrate.html?id=b-h2&team=${p.org}">加入下次校准</a></div></div></div>` : ''}
            ${ref.na ? html`<p class="nt-caption">资料不足不等于能力低，不会被放进低潜力。落位门槛：每条轴至少 2 条来自不同事件的已确认分数，潜力核心三项至少两项有分。</p>` : ''}
          </article>` : role === 'mentor' ? html`<div class="n-lock">${icon('lock')}导师看不到象限、变化和「值得聊一聊」。</div>` : ''}

          ${changes.length ? html`<article class="n-card"><h3 class="n-section-title">变化标记</h3><div id="pchanges">${changes.map((c) => UI.change(c, 'win'))}</div></article>` : ''}
          ${sig ? html`<div id="sigwrap">${UI.signalBlock(sig)}</div>` : ''}
          ${tracks.length ? html`<div id="trackwrap" class="nt-grid">${tracks.map((t) => UI.trackCard(t))}</div>` : ''}

          <article class="n-card"><h3 class="n-section-title">参与的项目</h3>
            ${projs.length ? html`<ul class="n-members">${projs.map((m) => html`<li class="${m.to ? 'is-left' : ''}"><a class="nt-plink" href="project.html?id=${m.p.id}"><b>${m.p.name}</b></a><span class="n-members__role">${m.role} · ${m.mode}</span><span class="n-members__when">${NT.md(m.from)}${m.to ? ` – ${NT.md(m.to)}` : ' 起'}</span></li>`)}</ul>` : html`<div class="nt-empty">还没有参与项目。</div>`}
          </article>
          ${mgmt ? correctionsBlock(p) : ''}
        </aside>
      </div>`);

    if (spec) UI.wireSpectrum($('#spec-rows'));
    UI.wireDirection($('#dirwrap'), pid, () => render(main));
    if ($('#pchanges')) UI.wireChanges($('#pchanges'));
    if ($('#sigwrap')) UI.wireSignal($('#sigwrap'), () => render(main));
    if ($('#trackwrap')) UI.wireTracks($('#trackwrap'), () => render(main));
    $('#pver')?.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; ver = b.dataset.v; render(main); });
    $('#btn-track')?.addEventListener('click', () => startTrack());
    wireTimeline(main);
    wireSummary(main);
    UI.mountIPs(main);
    if (NT.param('track') && !tracks.some((t) => t.state === 'on') && !render.asked) { render.asked = true; startTrack(); }
  }

  async function startTrack() {
    const r = await UI.trackDialog(pid);
    if (!r) return;
    // 从「验证」推动进来时，跟踪关联到推动并给推动记一笔进展（v1.4 3.21.1）
    const push = st.pushOf(NT.param('push')), fromPush = push && push.person === pid && push.owner === st.me().id && ['todo', 'doing'].includes(push.state);
    const t = { id: NT.uid('t'), person: pid, ...r, owner: st.me().id, helper: null, since: NT.TODAY, state: 'on', ...(fromPush ? { push: push.id } : {}) };
    st.get().tracks.unshift(t); st.save();
    const prevState = push?.state;
    if (fromPush) st.logPush(push.id, `已设为重点跟踪：${r.q || '观察问题见跟踪卡'}`);
    render($('#main'));
    NT.toast(`已开始跟踪${st.person(pid).name}${fromPush ? '，CEO 能在推动里看到这笔进展' : ''}`, { undo: () => { st.get().tracks.shift(); if (fromPush) { push.log.pop(); push.state = prevState; } st.save(); render($('#main')); } });
  }

  function verCompare(e, ref, f) {
    const d = (k) => { const a = e.dims?.[k]?.m, b = ref.dims?.[k]?.m; if (a == null && b == null) return '—'; return `${a == null ? '无' : a.toFixed(1)} → ${b == null ? '无' : b.toFixed(1)}`; };
    return html`<div>正式位置<b>${e.q ? st.QN[e.q] : '资料不足'} → ${f ? st.QN[f.q] : '—'}</b></div><div>参考位置<b>${e.ref ? st.QN[e.ref] : '资料不足'} → ${ref.na ? '资料不足' : st.QN[ref.q]}</b></div>
      <div>已确认事件分<b>${e.n} → ${ref.n} 条</b></div>${['prof', 'mot', 'wis', 'grit'].map((k) => html`<div>${st.dim(k).name}均值<b>${d(k)}</b></div>`)}`;
  }

  // AI 摘要：光；采纳后落墨并署名
  function summaryBlock(p, events, canScore, ref, f, canQuad) {
    const S = st.get();
    const saved = st.summaryFor(pid);
    const obs = events.filter((e) => e.kind === 'obs' && e.date);
    const tags = {}; obs.forEach((e) => (e.tags || []).forEach((t) => { tags[t] = (tags[t] || 0) + 1; }));
    const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
    const recent = obs.filter((e) => e.date >= NT.addDays(NT.TODAY, -90)).length;
    const self = events.find((e) => e.kind === 'self');
    let text = `近 12 个月有 ${obs.length} 条关键事件，其中近 3 个月 ${recent} 条${topTags.length ? `；常出现的标签是${topTags.map((t) => `「${t}」`).join('、')}` : ''}。`;
    // 两轴均值和落位缺口都是象限信息，只给能看象限的人
    if (canQuad && !ref.na) text += `已确认的分数里，专业度均值 ${ref.px.toFixed(1)}，潜力核心均值 ${ref.py.toFixed(1)}。`;
    if (canQuad && ref.na) text += `落位还差：${ref.miss}。`;
    if (self) text += `本人说过${self.title}`;
    if (canQuad && st.needsRecal(pid)) text += `冻结后的新事件让参考位置离开了正式象限，建议在下次校准时讨论。`;
    if (saved) return html`<div class="n-block" data-state="ink" id="summary">${saved.text}<div class="n-block__by"><span class="n-block__sig">${st.person(saved.by).name}</span>${NT.md(saved.at)} 采纳 AI 摘要</div></div>`;
    return html`<div><div class="n-block" data-state="light" id="summary"><span id="sum-text">${text}</span><div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}AI 摘要</span>依据 ${obs.length} 条事件 · 只用你有权限查看的资料</div></div>
      ${st.role() !== 'mentor' ? html`<div class="nt-row" style="margin-top:var(--s-2);padding-left:var(--s-5)" id="sum-acts"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-sum="ok">${icon('check')}采纳</button><button class="n-btn n-btn--sm" type="button" data-sum="edit">${icon('pen')}改写</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-sum="drop">删去</button></div>` : ''}</div>`;
  }
  function wireSummary(main) {
    const acts = $('#sum-acts'); if (!acts) return;
    const block = $('#summary'), text = $('#sum-text');
    acts.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sum]'); if (!b) return;
      if (b.dataset.sum === 'edit') { text.contentEditable = 'plaintext-only'; text.classList.add('n-edit'); text.focus(); b.dataset.sum = 'ok'; b.innerHTML = '<svg><use href="#i-check"/></svg>改好了，采纳'; return; }
      if (b.dataset.sum === 'drop') { block.parentElement.remove(); NT.toast('已删去这段摘要', { undo: () => render(main) }); return; }
      block.dataset.state = 'ink'; block.classList.add('is-settling'); text.contentEditable = 'false';
      st.adoptSummary(pid, text.textContent, st.can('quad', pid));
      $('.n-block__by', block).innerHTML = `<span class="n-block__sig">${NT.esc(st.me().name)}</span>刚刚采纳 AI 摘要`;
      acts.remove();
    });
  }

  function timeline(events, changes, verSnap) {
    const items = [];
    events.forEach((e) => items.push({ date: e.date, e }));
    changes.filter((c) => c.t === 'trend' || c.t === 'quad').forEach((c) => items.push({ date: c.when, c }));
    const known = items.filter((i) => i.date).sort((a, b) => b.date.localeCompare(a.date));
    const unknown = items.filter((i) => !i.date);
    let month = '';
    const out = [];
    known.forEach((it) => {
      const m = it.date.slice(0, 7);
      const label = it.date < '2026-01-01' ? '更早' : NT.monthLabel(it.date);
      if (label !== month) { month = label; out.push(html`<li class="n-tl__month">${label}</li>`); }
      out.push(item(it, verSnap && it.date > verSnap.cutoff));
      void m;
    });
    if (unknown.length) { out.push(html`<li class="n-tl__month">时间未知</li>`); unknown.forEach((it) => out.push(item(it))); }
    return out.length ? html`<ol class="n-tl">${out}</ol>` : html`<div class="nt-empty">还没有记录。</div>`;
  }
  function item(it, after) {
    const style = after ? raw(' style="opacity:.4" title="这条在所选档案版本冻结之后，不在该版本里"') : '';
    if (it.c) {
      const c = it.c;
      return html`<li class="n-tl__item"${style}><span class="n-tl__date">${NT.md(c.when)}</span><span class="n-tl__dot is-change"></span><div class="n-tl__body"><div class="n-tl__title">${c.what}</div><div class="n-tl__meta">${c.from != null ? html`<span class="n-delta"><s>${c.from.toFixed(1)}</s>${icon(c.up ? 'up-r' : 'down-r')}${c.to.toFixed(1)}</span>近 3 个月 ${c.n} 条 · 对比之前 9 个月` : c.sub} <span class="n-rule">${icon('flag')}${c.rule}</span></div></div></li>`;
    }
    const e = it.e;
    const dot = e.kind === 'hist' ? 'is-hist' : e.kind === 'self' ? 'is-self' : '';
    const isUnknown = !e.date;
    const proj = e.project && st.project(e.project);
    let meta;
    if (e.kind === 'hist') meta = html`${e.restricted ? html`<span class="n-badge">${icon('lock')}管理受限</span><span class="n-badge">含评价成分</span>不当作客观事实` : html`${UI.src(e.group ? 'fact' : 'hist')}${e.srcs[0]?.label} · ${e.srcs[0]?.loc}${e.group ? ` · 挂在项目「${proj?.name}」上` : ''}`}`;
    else if (e.kind === 'self') meta = html`${UI.src('self')}${e.srcs[0]?.label} ${e.srcs[0]?.loc}`;
    else meta = html`${UI.src('obs')}${e.push ? html`<span class="n-badge">${icon('flag')}来自 CEO 推动</span>` : ''}${st.person(e.recorder)?.name} · ${e.srcs.length > 1 ? html`<b style="color:var(--ink-2)">${e.srcs.length} 个来源</b>（同一件事，只计一次）` : e.srcs[0] ? `${e.srcs[0].label}` : '直接记录'}${e.people.length > 1 ? html` · 多人事件 · ${e.people.map((x) => `${st.person(x).name}${e.roles?.[x] ? `（${e.roles[x]}）` : ''}`).join('、')} · 各自按本人行为打分` : ''}${proj ? ` · ${proj.name}` : ''}`;
    const scores = e.kind === 'obs' && st.can('scores', pid) ? e.scores.filter((s) => s.p === pid) : [];
    const pending = scores.filter((s) => s.st === 'ai').length, conflict = scores.some((s) => s.st === 'conflict');
    return html`<li class="n-tl__item ${isUnknown ? 'is-unknown' : ''}" id="ev-${e.id}"${style}><span class="n-tl__date">${isUnknown ? '未知' : e.kind === 'hist' && e.restricted ? 'H1' : NT.md(e.date)}</span><span class="n-tl__dot ${dot}"></span><div class="n-tl__body">
      <div class="n-tl__title">${e.kind === 'obs' ? html`<button class="nt-tl-open" type="button" aria-expanded="false">${e.title}</button>` : e.title}${pending ? html` <span class="n-badge n-badge--ai">${icon('spark')}${pending} 项待确认</span>` : ''}${conflict ? html` <span class="n-badge n-badge--conflict">${icon('split')}待校准</span>` : ''}</div>
      <div class="n-tl__meta">${meta}${isUnknown && st.can('record', pid) ? html` · <button class="n-btn n-btn--sm n-btn--ghost" type="button" data-date="${e.id}" style="min-height:22px;padding:0 6px">补上时间</button>` : ''}</div>
      ${e.scale ? html`<div class="n-scale">${e.scale.map(([k, v]) => html`<span>${k} ${v}</span>`)}</div>${e.kind === 'hist' && !e.restricted ? html`<div class="n-tl__note">${e.group ? '这是小组的评分，不复制成每位成员的个人分。' : '保留原量表，不换算成 1–5 的维度分，也不参与象限。AI 打分时可以引用其中的文字评价。'}</div>` : ''}` : ''}
      ${e.kind === 'obs' ? html`<div class="nt-tl-card" hidden>${UI.eventCard(e, { for: pid })}</div>` : ''}
    </div></li>`;
  }
  function wireTimeline(main) {
    const tl = $('#timeline'); if (!tl) return;
    tl.addEventListener('click', async (e) => {
      const b = e.target.closest('.nt-tl-open');
      if (b) { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', open); b.closest('.n-tl__body').querySelector('.nt-tl-card').hidden = !open; return; }
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
      const d = e.target.closest('[data-date]');
      if (d) {
        const r = await NT.dialog({ title: '补上时间', body: html`<p>一对一记录里没说是哪一次。补上之后，这条事件才会参与「近 3 个月」的统计和象限计算。</p><label class="n-field" style="margin-top:var(--s-3)"><span class="n-field__label">大约什么时候</span><input class="n-input" type="date" id="dd" value="2026-10-16" max="${NT.TODAY}"></label>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存', value: 'ok', cls: 'n-btn--ink', read: (x) => x.querySelector('#dd').value }] });
        if (r?.value === 'ok' && r.data) { st.event(d.dataset.date).date = r.data; st.save(); render(main); NT.toast('时间已补上，时间线和统计随之更新'); }
      }
    });
    // 从能力谱点到某条事件时展开它
    if (location.hash.startsWith('#ev-')) { const li = document.getElementById(location.hash.slice(1)); li?.querySelector('.nt-tl-open')?.click(); }
    if (main.dataset.wired) return;
    main.dataset.wired = 1;
    main.addEventListener('click', (e) => {
      const fix = e.target.closest('[data-fix]'), rep = e.target.closest('[data-reply]');
      if (fix || rep) {
        const c = st.get().corrections.find((x) => x.id === (fix || rep).dataset.fix || x.id === (fix || rep).dataset.reply);
        c.done = true; st.save(); render(main);
        NT.toast(fix ? '已按纠错修改，原记录和理由都保留' : '已回复说明，纠错关闭');
        return;
      }
      const a = e.target.closest('a[href^="#ev-"]'); if (!a) return;
      const li = document.getElementById(a.getAttribute('href').slice(1));
      const btn = li?.querySelector('.nt-tl-open');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
    });
  }

  function correctionsBlock(p) {
    const list = st.get().corrections.filter((c) => c.person === p.id && !c.done);
    if (!list.length) return '';
    return html`<article class="n-card"><h3 class="n-section-title">本人纠错</h3>${list.map((c) => html`<div class="n-notice is-plain" data-corr="${c.id}">${icon('info')}<div><b>${p.name}提出：</b>${c.text}<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-fix="${c.id}">按纠错修改</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-reply="${c.id}">回复说明</button></div></div></div>`)}<p class="nt-caption">修改后保留原记录和修改理由。</p></article>`;
  }

  // 员工本人：只看本人经历、参与的项目和发布给本人的行动；能补充、能纠错，不能改别人的观察和管理结论
  function renderSelf(main, p) {
    const S = st.get();
    const own = S.events.filter((e) => e.people.includes(p.id) && e.kind === 'self').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const projs = st.projectsOf(p.id, true);
    const pub = S.pubActions.filter((a) => a.person === p.id);
    const corr = S.corrections.filter((c) => c.person === p.id);
    const add = NT.param('add');
    mount(main, html`
      <header class="nt-head" style="align-items:center">${UI.person(p.id, { size: 'lg', link: false, meta: `${st.orgPath(p.org)} · ${p.title} · ${p.level}`, meta2: `${st.tenure(p)} · Landing 第三期` })}</header>
      <div class="nt-split">
        <div class="nt-grid">
          <article class="n-card" id="self"><h3 class="n-section-title">我的经历</h3>
            <div class="n-self__acts">
              <button class="n-btn n-btn--sm" type="button" data-add="exp">${icon('plus')}补充经历</button>
              <button class="n-btn n-btn--sm" type="button" data-add="will">${icon('quote')}写意愿</button>
              <button class="n-btn n-btn--sm n-btn--ghost" type="button" data-add="fix">${icon('pen')}提出纠错</button>
            </div>
            <div id="self-form"></div>
            <ol class="n-tl">${projs.map((m) => html`<li class="n-tl__item"><span class="n-tl__date">${NT.md(m.from)}</span><span class="n-tl__dot is-hist"></span><div class="n-tl__body"><div class="n-tl__title">${m.to ? '参与' : '加入'}「${m.p.name}」</div><div class="n-tl__meta">${UI.src('fact')}项目成员记录 · ${m.role} · ${m.mode}${m.to ? ` · ${NT.md(m.to)} 结束` : ''}</div></div></li>`)}
              ${own.map((e) => html`<li class="n-tl__item"><span class="n-tl__date">${NT.md(e.date)}</span><span class="n-tl__dot is-self"></span><div class="n-tl__body"><div class="n-tl__title">${e.title}</div><div class="n-tl__meta">${UI.src('self')}${e.srcs[0]?.label} ${e.srcs[0]?.loc || ''}</div></div></li>`)}
              ${corr.map((c) => html`<li class="n-tl__item"><span class="n-tl__date">${NT.md(c.at)}</span><span class="n-tl__dot"></span><div class="n-tl__body"><div class="n-tl__title">我提出的纠错：${c.text}</div><div class="n-tl__meta">${c.done ? '已处理' : '等录入人处理'}</div></div></li>`)}</ol>
          </article>
        </div>
        <aside class="nt-grid">
          <div id="dirwrap">${UI.directionBlock(p.id, { canWrite: 'self' })}</div>
          <article class="n-card"><h3 class="n-section-title">发布给你的</h3>${pub.map((a) => html`<div class="n-pubaction" style="margin-bottom:var(--s-2)"><div>${a.title}<small>${st.person(a.by).name}发布给你 · ${NT.md(a.at)}</small></div><span class="n-astate" data-s="todo">待安排</span></div>`)}</article>
          <div class="n-lock">${icon('lock')}维度分、象限、他人的评价和「值得聊一聊」对本人不可见。</div>
          <article class="n-card"><h3 class="n-section-title">你问「我在哪个象限」</h3><div class="n-block" data-state="light" style="font-size:var(--t-sm)">象限信息对本人不可见，我不能回答这个问题。你可以看自己的经历和发布给你的安排，或者和 HRBP 聊聊。<div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}AI 回答</span>权限在服务端判断</div></div></article>
        </aside>
      </div>`);
    UI.wireDirection($('#dirwrap'), p.id, () => render(main));
    const form = $('#self-form');
    const open = (k) => {
      const label = { exp: '补充一段经历', will: '写下你的意愿', fix: '哪里写得不对' }[k];
      const ph = { exp: '比如：W2 的缓存问题，我后来写了一份排查笔记放在议题文档里。', will: '比如：下个阶段想离客户近一点，试试售前。', fix: '比如：10-15 的演示环境是我和陈一禾一起搭的，不是我一个人。' }[k];
      mount(form, html`<div class="n-card" style="box-shadow:var(--e-0);margin-bottom:var(--s-4)"><label class="n-eventin__label" style="margin-top:0" for="sf">${label}</label><textarea class="n-eventin__field" id="sf" style="min-height:90px" placeholder="${ph}"></textarea>
        <div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-save="${k}">${k === 'fix' ? '提交纠错' : '保存到我的档案'}</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-x>取消</button><span class="nt-muted">${k === 'fix' ? '纠错进入录入人的待办；修改后保留原记录和修改理由' : '作为「本人自述」保存，和他人的观察分开呈现'}</span></div></div>`);
      $('#sf').focus();
    };
    main.onclick = (e) => {
      const a = e.target.closest('[data-add]'); if (a) open(a.dataset.add);
      if (e.target.closest('[data-x]')) form.innerHTML = '';
      const sv = e.target.closest('[data-save]');
      if (sv) {
        const t = $('#sf').value.trim(); if (!t) { $('#sf').focus(); return; }
        if (sv.dataset.save === 'fix') S.corrections.unshift({ id: NT.uid('c'), person: p.id, text: t, at: NT.TODAY });
        else st.addEvent({ id: NT.uid('e'), kind: 'self', date: NT.TODAY, recorder: p.id, people: [p.id], title: `「${t}」`, srcs: [{ type: 'note', label: sv.dataset.save === 'will' ? '本人意愿' : '本人补充', loc: NT.md(NT.TODAY) }], tags: [], scores: [] });
        st.save(); render(main); NT.toast(sv.dataset.save === 'fix' ? '纠错已提交给录入人' : '已保存到你的档案');
      }
    };
    if (add && !form.dataset.opened) { form.dataset.opened = 1; open(add); }
  }
})();
