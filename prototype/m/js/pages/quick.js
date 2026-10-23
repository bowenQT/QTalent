/* 手机快速记录：一句话或按住说话 → AI 整理成背景、行为、结果，只给涉及的维度打建议分 → 点圆点确认或改分 → 保存（5 秒撤销）。
   员工本人在这里补充经历、写意愿或提出纠错，作为本人自述保存，不打分。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $, $$ } = NT;
  const SCRIPT = {
    lead: '林知远今天去客户现场演示。他发现演示环境配置不对，自己查日志定位到问题，提前半小时修好。演示顺利完成，客户当场约了下一次试用。',
    mentor: '唐果的方案在评审上被问住了。第二天她主动约了客服再访谈一次，周五带着新结构来评审。结构清楚多了，导师组直接通过。',
    hrbp: '陆川这周发现转化漏斗的口径各团队不一致。他主动拉上三个团队对齐，还整理成文档发了出来。下周起三个团队都按这份口径出数。',
    ceo: '海外搜索的延迟一直降不下来。周屿在周会上把问题拆成三段，先做最小验证再决定要不要换方案。两周后延迟降了四成。',
  };
  let step = 'write';

  NT.mshell({
    tab: 'work', title: st.role() === 'self' ? '补充到我的档案' : '一句话记录', back: true, noTabbar: true,
    demos: [['按住说话', 'quick.html?hold=1'], ['没认出是谁', `quick.html?q=${encodeURIComponent('今天联调时他先把日志都拉出来了。')}`]],
    view: () => `快速记录 · ${step}`,
    render(main) { if (st.role() === 'self') renderSelf(main); else renderWrite(main); },
  });

  function renderWrite(main) {
    step = 'write';
    const pre = NT.param('person');
    const can = st.visiblePeople().filter((p) => st.can('record', p.id) && !p.noReview);
    const recent = [...new Set([pre, 'p-lin', 'p-tangguo', 'p-wangyz', 'p-luchuan', 'p-zhouyu', 'p-heyn'].filter(Boolean))].filter((id) => can.some((p) => p.id === id)).slice(0, 5);
    mount(main, html`
      <div class="m-qin">
        <label class="m-qin__label" for="q-text">说说这次发生了什么</label>
        <div class="m-chips" role="group" aria-label="记录给谁"><span class="nt-muted">给</span><button type="button" class="n-chip" aria-pressed="${!pre}" data-p="">从原话识别</button>${recent.map((id) => html`<button type="button" class="n-chip" aria-pressed="${pre === id}" data-p="${id}">${st.person(id).name}</button>`)}</div>
        <textarea class="n-eventin__field m-qin__field" id="q-text" rows="6" placeholder="写原话就行，不用分段。比如：唐果今天方案被问住了，第二天主动约了客服再访谈一次。">${NT.param('q') || ''}</textarea>
        <p class="nt-muted" id="q-hint">谁、在什么情境下、做了什么、结果如何。只写「参与了」的地方会标为资料不足，不出分。</p>
      </div>
      <div class="m-actions">
        <button class="m-hold" type="button" id="q-hold" aria-label="按住说话，松开结束">${icon('mic')}</button>
        <p class="nt-muted" style="text-align:center;margin:0" id="q-holdhint">按住说话，松开结束 · 轻点上方输入框打字</p>
        <button class="n-btn n-btn--light m-big" type="button" id="q-shape">${icon('spark')}整理成关键事件</button>
      </div>`);
    let who = pre || '';
    $('.m-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; who = b.dataset.p; $$('.m-chips [data-p]').forEach((x) => x.setAttribute('aria-pressed', x === b)); });
    const field = $('#q-text');
    M.hold($('#q-hold'), field, SCRIPT[st.role()] || SCRIPT.mentor, {
      onStart: () => { $('#q-holdhint').textContent = '正在听…松开结束'; },
      onEnd: () => { $('#q-holdhint').textContent = '转写完成，可以直接改字'; setTimeout(() => shape(main, who), 400); },
      onCancel: () => { $('#q-holdhint').textContent = '按住说话，松开结束 · 轻点上方输入框打字'; },
    });
    $('#q-shape').onclick = () => shape(main, who);
    if (NT.param('hold')) { $('#q-holdhint').textContent = '正在听…（演示：自动转写一段）'; NT.stream(field, SCRIPT[st.role()] || SCRIPT.mentor, 40).then(() => setTimeout(() => shape(main, who), 400)); }
    else if (NT.param('q')) setTimeout(() => shape(main, who), 300);
  }

  async function shape(main, who) {
    const text = $('#q-text').value.trim();
    const hint = $('#q-hint');
    if (!text) { $('#q-text').focus(); return; }
    let pid = who;
    const found = NT.parse.findPeople(text);
    if (!pid) {
      if (found.hit.length) pid = found.hit[0].id;
      else if (found.hidden.length) { hint.innerHTML = `<span style="color:var(--no)">你没有给${NT.esc(found.hidden[0].name)}记录的权限。</span>换一个人，或请对方的负责人记录。`; return; }
      else { hint.innerHTML = '<span style="color:var(--conflict)">没认出是谁。</span>在上面点一个人，或在原话里写上名字。'; $('.m-chips').classList.add('nt-flash'); return; }
    }
    step = 'shaping';
    const proj = NT.parse.findProject(text);
    const s = NT.parse.shape(text, pid);
    const draft = { pid, text, proj, ...s, scores: s.scores.map((x) => ({ ...x })) };
    mount(main, html`
      <article class="m-card n-event" id="ev">
        <div class="n-event__head">${UI.avatar(pid, 'sm')}<b class="n-event__who">${st.person(pid).name}</b>${UI.demo()}<span class="n-event__ip nt-ip" data-ip="thinking" data-size="32" id="ev-ip"></span></div>
        ${proj ? html`<span class="n-badge" style="margin-top:var(--s-2)">${icon('folder')}${proj.type === 'Landing 议题' ? '议题' : '项目'}：${proj.name}</span>` : ''}
        <div style="margin:var(--s-3) 0">${UI.trail('整理这条记录 · 4 步', ['识别人员与项目', '拆出背景、行为、结果', '从标签库里打标签', '对照锚点给涉及的维度打建议分'])}</div>
        <h3 class="n-event__title"><span class="n-edit is-light" data-k="title" contenteditable="plaintext-only" spellcheck="false"></span></h3>
        <dl class="n-event__sbar">${['bg', 'act', 'res'].map((k) => html`<dt>${{ bg: '背景', act: '行为', res: '结果' }[k]}</dt><dd><span class="n-edit is-light" data-k="${k}" contenteditable="plaintext-only" spellcheck="false"></span></dd>`)}</dl>
        <div class="n-tags" id="ev-tags" hidden><span class="n-tags__label">标签</span><span class="n-tags__list" id="tag-list"></span></div>
        <details class="n-event__raw"><summary>原话</summary><p>${text}</p></details>
        <div id="scores" style="margin-top:var(--s-3)"></div>
        <div class="n-event__sign" id="ev-sign" hidden></div>
      </article>
      <div class="m-actions" id="ev-actions" hidden>
        <p class="nt-muted" style="margin:0;text-align:center" id="score-hint"></p>
        <button class="n-btn n-btn--ink m-big" type="button" id="ev-save">${icon('check')}确认并保存</button>
        <button class="n-btn n-btn--ghost" type="button" id="ev-back">改原话</button>
      </div>`);
    UI.mountIPs(main);
    const trailRun = NT.runTrail($('.n-trail', main), 480);
    const ph = { bg: '原话没写背景，可以补上', res: '原话没写结果，可以补上' };
    for (const el of $$('.n-edit', main)) {
      const t = s[el.dataset.k];
      if (!t) { el.textContent = ph[el.dataset.k] || ''; el.classList.remove('is-light'); el.style.color = 'var(--ink-3)'; el.dataset.empty = 1; continue; }
      await NT.stream(el, t, 16);
    }
    $$('.n-edit', main).forEach((el) => el.addEventListener('input', () => { el.classList.remove('is-light'); el.style.color = ''; delete el.dataset.empty; }));
    const tags = [...s.tags.map((t) => [t, false]), ...s.cand.map((t) => [t, true])];
    if (tags.length) { $('#ev-tags').hidden = false; mount($('#tag-list'), tags.map(([t, cand]) => html`<span class="n-tag ${cand ? 'is-candidate' : 'is-ai'}">${t}${cand ? html`<small>候选</small>` : ''}</span>`)); }
    const rows = [];
    const hintText = () => { const left = draft.scores.filter((x) => x.v != null && !x.touched).length; $('#score-hint').textContent = left ? `还有 ${left} 项 AI 建议分，保存时一并确认` : '分数都已由你确认'; };
    for (const sc of draft.scores) {
      const r = M.scoreRow(sc, { onChange: hintText });
      rows.push(r); $('#scores').append(r.el);
      r.el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: NT.reduced ? 1 : 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
      await NT.wait(220);
    }
    await trailRun;
    NT.ipState($('#ev-ip'), 'confirm');
    step = 'shaped';
    $('#ev-actions').hidden = false; hintText();
    $('#ev-back').onclick = () => { location.href = NT.link('quick.html', { q: text, ...(who ? { person: who } : {}) }); };
    $('#ev-save').onclick = () => save(main, draft, rows);
  }

  function save(main, draft, rows) {
    const me = st.me();
    const val = (k) => { const el = $(`.n-edit[data-k="${k}"]`); return el.dataset.empty ? '' : el.textContent.trim(); };
    const { e, big } = NT.parse.commit({ ...draft, title: val('title'), bg: val('bg'), act: val('act'), res: val('res'), tags: $$('#tag-list .n-tag:not(.is-candidate)').map((c) => c.textContent), cand: $$('#tag-list .is-candidate').map((c) => c.firstChild.textContent) });
    step = 'saved';
    rows.forEach((r) => r.settle());
    const ev = $('#ev');
    $$('.n-edit', ev).forEach((el) => { el.classList.remove('is-light'); el.removeAttribute('contenteditable'); });
    $$('#tag-list .n-tag', ev).forEach((c) => c.classList.remove('is-ai'));
    ev.classList.add('is-settling');
    NT.ipState($('#ev-ip'), 'done');
    const sign = $('#ev-sign');
    mount(sign, html`<span class="ink-hand">${me.name}</span>${st.roles[st.role()].label} · 刚刚保存到${st.person(draft.pid).name}的档案`);
    sign.hidden = false;
    mount($('#ev-actions'), html`<a class="n-btn n-btn--ink m-big" href="person.html?id=${draft.pid}#ev-${e.id}">去${st.person(draft.pid).name}的档案看看</a><a class="n-btn n-btn--ghost" href="quick.html">再记一条</a>`);
    NT.toast(`已保存到${st.person(draft.pid).name}的档案${big ? `，${big} 项进了校准队列` : ''}`, {
      undo: () => { st.removeEvent(e.id); location.href = NT.link('quick.html', { q: draft.text, person: draft.pid }); }, undoneText: '已撤销，这条记录没有保存',
    });
  }

  // 员工本人：补充经历 / 写意愿 / 提出纠错
  function renderSelf(main) {
    const me = st.me();
    let k = NT.param('k') || 'exp';
    const ph = { exp: '比如：W2 的缓存问题，我后来写了一份排查笔记放在议题文档里。', will: '比如：下个阶段想离客户近一点，试试售前。', fix: '比如：10-15 的演示环境是我和陈一禾一起搭的，不是我一个人。' };
    const draw = () => mount(main, html`
      <div class="n-seg n-seg--md" role="group" aria-label="写什么" data-manual id="self-k" style="margin-bottom:var(--s-3)">${[['exp', '补充经历'], ['will', '写意愿'], ['fix', '提出纠错']].map(([v, t]) => html`<button type="button" data-k="${v}" aria-pressed="${k === v}">${t}</button>`)}</div>
      <textarea class="n-eventin__field m-qin__field" id="sf" rows="6" placeholder="${ph[k]}"></textarea>
      <p class="nt-muted">${k === 'fix' ? '纠错进入录入人的待办；修改后保留原记录和修改理由。' : '作为「本人自述」保存，和他人的观察分开呈现，不打分。'}</p>
      <div class="m-actions"><button class="n-btn n-btn--ink m-big" type="button" id="sf-save">${k === 'fix' ? '提交纠错' : '保存到我的档案'}</button></div>`);
    draw();
    main.onclick = (e) => {
      const b = e.target.closest('[data-k]'); if (b) { k = b.dataset.k; draw(); return; }
      if (!e.target.closest('#sf-save')) return;
      const t = $('#sf').value.trim(); if (!t) { $('#sf').focus(); return; }
      if (k === 'fix') st.get().corrections.unshift({ id: NT.uid('c'), person: me.id, text: t, at: NT.TODAY });
      else st.addEvent({ id: NT.uid('e'), kind: 'self', date: NT.TODAY, recorder: me.id, people: [me.id], title: `「${t}」`, srcs: [{ type: 'note', label: k === 'will' ? '本人意愿' : '本人补充', loc: NT.md(NT.TODAY) }], tags: [], scores: [] });
      st.save();
      mount(main, UI.state({ ip: 'done', size: 56, title: k === 'fix' ? '纠错已提交给录入人' : '已保存到你的档案', text: k === 'fix' ? '处理后会在你的档案里看到结果。' : '录入人和 HRBP 能看到这条本人自述。', actions: html`<a class="n-btn n-btn--sm n-btn--ink" href="person.html?id=${me.id}">看我的档案</a><a class="n-btn n-btn--sm n-btn--ghost" href="quick.html?k=${k}">再写一条</a>` }));
      UI.mountIPs(main);
    };
  }
})();
