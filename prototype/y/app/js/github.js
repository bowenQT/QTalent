/* GitHub 依据：GitHub App 装在组织上，只读取安装时开放的仓库；人员关联 GitHub 账号（单人或按员工编号批量），
   记一件事时按这个人查已开放仓库里的 Issue、PR 和评审，课题绑定仓库后按 GitHub 状态显示看板。
   原型不连 GitHub：组织、账号、仓库和 Issue / PR 都是演示数据。xe6-infra 第一次查询演示连接超时，季叙白演示查询结果为空。
   账号按稳定 ID 匹配，login 只用于展示；改绑后，原关联时段里的记录仍归原来的人。平台角色和合并状态是 GitHub 的记录，描述里的说法出自作者本人。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store;
  const { html, icon, $, $$ } = NT;

  // 组织里的仓库；开放给本系统的在 store 的 ghApp.repos
  const ORG_REPOS = [
    { name: 'niu-demo/storyboard-factory', private: false, desc: '分镜工厂 · 短剧创作智能体' },
    { name: 'niu-demo/story-api', private: true, desc: '分镜工厂 · 后端服务' },
    { name: 'niu-demo/xe6-infra', private: true, desc: '第六期共用基础设施' },
    { name: 'niu-demo/talk-buddy', private: true, desc: '口语搭子' },
    { name: 'niu-demo/leida-crm', private: false, desc: '线索雷达 · CRM 接入' },
    { name: 'niu-demo/people-ops', private: true, desc: '人事内部工具' },
  ];
  // 组织成员：GitHub App 读到的成员名单
  const USERS = {
    'demo-mengyc': { id: 58210473, name: 'Meng Yichen' },
    'demo-shenyc': { id: 60311925, name: 'Shen Yichu' },
    'demo-jixubai': { id: 61002387, name: 'Ji Xubai' },
    'demo-zhoucq': { id: 59877410, name: 'Zhou Chuqing' },
    'demo-fangjs': { id: 60455120, name: 'Fang Jingshen' },
    'demo-sushq': { id: 57720031, name: 'Su Shaoqing' },
    'demo-xiehj': { id: 58833402, name: 'Xie Huaijin' },
    'demo-yeqing': { id: 51200877, name: 'Ye Qing' },
    'demo-wenyu': { id: 62019934, name: 'Wen Yu' },
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
      ['pr', 'niu-demo/storyboard-factory', 214, '视频上传：分片失败后按指数退避重试', 'PR 评审人', '已合并', 'yes', '2026-08-26', '评审于',
        '评审意见：弱网下要给用户看到重试进度；作者补了重试中的提示后通过。'],
    ],
    60311925: [
      ['pr', 'niu-demo/story-api', 205, '分镜缓存：三级缓存替换单层 Redis', 'PR 作者', '已合并', 'yes', '2026-08-24', '合并于',
        '把单层 Redis 换成内存、Redis、对象存储三级缓存；压测下 P95 从 2.1 秒降到 0.6 秒。'],
      ['issue', 'niu-demo/storyboard-factory', 226, '导出 MP4 时音画不同步', 'Issue 被指派', '进行中', '', '2026-09-02', '创建于',
        '导出超过 3 分钟的片段，音轨比画面晚约 0.4 秒；已定位到转码参数，正在验证。'],
    ],
    60455120: [
      ['pr', 'niu-demo/storyboard-factory', 228, '分镜卡片支持批量替换角色', 'PR 作者', '评审中', '', '2026-09-03', '创建于',
        '一次替换整部剧里同一角色的形象，替换前先预览受影响的分镜。'],
      ['pr', 'niu-demo/story-api', 205, '分镜缓存：三级缓存替换单层 Redis', 'PR 评审人', '已合并', 'yes', '2026-08-23', '评审于',
        '评审意见：对象存储这一层要设过期时间，否则旧分镜会一直占空间；作者补了 7 天过期。'],
    ],
    62019934: [
      ['issue', 'niu-demo/storyboard-factory', 230, '分镜模板库：支持按题材筛选', 'Issue 创建人', '待处理', '', '2026-09-03', '创建于',
        '希望模板库能按悬疑、爱情、喜剧筛选，现在只能按时间翻。'],
    ],
  };
  // 评论和评审次数（演示）
  const TALK = { 'niu-demo/storyboard-factory#214': [6, 2], 'niu-demo/story-api#205': [4, 1], 'niu-demo/storyboard-factory#228': [3, 0], 'niu-demo/storyboard-factory#221': [5, 0],
    'niu-demo/storyboard-factory#226': [2, 0], 'niu-demo/story-api#198': [3, 0], 'niu-demo/storyboard-factory#203': [1, 1], 'niu-demo/storyboard-factory#209': [2, 1], 'niu-demo/story-api#190': [8, 2] };
  const LANES = [['todo', '待处理'], ['doing', '进行中'], ['review', '评审中'], ['done', '已完成']];
  const laneOf = (state) => ({ 待处理: 'todo', 进行中: 'doing', 评审中: 'review' })[state] || 'done';
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
  gh.ORG_REPOS = ORG_REPOS;
  gh.LANES = LANES;
  gh.app = () => st.get().ghApp;
  gh.repos = () => (gh.app().state === 'installed' ? gh.app().repos : []);
  gh.repo = (name) => ORG_REPOS.find((r) => r.name === name);
  gh.short = short;
  // ghLinks[pid]：login 为 null 表示已解除；prev 是以往关联过的账号和时段，解除、改绑都追加进去
  gh.link = (pid) => (st.get().ghLinks[pid]?.login ? st.get().ghLinks[pid] : null);
  gh.history = (pid) => st.get().ghLinks[pid]?.prev || [];
  gh.user = (login) => (USERS[login] ? { login, ...USERS[login] } : null);
  gh.userById = (id) => { const e = Object.entries(USERS).find(([, u]) => u.id === id); return e ? { login: e[0], ...e[1] } : null; };
  gh.members = () => Object.keys(USERS).map(gh.user);
  const ownerOf = (id, except) => Object.entries(st.get().ghLinks).find(([p, l]) => l.login && l.id === id && p !== except)?.[0] || null;
  // 一条记录归谁：落在某人以往关联时段里的归那个人，其余归现在关联这个账号的人；改绑不把旧记录转到新的人名下
  gh.personOf = (id, date) => {
    const links = Object.entries(st.get().ghLinks);
    const past = links.find(([, l]) => l.prev.some((x) => x.id === id && date >= x.from && date < x.to));
    return past ? past[0] : ownerOf(id);
  };
  gh.find = (key) => Object.values(ITEMS).flat().map(item).find((g) => g.key === key) || null;
  // 仓库里的全部 Issue 和 PR，按条目合并：作者或被指派的人是负责人，评审人另列
  gh.repoItems = (repos) => {
    const by = new Map();
    Object.entries(ITEMS).forEach(([uid, list]) => list.map(item).filter((g) => repos.includes(g.repo)).forEach((g) => {
      const cur = by.get(g.key) || { ...g, owner: null, reviewers: [], lane: laneOf(g.state), talk: TALK[g.key] || [0, 0] };
      const who = { id: +uid, login: gh.userById(+uid).login, pid: gh.personOf(+uid, g.at) };
      if (g.role === 'PR 评审人') cur.reviewers.push(who);
      else { Object.assign(cur, { ...g, reviewers: cur.reviewers, lane: laneOf(g.state), talk: cur.talk }); cur.owner = who; }
      by.set(g.key, cur);
    }));
    return [...by.values()].filter((g) => g.owner).sort((a, b) => b.at.localeCompare(a.at));
  };
  gh.avatar = (login) => html`<span class="n-avatar n-avatar--sm n-gh__avatar" aria-hidden="true">${login.replace(/^demo-/, '').slice(0, 1).toUpperCase()}</span>`;

  // 没有手写原话时，按所选材料起草；起草用的文字只交给整理，不作为「记录原话」保存
  gh.draftText = (pid, list) => `${st.person(pid).name}${list.map((g) => `${g.kind === 'pr' ? '提交了' : '处理了'}「${g.title}」：${g.body}`).join('；')}`;

  // ---------- 关联账号（HR） ----------
  // 主路径从组织成员里选；不在组织里的账号（外部协作者）再输入用户名查找
  gh.linkDialog = async (pid) => {
    const p = st.person(pid), cur = gh.link(pid);
    let found = null;
    const free = gh.members().filter((u) => !ownerOf(u.id) && u.id !== cur?.id);
    const v = await NT.dialog({
      title: cur ? `更换${p.name}的 GitHub 账号` : `关联${p.name}的 GitHub 账号`,
      body: html`<label class="n-field"><span class="n-field__label">${gh.app().org} 组织成员</span>
          <select class="n-select" id="ghl-m"><option value="">选一个账号</option>${free.map((u) => html`<option value="${u.login}">@${u.login} · ${u.name}</option>`)}</select></label>
        <details class="n-gh__other"><summary>不在组织成员里？按用户名查找</summary>
          <div class="nt-row" style="flex-wrap:nowrap;margin-top:var(--s-2)"><input class="n-input" id="ghl-q" autocomplete="off" spellcheck="false" placeholder="用户名或 github.com/用户名"><button class="n-btn n-btn--sm" type="button" id="ghl-find">${icon('search')}查找</button></div></details>
        <div id="ghl-res" aria-live="polite"></div>
        ${cur ? html`<p class="nt-caption" style="margin-top:var(--s-3)">@${cur.login} 关联期间的记录仍归${p.name}。</p>` : ''}`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '保存关联', value: 'ok', cls: 'n-btn--ink',
        validate: (dl) => (!found ? '先查找并核对账号' : !$('#ghl-ok', dl)?.checked ? `勾选确认这是${p.name}本人的账号` : true) }],
      onOpen: (dl) => {
        const res = $('#ghl-res', dl), q = $('#ghl-q', dl);
        const find = (raw) => {
          const login = (raw ?? q.value).trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
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
        $('#ghl-find', dl).addEventListener('click', () => find());
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
        $('#ghl-m', dl).addEventListener('change', (e) => { if (e.target.value) find(e.target.value); else { found = null; NT.mount(res, ''); } });
      },
    });
    if (v !== 'ok') return false;
    const S = st.get(), before = S.ghLinks[pid];
    setLink(pid, found);
    st.save();
    NT.toast(`已关联 @${found.login}`, { undo: () => { if (before) S.ghLinks[pid] = before; else delete S.ghLinks[pid]; st.save(); gh.onChange?.(); }, undoneText: '已撤销这次关联' });
    return true;
  };
  // 关联或改绑：原来的账号和时段追加进 prev
  function setLink(pid, u, via) {
    const S = st.get(), before = S.ghLinks[pid];
    const prev = before ? [...before.prev, ...(before.login ? [{ login: before.login, id: before.id, from: before.at, to: NT.TODAY }] : [])] : [];
    S.ghLinks[pid] = { login: u ? u.login : null, id: u ? u.id : null, by: st.me().id, at: NT.TODAY, prev, ...(via ? { via } : {}) };
  }
  gh.unlink = async (pid) => {
    const p = st.person(pid), cur = gh.link(pid);
    const v = await NT.dialog({
      title: `解除${p.name}与 @${cur.login} 的关联？`,
      body: html`<p>已关联期间的 Issue、PR 和保存的记录仍归${p.name}。之后记一件事时改为粘贴链接添加 GitHub 依据。</p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, { label: '解除关联', value: 'ok', cls: 'n-btn--ink' }],
    });
    if (v !== 'ok') return false;
    const S = st.get(), before = S.ghLinks[pid];
    setLink(pid, null);
    st.save();
    NT.toast(`已解除 @${cur.login}`, { undo: () => { S.ghLinks[pid] = before; st.save(); gh.onChange?.(); }, undoneText: '已恢复关联' });
    return true;
  };

  // ---------- 批量关联（HR） ----------
  // 表格至少两列：员工编号、GitHub 用户名；可选姓名列用来核对。按员工编号匹配，同名的人不会绑错
  const BAD = { noEmp: '找不到这个员工编号', scope: '不在你负责的范围', noUser: 'GitHub 上没有这个账号', taken: '账号已关联给', dup: '表里重复', name: '姓名和员工编号对不上' };
  const sample = () => {
    const no = (pid) => st.person(pid).no, nm = (pid) => st.person(pid).name;
    return [
      [no('p-x12'), 'demo-shenyc', nm('p-x12')], [no('p-x14'), 'demo-fangjs', nm('p-x14')], [no('p-x01'), 'demo-sushq', nm('p-x01')],
      [no('p-x11'), 'demo-mengyc', nm('p-x11')], [no('p-x05'), 'demo-jixubai', nm('p-x05')], [no('p-x02'), 'demo-yujx', nm('p-x02')],
      [no('p-x03'), 'demo-xiehj', nm('p-x03')], [no('p-x04'), 'demo-xiehj', nm('p-x04')], ['QN000417', 'demo-wenyu', '温语'], [no('p-x13'), 'demo-zhoucq', nm('p-x15')],
    ];
  };
  const parse = (text) => {
    const rows = text.split(/\r?\n/).map((l) => l.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ''))).filter((r) => r.some(Boolean));
    if (!rows.length) return { err: '表格是空的' };
    const head = rows[0].map((c) => c.toLowerCase());
    const iNo = head.findIndex((c) => /员工编号|工号/.test(c)), iGh = head.findIndex((c) => /github/.test(c)), iName = head.findIndex((c) => /姓名/.test(c));
    if (iNo < 0 || iGh < 0) return { err: '第一行要有「员工编号」和「GitHub 用户名」两列' };
    return { rows: rows.slice(1).map((r) => [r[iNo] || '', (r[iGh] || '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, ''), iName >= 0 ? r[iName] || '' : '']) };
  };
  const match = (rows) => {
    const people = st.people();
    const seenNo = {}, seenGh = {};
    rows.forEach(([no, login]) => { seenNo[no] = (seenNo[no] || 0) + 1; seenGh[login.toLowerCase()] = (seenGh[login.toLowerCase()] || 0) + 1; });
    return rows.map(([no, login, name], i) => {
      const p = people.find((x) => x.no === no), u = gh.user(login), r = { i: i + 2, no, login, name, p, u };
      if (seenNo[no] > 1) return { ...r, bad: 'dup', why: `员工编号 ${no} 出现 ${seenNo[no]} 次` };
      if (seenGh[login.toLowerCase()] > 1) return { ...r, bad: 'dup', why: `@${login} 出现 ${seenGh[login.toLowerCase()]} 次` };
      if (!p) return { ...r, bad: 'noEmp' };
      if (name && name !== p.name) return { ...r, bad: 'name', why: `编号对应的是${p.name}` };
      if (!st.can('ghLink', p.id)) return { ...r, bad: 'scope' };
      if (!u) return { ...r, bad: 'noUser' };
      const other = ownerOf(u.id, p.id);
      if (other) return { ...r, bad: 'taken', why: st.person(other).name };
      const cur = gh.link(p.id);
      if (cur?.id === u.id) return { ...r, skip: true };
      return { ...r, change: cur ? cur.login : null };
    });
  };
  gh.batchDialog = async () => {
    let picked = null;
    await NT.dialog({
      title: '批量关联 GitHub 账号',
      body: html`<p>上传一张表格，第一行写列名，至少包含「员工编号」和「GitHub 用户名」；有「姓名」列时会一起核对。</p>
        <div class="n-gh__drop"><label class="n-btn n-btn--sm">${icon('upload')}选择 CSV 文件<input type="file" id="ghb-file" accept=".csv,.txt,text/csv" hidden></label>
          <button class="n-btn n-btn--sm n-btn--ghost" type="button" id="ghb-demo">用示例表格 ${NT.ui.demo()}</button></div>
        <p class="n-field__err" id="ghb-err" hidden></p>`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }],
      onOpen: (dl) => {
        const err = $('#ghb-err', dl);
        const done = (rows) => { picked = rows; dl.close(); };
        $('#ghb-demo', dl).addEventListener('click', () => done(sample()));
        $('#ghb-file', dl).addEventListener('change', async (e) => {
          const f = e.target.files[0]; if (!f) return;
          const r = parse(await f.text());
          if (r.err) { err.hidden = false; err.textContent = r.err; return; }
          if (!r.rows.length) { err.hidden = false; err.textContent = '表格里只有列名，没有数据行'; return; }
          done(r.rows);
        });
      },
    });
    if (!picked) return false;
    const res = match(picked);
    const ok = res.filter((r) => !r.bad && !r.skip), bad = res.filter((r) => r.bad), skip = res.filter((r) => r.skip);
    const row = (r) => html`<tr class="${r.bad ? 'is-bad' : ''}"><td class="nt-muted">${r.i}</td><td>${r.no}</td><td>${r.name || r.p?.name || '—'}</td><td>@${r.login}</td>
      <td>${r.bad ? html`<span class="n-gh__why">${BAD[r.bad]}${r.why ? (r.bad === 'taken' ? r.why : `：${r.why}`) : ''}</span>` : r.skip ? html`<span class="nt-muted">已是当前账号</span>` : r.change ? html`<span>改绑，原来是 @${r.change}</span>` : html`<span class="n-gh__ok">${icon('check', 14)}新关联</span>`}</td></tr>`;
    const table = (list) => html`<div class="nt-tablewrap"><table class="nt-table n-gh__tbl"><thead><tr><th>行</th><th>员工编号</th><th>姓名</th><th>GitHub</th><th>结果</th></tr></thead><tbody>${list.map(row)}</tbody></table></div>`;
    const v = await NT.dialog({
      cls: 'n-dialog--wide',
      title: '核对匹配结果',
      body: html`<div class="n-gh__sum"><span><b>${ok.length}</b> 行可以导入</span>${bad.length ? html`<span class="is-bad"><b>${bad.length}</b> 行有问题，不导入</span>` : ''}${skip.length ? html`<span><b>${skip.length}</b> 行已是当前账号</span>` : ''}</div>
        ${bad.length ? html`<h4 class="n-gh__h">有问题的行 <small>改好表格后可以再传一次</small></h4>${table(bad)}` : ''}
        ${ok.length ? html`<h4 class="n-gh__h">可以导入</h4>${table(ok)}` : ''}
        ${skip.length ? html`<details class="n-gh__hist"><summary>已是当前账号的 ${skip.length} 行</summary>${table(skip)}</details>` : ''}`,
      actions: [{ label: '取消', value: 'cancel', cls: 'n-btn--ghost' }, ...(ok.length ? [{ label: `导入 ${ok.length} 行`, value: 'ok', cls: 'n-btn--ink' }] : [])],
    });
    if (v !== 'ok') return false;
    const S = st.get(), before = NT.clone(S.ghLinks);
    ok.forEach((r) => setLink(r.p.id, r.u, 'batch'));
    st.save();
    NT.toast(`已关联 ${ok.length} 个账号${bad.length ? `，${bad.length} 行未导入` : ''}`, { undo: () => { S.ghLinks = before; st.save(); gh.onChange?.(); }, undoneText: '已撤销这次批量关联' });
    return true;
  };

  // 档案右栏：能看档案的人都能看到关联的账号和以往关联过的账号，负责这个人的 HR 可以关联、更换或解除
  const histList = (pid) => {
    const h = gh.history(pid);
    return h.length ? html`<details class="n-gh__hist"><summary>以往关联 ${h.length} 个账号</summary><ul>${h.slice().reverse().map((x) => html`<li><b>@${x.login}</b><span>${NT.md(x.from)} – ${NT.md(x.to)}</span></li>`)}</ul></details>` : '';
  };
  const acct = (pid, l) => html`<div class="n-gh__acct">${gh.avatar(l.login)}<div><b>@${l.login}</b> ${NT.ui.demo()}<small>${st.person(l.by).name} ${NT.md(l.at)} ${l.via === 'batch' ? '批量关联' : '关联'}</small></div></div>`;
  gh.card = (pid) => {
    const l = gh.link(pid), can = st.can('ghLink', pid);
    return html`<section class="n-facet" id="gh"><h3 class="n-facet__head">GitHub 账号${can ? html`<span class="n-facet__act">${l ? html`<button class="n-link" type="button" data-gh="link">更换</button><button class="n-link" type="button" data-gh="unlink">解除关联</button>` : html`<button class="n-link" type="button" data-gh="link">关联账号</button>`}</span>` : ''}</h3>
      ${l ? acct(pid, l) : html`<p class="nt-muted" style="margin:0;font-size:var(--t-sm)">待关联${can ? '' : ' · 由 HR 关联'}</p>`}
      ${histList(pid)}
    </section>`;
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
  function query(pid, id, repo, range) {
    const repos = repo ? [repo] : gh.repos();
    const failed = repos.filter((r) => r === 'niu-demo/xe6-infra' && infraDown);
    const list = (ITEMS[id] || []).map(item).filter((g) => repos.includes(g.repo) && !failed.includes(g.repo) && daysBefore(g.at) <= range && gh.personOf(id, g.at) === pid);
    return { repos, failed, list };
  }
  function fromUrl(text) {
    const m = text.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)\/?$/i);
    if (!m) return { err: '认不出这个链接，粘贴 Issue 或 PR 的完整地址' };
    const repo = m[1].toLowerCase(), kind = m[2].toLowerCase() === 'pull' ? 'pr' : 'issue', n = +m[3];
    if (!gh.repos().includes(repo)) return { err: `${repo} 没有开放给本系统，请系统管理员在 GitHub App 里开放后再读取` };
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
      body: html`${l ? html`<p>按${p.name}的账号 <b>@${l.login}</b> 查找本人创建或评审的 PR，以及本人创建或被指派的 Issue。</p>
          <div class="n-gh__query">
            <select class="n-select" id="gh-repo" aria-label="仓库"><option value="">全部已开放仓库（${gh.repos().length} 个）</option>${gh.repos().map((r) => html`<option value="${r}">${r}</option>`)}</select>
            <select class="n-select" id="gh-range" aria-label="时间段">${RANGES.map(([d, t]) => html`<option value="${d}" ${NT.raw(d === range ? 'selected' : '')}>${t}</option>`)}</select>
          </div>
          <div class="n-gh__status" id="gh-status" aria-live="polite"></div>`
        : html`<div class="n-notice is-plain">${icon('info')}<div>${p.name}待关联 GitHub 账号。${st.can('ghLink', pid) ? html`可以先<a href="person.html?id=${pid}#gh">到档案关联</a>，` : 'HR 在档案里关联后可以按人查找；现在'}也可以直接粘贴 Issue 或 PR 链接。</div></div>`}
        <ul class="n-gh__list" id="gh-list"></ul>
        <div class="n-field n-gh__paste"><label class="n-field__label" for="gh-url">粘贴 Issue 或 PR 链接</label>
          <div class="nt-row" style="flex-wrap:nowrap"><input class="n-input" id="gh-url" autocomplete="off" spellcheck="false" placeholder="github.com/niu-demo/storyboard-factory/pull/214"><button class="n-btn n-btn--sm" type="button" id="gh-url-add">添加</button></div>
          <p class="n-field__err" id="gh-url-err" hidden></p></div>
        `,
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
          const r = l ? query(pid, l.id, repo, range) : { repos: [], failed: [], list: [] };
          const rangeT = RANGES.find(([d]) => d === range)[1];
          shown = [...extra, ...r.list.filter((g) => !extra.some((x) => x.key === g.key))];
          if (l) {
            const ok = r.repos.filter((x) => !r.failed.includes(x));
            NT.mount(status, html`<span>${rangeT} · ${ok.length} 个仓库 · 查到 ${r.list.length} 条</span>${r.failed.map((x) => html`<span class="n-gh__fail">${icon('info')}${short(x)} 连接超时<button class="n-btn n-btn--sm n-btn--ghost" type="button" data-gh-retry>重试</button></span>`)}`);
          }
          NT.mount(list, shown.length ? shown.map(row) : l ? html`<li class="n-gh__empty">${rangeT}在${repo ? ` ${short(repo)} ` : `已开放的 ${gh.repos().length} 个仓库`}里查到 0 条。换个时间段试试，或粘贴具体链接。</li>` : '');
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
