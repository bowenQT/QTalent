/* 工作台：首屏「变化」，然后是一句话输入、待办、进行中的任务与上传。按视角呈现不同内容。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $, $$ } = NT;
  let base = 'win', type = 'all', expanded = false;

  const SUGGEST = {
    ceo: ['新转化团队要找一个能带 SDR 和 SMB 的 owner，11 月到岗', '谢灵这周主动整理了 SDR 交接清单，迎接并入'],
    hrbp: ['陆川这周主动帮许清和理清了投放口径，还整理成了文档', '为增长产品部发起 2026 H2 盘点'],
    lead: ['顾南今天独立处理了一个大客户故障，自己写了复盘', '灰度发布平台要找一个 owner'],
    mentor: ['唐果今天方案被问住了，第二天主动约了客服再访谈一次', '林知远这周排查缓存时先缩小了范围再动手'],
  };

  function greet(me) {
    const h = new Date().getHours();
    return `${h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'}，${me.name}`;
  }

  NT.shell({
    nav: 'work', title: '工作台',
    view: () => `变化：${base === 'win' ? '近 3 个月 vs 之前' : 'vs 2026 H1'}${type !== 'all' ? ` · 筛选 ${type}` : ''}`,
    state: () => ({ base, type }),
    restore: (s) => { base = s.base || base; type = s.type || type; renderChanges(); },
    render(main) {
      const role = st.role(), me = st.me();
      if (role === 'self') return renderSelf(main, me);
      const todos = st.todos();
      mount(main, html`
        <header class="nt-head"><div><h1>${greet(me)}</h1><p>10 月 23 日 · 周五 · ${role === 'mentor' ? 'Landing 第三期 W3 · 本周五 16:00 对事复盘' : role === 'ceo' ? '全公司 · 增长产品部 H2 盘点进行中' : `${st.roles[role].scope}`}</p></div></header>

        ${st.can('changes') ? html`<article class="n-card n-changes" id="changes" style="margin-bottom:var(--s-5)">
          <header class="n-changes__head"><h3>变化</h3><span class="n-changes__meta" id="chg-meta"></span>
            <div class="n-seg" role="group" aria-label="比较基准" data-manual id="chg-base">
              <button type="button" data-b="win" aria-pressed="true">近 3 个月 vs 之前</button>
              <button type="button" data-b="ver" aria-pressed="false">vs 2026 H1 档案版本</button>
            </div></header>
          <div class="n-chips" role="group" aria-label="按类型筛选" id="chg-filter">
            ${[['all', '全部'], ['trend', '能力走向'], ['activity', '活跃度与安排'], ['quad', '象限偏移'], ['team', '团队分布']].map(([k, l]) => html`<button class="n-chip" type="button" data-t="${k}" aria-pressed="${k === type}">${l}<b data-n="${k}"></b></button>`)}
          </div>
          <div id="chg-list"></div>
          <p class="nt-caption">只统计已确认的事件和分数，AI 建议分不会触发变化。资料从无到有不算上升；没有新事件不等于能力下降。变化按发生时间排列，不按幅度给人排名。</p>
        </article>` : ''}

        <div class="n-composer" id="composer" style="margin-bottom:var(--s-2)">
          <span class="nt-ip" data-ip="rest" data-size="36" id="composer-ip"></span>
          <textarea class="n-composer__field" rows="2" id="composer-field" aria-label="描述你要做的事" placeholder="${role === 'mentor' ? '说一件学员这周做的事，或输入 / 查看命令' : '说一件事，或描述一个项目要找谁。输入 / 查看命令'}"></textarea>
          <div class="n-composer__bar">
            <a class="n-btn n-btn--ghost n-btn--icon" href="#upload" aria-label="上传材料">${icon('clip')}</a>
            <button class="n-btn n-btn--ghost n-btn--icon" type="button" id="composer-mic" aria-label="按住说话" aria-pressed="false">${icon('mic')}</button>
            <span class="spacer"></span><span class="n-composer__hint">⌘ ↵ 发送</span>
            <button class="n-btn n-btn--ink n-btn--icon" type="button" id="composer-send" aria-label="发送">${icon('up')}</button>
          </div>
        </div>
        <div class="n-slash" id="slash" role="listbox" aria-label="命令" hidden>
          ${[['note', '记录关键事件', '/记', 'record.html'], st.can('findOwner') && ['folder', '为项目找 owner', '/找', 'staffing.html?new=1'], st.can('review') && role !== 'lead' && ['eye', '发起盘点', '/盘', 'reviews.html#new'], ['wave', '打开会议人才纪要', '/录', 'record.html?m=w2']].filter(Boolean).map(([ic, l, k, h], i) => html`<a class="n-slash__item" role="option" aria-selected="${i === 0}" href="${h}">${icon(ic, 16)}${l}<kbd>${k}</kbd></a>`)}
        </div>
        <div class="n-asks" style="margin:var(--s-2) 0 var(--s-6)">${(SUGGEST[role] || []).map((s) => html`<button class="n-ask" type="button" data-say="${s}">${s}</button>`)}</div>

        <div class="nt-cols">
          <article class="n-card" id="todo">
            <h3 class="n-section-title">待办${todos.length ? html`<span class="n-count">${todos.length}</span>` : ''}</h3>
            ${todos.length ? html`<ul class="n-todo">${todos.map((t) => html`<li><a href="${t.href}"><span class="n-badge ${t.cls || ''}">${t.icon ? icon(t.icon) : ''}${t.badge}</span><span>${t.title}<small>${t.sub}</small></span><span class="due">${t.due}</span></a></li>`)}</ul>`
              : UI.state({ ip: 'done', size: 48, title: '待办都处理完了', text: '新的待核对、校准和到期的跟踪会出现在这里。' })}
          </article>
          <div class="nt-grid">
            <article class="n-card"><h3 class="n-section-title">进行中的任务</h3><div id="tasks"></div></article>
            <article class="n-card" id="upload"><h3 class="n-section-title">上传材料</h3>
              <button class="n-drop" type="button" id="drop">${icon('upload')}<b>拖入文件，或点这里选择</b><small>TXT、MD、DOCX、PPTX、XLSX 和录音 · 解析结果写明能定位到段落、页、单元格还是时间点</small></button>
              <ul class="n-files" id="files"></ul>
            </article>
          </div>
        </div>`);
      wireComposer(role);
      renderTasks();
      wireUpload();
      if (st.can('changes')) {
        renderChanges();
        UI.wireChanges($('#chg-list'));
        $('#chg-base').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; base = b.dataset.b; $$('#chg-base button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderChanges(); });
        $('#chg-filter').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; type = b.dataset.t; $$('#chg-filter button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderChanges(); });
      }
    },
  });

  function renderChanges() {
    const host = $('#chg-list'); if (!host) return;
    const all = st.changes({ base });
    $$('#chg-filter [data-n]').forEach((b) => { const n = b.dataset.n === 'all' ? all.length : all.filter((c) => c.t === b.dataset.n).length; b.textContent = n ? ` ${n}` : ''; });
    $$('#chg-base button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.b === base));
    $$('#chg-filter button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.t === type));
    const list = all.filter((c) => type === 'all' || c.t === type);
    const scope = st.role() === 'ceo' ? '全公司' : st.role() === 'lead' ? '业务成功部' : '增长产品部、产品市场部';
    $('#chg-meta').textContent = `${scope} · ${list.length} 条，其中 ${list.filter((c) => c.hit).length} 条命中规则 · 规则版本 change-v1`;
    const cut = expanded ? list.length : 6;
    mount(host, list.length ? html`${list.slice(0, cut).map((c) => UI.change(c, base))}${list.length > cut ? html`<button class="n-btn n-btn--ghost n-btn--sm" type="button" id="chg-more" style="margin-top:var(--s-2)">再看 ${list.length - cut} 条</button>` : ''}` : html`<div class="nt-empty">这个类型下没有变化。</div>`);
    $('#chg-more')?.addEventListener('click', () => { expanded = true; renderChanges(); });
  }

  function wireComposer(role) {
    const field = $('#composer-field'), ipEl = $('#composer-ip'), slash = $('#slash');
    const go = () => {
      const q = field.value.trim();
      if (!q) { field.focus(); return; }
      NT.ipState(ipEl, 'thinking');
      const find = /找|owner|负责人|谁来/.test(q) && st.can('findOwner');
      const inv = /盘点/.test(q) && st.can('review');
      setTimeout(() => { location.href = inv ? 'reviews.html' : NT.link(find ? 'staffing.html' : 'record.html', find ? { new: 1, q } : { q }); }, NT.reduced ? 0 : 450);
    };
    field.addEventListener('input', () => { slash.hidden = !field.value.startsWith('/'); NT.ipState(ipEl, field.value ? 'listening' : 'rest'); });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
      if (!slash.hidden && (e.key === 'Enter')) { e.preventDefault(); location.href = slash.querySelector('[aria-selected="true"]').getAttribute('href'); }
      if (!slash.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const items = $$('.n-slash__item', slash), i = items.findIndex((x) => x.getAttribute('aria-selected') === 'true');
        const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((x, k) => x.setAttribute('aria-selected', k === n));
      }
      if (e.key === 'Escape') slash.hidden = true;
    });
    $('#composer-send').addEventListener('click', go);
    $('#composer-mic').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', on);
      NT.ipState(ipEl, on ? 'listening' : 'rest');
      if (on) {
        field.value = '';
        const say = (SUGGEST[role] || [''])[0];
        NT.stream(field, say, 40).then(() => { e.currentTarget.setAttribute('aria-pressed', 'false'); NT.ipState(ipEl, 'confirm'); });
      }
    });
    $$('[data-say]').forEach((b) => b.addEventListener('click', () => { field.value = b.dataset.say; field.focus(); NT.ipState(ipEl, 'listening'); }));
  }

  // 长任务：上传 → 排队 → 转写 → 整理 → 完成 / 部分待核对 / 失败
  const STATE = {
    uploading: ['upload', '上传中'], queued: ['clock', '已提交，排队中'], transcribing: ['wave', '转写中'], shaping: ['spark', '整理中'],
    partial: ['split', '部分待核对'], done: ['check', '已完成'], failed: ['x', '整理失败'],
  };
  function renderTasks() {
    const tasks = st.get().tasks;
    mount($('#tasks'), tasks.map((t) => {
      const [ic, label] = STATE[t.state];
      const act = {
        uploading: html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel="${t.id}">取消</button>`,
        partial: html`<a class="n-btn n-btn--sm" href="${t.link || 'inbox.html'}">去核对</a>`,
        done: html`<a class="n-btn n-btn--sm n-btn--ghost" href="landing.html">查看</a>`,
        failed: html`<button class="n-btn n-btn--sm" type="button" data-retry="${t.id}">${icon('retry')}重试整理</button>`,
        shaping: html`<a class="n-btn n-btn--sm n-btn--ghost" href="record.html?m=w2&tab=text">看转写</a>`,
      }[t.state] || '';
      const bar = t.state === 'uploading' ? html`<div class="n-progress"><i style="width:${t.progress}%"></i></div>` : ['transcribing', 'shaping'].includes(t.state) ? html`<div class="n-progress is-indeterminate"><i></i></div>` : '';
      return html`<div class="n-task" data-state="${t.state}" data-id="${t.id}"><span class="n-task__icon">${icon(ic)}</span><div><div class="n-task__name">${t.name}${t.preset ? html` <span class="n-badge n-badge--preset">预先处理的演示任务</span>` : ''}</div><div class="n-task__state"><b>${label}</b> · ${t.note}</div>${bar}</div><div class="n-task__acts">${act}</div></div>`;
    }));
    $('#tasks').onclick = (e) => {
      const r = e.target.closest('[data-retry]'), c = e.target.closest('[data-cancel]');
      if (r) retry(r.dataset.retry);
      if (c) { const t = tasks.find((x) => x.id === c.dataset.cancel); const i = tasks.indexOf(t); tasks.splice(i, 1); st.save(); renderTasks(); NT.toast(`已取消上传「${t.name}」`, { undo: () => { tasks.splice(i, 0, t); st.save(); renderTasks(); } }); }
    };
    tickUpload();
  }
  let ticking = false;
  function tickUpload() {
    if (ticking) return; ticking = true;
    const loop = () => {
      const t = st.get().tasks.find((x) => x.state === 'uploading');
      if (!t || !document.body.contains($('#tasks'))) { ticking = false; return; }
      t.progress = Math.min(100, t.progress + 3);
      const mb = Math.round(182 * t.progress / 100);
      const el = $(`.n-task[data-id="${t.id}"]`);
      if (t.progress >= 100) { t.state = 'queued'; t.note = `${NT.nowStamp().slice(6)} 提交 · 可以离开，结果会回到这里`; st.save(); ticking = false; renderTasks(); return; }
      if (el) { $('.n-progress i', el).style.width = `${t.progress}%`; $('.n-task__state', el).innerHTML = `<b>上传中</b> · 182 MB 中的 ${mb} MB · 上传完成前别关页面`; }
      setTimeout(loop, 700);
    };
    setTimeout(loop, 700);
  }
  async function retry(id) {
    const t = st.get().tasks.find((x) => x.id === id);
    t.state = 'shaping'; t.note = '重新提取人员和事件'; renderTasks();
    await NT.wait(2400);
    t.state = 'partial'; t.note = '4 条事件已整理，1 处人名待确认'; t.link = 'inbox.html'; st.save(); renderTasks();
    NT.toast('「导师访谈.m4a」整理完成，1 处待核对');
  }

  function wireUpload() {
    const files = $('#files');
    const add = async (name, ext, steps, final) => {
      const li = document.createElement('li'); li.className = 'n-file';
      li.innerHTML = `<span class="n-file__ext">${ext}</span><div style="min-width:0"><div class="n-file__name">${NT.esc(name)}</div><div class="n-file__state">上传中</div><div class="n-progress"><i style="width:0%"></i></div></div><span></span>`;
      files.prepend(li);
      const bar = $('.n-progress i', li), state = $('.n-file__state', li);
      for (let p = 0; p <= 100; p += 20) { bar.style.width = `${p}%`; await NT.wait(160); }
      $('.n-progress', li).classList.add('is-indeterminate');
      for (const s of steps) { state.textContent = s; await NT.wait(900); }
      $('.n-progress', li).remove();
      state.innerHTML = final[0]; li.lastElementChild.outerHTML = final[1];
    };
    $('#drop').addEventListener('click', () => add('W3 对事复盘纪要.docx', 'DOCX', ['解析中 · 读取 9 段', '整理中 · 提取人员和事件'],
      ['<span class="ok">已解析</span> · 9 段，定位到段落 · 提取 2 条事件待确认 · 已关联「Landing 第三期」', '<a class="n-btn n-btn--sm" href="record.html?q=W3%20对事复盘：唐果主动约了客服再访谈一次">确认事件</a>']));
    ['dragover', 'dragenter'].forEach((t) => $('#drop').addEventListener(t, (e) => { e.preventDefault(); e.currentTarget.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => $('#drop').addEventListener(t, (e) => { e.preventDefault(); e.currentTarget.classList.remove('is-over'); }));
    $('#drop').addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0]; if (!f) return;
      const ext = (f.name.split('.').pop() || '').toUpperCase();
      if (ext === 'PDF') add(f.name, 'PDF', [], ['<span class="err">暂不支持 PDF</span> · 本期只处理文字、Office 文件和录音。可以另存为 DOCX，或直接粘贴文字', '<a class="n-btn n-btn--sm n-btn--ghost" href="record.html">粘贴文字</a>']);
      else add(f.name, ext.slice(0, 4), ['解析中', '整理中 · 提取人员和事件'], ['<span class="ok">已解析</span> · 原型不读取真实文件内容，这里只演示状态流转', '<span></span>']);
    });
  }

  // 员工本人：只看本人经历、参与的项目和发布给本人的行动
  function renderSelf(main, me) {
    const S = st.get();
    const pub = S.pubActions.filter((a) => a.person === me.id);
    const projs = st.projectsOf(me.id);
    mount(main, html`
      <header class="nt-head"><div><h1>${greet(me)}</h1><p>这里是你自己的资料：经历、参与的项目和发布给你的安排。你可以补充经历、写下意愿、提出纠错。</p></div></header>
      <div class="nt-cols">
        <article class="n-card"><h3 class="n-section-title">发布给你的</h3>
          ${pub.length ? pub.map((a) => html`<div class="n-pubaction" style="margin-bottom:var(--s-2)"><div>${a.title}<small>${st.person(a.by).name}发布给你 · ${NT.md(a.at)}</small></div><span class="n-astate" data-s="todo">待安排</span></div>`) : html`<div class="nt-empty">还没有发布给你的安排。</div>`}
          <div class="n-self__acts">
            <a class="n-btn n-btn--sm" href="person.html?id=${me.id}&add=exp">${icon('plus')}补充经历</a>
            <a class="n-btn n-btn--sm" href="person.html?id=${me.id}&add=will">${icon('quote')}写意愿</a>
            <a class="n-btn n-btn--sm n-btn--ghost" href="person.html?id=${me.id}&add=fix">${icon('pen')}提出纠错</a>
          </div>
        </article>
        <article class="n-card"><h3 class="n-section-title">我参与的项目</h3>
          <ul class="n-members">${projs.map((m) => html`<li><a class="nt-plink" href="project.html?id=${m.p.id}"><b>${m.p.name}</b></a><span class="n-members__role">${m.role} · ${m.mode}</span><span class="n-members__when">${NT.md(m.from)} 起</span></li>`)}</ul>
        </article>
      </div>
      <div class="n-lock" style="margin-top:var(--s-4)">${icon('lock')}维度分、象限、他人的评价、变化和「值得聊一聊」对本人不可见。</div>`);
  }
})();
