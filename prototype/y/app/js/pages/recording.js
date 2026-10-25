/* 桌面录音：准备 → 录制中（暂停、断网续录、收起到顶栏）→ 结束确认 → 补传 → 处理中 → 完成。HR 和导师使用。
   实时文字只做预览：说话人用编号，结束后按完整录音重新转写和整理，是谁在「待核对」里确认。
   转写和整理是脚本化 mock：多人会议复用 W8 导师团复盘的句子，观察速记复用手机端的两句，按真实节奏出现，不读麦克风。
   演示参数：?mic=deny 麦克风未授权；?net=drop 开始录音后第 8 秒断网、第 20 秒恢复；?step=resume 上次的录音已暂停；?step=processing 处理中。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, R = NT.rec;
  const { html, raw, icon, mount, $, $$ } = NT;
  const W8 = NT.SEED.MINUTES.w8;
  const toS = (t) => t.split(':').reduce((a, x) => a * 60 + +x, 0);
  const MODES = [
    { id: 'meet', icon: 'users', name: '多人会议', limit: R.LIMIT.meet, cap: '区分说话人，整理成人才纪要' },
    { id: 'obs', icon: 'mic', name: '观察速记', limit: R.LIMIT.obs, cap: '一个人说，AI 拆成一条或几条关键事件' },
  ];
  const modeOf = (id) => MODES.find((m) => m.id === id);
  // [说话人, 句子]；观察速记只有一个人说，不标说话人
  const LINES = {
    meet: W8.lines.map(([, by, text]) => [by, text]),
    obs: [[null, '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了。'], [null, '分工比之前清楚多了，演示前一天全部跑通。']],
  };
  const SPEAKERS = [...new Set(W8.lines.map((l) => l[1]))]; // 按第一次开口的顺序编号
  const RELS = ['XEngineer 第六期 · W8 导师团复盘', '不关联'];
  const LANGS = ['普通话', '普通话 + 英文'];
  const STEPS = ['上传完整录音', '转写 · 区分说话人', '提取人员与项目', '整理关键事件', '标出需要人确认的地方'];
  const SEGS = 5; // 断网期间攒下、结束时还要补传的分段数（演示）
  const DROP_AT = 8000, DROP_FOR = 12000, RETRY_EVERY = 4000; // ?net=drop：开始后第 8 秒断开，断开 12 秒后恢复
  const STATE = { live: '录制中', paused: '已暂停', reconnecting: '重连中', uploading: '补传中' };
  const LABEL = { prep: '准备', resume: '上次的录音已暂停', live: '录制中', ending: '补传中', processing: '处理中', done: '完成' };

  let step = 'prep', mode = 'meet', lang = LANGS[0], rel = RELS[0];
  let main = null, rec = null, timers = [], ticker = 0;
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const stopTimers = () => { timers.forEach(clearTimeout); timers = []; clearInterval(ticker); clearTimeout(lineTimer); };
  let lineTimer = 0; // 逐句出现只有一条定时链：暂停、断网时取消，继续、恢复时重新排

  NT.shell({
    nav: 'work', title: '录音', crumbs: [['工作台', 'index.html']],
    allow: (role) => ['hrbp', 'mentor'].includes(role),
    view: () => `录音 · ${step === 'live' && rec ? STATE[ctlState(rec)] : LABEL[step]}`,
    state: () => ({ step }),
    render(m) {
      main = m;
      // 控制条吸在顶栏下面：顶栏在窄屏会换行，高度按实际量
      const top = $('.nt-top');
      new ResizeObserver(() => document.documentElement.style.setProperty('--nt-top-h', `${top.offsetHeight}px`)).observe(top);
      const demo = NT.param('step');
      if (demo === 'processing') { R.set(null); return renderProcessing({ title: W8.title, dur: toS(W8.dur) }); }
      if (demo === 'resume') seedResume();
      const r = R.mine();
      if (r && r.away) return renderResume(r);
      if (r) return renderLive(r);
      renderPrep();
    },
  });

  // 演示：上一段录音录到 23:10 时刷新了页面
  function seedResume() {
    const at = toS('23:10'), now = Date.now(), n = 4;
    R.set({ mode: 'meet', lang: LANGS[0], title: W8.title, by: st.me().id, t0: now - at * 1000, paused: true, pausedAt: now, away: true,
      line: n, stamps: W8.lines.slice(0, n).map((l) => toS(l[0])), marks: [], inserts: [] });
  }

  // ---------- 准备 ----------
  function renderPrep() {
    step = 'prep';
    const deny = NT.param('mic') === 'deny';
    mount(main, html`
      <section class="n-card nt-recprep" aria-labelledby="rec-h">
        <header class="nt-recprep__head"><span class="nt-ip" data-ip="listening" data-size="96"></span><div><h1 id="rec-h">录音</h1><p id="rec-cap">${modeOf(mode).cap}</p></div></header>
        <div>
          <div class="nt-recmodes" role="radiogroup" aria-label="录音模式" id="rec-modes">${MODES.map((x) => html`<button class="n-mode" type="button" role="radio" aria-checked="${x.id === mode}" tabindex="${x.id === mode ? 0 : -1}" data-mode="${x.id}"><span class="n-mode__icon">${icon(x.icon)}</span><span>${x.name}<small>最长 ${x.limit >= 3600 ? `${x.limit / 3600} 小时` : `${x.limit / 60} 分钟`}</small></span></button>`)}</div>
          <a class="n-link nt-recprep__up" href="index.html#upload">${icon('upload', 13)}上传已有录音</a>
        </div>
        <div class="nt-recopts">
          <label class="n-field"><span class="n-field__label">语言</span><select class="n-select" id="rec-lang">${LANGS.map((l) => html`<option ${raw(l === lang ? 'selected' : '')}>${l}</option>`)}</select></label>
          <label class="n-field"><span class="n-field__label">关联到</span><select class="n-select" id="rec-rel">${RELS.map((l) => html`<option ${raw(l === rel ? 'selected' : '')}>${l}</option>`)}</select></label>
        </div>
        ${deny ? html`<div class="n-notice is-deny">${icon('mic')}<div><b>麦克风权限待开启。</b>可以先打字记下来，或者上传已有录音；在浏览器地址栏左侧打开麦克风后再录。<div class="nt-row" style="margin-top:var(--s-2)"><a class="n-btn n-btn--sm n-btn--ink" href="record.html">改为打字</a><a class="n-btn n-btn--sm" href="index.html#upload">上传录音</a></div></div></div>`
          : html`<div><button class="n-btn n-btn--ink nt-recprep__start" type="button" id="rec-start">${icon('mic')}开始录音</button></div>`}
      </section>`);
    UI.mountIPs(main);
    const group = $('#rec-modes');
    const pick = (b) => {
      mode = b.dataset.mode;
      $$('[role="radio"]', group).forEach((x) => { x.setAttribute('aria-checked', x === b); x.tabIndex = x === b ? 0 : -1; });
      $('#rec-cap').textContent = modeOf(mode).cap;
    };
    group.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) pick(b); });
    group.addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (!d) return;
      e.preventDefault();
      const all = $$('[role="radio"]', group), b = all[(all.indexOf(document.activeElement) + d + all.length) % all.length];
      pick(b); b.focus();
    });
    $('#rec-lang').onchange = (e) => { lang = e.target.value; };
    $('#rec-rel').onchange = (e) => { rel = e.target.value; };
    $('#rec-start')?.addEventListener('click', () => {
      const title = mode === 'obs' ? '观察速记' : rel === RELS[0] ? W8.title : '多人会议';
      const r = { mode, lang, title, by: st.me().id, t0: Date.now(), paused: false, line: 0, stamps: [], marks: [], inserts: [] };
      R.set(r);
      renderLive(r, { fresh: true });
    });
  }

  // ---------- 上次的录音因刷新或关闭而暂停 ----------
  function renderResume(r) {
    step = 'resume';
    mount(main, html`
      <section class="n-card n-state nt-recresume" aria-labelledby="res-h">
        <span class="nt-ip" data-ip="confirm" data-size="56"></span>
        <h1 class="n-state__title" id="res-h">上次的录音已暂停</h1>
        <p class="n-state__text">${r.title} · 已录 ${R.fmt(R.elapsed(r))} · 已录内容都已保存</p>
        <div class="nt-row" style="justify-content:center"><button class="n-btn n-btn--ink" type="button" id="res-go">${icon('mic')}继续录音</button><button class="n-btn" type="button" id="res-end">结束并整理</button></div>
      </section>`);
    UI.mountIPs(main);
    $('#res-go').onclick = () => { delete r.away; resume(r); R.set(r); renderLive(r, { focus: true }); };
    $('#res-end').onclick = async () => {
      if (await confirmEnd(r) !== 'end') return;
      R.set(null);
      renderProcessing({ title: r.title, dur: R.elapsed(r) });
    };
  }

  const resume = (r) => { r.t0 += Date.now() - r.pausedAt; r.paused = false; delete r.pausedAt; };
  const confirmEnd = (r) => NT.dialog({ title: '结束这次录音？', body: html`<p>已录 ${R.fmt(R.elapsed(r))}。结束后按完整录音转写和整理，可以直接离开。</p>`,
    actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '结束录音', value: 'end', cls: 'n-btn--ink' }] });
  const ctlState = (r) => (r.uploading ? 'uploading' : r.paused ? 'paused' : r.net ? 'reconnecting' : 'live');

  // ---------- 录制中 ----------
  function renderLive(r, opt = {}) {
    step = 'live'; rec = r;
    const m = modeOf(r.mode), lines = LINES[r.mode];
    const people = st.batch('b-xe6').newcomers.map((n) => n[0]).filter((id) => st.scope(id));
    mount(main, html`
      <div class="nt-rec">
        <div class="n-recctl" id="ctl" role="group" aria-label="录音控制">
          <span class="n-recctl__state"><span class="n-recbar__dot"></span><span id="ctl-st"></span></span>
          <span class="n-recctl__title"><b>${r.title}</b><small>${m.name} · ${r.lang}</small></span>
          <span class="n-wave" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => html`<i style="animation-delay:${i * 0.15}s"></i>`)}</span>
          <span class="n-recctl__time"><b id="ctl-t">${R.fmt(R.elapsed(r))}</b> / ${R.fmt(m.limit)}</span>
          <span class="n-recctl__warn" id="ctl-warn" hidden></span>
          <span class="n-recctl__up" id="ctl-up" hidden><span id="ctl-up-t"></span><span class="n-progress"><i style="width:0%"></i></span></span>
          <div class="n-recctl__acts" id="ctl-acts"><button class="n-btn" type="button" id="rec-pause"></button><button class="n-btn n-btn--ink" type="button" id="rec-end">结束录音</button><button class="n-btn n-btn--ghost" type="button" id="rec-min">收起</button></div>
        </div>
        <div id="net"></div>
        <div class="nt-rec__cols">
          <section class="n-card nt-rec__live" aria-labelledby="live-h">
            <h2 class="n-section-title" id="live-h">实时文字<span class="n-badge">实时预览</span></h2>
            <div class="n-live" id="live" aria-live="polite" tabindex="0" aria-label="实时文字，结束后按完整录音重新转写"></div>
            <button class="n-btn n-btn--sm nt-rec__latest" type="button" id="latest" hidden>${icon('up-r', 12)}回到最新</button>
          </section>
          <aside class="n-card nt-rec__tools" aria-label="录音工具">
            <section class="nt-rtool" aria-labelledby="t-flag-h">
              <div class="nt-rtool__head"><h3 id="t-flag-h">标记</h3><button class="n-btn n-btn--sm" type="button" id="t-flag">${icon('flag')}打标记</button></div>
              <ol class="nt-rmarks" id="marks"></ol>
            </section>
            <section class="nt-rtool" aria-labelledby="t-note-h">
              <div class="nt-rtool__head"><h3 id="t-note-h">随手记</h3></div>
              <textarea class="n-textarea" id="t-note" rows="3" aria-labelledby="t-note-h" placeholder="比如：孟逸尘这里的说法要和周报对一下"></textarea>
              <div class="nt-rtool__bar"><button class="n-btn n-btn--sm" type="button" id="t-note-go"></button><span class="nt-muted">⌘ ↵</span></div>
            </section>
            <section class="nt-rtool" aria-labelledby="t-at-h">
              <div class="nt-rtool__head"><h3 id="t-at-h">@某人</h3></div>
              <p class="nt-muted" style="margin:0">这一段会作为这个人的证据来源，整理时优先归到这个人名下</p>
              <input class="n-input" id="t-at-q" type="search" placeholder="搜学员姓名" aria-label="搜学员姓名" aria-controls="t-at-list">
              <ul class="nt-rpeople" id="t-at-list"></ul>
            </section>
            <div class="n-lock">${icon('lock')}录音时保持这个标签页打开。刷新或关闭会暂停，回来接着录，已录内容都已保存。</div>
          </aside>
        </div>
      </div>`);

    const live = $('#live'), save = () => R.set(r), now = () => R.fmt(R.elapsed(r));
    const said = () => $$('.n-live__s', live).length;

    // 逐句出现：说话人换人时写「说话人 N · 时间点」，观察速记只在段首写时间点
    const head = (i) => (r.mode === 'obs' ? i === 0 : i === 0 || lines[i - 1][0] !== lines[i][0]);
    const put = (i) => {
      if (r.stamps[i] == null) r.stamps[i] = R.elapsed(r);
      $('.n-live__empty', live)?.remove();
      if (head(i)) live.insertAdjacentHTML('beforeend', `<div class="n-live__sp">${r.mode === 'obs' ? '' : `说话人 ${SPEAKERS.indexOf(lines[i][0]) + 1} · `}${R.fmt(r.stamps[i])}</div>`);
      const p = document.createElement('p');
      p.className = 'n-live__s'; p.dataset.i = i; p.textContent = lines[i][1];
      if (r.marks.some((k) => k.i === i)) p.classList.add('is-flag');
      live.append(p);
      return p;
    };
    const insertHtml = (x) => (x.kind === 'note' ? `<div class="n-live__note">${icon('note')}<span>${NT.esc(x.text)}</span><small>随手记 · ${x.at}</small></div>`
      : x.kind === 'at' ? `<div><span class="n-live__at">@${NT.esc(x.name)}<small>· ${x.at}</small></span></div>`
        : `<div class="n-live__gap" data-gap="${x.from}">${icon('clock')}${gapText(x)}</div>`);
    const gapText = (x) => `${R.fmt(x.from)}${x.to != null ? `–${R.fmt(x.to)}` : ' 起'} · 结束后补齐文字`;
    const addInsert = (x) => { r.inserts.push(x); save(); live.insertAdjacentHTML('beforeend', insertHtml(x)); toEnd(); };

    // 自动滚到最新一句；往上翻时停下，给「回到最新」
    let follow = true;
    const toEnd = () => { if (follow) live.scrollTop = live.scrollHeight; };
    live.addEventListener('scroll', () => { follow = live.scrollHeight - live.scrollTop - live.clientHeight < 24; $('#latest').hidden = follow; });
    $('#latest').onclick = () => { follow = true; live.scrollTo({ top: live.scrollHeight, behavior: NT.reduced ? 'auto' : 'smooth' }); live.focus(); };

    // 恢复已有内容：随手记、@ 和断开缺口按记下时的位置放回句子之间
    const insertsAt = (i) => r.inserts.filter((x) => x.i === i).forEach((x) => live.insertAdjacentHTML('beforeend', insertHtml(x)));
    for (let i = 0; i < r.line; i++) { insertsAt(i); put(i); }
    r.inserts.filter((x) => x.i >= r.line).forEach((x) => live.insertAdjacentHTML('beforeend', insertHtml(x)));
    if (!live.children.length) live.innerHTML = '<p class="n-live__empty">开始说话后，文字会出现在这里</p>';
    toEnd();

    // 逐句出现：未定稿的半句停在浅墨，定稿后落成正文。暂停或断网时停在半句，继续后先把这句定稿
    let pending = null;
    const run = (fn, ms) => { clearTimeout(lineTimer); lineTimer = setTimeout(fn, ms); };
    const halt = () => clearTimeout(lineTimer);
    const land = () => {
      const { p, i } = pending; pending = null;
      p.classList.remove('is-pending'); p.textContent = lines[i][1];
      r.line = i + 1; save(); toEnd();
      run(next, 1600);
    };
    const next = () => {
      if (step !== 'live' || r.paused || r.net) return;
      if (pending) { run(land, NT.reduced ? 0 : 600); return; }
      if (r.line >= lines.length) return;
      const i = r.line, text = lines[i][1];
      pending = { p: put(i), i };
      if (NT.reduced) { land(); return; }
      pending.p.classList.add('is-pending'); pending.p.textContent = text.slice(0, Math.ceil(text.length * 0.6)); toEnd();
      run(land, 1200);
    };

    // 控制条：状态、计时、剩余时长；到时长上限直接结束，不弹确认
    const paint = () => {
      const s = ctlState(r);
      $('#ctl').dataset.state = s;
      $('#ctl-st').textContent = STATE[s];
      $('#rec-pause').textContent = r.paused ? '继续' : '暂停';
      $('#ctl-acts').hidden = s === 'uploading';
      $('#ctl-up').hidden = s !== 'uploading';
      tick();
    };
    const tick = () => {
      const el = R.elapsed(r), left = m.limit - el;
      $('#ctl-t').textContent = R.fmt(Math.min(el, m.limit));
      $('#t-note-go').textContent = `插入到 ${R.fmt(el)}`;
      $('#ctl-warn').hidden = left > 300 || r.uploading;
      $('#ctl-warn').textContent = `还剩 ${Math.max(1, Math.ceil(left / 60))} 分钟，到 ${R.fmt(m.limit)} 自动结束`;
      if (left <= 0 && !r.uploading) finish();
    };
    paint();
    ticker = setInterval(tick, 500);

    // 工具：打标记（标在最新一句上）、随手记、@某人；暂停时同样可用，时间点记为暂停时刻
    const drawMarks = () => mount($('#marks'), r.marks.length ? r.marks.map((k) => html`<li><button type="button" data-jump="${k.i}"><time>${k.at}</time><span>${lines[k.i][1]}</span></button></li>`) : html`<li class="nt-muted">打过的标记会出现在这里</li>`);
    drawMarks();
    $('#t-flag').onclick = () => {
      const i = said() - 1;
      if (i < 0) { NT.toast('第一句出现后可以打标记'); return; }
      if (!r.marks.some((k) => k.i === i)) { r.marks.push({ i, at: now() }); save(); }
      $(`.n-live__s[data-i="${i}"]`, live)?.classList.add('is-flag');
      drawMarks();
      NT.toast(`已在 ${now()} 打标记，纪要里会跳到这一段`);
    };
    $('#marks').onclick = (e) => {
      const b = e.target.closest('[data-jump]'); if (!b) return;
      const p = $(`.n-live__s[data-i="${b.dataset.jump}"]`, live); if (!p) return;
      live.scrollTo({ top: p.offsetTop - live.clientHeight / 2, behavior: NT.reduced ? 'auto' : 'smooth' });
      p.classList.add('is-jump'); setTimeout(() => p.classList.remove('is-jump'), 1600);
    };
    const note = () => {
      const f = $('#t-note'), text = f.value.trim();
      if (!text) { f.focus(); return; }
      addInsert({ i: said(), kind: 'note', text, at: now() });
      f.value = '';
    };
    $('#t-note-go').onclick = note;
    $('#t-note').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); note(); } });
    const drawPeople = () => {
      const q = $('#t-at-q').value.trim(), list = people.filter((id) => st.person(id).name.includes(q));
      mount($('#t-at-list'), list.length ? list.map((id) => html`<li><button type="button" data-at="${id}">${UI.avatar(id, 'sm')}<span>${st.person(id).name}<small>${st.project(st.landingOf(id).row[1])?.name || ''}</small></span></button></li>`) : html`<li class="nt-muted">换个名字试试</li>`);
    };
    drawPeople();
    $('#t-at-q').addEventListener('input', drawPeople);
    $('#t-at-list').onclick = (e) => {
      const b = e.target.closest('[data-at]'); if (!b) return;
      const name = st.person(b.dataset.at).name;
      addInsert({ i: said(), kind: 'at', pid: b.dataset.at, name, at: now() });
      NT.toast(`已在 ${now()} 关联${name}`);
    };

    $('#rec-pause').onclick = () => {
      if (r.paused) { resume(r); run(next, 400); } else { r.paused = true; r.pausedAt = Date.now(); halt(); }
      save(); paint();
    };
    $('#rec-min').onclick = () => { save(); location.href = 'index.html'; };
    $('#rec-end').onclick = async () => { if (await confirmEnd(r) === 'end') finish(); };

    // 网络中断：本机继续录，计时照走；实时文字停在断开处，插一行缺口，恢复后补传
    // 断网状态存进录音：收起再展开、刷新后继续时，按记下的恢复时刻重建提示和恢复流程
    const tries = () => Math.floor((Date.now() - r.net.at) / RETRY_EVERY) + 1;
    const recover = () => {
      if (step !== 'live' || !r.net) return;
      const gap = r.inserts.find((x) => x.kind === 'gap' && x.from === r.net.from);
      gap.to = R.elapsed(r); delete r.net; save();
      $(`[data-gap="${gap.from}"]`, live).innerHTML = `${icon('clock')}${gapText(gap)}`;
      mount($('#net'), ''); paint();
      NT.toast('已恢复连接，断开期间的录音已补传');
      run(next, 600);
    };
    const watchNet = () => {
      mount($('#net'), html`<div class="n-notice nt-rec__net" role="status">${icon('retry')}<div>网络已断开，录音继续保存在这台电脑上，恢复后自动补传。</div><span class="nt-rec__tries" id="net-n">重连中 · 第 ${tries()} 次</span></div>`);
      const retry = setInterval(() => { if (!r.net || step !== 'live') { clearInterval(retry); return; } $('#net-n').textContent = `重连中 · 第 ${tries()} 次`; }, RETRY_EVERY);
      later(recover, Math.max(0, r.net.at + DROP_FOR - Date.now()));
    };
    const drop = () => {
      if (step !== 'live' || r.net) return;
      halt();
      r.net = { from: R.elapsed(r), at: Date.now() };
      addInsert({ i: said(), kind: 'gap', from: r.net.from });
      watchNet(); paint();
    };
    if (r.net) watchNet();
    if (opt.fresh && NT.param('net') === 'drop') later(drop, DROP_AT);

    // 结束：断网期间的分段先补传完，再进入处理中
    async function finish() {
      stopTimers(); step = 'ending';
      const dur = Math.min(R.elapsed(r), m.limit);
      if (r.net || r.uploading) {
        // 补传到第几段记在录音状态里：补传中刷新页面，回来接着传
        if (!r.uploading) { Object.assign(r, { uploading: true, paused: true, pausedAt: Date.now(), up: 0 }); delete r.net; save(); }
        mount($('#net'), ''); paint();
        for (let k = r.up || 0; k <= SEGS; k++) {
          r.up = k; save();
          $('#ctl-up-t').textContent = `补传中 ${k}/${SEGS} 段`;
          $('#ctl-up .n-progress i').style.width = `${k / SEGS * 100}%`;
          await NT.wait(700);
        }
      }
      R.set(null); rec = null;
      renderProcessing({ title: r.title, dur });
    }

    if (r.uploading) finish(); else run(next, 600);
    if (opt.fresh || opt.focus) $('#rec-pause').focus();
  }

  // ---------- 处理中与完成：可以直接离开，结果回到工作台「进行中的任务」 ----------
  async function renderProcessing(info) {
    step = 'processing';
    const task = R.addTask(info);
    const N = 64;
    mount(main, html`
      <section class="nt-recproc" aria-labelledby="proc-t">
        <div class="n-player"><button class="n-player__play nt-play" type="button" aria-label="播放">${icon('play')}</button><div class="n-player__track">${Array.from({ length: N }, (_, i) => raw(`<i style="height:${30 + Math.round(Math.abs(Math.sin(i * 1.7)) * 70)}%"></i>`))}</div><span>${R.fmt(info.dur)}</span></div>
        <div class="nt-recproc__head" role="status"><span class="nt-ip" data-ip="thinking" data-size="72" id="proc-ip"></span><div><h1 id="proc-t">转写与整理中</h1><p id="proc-s">约需 1–3 分钟，可以直接离开。结果会出现在工作台的「进行中的任务」里。</p></div></div>
        <div class="n-card">${UI.trail(`处理这段录音 · ${STEPS.length} 步`, STEPS)}</div>
        <div class="nt-row" id="proc-acts"><a class="n-btn" href="index.html">回到工作台</a></div>
      </section>`);
    UI.mountIPs(main);
    const steps = $$('.n-trail__step', main);
    for (const [k, s] of steps.entries()) {
      s.dataset.state = 'active';
      if (k === 2) { task.state = 'shaping'; task.note = '转写完成，正在整理事件'; st.save(); }
      await NT.wait(900);
      if (!document.body.contains(s)) return;
      s.dataset.state = 'done';
    }
    const open = st.get().inbox.filter((i) => i.src === W8.title && !i.done).length;
    Object.assign(task, { state: 'partial', note: `${W8.events.length} 条事件已整理，${open} 处待核对` });
    delete task.shapeAt; delete task.readyAt; st.save();
    step = 'done';
    NT.ipState($('#proc-ip'), 'done');
    $('#proc-t').textContent = '人才纪要已生成';
    $('#proc-s').textContent = open ? `${W8.events.length} 条事件已整理，${open} 处需要你确认是谁。` : `${W8.events.length} 条事件已整理。`;
    mount($('#proc-acts'), html`${open ? html`<a class="n-btn n-btn--ink" href="inbox.html">去核对</a>` : ''}<a class="n-btn ${open ? '' : 'n-btn--ink'}" href="record.html?m=w8">查看人才纪要</a><a class="n-btn n-btn--ghost" href="index.html">回到工作台</a>`);
  }
})();
