/* 手机录音（对标「得到」）：选模式 → 实时转写（打标记、随手记、@某人，可暂停、可收起成悬浮条）→ 完成后处理中（可以直接返回）
   → 人才纪要（摘要、涉及人员、新事件、待核对、文字记录，点时间点跳播放位置）→ 底部追问。
   转写和整理是脚本化 mock：内容预置，按真实节奏出现；演示里录完生成的是预先处理好的 W2 导师团复盘纪要。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui, M = NT.m;
  const { html, raw, icon, mount, $, $$ } = NT;
  const minutesId = NT.param('m');
  const MODES = [
    { id: 'obs', icon: 'mic', name: '观察速记', sub: '一个人说，记一条或几条事件', limit: '最长 10 分钟', cap: '一个人说，AI 拆成一条或几条关键事件' },
    { id: 'meet', icon: 'users', name: '多人会议', sub: '复盘会、一对一，区分说话人', limit: '最长 2 小时', cap: '区分说话人，整理成人才纪要' },
    { id: 'upload', icon: 'upload', name: '上传录音文件', sub: '已经录好的会议', limit: '以联调为准', cap: '上传后转写和整理在后台进行' },
  ];
  const W2 = NT.SEED.MINUTES.w2;
  let step = minutesId ? 'minutes' : NT.param('step') || 'mode';
  let mode = 'meet', lang = '普通话';
  let tabsApi = null;

  NT.mshell({
    tab: 'work', title: minutesId ? '人才纪要' : '录音', back: 'index.html', noTabbar: !minutesId,
    allow: (r) => r !== 'self',
    denyText: '员工视角不录音。可以在「档案」里补充自己的经历。',
    demos: [['麦克风未授权', 'record.html?mic=deny'], ['处理中', 'record.html?step=processing'], ['人才纪要', 'record.html?m=w2']],
    view: () => (step === 'minutes' ? `纪要 · ${$('[role="tab"][aria-selected="true"]')?.textContent || ''}` : `录音 · ${{ mode: '选模式', live: '录制中', processing: '处理中' }[step] || step}`),
    state: () => ({ step: step === 'live' ? 'mode' : step, tab: $('[role="tab"][aria-selected="true"]')?.dataset.tab }),
    restore: (s) => { if (s.tab && tabsApi) tabsApi.pick(s.tab); },
    render(main) {
      if (minutesId) return renderMinutes(main);
      const r = M.rec.get();
      if (r) { mode = r.mode; return renderLive(main, r); }
      if (step === 'processing') return renderProcessing(main, { title: 'W2 导师团复盘', dur: 42 * 60 + 10 });
      renderMode(main);
    },
  });

  // ---------- 选模式 ----------
  function renderMode(main) {
    step = 'mode';
    const deny = NT.param('mic') === 'deny';
    const m = () => MODES.find((x) => x.id === mode);
    const draw = () => mount(main, html`
      <div class="m-modehead">
        <span class="nt-ip" data-ip="listening" data-size="96"></span>
        <p>${m().cap}</p>
      </div>
      <div class="m-modes" role="radiogroup" aria-label="录音模式">${MODES.map((x) => html`<button type="button" class="m-mode" role="radio" aria-checked="${x.id === mode}" data-mode="${x.id}">${icon(x.icon)}<b>${x.name}</b><small>${x.limit}</small></button>`)}</div>
      <div class="m-modeopts">
        <label class="n-field"><span class="n-field__label">语言</span><select class="n-select" id="lang"><option ${lang === '普通话' ? 'selected' : ''}>普通话</option><option ${lang === '普通话 + 英文' ? 'selected' : ''}>普通话 + 英文</option></select></label>
        <label class="n-field"><span class="n-field__label">关联到</span><select class="n-select" id="rel"><option>Landing 第三期 · W2 导师团复盘</option><option>不关联</option></select></label>
      </div>
      <p class="nt-muted" style="text-align:center;margin:var(--s-2) 0 0">时长上限为占位值，联调后按真实规格填写。</p>
      <div class="m-actions">
        ${deny && mode !== 'upload' ? html`<div class="n-notice is-deny">${icon('mic')}<div><b>浏览器没有给麦克风权限。</b>可以先打字记下来，或者上传已有录音；之后在浏览器设置里打开麦克风再录。<div class="nt-row" style="margin-top:var(--s-2)"><a class="n-btn n-btn--sm n-btn--ink" href="quick.html">改为打字</a><button class="n-btn n-btn--sm" type="button" data-mode="upload">上传录音</button></div></div></div>`
          : mode === 'upload' ? html`<button class="n-btn n-btn--ink m-big" type="button" id="pick">${icon('upload')}选择录音文件</button>`
            : html`<button class="m-recbtn" type="button" id="start" aria-label="开始录音"><i></i></button>`}
      </div>`);
    draw(); UI.mountIPs(main);
    main.onclick = (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) { mode = b.dataset.mode; draw(); UI.mountIPs(main); return; }
      if (e.target.closest('#start')) start(main);
      if (e.target.closest('#pick')) upload(main);
    };
    main.onchange = (e) => { if (e.target.id === 'lang') lang = e.target.value; };
  }

  function start(main) {
    const title = mode === 'obs' ? '观察速记' : 'W2 导师团复盘';
    const r = { mode, lang, title, t0: Date.now(), paused: false, line: 0, marks: [], notes: [] };
    M.rec.set(r);
    renderLive(main, r);
  }

  // 上传：选文件 → 上传进度 → 进入处理中
  async function upload(main) {
    mount(main, html`<div class="m-card" style="margin-top:var(--s-4)"><div class="n-task" data-state="uploading"><span class="n-task__icon">${icon('upload')}</span><div style="min-width:0"><div class="n-task__name">W2 导师团复盘.m4a</div><div class="n-task__state"><b>上传中</b> · <span id="up-n">0</span> MB / 182 MB · 上传完成前别关页面</div><div class="n-progress"><i id="up-bar" style="width:0%"></i></div></div><div class="n-task__acts"><button class="n-btn n-btn--sm n-btn--ghost" type="button" id="up-x">取消</button></div></div></div>`);
    let pct = 0, stop = false;
    $('#up-x').onclick = () => { stop = true; NT.toast('已取消上传'); renderMode(main); };
    while (pct < 100 && !stop) { await NT.wait(120); pct = Math.min(100, pct + 7); if (!$('#up-bar')) return; $('#up-bar').style.width = `${pct}%`; $('#up-n').textContent = Math.round(182 * pct / 100); }
    if (!stop) renderProcessing(main, { title: 'W2 导师团复盘', dur: 42 * 60 + 10 });
  }

  // ---------- 录制中 ----------
  let liveTimer = 0, lineTimer = 0;
  function renderLive(main, r) {
    step = 'live';
    const screen = $('#m-screen');
    $('.m-rec', screen)?.remove();
    const el = document.createElement('section');
    el.className = 'm-rec'; el.setAttribute('aria-label', '录制中');
    el.innerHTML = String(html`
      <div class="m-rec__top"><span class="n-recbar__dot"></span><b>${r.title}</b><span class="nt-muted">${MODES.find((x) => x.id === r.mode).name} · ${r.lang}</span></div>
      <div class="n-lock m-rec__awake">${icon('lock')}请保持亮屏：锁屏或切到后台会暂停录音，已录的分段已上传，回来可以接着录。</div>
      <div class="m-live" id="live" aria-live="polite"></div>
      <div class="m-recsheet">
        <div class="m-recsheet__meta"><span class="n-wave" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => html`<i style="animation-delay:${i * 0.15}s"></i>`)}</span><span id="rec-state">${r.paused ? '已暂停' : '录制中'}</span><span style="margin-left:auto"><b id="rec-time">00:00</b> / ${r.mode === 'obs' ? '10:00' : '120:00'}</span></div>
        <div class="m-tools"><button type="button" data-tool="flag">${icon('flag')}打标记</button><button type="button" data-tool="note">${icon('note')}随手记</button><button type="button" data-tool="at">${icon('at')}@某人</button></div>
        <div class="m-recmain"><button class="n-btn n-btn--ghost" type="button" id="rec-pause">${r.paused ? '继续' : '暂停'}</button><button class="m-stop" type="button" id="rec-stop" aria-label="完成录音"><i></i></button><button class="n-btn n-btn--ghost" type="button" id="rec-min">收起</button></div>
      </div>`);
    screen.append(el);
    const live = $('#live', el);
    const lines = r.mode === 'obs' ? [['00:05', st.me().id, '唐果方案被否之后，两天就拿出了新版本，改得挺彻底。'], ['00:18', st.me().id, '她还主动约客服又访谈了一次，新结构是按客服的说法排的。']] : W2.lines;
    const sp = (by) => `${st.person(by).name}${by === 'p-songchuan' ? ' · 助教' : by === 'p-yeqing' ? ' · 导师' : ''}`;
    const put = (i, done) => {
      const [, by, text] = lines[i];
      const prev = lines[i - 1];
      if (!prev || prev[1] !== by) live.insertAdjacentHTML('beforeend', `<div class="sp">${NT.esc(sp(by))} · ${M.fmt(M.rec.elapsed(r))}</div>`);
      const d = document.createElement('div'); d.dataset.i = i;
      if (r.marks.includes(i)) d.classList.add('flag');
      live.append(d);
      if (done) d.textContent = text;
      return d;
    };
    // 恢复：随手记和 @ 按插入时的位置放回句子之间
    const notesAt = (i) => r.notes.filter((n) => n.i === i).forEach((n) => live.insertAdjacentHTML('beforeend', n.html));
    for (let i = 0; i < r.line; i++) { notesAt(i); put(i, true); }
    notesAt(r.line);
    live.scrollTop = live.scrollHeight;
    const tick = () => { const t = $('#rec-time', el); if (t) t.textContent = M.fmt(M.rec.elapsed(r)); };
    tick(); clearInterval(liveTimer); liveTimer = setInterval(tick, 1000);
    // 逐句出现：未定稿的字是浅墨，定稿后落成正文
    const next = async () => {
      if (r.paused || r.stopped || r.line >= lines.length) return;
      const i = r.line; const d = put(i, false);
      const text = lines[i][2], cut = Math.ceil(text.length * 0.6);
      d.className = 'pending'; d.textContent = text.slice(0, cut);
      live.scrollTop = live.scrollHeight;
      await NT.wait(1200);
      if (r.stopped) return;
      d.className = r.marks.includes(i) ? 'flag' : ''; d.textContent = text;
      r.line = i + 1; M.rec.set(r);
      live.scrollTop = live.scrollHeight;
      lineTimer = setTimeout(next, NT.reduced ? 0 : 1600);
    };
    clearTimeout(lineTimer); lineTimer = setTimeout(next, 600);

    el.onclick = async (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      const at = M.fmt(M.rec.elapsed(r));
      if (tool === 'flag') {
        const cur = Math.max(0, r.line - 1);
        if (!r.marks.includes(cur)) r.marks.push(cur);
        $(`[data-i="${cur}"]`, live)?.classList.add('flag'); M.rec.set(r);
        NT.toast(`已在 ${at} 打标记，纪要里会跳到这一段`);
      }
      if (tool === 'note') {
        const v = await NT.dialog({ title: `随手记 · ${at}`, body: html`<textarea class="n-eventin__field" id="nt-note" rows="3" style="width:100%" placeholder="比如：林知远这里的说法要和周报对一下"></textarea>`,
          actions: [{ label: '插入', value: 'ok', cls: 'n-btn--ink', validate: (d) => !!d.querySelector('#nt-note').value.trim(), read: (d) => d.querySelector('#nt-note').value.trim() }, { label: '取消', value: 'cancel', cls: 'n-btn--ghost' }],
          onOpen: (d) => d.querySelector('#nt-note').focus() });
        if (v?.value === 'ok') { const n = `<div class="m-live__note">${icon('note')}<span class="ink-hand">${NT.esc(v.data)}</span><small>随手记 · ${at}</small></div>`; r.notes.push({ i: r.line, kind: 'note', html: n }); live.insertAdjacentHTML('beforeend', n); M.rec.set(r); live.scrollTop = live.scrollHeight; }
      }
      if (tool === 'at') {
        const ids = st.batch('b-land3').newcomers.map((n) => n[0]).filter((id) => st.scope(id));
        const pid = await NT.dialog({ title: `在 ${at} 关联一个人`, sub: '这一段会作为这个人的证据来源，整理时优先归到他名下',
          body: html`<ul class="m-list">${ids.map((id) => html`<li><button class="m-row m-rolebtn" type="button" data-value="${id}">${UI.avatar(id, 'sm')}<span>${st.person(id).name}<small>${st.project(st.landingOf(id).row[1]).name}</small></span><span></span></button></li>`)}</ul>`,
          actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }] });
        if (st.person(pid)) { const n = `<div class="m-live__at">@${NT.esc(st.person(pid).name)} <small>${at}</small></div>`; r.notes.push({ i: r.line, kind: 'at', html: n }); live.insertAdjacentHTML('beforeend', n); M.rec.set(r); live.scrollTop = live.scrollHeight; }
      }
      if (e.target.closest('#rec-pause')) {
        r.paused = !r.paused;
        if (r.paused) r.pausedAt = Date.now(); else { r.t0 += Date.now() - r.pausedAt; delete r.pausedAt; }
        M.rec.set(r);
        $('#rec-pause', el).textContent = r.paused ? '继续' : '暂停';
        $('#rec-state', el).textContent = r.paused ? '已暂停' : '录制中';
        el.classList.toggle('is-paused', r.paused);
        if (!r.paused) { clearTimeout(lineTimer); lineTimer = setTimeout(next, 400); }
      }
      if (e.target.closest('#rec-min')) { M.rec.set(r); location.href = 'index.html'; }
      if (e.target.closest('#rec-stop')) {
        r.stopped = true; clearInterval(liveTimer); clearTimeout(lineTimer);
        const dur = M.rec.elapsed(r);
        M.rec.set(null);
        el.remove();
        renderProcessing(main, { title: r.title, dur, marks: r.marks.length, notes: r.notes.filter((n) => n.kind === 'note').length, ats: r.notes.filter((n) => n.kind === 'at').length });
      }
    };
    el.classList.toggle('is-paused', r.paused);
  }
  // ---------- 处理中：可以直接返回，结果回到工作台 ----------
  async function renderProcessing(main, info) {
    step = 'processing';
    const S = st.get();
    let task = S.tasks.find((t) => t.id === 'tk-live');
    if (!task) { task = { id: 'tk-live', name: `${info.title}.m4a`, state: 'shaping', live: true, minutes: 'w2', by: st.me().id, note: '转写完成，正在整理事件', link: 'record.html?m=w2', readyAt: Date.now() + 9000 }; S.tasks.unshift(task); st.save(); }
    mount(main, html`
      <div class="n-player m-card" style="margin-top:var(--s-2)"><button class="n-player__play nt-play" type="button" aria-label="播放">${icon('play')}</button><div class="n-player__track">${Array.from({ length: 48 }, (_, i) => raw(`<i style="height:${30 + Math.round(Math.abs(Math.sin(i * 1.7)) * 70)}%"></i>`))}</div><span>${M.fmt(info.dur)}</span></div>
      <div class="m-proc"><span class="nt-ip" data-ip="thinking" data-size="72" id="proc-ip"></span><div><b id="proc-t">转写与整理中</b><p class="nt-muted" id="proc-s">约需 1–3 分钟，可以直接返回。结果会出现在工作台的「进行中的任务」里。</p></div></div>
      <div class="m-card">${UI.trail('处理这段录音 · 5 步', ['上传完成', '转写 · 区分说话人', '提取人员与项目', '整理关键事件', '标出需要人确认的地方'])}</div>
      ${info.marks || info.notes || info.ats ? html`<p class="nt-muted">${[info.marks && `${info.marks} 个标记`, info.notes && `${info.notes} 条随手记`, info.ats && `${info.ats} 处 @`].filter(Boolean).join('、')}会一起带进纪要。</p>` : ''}
      <div class="m-actions"><a class="n-btn n-btn--ink m-big" href="index.html" id="proc-go">回到工作台</a></div>`);
    UI.mountIPs(main);
    await NT.runTrail($('.n-trail', main), 900);
    if (!$('#proc-ip')) return;
    task.state = 'partial'; task.note = '9 条事件已整理，3 处待核对'; delete task.readyAt; st.save();
    NT.ipState($('#proc-ip'), 'done');
    $('#proc-t').textContent = '人才纪要已生成';
    $('#proc-s').textContent = '9 条事件已整理，3 处需要你确认是谁。演示里使用预先处理好的 W2 导师团复盘纪要。';
    mount($('.m-actions', main), html`<a class="n-btn n-btn--ink m-big" href="record.html?m=w2">查看人才纪要</a><a class="n-btn n-btn--ghost" href="index.html">回到工作台</a>`);
  }

  // ---------- 人才纪要 ----------
  function renderMinutes(main) {
    const m = NT.SEED.MINUTES[minutesId];
    if (!m) { mount(main, UI.state({ ip: 'confirm', title: '没有找到这份纪要' })); return; }
    if (!st.canOpenMinutes(minutesId)) { mount(main, UI.state({ ip: 'confirm', title: '这个视角看不到这份纪要', text: '会议纪要只对录入人、该批次的导师、学员的归属 HRBP 和 CEO 可见。' })); return; }
    const S = st.get();
    const evs = m.events.map((id) => st.event(id)).filter(Boolean);
    const verify = S.inbox.filter((i) => i.src === m.title);
    const durS = 42 * 60 + 10;
    const toS = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
    const N = 56;
    mount(main, html`
      <h2 class="m-mtitle">${m.title}</h2>
      <p class="nt-muted" style="margin:0 0 var(--s-3)">${m.mode} · ${m.dur} · ${st.person(m.by).name}录制 · ${NT.md(m.at)} · <span class="n-badge n-badge--preset">预先处理的演示任务</span></p>
      <div class="n-player m-card m-player"><button class="n-player__play nt-play" type="button" aria-label="播放">${icon('play')}</button><div class="n-player__track" id="track">${Array.from({ length: N }, (_, i) => raw(`<i class="${m.marks.some((t) => Math.abs(t / durS * N - i) < 0.6) ? 'is-mark' : ''}" style="height:${30 + Math.round(Math.abs(Math.sin(i * 1.7)) * 70)}%"></i>`))}</div><span id="ptime">00:00 / ${m.dur}</span></div>
      <div class="n-tabs" role="tablist" id="mtabs">
        <button role="tab" type="button" aria-selected="true" aria-controls="mp-1" data-tab="sum">纪要</button>
        <button role="tab" type="button" aria-selected="false" aria-controls="mp-2" data-tab="text" tabindex="-1">文字记录</button>
      </div>
      <div class="n-tabpanel" role="tabpanel" id="mp-1">
        <p class="n-minutes__sum" id="sum"></p>
        <div class="n-minutes__people">${m.people.filter(([pid]) => st.scope(pid)).map(([pid, n]) => html`<a class="nt-plink" href="person.html?id=${pid}"><span>${UI.avatar(pid, 'sm')}${st.person(pid).name} · ${n} 条</span></a>`)}</div>
        <h3 class="m-h">新事件 · ${evs.length} 条</h3>
        ${evs.map((e) => {
          const pend = e.scores.filter((s) => s.st === 'ai').length, conf = e.scores.some((s) => s.st === 'conflict');
          const who = st.person(e.people[0]), loc = e.srcs.find((x) => x.type === 'audio')?.loc;
          const t = loc?.match(/\d\d:\d\d/)?.[0];
          return html`<div class="n-minievent m-mev"><div><a class="nt-plink" href="person.html?id=${who.id}#ev-${e.id}">${e.title}</a><small>${who.name} · ${e.scores.filter((s) => s.v != null).map((s) => `${st.dim(s.d).name} ${s.v}`).join('、') || '—'}${t ? html` · <button class="nt-linkbtn" type="button" data-seek="${t}">${icon('play', 9)} ${t}</button>` : ''}</small></div>${conf ? html`<span class="n-badge n-badge--conflict">${icon('split')}待校准</span>` : pend ? html`<span class="n-badge n-badge--ai">${icon('spark')}${pend} 项待确认</span>` : html`<span class="n-badge n-badge--yes">${icon('check')}已确认</span>`}</div>`;
        })}
        ${verify.length ? html`<h3 class="m-h">待核对 · ${verify.filter((v) => !v.done).length} 处</h3>${verify.map((v) => html`<a class="n-minievent nt-plink m-mev" href="inbox.html#${v.id}"><div>${v.q}<small>${v.at} · ${st.person(v.by).name}</small></div>${v.done ? html`<span class="n-badge n-badge--yes">${icon('check')}已核对</span>` : html`<span class="n-badge n-badge--ai">${icon('spark')}去核对</span>`}</a>`)}` : ''}
        <ul class="m-list" style="margin-top:var(--s-4)">
          ${['mentor', 'hrbp'].includes(st.role()) ? M.row('mentor.html', icon('users'), '导师逐个确认建议分', 'W2 对人复盘') : ''}
          ${M.row('inbox.html', icon('spark'), '核对人名和项目', `${verify.filter((v) => !v.done).length} 处待核对`)}
        </ul>
      </div>
      <div class="n-tabpanel" role="tabpanel" id="mp-2" hidden>
        <ol class="n-transcript">${m.lines.map(([t, by, text, flag]) => html`<li class="${flag === 'flag' ? 'is-flag' : ''}"><time><button class="nt-linkbtn" type="button" data-seek="${t}">${t}</button></time><div><b>${st.person(by).name} · ${by === 'p-songchuan' ? '助教' : '导师'}</b>${flag === 'verify' ? raw(NT.esc(text).replace(/(小王|宋老师)/, '<mark>$1</mark>')) : text}</div></li>`)}</ol>
      </div>
      <div id="answers"></div>
      <div class="m-ask">
        <div class="m-chips" style="margin-bottom:var(--s-2)">${m.asks.map((a) => html`<button class="n-ask" type="button" data-ask="${a}">${a}</button>`)}</div>
        <div class="m-ask__bar"><button class="m-hold m-hold--sm" type="button" id="ask-hold" aria-label="按住说话">${icon('mic')}</button><input class="n-input" id="ask-q" placeholder="按住说话，或轻点输入追问" aria-label="追问"><button class="n-btn n-btn--icon n-btn--ink" type="button" id="ask-go" aria-label="发送">${icon('up')}</button></div>
      </div>`);
    tabsApi = NT.tabs($('#mtabs'));
    NT.stream($('#sum'), m.summary, 16);
    const seek = (t) => {
      const s = toS(t), i = Math.round(s / durS * N);
      $$('#track i').forEach((b, k) => b.classList.toggle('is-played', k <= i));
      $('#ptime').textContent = `${t} / ${m.dur}`;
      $('.m-player').scrollIntoView({ block: 'nearest', behavior: NT.reduced ? 'auto' : 'smooth' });
    };
    const ask = async (q) => {
      if (!q) return;
      const box = document.createElement('div');
      box.className = 'n-block'; box.dataset.state = 'light'; box.style.marginTop = 'var(--s-3)';
      box.innerHTML = `<div class="nt-muted" style="margin-bottom:4px">${NT.esc(q)}</div><span class="a"></span><span class="n-caret"></span>`;
      $('#answers').append(box);
      box.scrollIntoView({ block: 'end', behavior: NT.reduced ? 'auto' : 'smooth' });
      await NT.wait(500);
      await NT.stream($('.a', box), m.answers[q] || '这次会议里没有找到直接相关的内容。可以换个问法，或者试试下面推荐的问题。', 20);
      $('.n-caret', box)?.remove();
      box.insertAdjacentHTML('beforeend', '<div class="n-block__by"><span class="n-src n-src--ai"><svg><use href="#i-spark"/></svg>AI 回答</span>只引用这次会议里你有权限查看的内容</div>');
      box.scrollIntoView({ block: 'end', behavior: NT.reduced ? 'auto' : 'smooth' });
    };
    main.onclick = (e) => {
      const s = e.target.closest('[data-seek]'); if (s) { seek(s.dataset.seek); NT.toast(`跳到 ${s.dataset.seek}`); return; }
      const a = e.target.closest('[data-ask]'); if (a) ask(a.dataset.ask);
      if (e.target.closest('#ask-go')) { const q = $('#ask-q').value.trim(); $('#ask-q').value = ''; ask(q); }
    };
    $('#ask-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = e.target.value.trim(); e.target.value = ''; ask(q); } });
    M.hold($('#ask-hold'), $('#ask-q'), m.asks[1], { onEnd: (q) => { $('#ask-q').value = ''; ask(q); } });
    if (NT.param('tab') === 'text') tabsApi.pick('text');
  }
})();
