/* Niu-Talent 原型：共用的界面片段。只拼 HTML 与少量行为，数据和权限从 NT.store 取。 */
(function () {
  'use strict';
  const NT = window.NT;
  const st = NT.store;
  const { html, raw, icon, esc, mount } = NT;
  const UI = (NT.ui = {});
  // 页面所在目录：桌面 app/、手机 m/ 都在 prototype/ 下一级
  UI.root = '..';

  UI.demo = () => html`<span class="n-badge n-badge--demo">演示</span>`;
  UI.avatar = (pid, size = '') => {
    const p = st.person(pid);
    if (!p) return html`<span class="n-avatar ${size ? `n-avatar--${size}` : ''}" style="--hue:0;background:var(--sheet-sunk)">?</span>`;
    return html`<span class="n-avatar ${size ? `n-avatar--${size}` : ''}" style="--hue:${p.hue}">${p.photo ? raw(`<img src="${UI.root}/assets/avatars/${p.photo}.jpg" alt="">`) : ''}${p.name[0]}</span>`;
  };
  // 人才评价规则的页头：标题 → 两个页签 → 当前页签的说明。规则是标准本身，判断对照用前后两段判断检验标准，结论回到规则修订
  UI.evalHead = (cur, desc) => html`<header class="nt-head nt-head--tabs"><div><h1>人才评价规则</h1></div></header>
    <nav class="n-tabs nt-subtabs" aria-label="人才评价规则">${[['rules', '规则', 'rules.html'], ['judge', '判断对照', 'judge.html']].map(([k, l, h]) => html`<a href="${h}" ${raw(k === cur ? 'aria-current="page"' : '')}>${l}</a>`)}</nav>
    <p class="nt-tabdesc">${desc}</p>`;
  // 人才项目的页头：各期工作区和关键节点复盘是同一个入口下的两个页签；看不到复盘的视角（导师）只有工作区，不显示页签
  UI.programHead = (cur, desc) => {
    const tabs = [['landing', 'XEngineer 第六期', 'landing.html'], ...(['ceo', 'hrbp', 'lead'].includes(st.role()) ? [['actions', '关键节点复盘', 'actions.html']] : [])];
    return html`<header class="nt-head nt-head--tabs"><div><h1>人才项目</h1></div></header>
    ${tabs.length > 1 ? html`<nav class="n-tabs nt-subtabs" aria-label="人才项目">${tabs.map(([k, l, h]) => html`<a href="${h}" ${raw(k === cur ? 'aria-current="page"' : '')}>${l}</a>`)}</nav>` : ''}
    <p class="nt-tabdesc">${desc}</p>`;
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
  UI.tplTitle = (t) => `找${/^[A-Za-z]/.test(t.name) ? ' ' : ''}${t.name}`; // 中英文之间留空格：找 FDE
  UI.dotsInline = (v, state = 'confirmed') => html`<span class="n-score n-score--inline" data-state="${state}">${UI.dots(v)}</span>`;

  // ---------- 对人复盘的评价：和事件证据分开呈现；AI 草拟是光，采用或改写后落墨署名 ----------
  let evalEditing = null;
  const EVAL_FROM = { ai: '采用 AI 草拟', edit: '改写 AI 草拟', new: '写下评价', fix: '修正评价' };
  UI.reviewEval = (pid, week, row) => {
    const d = row.d, saved = st.reviewEval(pid, week, d.id), draft = st.reviewEvalDraft(pid, row), can = st.canEditReview(pid);
    if (can && evalEditing === `${pid}-${week}-${d.id}`) {
      return html`<div class="n-review__eval" data-eval="${d.id}"><label class="n-review__evlabel" for="rv-eval-${d.id}">${d.name} · 评价</label>
        <textarea class="n-calib__reason" id="rv-eval-${d.id}" rows="3" placeholder="写这一项的评价：看到了什么行为，接近哪一档">${saved?.text || draft}</textarea>
        <div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-eval-save="${d.id}">保存评价</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-eval-cancel>取消</button><span class="nt-muted">保存后署名，旧版本保留</span></div></div>`;
    }
    if (saved) {
      const n = st.reviewEvalHist(pid, week, d.id).length;
      return html`<div class="n-block n-review__eval" data-state="ink" data-eval="${d.id}">${saved.text}<div class="n-block__by"><span class="n-block__sig">${st.person(saved.by).name}</span>${NT.md(saved.at)} ${EVAL_FROM[saved.from] || '写下评价'}${n > 1 ? ` · 改过 ${n - 1} 次` : ''}${can ? html`<button class="n-btn n-btn--sm n-btn--ghost n-review__evact" type="button" data-eval-edit="${d.id}">${icon('pen')}修正</button>` : ''}</div></div>`;
    }
    if (draft) {
      return html`<div class="n-block n-review__eval" data-state="light" data-eval="${d.id}">${draft}<div class="n-block__by"><span class="n-src n-src--ai">${icon('spark')}AI 草拟 · 仅供参考</span>${can ? html`<span class="n-review__evact"><button class="n-btn n-btn--sm" type="button" data-eval-adopt="${d.id}">${icon('check')}采用</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-eval-edit="${d.id}">${icon('pen')}改写</button></span>` : ''}</div></div>`;
    }
    return can ? html`<div class="n-review__eval" data-eval="${d.id}"><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-eval-edit="${d.id}">${icon('pen')}写评价</button></div>` : '';
  };
  // 页面的点击处理先交给这里；处理了返回 true
  UI.reviewEvalClick = (ev, pid, week, rerender) => {
    const b = ev.target.closest('[data-eval-adopt], [data-eval-edit], [data-eval-save], [data-eval-cancel]');
    if (!b) return false;
    if ('evalCancel' in b.dataset) { evalEditing = null; rerender(); return true; }
    if (b.dataset.evalEdit) {
      const dim = b.dataset.evalEdit; evalEditing = `${pid}-${week}-${dim}`; rerender();
      const t = document.getElementById(`rv-eval-${dim}`); t?.focus(); t?.setSelectionRange(t.value.length, t.value.length);
      return true;
    }
    const dim = b.dataset.evalAdopt || b.dataset.evalSave;
    const saved = st.reviewEval(pid, week, dim), draft = st.reviewEvalDraft(pid, st.review(pid, week).rows.find((x) => x.d.id === dim));
    let text = draft, from = 'ai';
    if (b.dataset.evalSave) {
      const t = document.getElementById(`rv-eval-${dim}`); text = t.value.trim();
      if (!text) { t.focus(); t.placeholder = '至少写一句；保持原样就点取消'; return true; }
      if (saved && text === saved.text) { evalEditing = null; rerender(); return true; }
      from = saved ? 'fix' : text === draft ? 'ai' : draft ? 'edit' : 'new';
    }
    const undo = st.setReviewEval(pid, week, dim, text, from);
    if (!undo) return true;
    evalEditing = null; rerender();
    NT.toast(`${from === 'ai' ? '已采用 AI 草拟' : '评价已保存'}，署名 ${st.me().name}${saved ? '，旧版本保留' : ''}`, { undo: () => { undo(); rerender(); } });
    return true;
  };
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
    // 有时间段的录音（含附件里的录音、视频音轨）可以就地播放那一段
    const audio = (src.type === 'audio' || src.type === 'video') && /\d:\d\d/.test(src.loc || '');
    const ic = { audio: 'wave', video: 'play', doc: 'doc', slide: 'doc', sheet: 'doc', note: 'note' }[src.type] || 'doc';
    const quote = src.quote ? html`<p class="n-cite__quote">${src.quote}</p>` : '';
    return html`<span class="n-cite"><button class="n-cite__mark" ${raw(audio ? 'data-kind="audio"' : '')} type="button" aria-label="引用 ${n}：${src.label}">${n}</button><span class="n-cite__pop" role="tooltip"><span class="n-cite__src">${icon(ic, 14)}${src.label} · ${src.loc}${src.by ? ` · ${st.person(src.by)?.name}` : ''}</span>${quote}${audio ? html`<span class="n-cite__foot"><button class="n-player__play nt-play" type="button" style="width:26px;height:26px" aria-label="播放这一段">${icon('play', 10)}</button><span style="font-size:var(--t-xs);color:var(--ink-3)">播放 ${src.loc.match(/\d+:\d\d/)[0]} 起的 10 秒</span></span>` : ''}</span></span>`;
  };
  UI.cites = (srcs) => (srcs || []).map((s, i) => UI.cite(s, i + 1));

  // ---------- 附件（v1.5 3.34）：记一件事时附上多个文件，解析完成后作为这件事的出处一起保存 ----------
  // 原型不读取真实文件内容：上传、解析、失败只演示状态，引用位置按文件名生成示意；文件名含「扫描」的 PDF 演示识别不出文字
  const ATT_KINDS = [
    [['pdf'], 'doc', 'PDF', '页'],
    [['doc', 'docx', 'txt', 'md'], 'doc', '文档', '段'],
    [['ppt', 'pptx'], 'slide', '演示文稿', '页'],
    [['xls', 'xlsx', 'csv'], 'sheet', '表格', '格'],
    [['mp3', 'm4a', 'wav', 'aac'], 'audio', '录音', '时'],
    [['mp4', 'mov', 'webm', 'm4v'], 'video', '视频', '时'],
  ];
  const ATT_SIZE = 2 * 1024 ** 3;
  UI.ATT_MAX = 10;
  UI.ATT_ACCEPT = ATT_KINDS.flatMap(([exts]) => exts.map((x) => `.${x}`)).join(',');
  UI.ATT_TYPES = 'PDF、Word、PPT、Excel、TXT / MD、音频和视频';
  UI.attachKind = (name) => {
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
    const k = ATT_KINDS.find(([exts]) => exts.includes(ext));
    return { ext: (ext || '?').toUpperCase().slice(0, 4), type: k?.[1], label: k?.[2], unit: k?.[3], ok: !!k };
  };
  // 不能加入的原因；能加入返回空。记录页的附件和工作台的上传材料共用
  UI.attachCheck = (f) => {
    const k = UI.attachKind(f.name);
    return !k.ok ? `暂时读不了 .${k.ext.toLowerCase()} 格式，可以上传 ${UI.ATT_TYPES}` : (f.size || 0) > ATT_SIZE ? '超过 2 GB，传不上来；可以先剪成几段再传' : '';
  };
  // 解析后的引用位置（示意）：文档到段，PDF 与演示文稿到页，表格到单元格，音视频到时间段
  UI.attachLoc = (name, unit) => {
    const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
    const t = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    return unit === '页' ? `第 ${2 + (h % 9)} 页` : unit === '段' ? `第 ${3 + (h % 12)} 段` : unit === '格' ? `「汇总」表 ${'BCDEF'[h % 5]}${4 + (h % 20)}`
      : `${t(180 + (h % 1500))}–${t(180 + (h % 1500) + 25)}`;
  };
  const attSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  UI.attachButton = (label) => (label
    ? html`<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-att-pick>${icon('clip')}${label}</button>`
    : html`<button class="n-btn n-btn--ghost n-btn--icon" type="button" data-att-pick aria-label="添加附件" title="添加附件：${UI.ATT_TYPES}">${icon('clip')}</button>`);
  // att = UI.attach({ key })：att.list(ul) 绑定列表，att.pick(btn) 绑定选择，att.drop(el) 绑定拖入；
  // att.srcs() 取已解析的出处，att.pending() 还在上传或解析的个数，att.lock() 保存后只读，keep / restore 跨「改原话」和撤销保留
  UI.attach = ({ key = 'rec' } = {}) => {
    let items = [], ul = null, locked = false, picker = null, fallback = null;
    const SKEY = `nty-att:${key}`;
    const input = document.createElement('input');
    Object.assign(input, { type: 'file', multiple: true, accept: UI.ATT_ACCEPT, hidden: true });
    document.body.append(input);
    const stateLine = (it) => (it.st === 'up' ? `上传中 · ${attSize(it.size)}`
      : it.st === 'parse' ? (it.unit === '时' ? '转写中…' : '解析中 · 识别文字')
        : it.st === 'err' ? html`<span class="err">${it.err}</span>`
          : it.scan ? html`<span class="ok">已上传</span> · 扫描件，未识别出文字，只作附件保存`
            : html`<span class="ok">已解析</span> · ${it.label} · ${attSize(it.size)} · 位置：${it.loc}`);
    // 按行更新：上传进度刷新时不重建整行，键盘焦点留在移除按钮上
    const paint = (li, it) => {
      const sig = `${it.st}|${it.pct}|${locked}`;
      if (li.dataset.sig === sig) return;
      li.dataset.sig = sig;
      mount(li.querySelector('.n-file__state'), stateLine(it));
      mount(li.querySelector('.n-file__prog'), it.st === 'up' ? html`<div class="n-progress"><i style="width:${it.pct}%"></i></div>` : it.st === 'parse' ? html`<div class="n-progress is-indeterminate"><i></i></div>` : '');
      if (locked) li.querySelector('.n-file__rm')?.remove();
    };
    const draw = () => {
      if (!ul) return;
      ul.hidden = !items.length;
      const ids = new Set(items.map((x) => x.id));
      [...ul.children].forEach((li) => { if (!ids.has(li.dataset.att)) li.remove(); });
      items.forEach((it, i) => {
        let li = [...ul.children].find((x) => x.dataset.att === it.id);
        if (!li) {
          li = document.createElement('li'); li.className = 'n-file'; li.dataset.att = it.id;
          mount(li, html`<span class="n-file__ext">${it.ext}</span><div style="min-width:0"><div class="n-file__name" title="${it.name}">${it.name}</div><div class="n-file__state"></div><div class="n-file__prog"></div></div><span>${locked ? '' : html`<button class="n-btn n-btn--ghost n-btn--icon n-file__rm" type="button" data-att-rm="${it.id}" aria-label="移除附件「${it.name}」">${icon('x')}</button>`}</span>`);
        }
        if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
        paint(li, it);
      });
    };
    const run = async (it) => {
      for (it.pct = 0; it.pct <= 100; it.pct += 25) { if (!items.includes(it)) return; draw(); await NT.wait(140); }
      it.st = 'parse'; draw();
      await NT.wait(it.unit === '时' ? 1600 : 1000);
      if (!items.includes(it)) return;
      if (it.ext === 'PDF' && /扫描/.test(it.name)) it.scan = true;
      else it.loc = UI.attachLoc(it.name, it.unit);
      it.st = 'ok'; draw();
    };
    const add = (files) => {
      const room = Math.max(UI.ATT_MAX - items.length, 0), list = [...files];
      if (list.length > room) NT.toast(`已加入前 ${room} 个附件，其余 ${list.length - room} 个请再选一次`);
      list.slice(0, room).forEach((f) => {
        if (items.some((x) => x.name === f.name && x.size === f.size)) { NT.toast(`「${f.name}」已经加过了`); return; }
        const k = UI.attachKind(f.name), err = UI.attachCheck(f);
        const it = { id: NT.uid('att'), name: f.name, size: f.size || 0, ext: k.ext, type: k.type, label: k.label, unit: k.unit, st: err ? 'err' : 'up', err, pct: 0 };
        items.push(it);
        if (!err) run(it);
      });
      draw();
    };
    input.addEventListener('change', () => { add(input.files); input.value = ''; });
    const api = {
      list(el) {
        ul = el; ul.replaceChildren(); ul.classList.add('n-files', 'n-attach'); ul.setAttribute('aria-live', 'polite');
        ul.addEventListener('click', (e) => {
          const b = e.target.closest('[data-att-rm]'); if (!b || locked) return;
          const i = items.findIndex((x) => x.id === b.dataset.attRm); if (i < 0) return;
          const [gone] = items.splice(i, 1); draw();
          // 焦点落到同一位置的下一个附件的移除按钮；没有了回到看得见的「添加附件」，整理确认页里回到页面给的落点
          const rms = ul.querySelectorAll('[data-att-rm]'), seen = (b) => b?.isConnected && b.getClientRects().length > 0;
          (rms[Math.min(i, rms.length - 1)] || (seen(picker) ? picker : fallback?.()))?.focus();
          NT.toast(`已移除「${gone.name}」`);
        });
        draw(); return api;
      },
      pick(btn) { picker = btn || picker; btn?.addEventListener('click', () => input.click()); return api; },
      fallback(fn) { fallback = fn; return api; },
      drop(el) {
        if (!el) return api;
        ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (e) => { if (locked || !e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); el.classList.add('is-dropping'); }));
        ['dragleave', 'drop'].forEach((t) => el.addEventListener(t, (e) => { if (t === 'dragleave' && el.contains(e.relatedTarget)) return; el.classList.remove('is-dropping'); }));
        el.addEventListener('drop', (e) => { if (locked || !e.dataTransfer?.files.length) return; e.preventDefault(); add(e.dataTransfer.files); });
        return api;
      },
      add,
      pending: () => items.filter((x) => x.st === 'up' || x.st === 'parse').length,
      // 出处：已解析的给到具体位置和原文示意；扫描件只作附件，不给位置
      srcs: () => items.filter((x) => x.st === 'ok').map((x) => (x.scan
        ? { type: x.type, att: 1, label: `附件：${x.name}`, loc: '扫描件，未识别出文字' }
        : { type: x.type, att: 1, label: `附件：${x.name}`, loc: x.loc, quote: `演示附件：这里显示${x.loc}的原文。` })),
      lock() { locked = true; items = items.filter((x) => x.st === 'ok'); draw(); },
      keep() { try { sessionStorage.setItem(SKEY, JSON.stringify(items.filter((x) => x.st === 'ok'))); } catch (e) { /* 存不下就不保留 */ } },
      restore() { try { const v = JSON.parse(sessionStorage.getItem(SKEY) || '[]'); if (Array.isArray(v)) items = v.filter((x) => x && x.id && x.st === 'ok'); } catch (e) { /* 忽略 */ } api.clear(); draw(); return api; },
      clear() { try { sessionStorage.removeItem(SKEY); } catch (e) { /* 忽略 */ } },
    };
    return api;
  };

  UI.scoreState = (s) => (s.st === 'calibrated' ? 'calibrated' : s.st === 'ai' ? 'ai' : s.st === 'unknown' ? 'unknown' : s.st === 'absent' ? 'absent' : 'confirmed');
  // 只读的一行维度分
  UI.scoreLine = (s, o = {}) => {
    const d = st.dim(s.d);
    if (s.st === 'conflict') {
      return html`<div class="n-score" data-state="confirmed"><span class="n-score__dim">${d.name}</span><span class="n-badge n-badge--conflict">${icon('split')}证据冲突 ${s.raters.map((r) => r.v).join(' / ')}</span><span class="n-score__note">${s.raters.map((r) => st.person(r.by).name).join('、')}分差 ≥ 2 · 待 HR 复核</span></div>`;
    }
    const state = UI.scoreState(s);
    const who = s.by ? st.person(s.by) : null;
    let note = s.note || '';
    if (state === 'confirmed' || state === 'calibrated') {
      note = html`${who ? html`<span class="ink-hand">${who.name}</span>` : ''}${state === 'calibrated' ? '校准' : '确认'}${s.ai != null && s.ai !== s.v ? html` · <span class="n-score__delta">${s.v > s.ai ? '+' : ''}${s.v - s.ai}</span> AI 原为 ${s.ai}` : ''}`;
    } else if (state === 'ai') note = html`<span class="n-src n-src--ai">${icon('spark')}AI 建议</span>${s.note ? ` · ${s.note}` : ''}`;
    const empty = state === 'unknown' ? html`<span class="n-score__empty n-badge n-badge--unknown">${icon('dash')}资料不足</span>` : state === 'absent' ? html`<span class="n-score__empty n-badge">未体现</span>` : '';
    return html`<div class="n-score" data-state="${state}" ${raw(o.hist && s.hist ? `data-hist="1"` : '')}><span class="n-score__dim">${d.name}</span>${UI.dots(s.v, { ghost: s.ai != null && s.ai > s.v && state !== 'ai' ? s.ai : null })}${empty}<span class="n-score__note">${note}${o.hist && s.hist ? html` <button class="n-link nt-hist" type="button">修订历史</button>` : ''}</span></div>`;
  };
  UI.history = (s, e) => {
    const rows = (s.hist || []).map((h) => html`<li><span class="n-history__v ${h.kind === 'ai' ? 'is-ai' : ''}">${h.v}</span><div>${h.why ? html`<span class="n-history__why">${h.why}</span>` : h.kind === 'ai' ? 'AI 建议' : h.kind === 'edit' ? '改分' : '确认'}<small>${h.kind === 'ai' ? `${st.eventRubric(e).v} · ${NT.md(h.at)}` : `${st.person(h.by)?.name} · ${{ calib: 'HR 校准', confirm: '确认', edit: '改分' }[h.kind]} · ${NT.md(h.at)}`}</small></div></li>`);
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
    const tags = (e.tags || []).map((t) => html`<span class="n-tag">${t}</span>`).concat((e.tagsAI || []).map((t) => html`<span class="n-tag is-candidate" title="标签库里还没有，等 HR 决定是否收录">${t}<small>候选</small></span>`));
    return html`<article class="n-card n-event nt-event" id="ev-${e.id}">
      <div class="n-event__head">${o.showPerson && e.people[0] ? html`${UI.avatar(e.people[0], 'sm')}<b class="n-event__who">${st.person(e.people[0]).name}</b>` : ''}
        ${UI.src(e.kind === 'self' ? 'self' : e.kind === 'hist' ? 'hist' : 'obs')}
        <span>${e.date ? NT.md(e.date) : '时间未知'} · ${st.person(e.recorder)?.name || ''}记录</span>
        ${proj ? html`<a class="n-badge" href="project.html?id=${proj.id}">${icon('folder')}${proj.type === 'XEngineer 课题' ? '课题' : '项目'}：${proj.name}</a>` : ''}${who}${roleNote}</div>
      <h3 class="n-event__title">${e.title}${e.kind !== 'hist' ? UI.cites(e.srcs) : ''}</h3>
      ${e.bg || e.act || e.res ? html`<dl class="n-event__sbar">${[['情境', e.bg], ['行为', e.act], ['影响', e.res]].map(([k, v]) => html`<dt>${k}</dt><dd>${v || html`<span class="nt-muted">待补充</span>`}</dd>`)}</dl>` : ''}
      ${e.scale ? html`<div class="n-scale">${e.scale.map(([k, v]) => html`<span>${k} ${v}</span>`)}</div><div class="n-tl__note">保留原量表，不换算成 1–5 的维度分，也不参与象限。${e.srcs?.[0] ? ` 来源：${e.srcs[0].label} · ${e.srcs[0].loc}` : ''}</div>` : ''}
      ${tags.length ? html`<div class="n-tags"><span class="n-tags__label">标签</span>${tags}</div>` : ''}
      ${scores.length ? (canScore ? html`<div class="n-event__scores">${scores.map((s) => UI.scoreLine(s, { hist: true }))}</div>` : html`<div class="n-event__scores">${UI.lock('本人视角已隐藏维度分')}</div>`) : ''}
    </article>`;
  };

  // 个人能力谱
  UI.spectrum = (pid) => {
    const at = (v) => ((v - 1) / 4) * 100;
    const from = NT.addDays(NT.TODAY, -365), recent = NT.addDays(NT.TODAY, -90);
    const groups = [['专业度', ['prof']], ['潜力 · 核心', ['mot', 'wis', 'grit']], ['潜力 · 加分项', ['lead', 'open']]];
    let total = 0;
    const vers = new Set(); // 这些分各自保存时的维度与锚点版本
    const rows = groups.map(([g, ids]) => html`<div class="n-spectrum__group">${g === '专业度' ? `专业度（对标 ${st.person(pid).level}）` : g}</div>${ids.map((id) => {
      const d = st.dim(id);
      const list = st.scoresOf(pid, { dim: id, from, visible: true });
      if (!list.length) {
        return html`<div class="n-spectrum__row"><span class="n-spectrum__dim">${d.name}</span><div class="n-spectrum__track is-unknown">资料不足 · ${UI.missText(pid, id)}</div><span class="n-spectrum__stat"><span class="cnt">0 条</span></span></div>`;
      }
      total += list.length;
      list.forEach((s) => vers.add(s.ver));
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
    return { html: rows, total, vers: [...vers].sort() };
  };
  UI.missText = (pid, dimId) => {
    const any = NT.store.visibleEvents(pid).events.some((e) => e.scores.some((s) => s.p === pid && s.d === dimId));
    if (any) return '有记录，待补具体行为';
    return { grit: '待补受挫后如何反应的事件', prof: '待补专业度评分', mot: '待补主动性相关的事件', wis: '待补判断与取舍相关的事件', lead: '待补带动他人的事件', open: '待补接受反馈相关的事件' }[dimId];
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
    const sub = c.sub || (c.t === 'trend' ? `近 3 个月 ${c.n} 条 · ${base === 'ver' ? '对比中期档案版本' : '对比之前 9 个月'}${c.thin ? ' · 证据少' : ''}` : '');
    const evli = (list) => html`<ul>${list.map((s) => html`<li><b>${s.v}</b>${s.ev.title} <small>${NT.md(s.date)} · ${st.person(s.by)?.name || ''}</small></li>`)}</ul>`;
    const why = {
      trend: c.up ? '上升和下降一样按规则提示，便于在盘点里及时看到。先看事件再判断。' : '下降可能和情境变化有关（换了项目、任务更模糊），建议先看事件再判断，不直接下结论。',
      activity: c.hit ? '近 90 天的事件待补记。' : '这是一条记录变动，供了解。',
      quad: '校准过的位置保持原样，要在象限校准里重新确认。',
      team: '资料不足上升，需要补录事件。',
    }[c.t];
    const acts = {
      trend: [['转为跟踪', `person.html?id=${c.person}&track=1`], ['看档案', `person.html?id=${c.person}`]],
      activity: c.hit ? [['看「值得聊一聊」', `person.html?id=${c.person}#signal`], ['看档案', `person.html?id=${c.person}`]] : [['看档案', `person.html?id=${c.person}`]],
      // 校准由 HR 完成：管理者只看档案，不给校准入口
      quad: st.can('calibrate') ? [st.recalTarget(c.person) ? ['去象限校准', st.recalTarget(c.person)] : ['发起新的盘点后校准', 'reviews.html']] : [['看档案', `person.html?id=${c.person}`]],
      team: [['看盘点清单', `review.html?id=b-xe6-end`]],
    }[c.t];
    const detail = c.t === 'trend'
      ? html`<div><h5>${base === 'ver' ? '中期档案版本' : '之前 9 个月'}</h5>${evli(c.before)}</div><div><h5>近 3 个月</h5>${evli(c.after)}</div><p class="n-change__why">${why}</p>`
      : html`<p class="n-change__why" style="border:0;padding:0">${why}</p>`;
    return html`<div class="n-change ${st.get().seen[c.id] ? 'is-seen' : ''}" data-id="${c.id}"><button class="n-change__row" type="button" aria-expanded="false">${ava}
      <span class="n-change__what"><span class="n-change__line"><b>${who}</b>${c.what}${delta}${mini}${c.hit && c.rule ? html`<span class="n-rule">${icon('flag')}${c.rule}</span>` : ''}</span><span class="n-change__sub">${sub}</span></span>
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
    NT.toast('正在播放这一段（演示录音只显示进度）', { duration: 2200 });
    setTimeout(() => { delete b.dataset.playing; b.innerHTML = '<svg width="10" height="10"><use href="#i-play"/></svg>'; }, 2400);
  });
  // ---------- 重点跟踪 ----------
  // opts.readonly：只读（管理者）——不出现记观察、改问题、停止、恢复，写明由 HR 跟进
  UI.trackCard = (t, opts = {}) => {
    const p = st.person(t.person);
    // 只列当前视角在档案里能看到的事件（导师看不到管理观察和管理受限的记录）
    const seen = new Set(st.visibleEvents(t.person).events.map((e) => e.id));
    const since = st.get().events.filter((e) => e.kind === 'obs' && e.date && e.date > t.since && e.people.includes(t.person) && seen.has(e.id));
    const scoreTxt = (e) => e.scores.filter((s) => s.p === t.person).map((s) => (s.v != null ? `${st.dim(s.d).name} ${s.v}${s.st === 'ai' ? '（AI 建议）' : ''}` : `${st.dim(s.d).name}资料不足`)).join('、');
    return html`<article class="n-card n-track ${t.state !== 'on' ? 'is-stopped' : ''}" data-track="${t.id}" id="track-${t.id}">
      <div class="n-track__head">${UI.person(t.person, { meta: `${st.orgShort(p.org)} · ${p.title}` })}<span class="n-badge">${icon('target')}${t.state === 'on' ? '跟踪中' : '已结束'}</span></div>
      <dl class="n-track__dl"><dt>为什么关注</dt><dd>${t.why}</dd><dt>想观察</dt><dd class="n-track__q">${t.q}</dd>
        <dt>负责人</dt><dd>${st.person(t.owner).name}${t.helper ? ` · ${st.person(t.helper).name}协助` : ''}</dd><dt>下次</dt><dd>${NT.md(t.next)} 前，或下一次对人复盘</dd></dl>
      <div class="n-track__new"><h5>上次（${NT.md(t.since)}）之后新增</h5>${since.length ? html`<span class="n-diff"><ins>${since.length} 条事件</ins>：${since.map((e) => `${e.title}（${scoreTxt(e) || '待评分'}）`).join('；')}</span>` : '新增的材料会出现在这里。'}</div>
      ${opts.readonly ? html`<div class="n-track__acts"><span class="nt-muted">${t.state === 'on' ? 'HR 在跟' : `${NT.md(t.stoppedAt || NT.TODAY)} 停止 · HR 在跟的观察问题和期间的事件都在档案里`}</span></div>`
        : t.state === 'on' ? html`<div class="n-track__acts"><a class="n-btn n-btn--sm n-btn--ink" href="${mob() ? 'quick.html' : 'record.html'}?person=${t.person}&track=${t.id}">${icon('plus')}记一条观察</a><button class="n-btn n-btn--sm" type="button" data-edit="${t.id}">改观察问题</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-stop="${t.id}">停止跟踪</button></div>`
        : html`<div class="n-track__acts"><span class="nt-muted">${NT.md(t.stoppedAt || NT.TODAY)} 停止 · 观察问题和期间的事件都还在档案里</span><button class="n-link" type="button" data-resume="${t.id}">恢复跟踪</button></div>`}
    </article>`;
  };
  UI.wireTracks = (host, rerender) => host.addEventListener('click', async (e) => {
    const S = st.get();
    const stop = e.target.closest('[data-stop]'), edit = e.target.closest('[data-edit]'), resume = e.target.closest('[data-resume]');
    if (stop) {
      const t = S.tracks.find((x) => x.id === stop.dataset.stop); t.state = 'stopped'; t.stoppedAt = NT.TODAY; t.stoppedTs = Date.now(); st.save(); rerender();
      NT.toast(`已停止跟踪${st.person(t.person).name}`, { undo: () => { t.state = 'on'; st.save(); rerender(); } });
    }
    if (resume) { const t = S.tracks.find((x) => x.id === resume.dataset.resume); t.state = 'on'; st.save(); rerender(); }
    if (edit) {
      const t = S.tracks.find((x) => x.id === edit.dataset.edit);
      const r = await UI.trackDialog(t.person, t);
      if (r) { Object.assign(t, r, { editedAt: NT.TODAY, editedTs: Date.now() }); st.save(); rerender(); NT.toast('观察问题已更新'); }
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
  // ---------- 发展方向（v1.3 3.15.1）：本人意愿与管理判断并列，分开标来源；没有记录就是「未知」 ----------
  UI.directionBlock = (pid, o = {}) => {
    const d = st.directions(pid); if (!d) return '';
    const ch = (id) => st.channel(id)?.name || '还没想好';
    const older = (list, f) => (list.length > 1 ? html`<div class="n-dir__old">之前：${list.slice(1).map((x) => html`<s>${ch(x.ch)}</s> ${f(x)}`)}</div>` : '');
    const self = d.self[0], mg = d.mgmt?.[0];
    const selfSide = self
      ? html`<div class="n-dir__side is-self"><span class="n-dir__label"><span class="n-src n-src--self">${icon('quote')}本人意愿</span>${self.src || '本人填写'} · ${NT.md(self.at)}</span><b class="n-dir__ch">${ch(self.ch)}</b>${self.text ? html`<span class="n-dir__note">「${self.text}」</span>` : ''}${older(d.self, (x) => NT.md(x.at))}</div>`
      : html`<div class="n-dir__side is-unknown"><span class="n-dir__label">本人意愿</span><b class="n-dir__ch">未知</b><span class="n-dir__note">还没有本人的记录，不当作「不想」</span></div>`;
    const mgSide = d.mgmt == null ? html`<div class="n-lock">${icon('lock')}管理判断仅管理者和 HR 可见。</div>`
      : mg ? html`<div class="n-dir__side is-mgmt"><span class="n-dir__label"><span class="n-src n-src--obs">${icon('eye')}管理判断</span>${st.person(mg.by).name} · ${NT.md(mg.at)}</span><b class="n-dir__ch">${ch(mg.ch)}</b><span class="n-dir__note">依据：${mg.basis}${mg.ev && st.event(mg.ev) ? UI.cite({ ...st.event(mg.ev).srcs[0], quote: st.event(mg.ev).srcs[0]?.quote || st.event(mg.ev).act || st.event(mg.ev).title }, 1) : ''}</span>${older(d.mgmt, (x) => `${st.person(x.by).name} ${NT.md(x.at)}`)}</div>`
        : html`<div class="n-dir__side is-unknown"><span class="n-dir__label">管理判断</span><b class="n-dir__ch">未知</b><span class="n-dir__note">还没有人写过，不当作「不适合」</span></div>`;
    const differ = self && mg && self.ch !== mg.ch;
    // 已核实的推荐方向（v1.5 3.31）：推荐人与核实人都写出来，不打分、不参与排序
    const recos = st.recosFor(pid).map((c) => html`<div class="n-dir__reco">${icon('target')}<span><b>推荐${st.fitText(c.dir)}</b>${c.why}<small>${st.person(c.by).name}推荐 · ${st.person(c.verifiedBy).name}核实 · ${NT.md(c.verifiedAt)}</small></span></div>`);
    return html`<article class="n-card" id="direction"><h3 class="n-section-title n-dirhead">发展方向<small class="nt-muted">通道取自人才发展大图</small></h3>
      <div class="n-dir" ${raw(st.role() === 'self' ? 'style="grid-template-columns:1fr"' : '')}>${selfSide}${st.role() === 'self' ? '' : mgSide}</div>
      
      ${recos.length ? html`<div class="n-dir__recos">${recos}</div>` : ''}
      ${o.canWrite ? html`<div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--sm" type="button" data-dir="${o.canWrite}">${icon('pen')}${o.canWrite === 'self' ? '写下或修改我的意愿' : '写管理判断'}</button></div>` : ''}
      <div data-dir-form></div></article>`;
  };
  // 写发展方向：本人写意愿；管理判断必须写依据
  UI.wireDirection = (host, pid, rerender) => {
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dir]'), form = host.querySelector('[data-dir-form]');
      if (b && form) {
        const self = b.dataset.dir === 'self';
        mount(form, html`<div class="n-card" style="box-shadow:var(--e-0);margin-top:var(--s-3)">
          <label class="n-field"><span class="n-field__label">${self ? '想往哪个方向发展' : '适合往哪个通道发展'}</span><select class="n-select" data-dir-ch>${self ? html`<option value="">还没想好</option>` : ''}${st.channels.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
          <label class="n-field" style="margin-top:var(--s-3)"><span class="n-field__label">${self ? '说说你的想法（可以不写）' : '依据（必填：引用事件或观察）'}</span><textarea class="n-textarea" rows="2" data-dir-text placeholder="${self ? '比如：下个阶段想离客户近一点，试试售前。' : '比如：两次客户方案都由本人牵头，取舍写得清楚'}"></textarea></label>
          <div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--sm n-btn--ink" type="button" data-dir-save="${b.dataset.dir}">保存</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-dir-x>取消</button><span class="nt-muted">${self ? '旧的记录会保留，你随时可以再改' : '仅管理者和 HR 可见'}</span></div></div>`);
        form.querySelector('select').focus();
        return;
      }
      if (e.target.closest('[data-dir-x]')) { host.querySelector('[data-dir-form]').innerHTML = ''; return; }
      const sv = e.target.closest('[data-dir-save]');
      if (sv) {
        const ch = host.querySelector('[data-dir-ch]').value, text = host.querySelector('[data-dir-text]').value.trim();
        if (sv.dataset.dirSave === 'mgmt' && !text) { host.querySelector('[data-dir-text]').focus(); NT.toast('管理判断要写依据'); return; }
        st.addDirection(sv.dataset.dirSave === 'self' ? { person: pid, kind: 'self', ch, text, src: '本人填写' } : { person: pid, kind: 'mgmt', ch, by: st.me().id, basis: text });
        rerender();
        NT.toast(sv.dataset.dirSave === 'self' ? '已更新你的发展意愿，旧的记录保留' : '管理判断已保存，和本人意愿分开呈现');
      }
    });
  };
  // 候选人卡上的一行：两种来源分开写，只作参考事实，不参与排序
  UI.directionLine = (pid) => {
    const d = st.directions(pid); if (!d) return '';
    const ch = (x) => (x ? st.channel(x.ch)?.name || '还没想好' : '未知');
    return html`<div class="n-dirline"><span><i>发展方向</i></span><span>${icon('quote', 11)}本人：${ch(d.self[0])}</span>${d.mgmt ? html`<span>${icon('eye', 11)}管理判断：${ch(d.mgmt[0])}</span>` : ''}</div>`;
  };

  UI.signalBlock = (sig) => {
    const p = st.person(sig.person);
    const canAct = st.role() !== 'ceo'; // 管理者只看信号与来源；沟通与暂不处理由 HR 办理
    const mgr = p.manager && st.person(p.manager);
    const items = sig.items.map((it, i) => html`<li>${UI.src(it.src)}<span class="n-signal__text ${it.src === 'self' ? 'ink-hand' : ''}">${it.text}</span><button class="n-signal__from" type="button" aria-expanded="false" data-from="${i}">${it.from}</button><div class="n-signal__detail" hidden>${it.src === 'self' ? icon('play') : ''}${it.detail}</div></li>`);
    let tail = '';
    if (sig.state === 'open') {
      if (canAct) tail = html`<div class="n-signal__actions" data-acts><button class="n-btn n-btn--ink" type="button" data-talk>安排一次沟通</button><button class="n-btn n-btn--ghost" type="button" data-hold>暂不处理</button></div>
        <form class="n-signal__form" data-talkform hidden><label>谁来聊<select name="who">${[p.manager, p.hrbp].filter(Boolean).map((id) => html`<option value="${id}">${st.person(id).name}（${id === p.hrbp ? 'HR' : '直属负责人'}）</option>`)}</select></label>
          <label>什么时候前<select name="when"><option>11-06 前</option><option>11-13 前</option><option>本月内</option></select></label>
          <div class="n-signal__formbar"><button class="n-btn n-btn--sm n-btn--ink" type="submit">创建跟进</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel>取消</button></div></form>
        <form class="n-signal__form" data-holdform hidden><label class="is-wide">为什么暂不处理<input class="n-score__why" name="reason" placeholder="写一句原因，比如：上周刚聊过，正在准备转岗" required></label>
          <div class="n-signal__formbar"><button class="n-btn n-btn--sm n-btn--ink" type="submit" disabled data-holdok>确认暂不处理</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-cancel>取消</button></div></form>`;
    } else {
      const r = sig.result;
      const body = sig.state === 'talk' ? html`<div class="n-signal__todo"><span class="n-badge">待沟通</span><b>${st.person(r.who).name}和${p.name}聊一次</b><span>${r.when}</span></div><p>${canAct ? `聊完在这里记一笔，结果会进${p.name}的档案，这几条信号随之收起。` : `聊完后，沟通结果会进${p.name}的档案。`}</p>${canAct ? html`<div class="nt-row" style="margin-top:var(--s-2)"><button class="n-btn n-btn--sm" type="button" data-talked>记录沟通结果</button></div>` : ''}`
        : sig.state === 'hold' ? html`<p class="n-signal__reason"><span class="n-badge">暂不处理</span><span class="ink-hand">${r.reason}</span></p><p>信号保留在档案里；有新的信号出现时会重新提示。</p>`
          : html`<div class="n-signal__todo"><span class="n-badge n-badge--yes">${icon('check')}已沟通</span><b>${r.note}</b></div>${r.action ? html`<p>已生成行动：<a href="actions.html#${r.action}">${st.get().actions.find((a) => a.id === r.action)?.title || '查看行动'}</a></p>` : ''}`;
      tail = html`<div class="n-signal__result">${body}<div class="n-block__by"><span class="n-block__sig">${st.person(r.by).name}</span>${NT.md(r.at)}</div>${sig.state !== 'acted' && canAct ? html`<button type="button" class="n-signal__undo" data-reopen>撤销</button>` : ''}</div>`;
    }
    return html`<article class="n-card n-signal ${sig.state !== 'open' ? 'is-resolved' : ''}" id="signal" data-sig="${sig.person}">
      <header class="n-signal__head"><h3 class="n-section-title" style="margin:0">值得聊一聊</h3><span class="n-signal__vis">${icon('lock')}管理者、归属 HR、直属负责人可见</span></header>
      <p class="n-signal__sub" style="margin-top:var(--s-2)">下面 ${sig.items.length} 条信号都能核实，放在一起看，可能值得找${p.name}聊一次。</p>
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

  // 事件的第一处来源做成引用角标（值得关注共用）
  UI.evCite = (id, n) => { const e = st.event(id); if (!e) return ''; const src = e.srcs[0] || { type: 'note', label: '观察记录', loc: NT.md(e.date) }; return UI.cite({ ...src, quote: src.quote || e.title }, n); };
  // 判断提醒的一句差异：取差异最多的维度，偏高、偏低都写，其余维度只给个数（桌面与手机共用）
  UI.judgeTipText = (g) => {
    const d = g.dims.slice().sort((a, b) => b.diff - a.diff)[0];
    return `${d.name}：前段评为最高或最低一档的 ${d.clear} 人里，${[d.diffHigh && `${d.diffHigh} 人前段偏高`, d.diffLow && `${d.diffLow} 人前段偏低`].filter(Boolean).join('、')}（中间档另看）${g.dims.length > 1 ? `，共 ${g.dims.length} 个维度有差异` : ''}`;
  };

  // ---------- 关注（v1.5 3.26.2）：个人的观察名单 ----------
  UI.followBtn = (pid, o = {}) => {
    if (!st.canFollow(pid)) return '';
    const on = st.isFollowing(pid);
    return html`<button class="n-btn n-btn--sm ${o.ghost ? 'n-btn--ghost' : ''} n-follow" type="button" data-follow="${pid}" aria-pressed="${on}">${icon(on ? 'star-on' : 'star')}${on ? '已关注' : '加关注'}</button>`;
  };
  UI.toggleFollow = (pid, rerender) => {
    const name = st.person(pid).name;
    if (st.isFollowing(pid)) {
      const undo = st.unfollow(pid); rerender && rerender();
      NT.toast(`已取消关注${name}`, { undo: () => { undo(); rerender && rerender(); } });
    } else {
      st.follow(pid); rerender && rerender();
      NT.toast(`已关注${name}，之后的新进展会出现在「我的关注」`, { undo: () => { st.unfollow(pid); rerender && rerender(); } });
    }
  };

  // ---------- 推荐方向（v1.5 3.31）：目标角色 + 理由 + 至少 2 件不同的已确认事件，HR 核实 ----------
  const recoDup = (pid, dir) => {
    if (!st.recoExists(pid, dir)) return '';
    const c = (st.get().watchClues || []).find((x) => x.person === pid && x.dir === dir && ['pending', 'verified'].includes(x.state));
    return c?.state === 'verified' ? '已有同一方向的推荐，已核实' : '已有同一方向的推荐在核实中';
  };
  const recoMsg = (d, pid) => recoDup(pid, d.querySelector('#rc-dir').value)
    || (!d.querySelector('#rc-why').value.trim() ? '写一句理由。' : d.querySelectorAll('.n-recoevs input:checked').length < 2 ? '至少勾选 2 件不同的事。' : '');
  UI.recoDialog = async (pid, rerender) => {
    const p = st.person(pid), evs = st.recoEvidence(pid), self = st.role() === 'hrbp';
    const r = await NT.dialog({ title: `推荐方向：${p.name}`,
      // 提示出现后，改到满足条件就收起
      onOpen: (d) => { const clear = () => { const err = d.querySelector('#rc-err'); if (!err.hidden && recoMsg(d, pid) !== err.textContent) err.hidden = true; }; d.addEventListener('input', clear); d.addEventListener('change', clear); },
      body: html`<p style="margin:0 0 var(--s-3)">推荐${p.name}往一个目标角色发展，写理由并勾选至少 2 件不同的事作为依据。${self ? '提交后直接记入档案的发展方向。' : 'HR 核实后进入档案的发展方向。'}</p>
        <label class="n-field"><span class="n-field__label">适合做</span><select class="n-select" id="rc-dir">${st.templates().map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></label>
        <label class="n-field"><span class="n-field__label">理由</span><textarea class="n-textarea" rows="2" id="rc-why" placeholder="比如：联调时能独立定位问题，也会主动接没人认领的事"></textarea></label>
        <fieldset class="n-field n-recoevs"><legend class="n-field__label">依据（至少 2 件不同的事）</legend>${evs.length ? evs.slice(0, 8).map((e) => html`<label class="n-check"><input type="checkbox" value="${e.id}"><span>${e.title}<small>${NT.md(e.date)}${e.project ? ` · ${st.project(e.project)?.name}` : ''}</small></span></label>`) : html`<p class="nt-muted">推荐要以已确认的关键事件为依据，先记一件事。</p>`}</fieldset>
        <div class="n-field__err" id="rc-err" role="alert" aria-live="assertive" hidden></div>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: self ? '记入档案' : '提交给 HR', value: 'ok', cls: 'n-btn--ink',
        validate: (d) => {
          const msg = recoMsg(d, pid), err = d.querySelector('#rc-err');
          err.hidden = !msg; err.textContent = msg;
          if (msg) (d.querySelector(recoDup(pid, d.querySelector('#rc-dir').value) ? '#rc-dir' : !d.querySelector('#rc-why').value.trim() ? '#rc-why' : '.n-recoevs input:not(:checked)') || d.querySelector('#rc-why')).focus();
          return !msg;
        },
        read: (d) => ({ dir: d.querySelector('#rc-dir').value, why: d.querySelector('#rc-why').value.trim(), evs: [...d.querySelectorAll('.n-recoevs input:checked')].map((x) => x.value) }) }] });
    if (r?.value !== 'ok') return null;
    const c = st.addReco(pid, r.data.dir, r.data.why, r.data.evs);
    if (!c) {
      // 弹窗里已校验过理由、依据和重复；这里拿到空值时，按同一方向已有的推荐给出提示
      NT.toast(recoDup(pid, r.data.dir) || '这条推荐没有提交成功，请检查方向、理由和依据后再试');
      return null;
    }
    rerender && rerender();
    NT.toast(c.state === 'verified' ? `已记入${p.name}档案的发展方向` : '已提交，HR 核实后会进入档案的发展方向', { undo: () => { st.removeReco(c.id); rerender && rerender(); } });
    return c;
  };

  // ---------- 速览（v1.5 3.27）：点人或项目先看 30 秒的关键信息，想深入再进详情 ----------
  // 桌面是右侧栏，侧栏开着时点另一个人直接切换；手机是屏内的底部弹层。内容与详情页同一套权限
  const mob = () => !!document.getElementById('m-screen');
  const appHref = (h) => (mob() && !/^(person|index|people)\.html/.test(h) ? `../app/${h}` : h);
  const capLines = (pid) => {
    if (!st.can('scores', pid)) return null;
    // 与档案同一取数口径（含复核暂停）；锚点按最高分所用的版本（复核过的按复核版本）
    const by = {};
    st.scoresOf(pid, { visible: true }).forEach((x) => {
      const d = (by[x.d] = by[x.d] || { evs: new Set(), top: 0 }); d.evs.add(x.ev.id);
      if (x.v > d.top) { d.top = x.v; d.ver = x.ver; }
    });
    const dims = SEED_DIMS().filter((d) => by[d.id]);
    return { dims: dims.map((d) => ({ name: d.name, n: by[d.id].evs.size, anchor: st.anchors(d.id, pid, st.ruleVer(by[d.id].ver)).list[by[d.id].top - 1] })), rest: SEED_DIMS().length - dims.length };
  };
  const SEED_DIMS = () => NT.SEED.DIMS;
  UI.peekPerson = (pid) => {
    const p = st.person(pid), role = st.role(), sc = st.scope(pid);
    if (!p || !sc) return html`<div class="nt-empty">这个人在你的查看范围之外。</div>`;
    const w = st.watch().find((x) => x.person === pid), rule = w && st.WATCH_RULES[w.rule], cat = w && Object.fromEntries(st.WATCH_CATS)[w.cat];
    const facts = st.visibleEvents(pid).events.filter((e) => e.kind === 'obs' && e.date && !e.scores.some((x) => x.p === pid && x.st === 'ai')).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    const cap = capLines(pid), recos = st.recosFor(pid), doing = st.doingFor(pid);
    const src = w && (w.verifiedBy ? `${w.by === 'ai' ? 'AI 从材料里发现' : `${st.person(w.by).name}${w.dir ? '推荐' : '提名'}`} · ${st.person(w.verifiedBy).name}核实` : '按写明的规则得出');
    const href = `person.html?id=${pid}`;
    return html`<header class="n-peek__head">${UI.avatar(pid, 'lg')}<div><h2 id="peek-h">${p.name}</h2><p>${st.orgShort(p.org)} · ${p.title} · ${st.tenure(p)}</p></div></header>
      ${st.canFollow(pid) ? html`<div class="n-peek__acts">${UI.followBtn(pid)}</div>` : ''}
      ${w ? html`<section class="n-peek__sec"><h3>为什么值得关注</h3><div class="n-peek__why"><span class="n-watch__cat">${cat}</span>${w.why}${w.srcs ? UI.cites(w.srcs) : (w.evs || []).slice(0, 3).map((id, i) => UI.evCite(id, i + 1))}</div>
        <p class="n-peek__src">${src}${w.also.length ? ` · 另有 ${w.also.length} 条依据` : ''}</p><p class="n-peek__rule" title="${w.rule} · ${st.WATCH_VER}">入选依据：${rule.text}</p></section>` : ''}
      <section class="n-peek__sec"><h3>关键事实${facts.length ? html`<a class="n-link" href="${href}#timeline">查看全部</a>` : ''}</h3>
        ${facts.length ? html`<ol class="n-peek__facts">${facts.map((e) => html`<li><span class="n-peek__date">${NT.md(e.date)}</span><span>${e.title}${UI.evCite(e.id, '原文')}<small>${[e.project && st.project(e.project)?.name, `${st.person(e.recorder)?.name}记录`].filter(Boolean).join(' · ')}</small></span></li>`)}</ol>` : html`<p class="nt-muted">还没有你能看到的关键事件。</p>`}</section>
      ${cap ? html`<section class="n-peek__sec"><h3>能力线索</h3>${cap.dims.length ? html`<ul class="n-peek__caps">${cap.dims.map((d) => html`<li><b>${d.name}</b><span>${d.n} 件事</span><small>${d.anchor}</small></li>`)}</ul>` : ''}
        <p class="nt-muted">${cap.dims.length ? (cap.rest ? `其余 ${cap.rest} 个维度资料不足，补充材料后出分。` : '') : '维度分待确认。'}</p></section>` : ''}
      ${recos.length ? html`<section class="n-peek__sec"><h3>推荐方向</h3>${recos.map((c) => html`<p class="n-peek__reco"><b>${st.fitText(c.dir)}</b>${c.why}<small>${st.person(c.by).name}推荐 · ${st.person(c.verifiedBy).name}核实 · ${NT.md(c.verifiedAt)}</small></p>`)}</section>` : ''}
      ${doing.length ? html`<section class="n-peek__sec"><h3>已经在做的事</h3><ul class="n-peek__doing">${doing.map((t) => html`<li>${t}</li>`)}</ul></section>` : ''}
      <footer class="n-peek__foot">${!mob() && st.can('record', pid) ? html`<a class="n-btn n-btn--sm" href="record.html?person=${pid}">${icon('pen')}记一件事</a>` : ''}
        ${!mob() && st.canRecommend(pid) ? html`<button class="n-btn n-btn--sm" type="button" data-pk-reco="${pid}">${icon('target')}推荐方向</button>` : ''}
        <a class="n-btn n-btn--sm n-btn--ink" href="${href}">打开档案</a></footer>`;
  };
  UI.peekProject = (id) => {
    const S = st.get(), b = st.batch(id), pj = !b && st.project(id);
    if (!b && !pj) return html`<div class="nt-empty">这个项目已失效。</div>`;
    const pids = b ? S.projects.filter((x) => x.batch === b.id).map((x) => x.id) : [pj.id];
    const inProj = (eid) => pids.includes(st.event(eid)?.project);
    const people = st.watch().filter((w) => (w.evs || []).some(inProj));
    const evs = S.events.filter((e) => e.kind === 'obs' && e.date && pids.includes(e.project) && e.people.some((x) => st.scope(x) && st.visibleEvents(x).events.some((y) => y.id === e.id))).sort((a, c) => c.date.localeCompare(a.date)).slice(0, 3);
    const needs = !b && st.canStaff(pj.id) ? S.needs.filter((n) => n.project === pj.id) : [];
    const plans = !b && st.canStaff(pj.id) ? S.plans.filter((x) => x.kind === 'staffing' && x.project === pj.id) : [];
    const href = appHref(b ? 'landing.html' : `project.html?id=${pj.id}`);
    return html`<header class="n-peek__head"><span class="n-peek__icon">${icon(b ? 'book' : 'folder')}</span><div><h2 id="peek-h">${b ? b.name : pj.name}</h2><p>${b ? `训练营 · ${b.newcomers.length} 位学员 · ${pids.length} 个课题` : `${pj.type} · ${pj.status} · ${NT.md(pj.from)} – ${NT.md(pj.to)} · owner ${pj.owner ? st.person(pj.owner).name : '待定'}`}</p></div></header>
      ${pj ? html`<section class="n-peek__sec"><h3>目标</h3><p>${pj.goal}</p></section>` : ''}
      ${people.length ? html`<section class="n-peek__sec"><h3>值得关注的人</h3><ul class="n-peek__people">${people.map((w) => html`<li><a href="person.html?id=${w.person}" data-peek="p:${w.person}">${UI.avatar(w.person, 'sm')}<b>${st.person(w.person).name}</b></a><span>${w.why}</span></li>`)}</ul></section>` : ''}
      ${needs.length || plans.length ? html`<section class="n-peek__sec"><h3>找人</h3><p>${plans.length ? plans.map((x) => `用人方案 v${x.version} · ${x.status === 'draft' ? '待确认' : '已确认'}`).join('；') : '候选人核对中，还没有用人方案'}</p></section>` : ''}
      <section class="n-peek__sec"><h3>最近的关键事件</h3>${evs.length ? html`<ol class="n-peek__facts">${evs.map((e) => html`<li><span class="n-peek__date">${NT.md(e.date)}</span><span>${e.title}<small>${e.people.map((x) => st.person(x).name).join('、')}</small></span></li>`)}</ol>` : html`<p class="nt-muted">还没有你能看到的关键事件。</p>`}</section>
      <footer class="n-peek__foot"><a class="n-btn n-btn--sm n-btn--ink" href="${href}">打开${b ? '批次' : '项目'}</a></footer>`;
  };
  UI.peek = (() => {
    let el = null, scrim = null, cur = null, from = null, lastIn = null;
    const body = () => (cur.t === 'p' ? UI.peekPerson(cur.id) : UI.peekProject(cur.id));
    // 速览里的操作完成后：速览还开着就重绘，已经关了也照样刷新页面（撤销可能在关闭之后才点）
    // 速览里的操作完成后重绘：焦点原来在抽屉里（或操作后落到 body），就回到重绘后对应的控件，找不到则落到抽屉本身，不掉到 body
    const after = () => {
      if (el) {
        const a = document.activeElement;
        const keep = !a || a === document.body || el.contains(a);
        draw();
        if (keep) (focusBack() || el).focus();
      }
      UI.peek.changed();
    };
    const draw = () => {
      if (!el) return;
      NT.mount(el.querySelector('.n-peek__body'), body()); UI.mountIPs(el);
    };
    // 抽屉内控件的定位：优先按 data-follow / data-pk-reco，其余按在抽屉内可操作控件里的序号
    const ctlSel = (n) => (n.dataset.follow ? `[data-follow="${n.dataset.follow}"]` : n.dataset.pkReco ? `[data-pk-reco="${n.dataset.pkReco}"]` : null);
    const ctls = () => [...el.querySelectorAll('.n-peek__body button, .n-peek__body a[href], .n-peek__x')];
    const mark = (n) => {
      const c = n.closest('button, a[href]');
      if (!c || !el.contains(c)) return null;
      return { sel: ctlSel(c), i: ctls().indexOf(c) };
    };
    const focusBack = () => {
      if (!lastIn) return null;
      return (lastIn.sel && el.querySelector(lastIn.sel)) || ctls()[lastIn.i] || null;
    };
    // 找回焦点：同一个 data-peek 常有头像、人名、「查看依据」几个入口；跳过 aria-hidden / 不可见的，优先和原触发元素同类的
    const backTarget = (trigger) => {
      const cands = [...document.querySelectorAll(`[data-peek="${trigger.dataset.peek}"]`)]
        .filter((x) => !x.closest('[aria-hidden="true"]') && x.tabIndex >= 0 && x.getClientRects().length);
      return cands.find((x) => x.className === trigger.className) || cands[0];
    };
    // restore：Esc、关闭按钮、再点同一触发才把焦点还给触发元素；点抽屉外的控件关闭时，不抢走那个控件刚得到的焦点
    const close = (restore = true) => {
      if (!el) return;
      const node = el, sc = scrim; el = null; scrim = null; cur = null; lastIn = null;
      node.classList.remove('is-open');
      setTimeout(() => { node.remove(); sc?.remove(); }, NT.reduced ? 0 : 220);
      // 触发元素可能已随页面重绘被替换：按同一个 data-peek 找回来再还焦点
      // 点抽屉外的控件关闭时，只有那个控件还拿着焦点才不抢；它随页面重绘被替换了（焦点落到 body）就仍回到触发元素
      const a = document.activeElement;
      const held = a && a !== document.body && a.isConnected && !node.contains(a);
      const back = (restore || !held) && (from?.isConnected ? from : from?.dataset?.peek && backTarget(from));
      if (back) back.focus?.();
      from = null;
    };
    const open = (key, trigger) => {
      const [t, id] = key.split(':');
      if (el && cur && cur.t === t && cur.id === id) { close(); return; }
      cur = { t, id }; lastIn = null; if (trigger) from = trigger;
      if (!el) {
        el = document.createElement('aside');
        el.className = `n-peek ${mob() ? 'is-sheet' : ''}`;
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', mob() ? 'true' : 'false'); el.setAttribute('aria-labelledby', 'peek-h'); el.tabIndex = -1;
        el.innerHTML = `${mob() ? '<div class="n-sheet__grip"></div>' : ''}<button class="n-btn n-btn--ghost n-btn--icon n-peek__x" type="button" aria-label="关闭速览"><svg><use href="#i-x"/></svg></button><div class="n-peek__body"></div>`;
        const host = document.getElementById('m-screen') || document.body;
        if (mob()) { scrim = document.createElement('div'); scrim.className = 'm-scrim'; scrim.addEventListener('click', () => close()); host.append(scrim); }
        host.append(el);
        el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
        el.addEventListener('focusin', (e) => { lastIn = mark(e.target); });
        el.addEventListener('click', (e) => {
          if (e.target.closest('.n-peek__x')) { close(); return; }
          const f = e.target.closest('[data-follow]');
          if (f) { UI.toggleFollow(f.dataset.follow, after); return; }
          const rc = e.target.closest('[data-pk-reco]');
          if (rc) { UI.recoDialog(rc.dataset.pkReco, after); return; }
        });
        requestAnimationFrame(() => el?.classList.add('is-open'));
      }
      draw();
      el.focus();
    };
    // 页面里带 data-peek 的人名、头像、项目名：普通点击拉起速览，⌘ / Ctrl 点击照常打开详情页
    document.addEventListener('click', (e) => {
      // 工作台（带 data-peek-scope 的区域）里的人名链接也拉起速览
      const t = e.target.closest('[data-peek]') || e.target.closest('[data-peek-scope] a.nt-plink[href^="person.html?id="]');
      if (t) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault(); open(t.dataset.peek || `p:${new URLSearchParams(t.getAttribute('href').split('?')[1]).get('id')}`, t); return;
      }
      // 用事件派发时的原始路径判断里外：速览里的按钮点完会被重绘替换，不能再用 target 判断
      const inside = e.composedPath().some((n) => n.nodeType === 1 && n.matches('.n-peek, .n-menu, dialog, .n-toast, .n-cite__pop'));
      if (el && !mob() && !inside) close(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el && !document.querySelector('dialog[open]')) close(); });
    return { open, close, changed: () => {}, isOpen: () => !!el };
  })();

  // 重置演示数据：只清本浏览器里的演示状态，评审评论在服务器上不受影响
  NT.resetDemo = async () => {
    const v = await NT.dialog({
      title: '重置演示数据？', body: html`<p>你在本浏览器里做过的确认、校准、方案和记录都会清空，回到初始的演示数据。评审评论保存在服务器上，会保留。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '重置', value: 'ok', cls: 'n-btn--ink', icon: 'retry' }],
    });
    if (v !== 'ok') return;
    st.reset();
    location.reload();
  };
})();
