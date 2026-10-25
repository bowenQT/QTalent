/* 记录关键事件：一句话 → AI 整理成情境、行为、影响（SBI）→ 建议分逐项出现 → 确认或改分 → 保存（5 秒撤销）。
   ?m=w2 打开会议人才纪要（预先处理的演示任务）。员工视角只能补充本人自述，不打分。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, raw, icon, mount, $, $$ } = NT;
  const minutesId = NT.param('m');

  const { shape, findPeople, findProject } = NT.parse;

  NT.shell({
    nav: 'work', title: minutesId ? '会议人才纪要' : '记录关键事件', crumbs: [['工作台', 'index.html']],
    view: () => (minutesId ? `纪要 · ${$('[role="tab"][aria-selected="true"]')?.textContent || ''}` : `记录 · ${$('#ev')?.dataset.step || 'write'}`),
    state: () => ({ tab: $('[role="tab"][aria-selected="true"]')?.dataset.tab }),
    restore: (s) => { if (s.tab && tabsApi) tabsApi.pick(s.tab); },
    render(main) {
      if (minutesId) return renderMinutes(main);
      if (st.role() === 'self') return renderSelfNote(main);
      renderRecord(main);
    },
  });

  // ---------- 一句话记录 ----------
  function renderRecord(main) {
    const q = NT.param('q') || '';
    const pre = NT.param('person');
    mount(main, html`
      <header class="nt-head"><div><h1>记录关键事件</h1><p>写原话就行。AI 按情境、行为、影响整理，给涉及的维度打建议分，文字和分数都可以直接改。保存后 5 秒内可以撤销。</p></div></header>
      <div class="nt-split">
        <article class="n-card n-event" id="ev" data-step="write">
          <div class="n-event__head" id="ev-head"><span>谁</span><select class="n-select" id="ev-person" style="width:auto;min-height:30px" aria-label="记录给谁">
            <option value="">从原话里识别</option>${st.visiblePeople().filter((p) => st.can('record', p.id)).map((p) => html`<option value="${p.id}" ${pre === p.id ? 'selected' : ''}>${p.name} · ${st.orgShort(p.org)}</option>`)}</select>
            <span class="n-event__ip nt-ip" data-ip="rest" data-size="36" id="ev-ip"></span></div>
          <div id="ev-in">
            <label class="n-eventin__label" for="ev-text">说说这次发生了什么</label>
            <textarea class="n-eventin__field" id="ev-text" rows="5" placeholder="比如：唐果今天方案被问住了，第二天主动约了客服再访谈一次，周五带着新结构来评审。">${q}</textarea>
            <div class="n-eventin__bar">
              <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="ev-mic" aria-label="按住说话">${icon('mic')}</button>
              ${UI.attachButton()}
              <span class="n-eventin__hint" id="ev-hint">写原话就行，不用分段；可以附上 PDF、PPT、文档、表格、录音或视频，也可以直接拖进来</span>
              <button class="n-btn n-btn--light" type="button" id="ev-shape">${icon('spark')}整理成关键事件</button>
            </div>
          </div>
          <div id="ev-body" hidden></div>
          <ul id="ev-atts" hidden></ul>
        </article>
        <aside class="nt-grid nt-sticky">
          <div class="n-anchor" id="anchor"><b id="anchor-t">锚点</b> <span class="n-badge" style="margin-left:6px" id="anchor-v"></span><p class="nt-muted" id="anchor-fam" style="margin:4px 0 0" hidden></p><ol></ol>
            ${st.canSuggestRule() ? html`<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ghost" type="button" id="anchor-sug">${icon('note')}提修订建议</button></div><div id="my-sugs"></div>` : ''}</div>
          <div class="n-card" style="padding:var(--s-4) var(--s-5)"><b style="font-size:var(--t-sm)">怎么算一条关键事件</b>
            <p class="nt-caption">一件具体的事，按 SBI 讲：在什么情境下（S）、本人做了什么（B）、带来什么影响（I）。只写了「参与」的地方标为资料不足。多人参与的事，按各自的行为打分。</p></div>
        </aside>
      </div>`);
    // 附件：「改原话」或撤销保存回到这页时保留已解析的附件
    att = UI.attach({ key: 'record' }).list($('#ev-atts')).pick($('[data-att-pick]', $('#ev'))).drop($('#ev')).fallback(() => $('#ev-back'));
    if (q) att.restore(); else att.clear();
    $('#ev-shape').addEventListener('click', () => doShape());
    $('#ev-mic').addEventListener('click', () => {
      const f = $('#ev-text'); NT.ipState($('#ev-ip'), 'listening');
      NT.stream(f, '唐果今天方案被问住了，第二天主动约了客服再访谈一次，周五带着新结构来评审，结构清楚多了。', 38).then(() => NT.ipState($('#ev-ip'), 'confirm'));
    });
    if (q) setTimeout(() => doShape(), 300);
    anchorFor('mot');
    $('#anchor-sug')?.addEventListener('click', suggest);
    mySugs();
  }
  // 锚点面板：心性维度全公司一套；专业度按被记录人的岗位族，显示所用版本（v1.6 3.36）
  let anchorDim = 'mot', anchorV = null;
  function anchorFor(dimId, v) {
    anchorDim = dimId; anchorV = v ?? null;
    const d = st.dim(dimId), pid = draft?.pid || $('#ev-person')?.value || null, a = st.anchors(dimId, pid);
    $('#anchor-t').textContent = `${d.name} · 1–5 分锚点`;
    $('#anchor-v').textContent = a.v;
    const fam = $('#anchor-fam');
    fam.hidden = dimId !== 'prof' || !pid;
    if (!fam.hidden) fam.textContent = `${st.person(pid).name}属于${st.familyName(st.familyOf(pid))}族 · ${a.fam ? `${st.familyName(a.fam)}族锚点` : '这一版按通用锚点'}`;
    mount($('#anchor ol'), a.list.map((t, i) => html`<li data-v="${i + 1}" class="${v === i + 1 ? 'is-hit' : ''}"><b>${i + 1}</b>${t}</li>`));
  }
  // 提修订建议（v1.6 3.35.8）：选维度与锚点、写一句理由，可以引用一件事；进 HRBP 待办，不改变任何分数
  async function suggest() {
    const pid = draft?.pid || $('#ev-person')?.value || null;
    const evs = pid ? st.visibleEvents(pid).events.filter((e) => e.kind === 'obs').slice(0, 8) : [];
    const v = await NT.dialog({
      title: '提修订建议',
      body: html`<p>建议会进 HRBP 的待办，处理结果在这里能看到。分数保持原样。</p>
        <div class="nt-row" style="margin-top:var(--s-3)"><label class="nt-muted" for="sg-d">维度</label><select class="n-select" id="sg-d" style="width:auto">${st.dims.map((d) => html`<option value="${d.id}" ${NT.raw(d.id === anchorDim ? 'selected' : '')}>${d.name}</option>`)}</select>
          <label class="nt-muted" for="sg-l">锚点</label><select class="n-select" id="sg-l" style="width:auto">${[1, 2, 3, 4, 5].map((n) => html`<option value="${n}" ${NT.raw(n === (anchorV || 3) ? 'selected' : '')}>${n} 分</option>`)}</select></div>
        <label class="nt-muted" for="sg-t" style="display:block;margin-top:var(--s-3)">理由</label><textarea class="n-textarea" id="sg-t" rows="3" placeholder="比如：按期交付和遇到阻碍后坚持到有结果，都能落到 3 分"></textarea>
        ${evs.length ? html`<label class="nt-muted" for="sg-e" style="display:block;margin-top:var(--s-3)">引用一件事（可选）</label><select class="n-select" id="sg-e"><option value="">先空着</option>${evs.map((e) => html`<option value="${e.id}">${NT.md(e.date)} · ${e.title}</option>`)}</select>` : ''}`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '提交建议', value: 'ok', cls: 'n-btn--ink',
        validate: (dl) => { const ok = !!$('#sg-t', dl).value.trim(); if (!ok) $('#sg-t', dl).focus(); return ok; },
        read: (dl) => ({ dim: $('#sg-d', dl).value, level: +$('#sg-l', dl).value, text: $('#sg-t', dl).value.trim(), ev: $('#sg-e', dl)?.value || null }) }],
    });
    if (v?.value !== 'ok') return;
    const a = st.anchors(v.data.dim, pid); // 记下针对哪一套锚点、哪个版本，HRBP 处理时知道要改哪段文字
    const sg = st.addRuleSug({ ...v.data, person: pid, fam: v.data.dim === 'prof' ? a.fam || 'all' : null, ver: a.v });
    mySugs();
    NT.toast(`已提交给${st.person(st.roles.hrbp.person).name}，处理结果会显示在锚点下面`, { undo: () => { st.removeRuleSug(sg.id); mySugs(); } });
  }
  function mySugs() {
    const host = $('#my-sugs'); if (!host) return;
    const list = st.ruleSugs({ by: st.me().id });
    const S = { open: '待 HRBP 处理', adopted: '已纳入修订草稿', rejected: '不采纳' };
    mount(host, list.length ? html`<div style="margin-top:var(--s-2)">${list.map((x) => html`<div style="padding:var(--s-2) 0;border-top:1px solid var(--line);font-size:var(--t-xs);color:var(--ink-2)"><b>你的建议 · ${st.sugLabel(x)}</b> · ${S[x.state]}${x.state === 'rejected' && x.why ? `：${x.why}` : ''}<div class="nt-muted">「${x.text}」</div></div>`)}</div>` : '');
  }

  let draft = null, att = null;
  async function doShape() {
    const text = $('#ev-text').value.trim();
    if (!text) { $('#ev-text').focus(); return; }
    let pid = $('#ev-person').value;
    const found = findPeople(text);
    if (!pid) {
      if (found.hit.length) pid = found.hit[0].id;
      else if (found.hidden.length) { $('#ev-hint').innerHTML = `<span style="color:var(--no)">${NT.esc(found.hidden[0].name)}的事件由所属负责人记录。</span>换一个人，或请对方的负责人来记`; return; }
      else { $('#ev-hint').innerHTML = '<span style="color:var(--conflict)">这句话说的是谁？</span>在上面选一下，或在原话里写上名字'; $('#ev-person').focus(); return; }
    }
    const ev = $('#ev'), ip = $('#ev-ip');
    const proj = findProject(text);
    const s = shape(text, pid);
    draft = { pid, text, proj, ...s };
    ev.dataset.step = 'shaped';
    $('#ev-in').hidden = true;
    const body = $('#ev-body'); body.hidden = false;
    $('#ev-head').innerHTML = '';
    mount($('#ev-head'), html`${UI.avatar(pid, 'sm')}<b class="n-event__who">${st.person(pid).name}</b>${proj ? html`<span class="n-badge">${icon('folder')}${proj.type === 'Landing 议题' ? '议题' : '项目'}：${proj.name}</span>` : ''}${UI.demo()}${found.hit.length > 1 ? html`<span class="n-badge">也提到了${found.hit.slice(1).map((p) => p.name).join('、')} · 可另记一条</span>` : ''}<span class="n-event__ip nt-ip" data-ip="thinking" data-size="36" id="ev-ip"></span>`);
    UI.mountIPs($('#ev-head'));
    mount(body, html`
      <div style="margin:var(--s-3) 0">${UI.trail('整理这条记录 · 4 步', ['识别人员与项目', '拆出情境、行为、影响', '从标签库里打标签', '对照锚点给涉及的维度打建议分'])}</div>
      <h3 class="n-event__title"><span class="n-edit is-light" data-k="title" contenteditable="plaintext-only" spellcheck="false"></span></h3>
      <dl class="n-event__sbar">
        <dt>情境</dt><dd><span class="n-edit is-light" data-k="bg" contenteditable="plaintext-only" spellcheck="false"></span></dd>
        <dt>行为</dt><dd><span class="n-edit is-light" data-k="act" contenteditable="plaintext-only" spellcheck="false"></span></dd>
        <dt>影响</dt><dd><span class="n-edit is-light" data-k="res" contenteditable="plaintext-only" spellcheck="false"></span></dd>
      </dl>
      <div class="n-tags" id="ev-tags" hidden><span class="n-tags__label">标签</span><span class="n-tags__list" id="tag-list"></span><span class="n-tags__undo" id="tag-undo" hidden></span></div>
      <details class="n-event__raw"><summary>原话</summary><p>${text}</p></details>
      <div id="ev-att-slot"></div>
      <div class="n-event__scores" id="scores"></div>
      <div class="n-event__sign" id="ev-sign" hidden></div>
      <div class="nt-row" style="margin-top:var(--s-4)" id="ev-actions" hidden>
        <button class="n-btn n-btn--sm n-btn--ink" type="button" id="ev-save">${icon('check')}确认并保存</button>
        <button class="n-btn n-btn--sm n-btn--ghost" type="button" id="ev-back">改原话</button>
        <span class="n-eventin__hint" id="score-hint"></span>
      </div>`);
    $('#ev-att-slot').append($('#ev-atts'));
    const trail = $('.n-trail', body);
    const trailRun = NT.runTrail(trail, 520);
    const ph = { bg: '补充情境', res: '补充影响' };
    for (const el of $$('.n-edit', body)) {
      const t = s[el.dataset.k];
      if (!t) { el.textContent = ph[el.dataset.k] || ''; el.classList.remove('is-light'); el.style.color = 'var(--ink-3)'; el.dataset.empty = 1; continue; }
      await NT.stream(el, t, 18);
      await NT.wait(100);
    }
    $$('.n-edit', body).forEach((el) => el.addEventListener('input', () => { el.classList.remove('is-light'); el.style.color = ''; delete el.dataset.empty; }));
    await buildTags(s);
    await buildScores();
    await trailRun;
    NT.ipState($('#ev-ip'), 'confirm');
    $('#ev-actions').hidden = false; hint();
    $('#ev-save').addEventListener('click', save);
    $('#ev-back').addEventListener('click', () => { att.keep(); location.href = NT.link('record.html', { q: text }); });
  }
  async function buildTags(s) {
    const host = $('#tag-list'); $('#ev-tags').hidden = false;
    const chip = (t, cand) => {
      const c = document.createElement('span');
      c.className = `n-tag ${cand ? 'is-candidate' : 'is-ai'}`; c.textContent = t;
      if (cand) { c.title = '标签库里还没有这个标签，已列为候选，等 HRBP 决定是否收录'; c.insertAdjacentHTML('beforeend', '<small>候选</small>'); }
      else {
        const x = document.createElement('button'); x.type = 'button'; x.className = 'n-tag__x'; x.setAttribute('aria-label', `移除标签「${t}」`); x.innerHTML = '<svg><use href="#i-x"/></svg>';
        x.onclick = () => { const next = c.nextSibling; c.remove(); const u = $('#tag-undo'); u.hidden = false; u.innerHTML = `已移除「${NT.esc(t)}」<button type="button">撤销</button>`; u.querySelector('button').onclick = () => { host.insertBefore(c, next); u.hidden = true; }; };
        c.append(x);
      }
      return c;
    };
    for (const [t, cand] of [...s.tags.map((t) => [t, false]), ...s.cand.map((t) => [t, true])]) {
      const c = chip(t, cand); host.append(c);
      c.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: NT.reduced ? 1 : 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      await NT.wait(90);
    }
    if (!host.children.length) $('#ev-tags').hidden = true;
  }
  async function buildScores() {
    const host = $('#scores');
    for (const sc of draft.scores) {
      const d = st.dim(sc.d);
      const row = document.createElement('div');
      row.className = 'n-score'; row.dataset.state = sc.st === 'unknown' ? 'unknown' : 'ai';
      row.innerHTML = `<span class="n-score__dim">${d.name}</span><span class="n-score__dots" role="radiogroup" aria-label="${d.name}分数">${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="n-score__dot" role="radio" aria-label="${v} 分" data-v="${v}"></button>`).join('')}</span>${sc.st === 'unknown' ? '<span class="n-score__empty n-badge n-badge--unknown"><svg><use href="#i-dash"/></svg>资料不足</span>' : ''}<span class="n-score__note"></span>`;
      $('.n-score__note', row).textContent = sc.note;
      sc.row = row; host.append(row); paint(sc);
      row.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: NT.reduced ? 1 : 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
      $$('.n-score__dot', row).forEach((b) => {
        b.addEventListener('click', () => {
          if ($('#ev').dataset.step === 'done') return;
          sc.v = +b.dataset.v; sc.st = 'confirmed'; sc.edited = sc.ai != null && sc.v !== sc.ai; row.dataset.state = 'confirmed';
          paint(sc); why(sc); hint(); anchorFor(sc.d, sc.v);
        });
        b.addEventListener('mouseenter', () => anchorFor(sc.d, +b.dataset.v));
        b.addEventListener('focus', () => anchorFor(sc.d, +b.dataset.v));
      });
      if (sc.ai) anchorFor(sc.d, sc.ai);
      await NT.wait(260);
    }
  }
  function why(sc) {
    let input = $('.n-score__why', sc.row);
    if (!sc.edited) { input?.remove(); return; }
    if (!input) {
      input = document.createElement('input'); input.className = 'n-score__why';
      input.setAttribute('aria-label', `${st.dim(sc.d).name}改分理由`);
      sc.row.append(input); input.focus({ preventScroll: true });
      input.addEventListener('input', () => { sc.why = input.value; });
    }
    input.placeholder = `为什么改成 ${sc.v} 分？（可选）${Math.abs(sc.v - sc.ai) >= 2 ? ' 和 AI 差 2 分以上，请写一句理由；留空会转给 HRBP 复核' : ''}`;
  }
  function paint(sc) {
    $$('.n-score__dot', sc.row).forEach((b) => {
      const v = +b.dataset.v;
      b.classList.toggle('is-on', sc.v != null && v <= sc.v);
      b.classList.toggle('is-ghost', !!sc.edited && v <= sc.ai && v > sc.v);
      b.setAttribute('aria-checked', v === sc.v);
    });
    const note = $('.n-score__note', sc.row);
    if (sc.row.dataset.state === 'confirmed') note.innerHTML = sc.edited ? `<span class="n-score__delta">${sc.v > sc.ai ? '+' : ''}${sc.v - sc.ai}</span>AI 原为 ${sc.ai}` : sc.ai == null ? '你补的分' : '已确认';
  }
  function hint() {
    const left = draft.scores.filter((s) => s.row?.dataset.state === 'ai').length;
    const manual = draft.scores.filter((s) => s.reviewRequired && s.row?.dataset.state === 'ai').length;
    $('#score-hint').textContent = manual
      ? `还有 ${manual} 项低分候选须逐项确认；未确认将作为 AI 建议保留，不计入已确认分数`
      : left
        ? `文字可以直接改；还有 ${left} 项 AI 建议分，保存时一并确认` : '分数都已由你确认';
  }
  function save() {
    const me = st.me();
    const ev = $('#ev');
    const wait = att.pending();
    if (wait) { $('#score-hint').innerHTML = `<span style="color:var(--conflict)">还有 ${wait} 个附件在上传或解析，</span>完成后再保存`; return; }
    const val = (k) => { const el = $(`.n-edit[data-k="${k}"]`); return el.dataset.empty ? '' : el.textContent.trim(); };
    const { e, big } = NT.parse.commit({ ...draft, title: val('title'), bg: val('bg'), act: val('act'), res: val('res'),
      tags: $$('#tag-list .n-tag:not(.is-candidate)').map((c) => c.firstChild.textContent), cand: $$('#tag-list .is-candidate').map((c) => c.firstChild.textContent), atts: att.srcs() });
    ev.dataset.step = 'done';
    att.lock();
    draft.scores.forEach((s) => { if (s.row.dataset.state === 'ai' && !s.reviewRequired) { s.row.dataset.state = 'confirmed'; paint(s); } });
    $$('.n-edit', ev).forEach((el) => { el.classList.remove('is-light'); el.removeAttribute('contenteditable'); });
    $$('#tag-list .n-tag', ev).forEach((c) => { c.classList.remove('is-ai'); $('.n-tag__x', c)?.remove(); });
    $$('.n-score__why', ev).forEach((i) => { if (!i.value.trim()) i.remove(); else i.readOnly = true; });
    ev.classList.add('is-settling'); setTimeout(() => ev.classList.remove('is-settling'), 700);
    const sign = $('#ev-sign');
    mount(sign, html`<span class="ink-hand">${me.name}</span>${st.roles[st.role()].label} · 刚刚保存到${st.person(draft.pid).name}的档案 · <a href="person.html?id=${draft.pid}#ev-${e.id}">去档案看看</a>`);
    sign.hidden = false; $('#ev-actions').hidden = true;
    NT.ipState($('#ev-ip'), 'done');
    NT.toast(`已保存到${st.person(draft.pid).name}的档案${big ? `，${big} 项转给了 HRBP 复核` : ''}`, {
      undo: () => { st.removeEvent(e.id); att.keep(); location.href = NT.link('record.html', { q: draft.text, person: draft.pid }); }, undoneText: '已撤销，这条记录没有保存',
    });
  }

  // ---------- 员工本人：补充经历与自述 ----------
  function renderSelfNote(main) {
    const me = st.me();
    mount(main, html`<header class="nt-head"><div><h1>补充经历</h1><p>你写下的内容作为「本人自述」进入档案，和他人的观察分开呈现。</p></div></header>
      <article class="n-card" style="max-width:640px"><label class="n-eventin__label" for="self-text">想补充什么</label>
        <textarea class="n-eventin__field" id="self-text" placeholder="比如：10-15 的演示环境是我和陈一禾一起搭的。"></textarea>
        <div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--ink n-btn--sm" type="button" id="self-save">保存到我的档案</button><span class="nt-muted">保存后录入人和 HRBP 能看到</span></div></article>`);
    $('#self-save').onclick = () => {
      const t = $('#self-text').value.trim(); if (!t) return;
      st.addEvent({ id: NT.uid('e'), kind: 'self', date: NT.TODAY, recorder: me.id, people: [me.id], title: `「${t}」`, srcs: [{ type: 'note', label: '本人补充', loc: NT.md(NT.TODAY) }], tags: [], scores: [] });
      location.href = `person.html?id=${me.id}`;
    };
  }

  // ---------- 会议人才纪要 ----------
  let tabsApi = null;

  function renderMinutes(main) {
    const m = NT.SEED.MINUTES[minutesId];
    if (!m || !st.canOpenMinutes(minutesId)) { mount(main, UI.state({ ip: 'confirm', title: '这份纪要属于其他视角', text: '会议纪要仅录入人、这一批的导师、学员的归属 HRBP 和 CEO 可见。' })); return; }
    const S = st.get();
    const evs = m.events.map((id) => st.event(id)).filter(Boolean);
    const verify = S.inbox.filter((i) => i.src === m.title);
    const bars = Array.from({ length: 80 }, (_, i) => i);
    const durS = 42 * 60 + 10;
    mount(main, html`
      <header class="nt-head"><div><h1>${m.title}</h1><p>${m.mode} · ${m.dur} · ${st.person(m.by).name}录制 · ${NT.md(m.at)} · 关联「${st.batch(m.batch).name}」</p></div>
        <div class="nt-head__acts"><span class="n-badge n-badge--preset">预先处理的演示任务</span></div></header>
      <div class="nt-split nt-split--wide">
        <article class="n-card">
          <div class="n-player" style="margin-bottom:var(--s-4)"><button class="n-player__play nt-play" type="button" aria-label="播放">${icon('play')}</button><div class="n-player__track" id="track">${bars.map((i) => raw(`<i class="${m.marks.some((t) => Math.abs(t / durS * 80 - i) < 0.6) ? 'is-mark' : ''}" style="height:${30 + Math.round(Math.abs(Math.sin(i * 1.7)) * 70)}%"></i>`))}</div><span>00:00 / ${m.dur}</span></div>
          <div class="n-tabs" role="tablist" id="mtabs">
            <button role="tab" type="button" aria-selected="true" aria-controls="mp-1" data-tab="sum">纪要</button>
            <button role="tab" type="button" aria-selected="false" aria-controls="mp-2" data-tab="text" tabindex="-1">文字记录</button>
          </div>
          <div class="n-tabpanel" role="tabpanel" id="mp-1">
            <p class="n-minutes__sum" id="sum"></p>
            <div class="n-minutes__people">${m.people.filter(([pid]) => st.scope(pid)).map(([pid, n]) => html`<a class="nt-plink" href="person.html?id=${pid}"><span>${UI.avatar(pid, 'sm')}${st.person(pid).name} · ${n} 条</span></a>`)}${verify.filter((v) => !v.done).map((v) => html`<a class="nt-plink" href="inbox.html#${v.id}"><span><span class="n-avatar n-avatar--sm" style="--hue:0;background:var(--sheet-sunk)">?</span>${v.quote.match(/「?(小王|宋老师|海外那个项目)/)?.[1] || '待核对'} · 待核对</span></a>`)}</div>
            <h4 class="nt-h2" style="font-size:var(--t-sm)">新事件 · ${evs.length} 条</h4>
            ${evs.map((e) => {
              const pend = e.scores.filter((s) => s.st === 'ai').length, conf = e.scores.some((s) => s.st === 'conflict');
              const who = st.person(e.people[0]);
              return html`<a class="n-minievent nt-plink" href="person.html?id=${who.id}#ev-${e.id}"><div>${e.title}<small>${who.name} · ${e.scores.filter((s) => s.v != null).map((s) => `${st.dim(s.d).name} ${s.v}`).join('、') || '—'} · ${e.srcs.find((x) => x.type === 'audio')?.loc || NT.md(e.date)}</small></div>${conf ? html`<span class="n-badge n-badge--conflict">${icon('split')}待校准</span>` : pend ? html`<span class="n-badge n-badge--ai">${icon('spark')}${pend} 项待确认</span>` : html`<span class="n-badge n-badge--yes">${icon('check')}已确认</span>`}</a>`;
            })}
            ${verify.length ? html`<h4 class="nt-h2" style="font-size:var(--t-sm);margin-top:var(--s-4)">待核对 · ${verify.filter((v) => !v.done).length} 处</h4>${verify.map((v) => html`<a class="n-minievent nt-plink" href="inbox.html#${v.id}"><div>${v.q}<small>${v.at} · ${st.person(v.by).name}</small></div>${v.done ? html`<span class="n-badge n-badge--yes">${icon('check')}已核对</span>` : html`<span class="n-badge n-badge--ai">${icon('spark')}去核对</span>`}</a>`)}` : ''}
          </div>
          <div class="n-tabpanel" role="tabpanel" id="mp-2" hidden>
            <ol class="n-transcript">${m.lines.map(([t, by, text, flag]) => html`<li class="${flag === 'flag' ? 'is-flag' : ''}"><time>${t}</time><div><b>${st.person(by).name} · ${by === 'p-songchuan' ? '助教' : '导师'}</b>${flag === 'verify' ? raw(NT.esc(text).replace(/(小王|宋老师)/, '<mark>$1</mark>')) : text}</div></li>`)}</ol>
          </div>
          <div style="margin-top:var(--s-4);padding-top:var(--s-3);border-top:1px dashed var(--line)">
            <div class="n-asks">${m.asks.map((a) => html`<button class="n-ask" type="button" data-ask="${a}">${a}</button>`)}</div>
            <div id="answers"></div>
          </div>
        </article>
        <aside class="nt-grid nt-sticky">
          <div class="n-card">${UI.trail('处理这段录音 · 5 步', ['上传完成 · 182 MB', '转写 · 区分 3 位说话人', '提取人员与项目', '整理出 9 条事件', '标出 3 处需要人确认'], false)}</div>
          <div class="n-card"><h3 class="n-section-title">接下来</h3>
            <ul class="nt-list" style="font-size:var(--t-sm)">
              <li>导师逐个确认学员的建议分：<a href="landing-review.html?id=p-lin">林知远 W2 对人复盘</a></li>
              <li>核对人名和项目：<a href="inbox.html">待核对</a></li>
              <li>分差大的分数由 HRBP 校准：<a href="queue.html">评分复核</a></li>
            </ul></div>
        </aside>
      </div>`);
    NT.$$('.n-trail__step', main).forEach((s) => { s.dataset.state = 'done'; });
    tabsApi = NT.tabs($('#mtabs'));
    if (NT.param('tab') === 'text') tabsApi.pick('text');
    NT.stream($('#sum'), m.summary, 16);
    main.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ask]'); if (!b) return;
      const box = document.createElement('div');
      box.className = 'n-block'; box.dataset.state = 'light'; box.style.marginTop = 'var(--s-3)';
      box.innerHTML = `<div style="font-size:var(--t-xs);color:var(--ink-3);margin-bottom:4px">${NT.esc(b.dataset.ask)}</div><span class="a"></span><span class="n-caret"></span>`;
      $('#answers').prepend(box);
      await NT.wait(500);
      await NT.stream($('.a', box), m.answers[b.dataset.ask], 20);
      $('.n-caret', box)?.remove();
      box.insertAdjacentHTML('beforeend', '<div class="n-block__by"><span class="n-src n-src--ai"><svg><use href="#i-spark"/></svg>AI 回答</span>只引用这次会议里你有权限查看的内容</div>');
    });
  }
})();
