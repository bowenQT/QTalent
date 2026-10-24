/* 手机快速记录（导师）：一句话或按住说话 → AI 整理成情境、行为、影响（SBI），只给涉及的维度打建议分 → 点圆点确认或改分 → 保存（5 秒撤销）。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, icon, mount, $, $$ } = NT;
  const SCRIPT = '结营前一周组员都在等分工。孟逸尘主动把任务池同步给了全组，下午组员就接上了。分工清楚多了，演示前一天全部跑通。';
  let step = 'write', att = null;

  NT.mshell({
    tab: 'work', title: '一句话记录', back: true, noTabbar: true,
    demos: [['按住说话', 'quick.html?hold=1'], ['确认说的是谁', `quick.html?q=${encodeURIComponent('今天联调时他先把日志都拉出来了。')}`]],
    view: () => `快速记录 · ${step}`,
    render: renderWrite,
  });

  function renderWrite(main) {
    step = 'write';
    const pre = NT.param('person');
    const can = st.visiblePeople().filter((p) => st.can('record', p.id) && !p.noReview);
    const recent = [...new Set([pre, 'p-x11', 'p-x07', 'p-x15', 'p-x06', 'p-x14'].filter(Boolean))].filter((id) => can.some((p) => p.id === id)).slice(0, 5);
    mount(main, html`
      <div class="m-qin">
        <label class="m-qin__label" for="q-text">说说这次发生了什么</label>
        <div class="m-chips" role="group" aria-label="记录给谁"><span class="nt-muted">给</span><button type="button" class="n-chip" aria-pressed="${!pre}" data-p="">从原话识别</button>${recent.map((id) => html`<button type="button" class="n-chip" aria-pressed="${pre === id}" data-p="${id}">${st.person(id).name}</button>`)}</div>
        <textarea class="n-eventin__field m-qin__field" id="q-text" rows="6" placeholder="写原话就行，不用分段。比如：孟逸尘今天主动把任务池同步给了全组，下午组员就接上了。">${NT.param('q') || ''}</textarea>
        <p class="nt-muted" id="q-hint">谁、在什么情境下、做了什么、结果如何。只写了「参与」的地方标为资料不足。</p>
        <div class="m-qatt">${UI.attachButton('添加附件')}<span class="nt-muted">PDF、PPT、文档、表格、录音或视频，可多选</span></div>
        <ul id="q-atts" hidden></ul>
      </div>
      <div class="m-actions">
        <button class="m-hold" type="button" id="q-hold" aria-label="按住说话，松开结束">${icon('mic')}</button>
        <p class="nt-muted" style="text-align:center;margin:0" id="q-holdhint">按住说话，松开结束 · 轻点上方输入框打字</p>
        <button class="n-btn n-btn--light m-big" type="button" id="q-shape">${icon('spark')}整理成关键事件</button>
      </div>`);
    let who = pre || '';
    // 附件跟着这次记录走：整理后挪到原话下面，「改原话」回来时保留已解析的
    att = UI.attach({ key: 'quick' }).list($('#q-atts')).pick($('[data-att-pick]', main)).fallback(() => $('#ev-back'));
    if (NT.param('q')) att.restore(); else att.clear();
    $('.m-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; who = b.dataset.p; $$('.m-chips [data-p]').forEach((x) => x.setAttribute('aria-pressed', x === b)); });
    const field = $('#q-text');
    M.hold($('#q-hold'), field, SCRIPT, {
      onStart: () => { $('#q-holdhint').textContent = '正在听…松开结束'; },
      onEnd: () => { $('#q-holdhint').textContent = '转写完成，可以直接改字'; setTimeout(() => shape(main, who), 400); },
      onCancel: () => { $('#q-holdhint').textContent = '按住说话，松开结束 · 轻点上方输入框打字'; },
    });
    $('#q-shape').onclick = () => shape(main, who);
    if (NT.param('hold')) { $('#q-holdhint').textContent = '正在听…（演示：自动转写一段）'; NT.stream(field, SCRIPT, 40).then(() => setTimeout(() => shape(main, who), 400)); }
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
      else if (found.hidden.length) { hint.innerHTML = `<span style="color:var(--no)">${NT.esc(found.hidden[0].name)}不是你带的学员，由所带导师记录。</span>换一个人，或请对方的导师来记。`; return; }
      else { hint.innerHTML = '<span style="color:var(--conflict)">这句话说的是谁？</span>在上面点一个人，或在原话里写上名字。'; $('.m-chips').classList.add('nt-flash'); return; }
    }
    step = 'shaping';
    const proj = NT.parse.findProject(text);
    const s = NT.parse.shape(text, pid);
    const draft = { pid, text, proj, ...s, scores: s.scores.map((x) => ({ ...x })) };
    mount(main, html`
      <article class="m-card n-event" id="ev">
        <div class="n-event__head">${UI.avatar(pid, 'sm')}<b class="n-event__who">${st.person(pid).name}</b>${UI.demo()}<span class="n-event__ip nt-ip" data-ip="thinking" data-size="32" id="ev-ip"></span></div>
        ${proj ? html`<span class="n-badge" style="margin-top:var(--s-2)">${icon('folder')}${proj.type === 'XEngineer 课题' ? '课题' : '项目'}：${proj.name}</span>` : ''}
        <div style="margin:var(--s-3) 0">${UI.trail('整理这条记录 · 4 步', ['识别人员与项目', '拆出情境、行为、影响', '从标签库里打标签', '对照锚点给涉及的维度打建议分'])}</div>
        <h3 class="n-event__title"><span class="n-edit is-light" data-k="title" contenteditable="plaintext-only" spellcheck="false"></span></h3>
        <dl class="n-event__sbar">${['bg', 'act', 'res'].map((k) => html`<dt>${{ bg: '情境', act: '行为', res: '影响' }[k]}</dt><dd><span class="n-edit is-light" data-k="${k}" contenteditable="plaintext-only" spellcheck="false"></span></dd>`)}</dl>
        <div class="n-tags" id="ev-tags" hidden><span class="n-tags__label">标签</span><span class="n-tags__list" id="tag-list"></span></div>
        <details class="n-event__raw"><summary>原话</summary><p>${text}</p></details>
        <ul id="q-atts" hidden></ul>
        <div id="scores" style="margin-top:var(--s-3)"></div>
        <div class="n-event__sign" id="ev-sign" hidden></div>
      </article>
      <div class="m-actions" id="ev-actions" hidden>
        <p class="nt-muted" style="margin:0;text-align:center" id="score-hint"></p>
        <button class="n-btn n-btn--ink m-big" type="button" id="ev-save">${icon('check')}确认并保存</button>
        <button class="n-btn n-btn--ghost" type="button" id="ev-back">改原话</button>
      </div>`);
    UI.mountIPs(main);
    att.list($('#q-atts'));
    const trailRun = NT.runTrail($('.n-trail', main), 480);
    const ph = { bg: '原话没写情境，可以补上', res: '原话没写影响，可以补上' };
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
      const r = M.scoreRow(sc, { onChange: hintText, pid: () => draft.pid });
      rows.push(r); $('#scores').append(r.el);
      r.el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: NT.reduced ? 1 : 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
      await NT.wait(220);
    }
    await trailRun;
    NT.ipState($('#ev-ip'), 'confirm');
    step = 'shaped';
    $('#ev-actions').hidden = false; hintText();
    $('#ev-back').onclick = () => { att.keep(); location.href = NT.link('quick.html', { q: text, ...(who ? { person: who } : {}) }); };
    $('#ev-save').onclick = () => save(main, draft, rows);
  }

  function save(main, draft, rows) {
    const me = st.me();
    const wait = att.pending();
    if (wait) { $('#score-hint').innerHTML = `<span style="color:var(--conflict)">还有 ${wait} 个附件在上传或解析，</span>完成后再保存`; return; }
    const val = (k) => { const el = $(`.n-edit[data-k="${k}"]`); return el.dataset.empty ? '' : el.textContent.trim(); };
    const { e, big } = NT.parse.commit({ ...draft, title: val('title'), bg: val('bg'), act: val('act'), res: val('res'), tags: $$('#tag-list .n-tag:not(.is-candidate)').map((c) => c.textContent), cand: $$('#tag-list .is-candidate').map((c) => c.firstChild.textContent), atts: att.srcs() });
    step = 'saved';
    att.lock();
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
      undo: () => { st.removeEvent(e.id); att.keep(); location.href = NT.link('quick.html', { q: draft.text, person: draft.pid }); }, undoneText: '已撤销，这条记录没有保存',
    });
  }
})();
