/* GitHub 依据：人员关联 GitHub 账号；记一件事时按这个人查已配置仓库里的 Issue 和 PR，所选内容作为这件事的依据，和原话一起整理、确认。
   原型不连 GitHub：账号、仓库和 Issue / PR 都是演示数据。xe6-infra 第一次查询演示连接超时，季叙白演示查询结果为空。
   账号按稳定 ID 匹配，login 只用于展示；平台角色和合并状态是 GitHub 的记录，描述里的说法出自作者本人。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store;
  const { html, icon, $, $$ } = NT;

  const REPOS = ['niu-demo/storyboard-factory', 'niu-demo/story-api', 'niu-demo/xe6-infra'];
  const USERS = {
    'demo-mengyc': { id: 58210473, name: 'Meng Yichen' },
    'demo-shenyc': { id: 60311925, name: 'Shen Yichu' },
    'demo-jixubai': { id: 61002387, name: 'Ji Xubai' },
    'demo-zhoucq': { id: 59877410, name: 'Zhou Chuqing' },
  };
  // [类型, 仓库, 编号, 标题, 平台角色, 状态, 状态色, 关键时间, 关键时间说法, 描述摘录]
  const ITEMS = {
    58210473: [
      ['issue', 'niu-demo/storyboard-factory', 221, '路演前压测：并发 20 个生成任务时排队超时', 'Issue 创建人', '进行中', '', '2026-09-01', '创建于',
        '压测时并发 20 个生成任务，第 15 个之后排队超过 120 秒。先限流到 12 个并给出排队提示，根因还在查。'],
      ['pr', 'niu-demo/storyboard-factory', 214, '视频上传：分片失败后按指数退避重试', 'PR 作者', '已合并', 'yes', '2026-08-27', '合并于',
        '分片上传的超时从固定 30 秒改为按分片大小估算；单片失败后按 1、2、4 秒退避重试 3 次，仍失败再提示重新上传。弱网下演示视频上传成功率从 72% 提到 96%。'],
      ['issue', 'niu-demo/story-api', 198, '长剧本分段后角色名前后不一致', 'Issue 被指派', '已关闭 · 已完成', 'yes', '2026-08-20', '关闭于',
        '分段生成时每段重新抽取角色，同一角色出现两个名字。改为分段前先建角色表，各段共用。'],
      ['pr', 'niu-demo/storyboard-factory', 203, '任务池同步：每天 9:30 把待领取任务推送到小组群', 'PR 作者', '已合并', 'yes', '2026-08-12', '合并于',
        '新增定时任务，每天 9:30 把任务池里待领取的任务和建议负责人推送到小组群；有人领取后看板自动更新。'],
      ['pr', 'niu-demo/story-api', 190, '生成进度改用 WebSocket 推送', 'PR 作者', '已关闭', '', '2026-08-09', '关闭于',
        '尝试用 WebSocket 推送生成进度。评审讨论后改回轮询，这个 PR 关闭。'],
    ],
    59877410: [
      ['pr', 'niu-demo/storyboard-factory', 209, '分镜编辑器：拖拽排序与撤销', 'PR 作者', '已合并', 'yes', '2026-08-18', '合并于',
        '分镜卡片支持拖拽排序，最近 20 步可以撤销。'],
    ],
  };
  const RANGES = [[7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天']];
  const short = (repo) => repo.split('/')[1];
  const urlOf = (kind, repo, n) => `github.com/${repo}/${kind === 'pr' ? 'pull' : 'issues'}/${n}`;
  const clock = () => { const d = new Date(); return `${NT.md(NT.TODAY)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const item = ([kind, repo, n, title, role, state, tone, at, atLabel, body]) => ({
    key: `${repo}#${n}`, kind, repo, n, title, role, state, tone, at, atLabel, body,
    ref: `${short(repo)} #${n}`, url: urlOf(kind, repo, n),
  });
  const daysBefore = (date) => (new Date(`${NT.TODAY}T00:00:00Z`) - new Date(`${date}T00:00:00Z`)) / 86400000;

  const gh = (NT.gh = {});
  gh.REPOS = REPOS;
  gh.link = (pid) => st.get().ghLinks[pid] || null;
  gh.user = (login) => (USERS[login] ? { login, ...USERS[login] } : null);
  const ownerOf = (id, except) => Object.entries(st.get().ghLinks).find(([p, l]) => l.id === id && p !== except)?.[0] || null;
  gh.avatar = (login) => html`<span class="n-avatar n-avatar--sm n-gh__avatar" aria-hidden="true">${login.replace(/^demo-/, '').slice(0, 1).toUpperCase()}</span>`;

  // 没有手写原话时，按所选材料起草；起草用的文字只交给整理，不作为「记录原话」保存
  gh.draftText = (pid, list) => `${st.person(pid).name}${list.map((g) => `${g.kind === 'pr' ? '提交了' : '处理了'}「${g.title}」：${g.body}`).join('；')}`;

  // ---------- 关联账号（HR） ----------
  gh.linkDialog = async (pid) => {
    const p = st.person(pid), cur = gh.link(pid);
    let found = null;
    const v = await NT.dialog({
      title: cur ? `更换${p.name}的 GitHub 账号` : `关联${p.name}的 GitHub 账号`,
      body: html`<p>关联后，记一件事时可以按这个账号查找${p.name}在已配置仓库里的 Issue 和 PR。</p>
        <div class="n-field" style="margin-top:var(--s-3)"><label class="n-field__label" for="ghl-q">GitHub 用户名或主页</label>
          <div class="nt-row" style="flex-wrap:nowrap"><input class="n-input" id="ghl-q" autocomplete="off" spellcheck="false" placeholder="比如 demo-shenyc 或 github.com/demo-shenyc"><button class="n-btn n-btn--sm" type="button" id="ghl-find">${icon('search')}查找</button></div></div>
        <div id="ghl-res" aria-live="polite"></div>
        ${cur ? html`<p class="nt-caption" style="margin-top:var(--s-3)">已保存的记录继续引用当时取得的内容，更换后的账号用于之后的查找。</p>` : ''}`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存关联', value: 'ok', cls: 'n-btn--ink',
        validate: (dl) => (!found ? '先查找并核对账号' : !$('#ghl-ok', dl)?.checked ? `勾选确认这是${p.name}本人的账号` : true) }],
      onOpen: (dl) => {
        const res = $('#ghl-res', dl), q = $('#ghl-q', dl);
        const find = () => {
          const login = q.value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
          found = null;
          if (!login) { q.focus(); return; }
          const u = gh.user(login);
          if (!u) { NT.mount(res, html`<p class="n-field__err">查找结果为空：检查「${login}」的拼写，或粘贴主页地址。</p>`); return; }
          if (cur && cur.id === u.id) { NT.mount(res, html`<p class="n-field__err">@${login} 就是现在关联的账号。</p>`); return; }
          const other = ownerOf(u.id, pid);
          if (other) { NT.mount(res, html`<p class="n-field__err">@${login} 已关联${st.person(other).name}。一个 GitHub 账号只关联一个人，先到${st.person(other).name}的档案解除关联。</p>`); return; }
          found = u;
          NT.mount(res, html`<div class="n-gh__acct" style="margin-top:var(--s-3)">${gh.avatar(u.login)}<div><b>${u.name}</b> <span class="nt-muted">@${u.login}</span> ${NT.ui.demo()}<small>github.com/${u.login} · GitHub ID ${u.id}</small></div></div>
            <label class="n-check" style="margin-top:var(--s-3)"><input type="checkbox" id="ghl-ok">确认这是${p.name}本人的账号</label>`);
        };
        $('#ghl-find', dl).addEventListener('click', find);
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
      },
    });
    if (v !== 'ok') return false;
    const me = st.me(), S = st.get(), before = S.ghLinks[pid];
    S.ghLinks[pid] = { login: found.login, id: found.id, by: me.id, at: NT.TODAY, prev: before ? [...before.prev, { login: before.login, id: before.id, from: before.at, to: NT.TODAY }] : [] };
    st.save();
    NT.toast(`已关联 @${found.login}`, { undo: () => { if (before) S.ghLinks[pid] = before; else delete S.ghLinks[pid]; st.save(); gh.onChange?.(); }, undoneText: '已撤销这次关联' });
    return true;
  };
  gh.unlink = async (pid) => {
    const p = st.person(pid), cur = gh.link(pid);
    const v = await NT.dialog({
      title: `解除${p.name}与 @${cur.login} 的关联？`,
      body: html`<p>解除后，记一件事时改为粘贴链接添加 GitHub 依据；已保存的记录保持原样。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '解除关联', value: 'ok', cls: 'n-btn--ink' }],
    });
    if (v !== 'ok') return false;
    const S = st.get();
    delete S.ghLinks[pid];
    st.save();
    NT.toast(`已解除 @${cur.login}`, { undo: () => { S.ghLinks[pid] = cur; st.save(); gh.onChange?.(); }, undoneText: '已恢复关联' });
    return true;
  };

  // 档案右栏：能看档案的人都能看到关联的账号，负责这个人的 HR 可以关联、更换或解除
  gh.card = (pid, o = {}) => {
    const l = gh.link(pid), can = st.can('ghLink', pid), last = l?.prev.at(-1);
    // 档案右栏的概况卡里只占一行：账号或「待关联」，操作放在标题行右侧
    if (o.compact) return html`<section class="n-facet" id="gh"><h3 class="n-facet__head">GitHub 账号${can ? html`<span class="n-facet__act">${l ? html`<button class="n-link" type="button" data-gh="link">更换</button><button class="n-link" type="button" data-gh="unlink">解除关联</button>` : html`<button class="n-link" type="button" data-gh="link">关联账号</button>`}</span>` : ''}</h3>
      ${l ? html`<div class="n-gh__acct">${gh.avatar(l.login)}<div><b>@${l.login}</b> ${NT.ui.demo()}<small>${st.person(l.by).name} ${NT.md(l.at)} 关联 · 记一件事时按这个账号查找</small></div></div>
          ${last ? html`<p class="nt-caption">${NT.md(last.from)} 至 ${NT.md(last.to)} 关联的是 @${last.login}，那段时间保存的记录照旧引用当时的内容。</p>` : ''}`
        : html`<p class="nt-muted" style="margin:0;font-size:var(--t-sm)">待关联${can ? ' · 关联后记一件事时可以按账号查找 Issue 和 PR' : ' · 由 HR 关联'}</p>`}
    </section>`;
    return html`<article class="n-card" id="gh"><h3 class="n-section-title">GitHub 账号</h3>
      ${l ? html`<div class="n-gh__acct">${gh.avatar(l.login)}<div><b>@${l.login}</b> ${NT.ui.demo()}<small>${st.person(l.by).name} ${NT.md(l.at)} 关联 · 记一件事时按这个账号查找</small></div></div>
          ${last ? html`<p class="nt-caption">${NT.md(last.from)} 至 ${NT.md(last.to)} 关联的是 @${last.login}，那段时间保存的记录照旧引用当时的内容。</p>` : ''}
          ${can ? html`<div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--sm" type="button" data-gh="link">更换</button><button class="n-btn n-btn--sm n-btn--ghost" type="button" data-gh="unlink">解除关联</button></div>` : ''}`
        : html`<p class="nt-muted" style="margin:0;font-size:var(--t-sm)">待关联${can ? '' : ' · 由 HR 关联'}</p>
          ${can ? html`<div class="nt-row" style="margin-top:var(--s-3)"><button class="n-btn n-btn--sm" type="button" data-gh="link">${icon('branch')}关联 GitHub 账号</button></div>` : ''}`}
    </article>`;
  };
  gh.wireCard = (host, pid, rerender) => {
    gh.onChange = rerender;
    host.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gh]'); if (!b) return;
      const ok = b.dataset.gh === 'link' ? await gh.linkDialog(pid) : await gh.unlink(pid);
      if (ok) rerender();
    });
  };

  // ---------- 选择 GitHub 依据（记一件事） ----------
  let infraDown = true; // 演示：xe6-infra 第一次查询连接超时，重试后恢复
  function query(id, repo, range) {
    const repos = repo ? [repo] : REPOS;
    const failed = repos.filter((r) => r === 'niu-demo/xe6-infra' && infraDown);
    const list = (ITEMS[id] || []).map(item).filter((g) => repos.includes(g.repo) && !failed.includes(g.repo) && daysBefore(g.at) <= range);
    return { repos, failed, list };
  }
  function fromUrl(text) {
    const m = text.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)\/?$/i);
    if (!m) return { err: '认不出这个链接，粘贴 Issue 或 PR 的完整地址' };
    const repo = m[1].toLowerCase(), kind = m[2].toLowerCase() === 'pull' ? 'pr' : 'issue', n = +m[3];
    if (!REPOS.includes(repo)) return { err: `${repo} 在已配置的仓库之外，请系统管理员加进来后再读取` };
    const known = Object.values(ITEMS).flat().map(item).find((g) => g.repo === repo && g.n === n && g.kind === kind);
    if (known) return { g: { ...known, role: '链接添加' } };
    return { g: item([kind, repo, n, `${kind === 'pr' ? 'PR' : 'Issue'} #${n}（按链接取得）`, '链接添加', kind === 'pr' ? '已合并' : '进行中', kind === 'pr' ? 'yes' : '', '2026-08-22', kind === 'pr' ? '合并于' : '创建于',
      '演示：这里显示按链接取得的标题、描述和状态。']) };
  }

  // 返回勾选的材料（带取得时间）；取消返回空数组
  gh.pick = async (pid, have = []) => {
    const p = st.person(pid), l = gh.link(pid), extra = [];
    let range = 30, repo = '', shown = [];
    const haveKeys = new Set(have.map((g) => g.key));
    const v = await NT.dialog({
      cls: 'n-dialog--wide',
      title: '添加 GitHub 依据',
      body: html`${l ? html`<p>按${p.name}的账号 <b>@${l.login}</b> 查找本人创建的 PR，以及本人创建或被指派的 Issue。</p>
          <div class="n-gh__query">
            <select class="n-select" id="gh-repo" aria-label="仓库"><option value="">全部已配置仓库（${REPOS.length} 个）</option>${REPOS.map((r) => html`<option value="${r}">${r}</option>`)}</select>
            <select class="n-select" id="gh-range" aria-label="时间段">${RANGES.map(([d, t]) => html`<option value="${d}" ${NT.raw(d === range ? 'selected' : '')}>${t}</option>`)}</select>
          </div>
          <div class="n-gh__status" id="gh-status" aria-live="polite"></div>`
        : html`<div class="n-notice is-plain">${icon('info')}<div>${p.name}待关联 GitHub 账号。${st.can('ghLink', pid) ? html`可以先<a href="person.html?id=${pid}#gh">到档案关联</a>，` : 'HR 在档案里关联后可以按人查找；现在'}也可以直接粘贴 Issue 或 PR 链接。</div></div>`}
        <ul class="n-gh__list" id="gh-list"></ul>
        <div class="n-field n-gh__paste"><label class="n-field__label" for="gh-url">粘贴 Issue 或 PR 链接</label>
          <div class="nt-row" style="flex-wrap:nowrap"><input class="n-input" id="gh-url" autocomplete="off" spellcheck="false" placeholder="github.com/niu-demo/storyboard-factory/pull/214"><button class="n-btn n-btn--sm" type="button" id="gh-url-add">添加</button></div>
          <p class="n-field__err" id="gh-url-err" hidden></p></div>
        <p class="nt-caption" style="margin-top:var(--s-3)">勾选的内容作为这件事的依据，和你写的原话一起整理。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '加入这件事', value: 'ok', cls: 'n-btn--ink',
        validate: (dl) => ($$('#gh-list input:checked:not(:disabled)', dl).length ? true : '先勾选要加入的 Issue 或 PR'),
        read: (dl) => $$('#gh-list input:checked:not(:disabled)', dl).map((x) => x.value) }],
      onOpen: (dl) => {
        const list = $('#gh-list', dl), status = $('#gh-status', dl), go = $('.n-dialog__bar [data-i="1"]', dl);
        const row = (g) => html`<li class="n-gh__item"><label><input type="checkbox" value="${g.key}" ${NT.raw(haveKeys.has(g.key) ? 'checked disabled' : '')}>
          <span class="n-gh__kind">${g.kind === 'pr' ? 'PR' : 'Issue'}</span>
          <span class="n-gh__main"><b>${g.title}</b><small>${g.ref} · ${g.role} · ${g.atLabel} ${NT.md(g.at)}${haveKeys.has(g.key) ? ' · 已加入' : ''}</small><small class="n-gh__url">${g.url}</small></span>
          <span class="n-badge ${g.tone ? `n-badge--${g.tone}` : ''}">${g.state}</span></label></li>`;
        const count = () => { const n = $$('input:checked:not(:disabled)', list).length; go.textContent = n ? `加入这件事（${n}）` : '加入这件事'; };
        const draw = () => {
          const r = l ? query(l.id, repo, range) : { repos: [], failed: [], list: [] };
          const rangeT = RANGES.find(([d]) => d === range)[1];
          shown = [...extra, ...r.list.filter((g) => !extra.some((x) => x.key === g.key))];
          if (l) {
            const ok = r.repos.filter((x) => !r.failed.includes(x));
            NT.mount(status, html`<span>${rangeT} · ${ok.length} 个仓库 · 查到 ${r.list.length} 条</span>${r.failed.map((x) => html`<span class="n-gh__fail">${icon('info')}${short(x)} 连接超时<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-gh-retry>重试</button></span>`)}`);
          }
          NT.mount(list, shown.length ? shown.map(row) : l ? html`<li class="n-gh__empty">${rangeT}在${repo ? ` ${short(repo)} ` : `已配置的 ${REPOS.length} 个仓库`}里查到 0 条。换个时间段试试，或粘贴具体链接。</li>` : '');
          count();
        };
        list.addEventListener('change', count);
        if (l) {
          $('#gh-repo', dl).addEventListener('change', (e) => { repo = e.target.value; draw(); });
          $('#gh-range', dl).addEventListener('change', (e) => { range = +e.target.value; draw(); });
          status.addEventListener('click', async (e) => {
            if (!e.target.closest('[data-gh-retry]')) return;
            NT.mount(status, html`<span>查询中</span>`);
            await NT.wait(700); infraDown = false; draw();
          });
        }
        const url = $('#gh-url', dl), err = $('#gh-url-err', dl);
        const addUrl = () => {
          if (!url.value.trim()) { url.focus(); return; }
          const r = fromUrl(url.value);
          err.hidden = !r.err; err.textContent = r.err || '';
          if (r.err) return;
          if (!shown.some((g) => g.key === r.g.key)) extra.unshift(r.g);
          draw();
          const box = $$('input', list).find((x) => x.value === r.g.key); if (box && !box.disabled) box.checked = true;
          url.value = ''; count();
        };
        $('#gh-url-add', dl).addEventListener('click', addUrl);
        url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
        url.addEventListener('input', () => { err.hidden = true; });
        draw();
      },
    });
    if (v?.value !== 'ok') return [];
    const at = clock();
    return v.data.map((k) => ({ ...shown.find((g) => g.key === k), fetched: at }));
  };
})();
