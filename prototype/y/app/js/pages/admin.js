/* 系统管理：只给系统管理员。账号与权限、北森同步、集成与设置、接入状态、审计日志五个页签，只示意结构，数据为演示。
   系统管理员看配置和技术记录，看不到档案、评价和原件；授予业务权限要管理者确认后生效（架构提案 U-10、U-17）。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;

  const TABS = [['acct', '账号与权限'], ['hr', '北森同步'], ['intg', '集成与设置'], ['conn', '接入状态'], ['audit', '审计日志']];
  let tab = TABS.some(([k]) => k === NT.param('tab')) ? NT.param('tab') : 'acct';

  NT.shell({
    nav: 'admin', title: '系统管理',
    allow: (r) => r === 'admin',
    denyTitle: '这一页只给系统管理员',
    denyText: '系统管理包括账号与权限、北森同步、集成配置、接入状态和审计日志。切换到系统管理员视角查看。',
    view: () => `系统管理 · ${TABS.find(([k]) => k === tab)[1]}`,
    state: () => ({ tab }),
    restore: (s) => { if (s?.tab) { const b = document.querySelector(`[role="tab"][data-tab="${s.tab}"]`); b?.click(); } },
    render,
  });

  const ACCOUNTS = [
    ['p-cheng', '管理者', '全公司', '确认规则修订和找人方案；确认业务授权变更'],
    ['p-suwan', 'HR', 'XEngineer 第六期 · 2026-07-06 起', '期次里的学员由人才项目的名单决定'],
    ['p-yeqing', '导师', '所带学员', '由人才项目里的导师分配决定'],
    ['p-xuheng', '系统管理员', '系统配置', '不持有业务角色'],
  ];
  const SYNC = [
    ['组织架构', '人员与组织', '计算部门范围和团队分布'],
    ['人员与任职、职级', '人员与组织', '按字段白名单同步；健康、家庭、联系方式不同步'],
    ['入离调转', '人员与组织', '离职当天停用账号；调岗后重算范围'],
    ['绩效结果、晋升记录', '档案 · 北森人事记录', '只给管理者和 HR 看，按原口径展示；不换算成分数，不进入找人和 AI'],
  ];
  const INTG = [
    ['七牛 MaaS', '整理事件与建议分、会议纪要、复盘草拟', '演示数据'],
    ['Jev', '找人时逐条判断支持、不支持、资料不足、证据冲突', '演示数据'],
    ['通义听悟', '录音转写：离线稿为准，实时稿只做预览', '演示数据'],
    ['七牛 Kodo', '原件与录音存储', '待接入'],
    ['北森开放接口', '组织、任职与人事数据，只读', '待接入'],
  ];
  const AUDIT = [
    ['09-03 10:12', 'p-xuheng', '发起授权变更', '苏晚 · 负责期次增加 Landing 第四期'],
    ['09-02 16:40', 'p-suwan', '查看档案', '孟逸尘'],
    ['09-02 09:05', 'p-cheng', '确认规则修订', '值得关注的入选规则'],
    ['09-01 18:20', 'p-suwan', '导出', '第六期结营盘点'],
    ['09-01 11:02', 'p-xuheng', '修改集成配置', '通义听悟 · 连接地址'],
  ];

  // 接入状态（BOW-916）：企业微信机器人、MCP、AgentAPI 三个入口。只记时间、账号、动作和结果，不记消息正文、文件内容、查询内容和密钥。
  // 演示：?wecom=down 看「已断开」，?wecom=never 看「从未连接」
  const WECOM = {
    on: { label: '已连接', at: '09-04 14:02', text: '最近收到消息 09-04 14:02 · 最近一次回执 09-04 14:03' },
    down: { label: '已断开', at: '09-04 10:18', text: '09-04 10:20 起收不到回调 · 断开前最后收到消息 09-04 10:18', next: '断开期间发来的消息可能没有收到。回调地址和密钥在部署配置里，请部署负责人检查；恢复后这里会显示新的消息时间。' },
    never: { label: '从未连接', at: null, text: '还没有收到过消息', next: '部署时完成机器人配置后，收到第一条消息就会显示「已连接」。' },
  };
  const CALLS = [
    ['09-04 13:40', 'MCP', 'p-suwan', '查任务状态', 'ok', '320 ms'],
    ['09-04 13:12', 'MCP', 'p-cheng', '找人：提交项目要求', 'ok', '1.8 s'],
    ['09-04 11:15', 'AgentAPI', 'p-suwan', '记一件事：提交草稿', 'ok', '640 ms'],
    ['09-04 10:47', 'MCP', 'p-yeqing', '查人员档案摘要', 'deny', '超出查看范围，已拒绝，没有返回内容'],
    ['09-04 09:30', 'AgentAPI', 'p-suwan', '上传材料', 'fail', '文件超过 50 MB，没有入库'],
    ['09-03 18:05', 'MCP', 'p-cheng', '查人员档案摘要', 'ok', '410 ms'],
  ];
  // 调用结果只说明处理到哪一步，沿用处理进度的中性徽标，不用支持 / 不支持的颜色
  const CALL_RES = { ok: ['成功', 'check', ''], deny: ['拒绝', 'lock', 'review'], fail: ['失败', 'x', 'failed'] };
  const BINDS = [
    ['09-04 12:26', 'wx·****3f2a', '人员目录里找不到这个企业微信账号', '让对方在北森补上企业微信账号；补上后下一条消息会自动匹配，这次的材料需要重新发送'],
    ['09-03 16:41', 'wx·****81c0', '对上了两个人，不能确定是谁', '已转给 HR 负责人确认；确认前这个账号发来的材料不入库'],
    ['09-02 09:12', 'wx·****d47e', '账号对应的人员已离职，账号已停用', '不需要处理；已回复对方「账号已停用」'],
  ];
  const TASK_FAILS = [
    { id: 'tf-1', at: '09-04 12:31', what: '整理企业微信材料 · 1 个 PDF', from: '企业微信', by: 'p-yeqing', why: '文件是扫描件，识别不出文字', next: '请发送人改发可复制文字的版本；这一步不能重试解决' },
    { id: 'tf-2', at: '09-04 09:58', what: '转写会议录音 · 42 分钟', from: '企业微信', by: 'p-suwan', why: '转写服务超时，已自动重试 2 次', next: '可以再重试一次；仍失败请部署负责人查看转写服务', retry: true },
    { id: 'tf-3', at: '09-03 20:14', what: '整理事件与建议分 · 3 段纪要', from: 'AgentAPI', by: 'p-suwan', why: '模型返回的格式不对，已自动重试 3 次', next: '可以重试；连续失败请部署负责人检查模型和提示词版本', retry: true },
  ];
  const requeued = new Set();

  function render(main) {
    mount(main, html`
      <header class="nt-head nt-head--tabs"><div><h1>系统管理 <span class="n-badge n-badge--demo">演示</span></h1><p>管账号与权限、北森同步、集成配置、接入状态和审计日志。系统管理员只看配置和技术记录，看不到档案、评价和原件。</p></div></header>
      <div class="n-tabs n-tabs--scroll" role="tablist" id="atabs">${TABS.map(([k, l]) => html`<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}" aria-controls="ap-${k}" tabindex="${k === tab ? 0 : -1}">${l}</button>`)}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-acct" ${NT.raw(tab === 'acct' ? '' : 'hidden')}>${accounts()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-hr" ${NT.raw(tab === 'hr' ? '' : 'hidden')}>${beisen()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-intg" ${NT.raw(tab === 'intg' ? '' : 'hidden')}>${integrations()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-conn" ${NT.raw(tab === 'conn' ? '' : 'hidden')}>${connections()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-audit" ${NT.raw(tab === 'audit' ? '' : 'hidden')}>${audit()}</div>`);
    NT.tabs($('#atabs'), (t) => { tab = t; });
    main.onclick = (e) => {
      if (e.target.closest('[data-grant]')) NT.toast('发起后要管理者确认才生效');
      const r = e.target.closest('[data-requeue]');
      if (r) {
        const id = r.dataset.requeue;
        requeued.add(id); redrawConn();
        NT.toast('已重新排队，处理结果会更新在这里', { undo: () => { requeued.delete(id); redrawConn(); }, undoneText: '已撤销，任务仍是失败' });
      }
    };
  }

  function accounts() {
    return html`
      <section class="nt-sec">
        <h2 class="nt-h2">账号 <small>${ACCOUNTS.length} 个</small></h2>
        <div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>账号</th><th>角色</th><th>范围</th><th>状态</th></tr></thead>
          <tbody>${ACCOUNTS.map(([pid, r, scope, note]) => html`<tr><td style="white-space:nowrap"><span style="display:inline-flex;align-items:center;gap:var(--s-2)">${UI.avatar(pid, 'sm')}${st.person(pid).name}</span></td><td style="white-space:nowrap">${r}</td><td>${scope}<small>${note}</small></td><td style="white-space:nowrap">正常</td></tr>`)}</tbody>
        </table></div>
      </section>
      <section class="nt-sec">
        <h2 class="nt-h2">授权变更 <small>由系统管理员发起，管理者确认后生效</small></h2>
        <div class="n-card" style="display:grid;gap:var(--s-3)">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-2) var(--s-3)">
            <b style="font-weight:600">给苏晚增加负责期次：Landing 第四期（2026-11-03 起）</b>
            <span class="n-badge n-badge--prep">待管理者确认</span>
            <small class="nt-muted" style="margin-left:auto">许衡发起 · 09-03</small>
          </div>
          <div><button class="n-btn n-btn--sm" type="button" data-grant>${icon('plus')}发起授权变更</button></div>
        </div>
        <div class="n-lock" style="margin-top:var(--s-3)">${icon('lock')}<span>系统管理员账号不持有业务角色。学员名单和导师分配由 HR 在人才项目里维护，这里只读；增补学员也要管理者确认。</span></div>
      </section>`;
  }

  function beisen() {
    return html`
      <section class="nt-sec">
        <div class="n-card" style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-2) var(--s-4)">
          <b style="font-weight:600">北森开放接口</b><span class="n-badge n-badge--prep">待接入</span>
          <span class="nt-muted" style="font-size:var(--t-sm)">接入后每天增量同步、每周全量对账；只读，不回写北森。</span>
        </div>
      </section>
      <section class="nt-sec">
        <h2 class="nt-h2">同步范围</h2>
        <div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>数据</th><th>写入</th><th>用法</th></tr></thead>
          <tbody>${SYNC.map(([d, to, use]) => html`<tr><td>${d}</td><td>${to}</td><td>${use}</td></tr>`)}</tbody>
        </table></div>
        <p class="nt-caption">冲突时组织、人员、任职以北森为准；人才项目名单、导师关系、评价与校准不被北森覆盖。</p>
      </section>
      <div class="nt-cols nt-sec">
        <section><h2 class="nt-h2">最近同步</h2><div class="nt-empty">接入后，这里列出每次同步的时间、条数和失败原因。</div></section>
        <section><h2 class="nt-h2">同步异常</h2>
          <div class="n-card" style="font-size:var(--t-sm);line-height:1.7">
            <p style="margin:0"><b style="font-weight:600">接口失败、字段映射缺失</b>：系统管理员重试或修改映射。</p>
            <p style="margin:var(--s-2) 0 0"><b style="font-weight:600">匹配不到人、疑似同一人、任职重叠</b>：转给 HR 负责人确认；确认前，这一批里涉及此人的变更先不写入。</p>
          </div>
        </section>
      </div>`;
  }

  function integrations() {
    return html`
      <section class="nt-sec">
        <h2 class="nt-h2">外部服务</h2>
        <div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>服务</th><th>用途</th><th>状态</th></tr></thead>
          <tbody>${INTG.map(([n, use, s]) => html`<tr><td>${n}</td><td>${use}</td><td><span class="n-badge ${s === '待接入' ? 'n-badge--prep' : 'n-badge--demo'}">${s}</span></td></tr>`)}</tbody>
        </table></div>
        <p class="nt-caption">密钥在服务端环境变量里配置，界面不显示。模型与提示词版本、用量接入后在这里查看；企业微信、MCP、AgentAPI 的连接情况和失败任务在「接入状态」。</p>
      </section>`;
  }

  function redrawConn() { mount($('#ap-conn'), connections()); }

  function connections() {
    const wk = WECOM[NT.param('wecom')] ? NT.param('wecom') : 'on', w = WECOM[wk];
    const recent = (src) => CALLS.filter((c) => c[1] === src);
    const callCard = (src, use) => {
      const l = recent(src), bad = l.filter((c) => c[4] !== 'ok').length;
      return html`<article class="n-card n-conn__item"><header class="n-conn__head"><b>${src}</b>${l.length ? html`<span class="n-conn__state" data-state="on">有调用</span>` : html`<span class="n-conn__state" data-state="never">还没有调用</span>`}</header>
        <p class="n-conn__use">${use}</p>
        <p class="n-conn__meta">${l.length ? `最近一次调用 ${l[0][0]} · 近 24 小时 ${l.length} 次${bad ? `，其中 ${bad} 次拒绝或失败` : ''}` : '部署后有账号调用时，这里显示最近的时间和结果'}</p></article>`;
    };
    // 重新排队的任务留在原位，改成「已重新排队」，处理完才离开这里；计数只算还没处理的失败
    const tasks = TASK_FAILS, open = tasks.filter((t) => !requeued.has(t.id));
    return html`
      <section class="nt-sec">
        <div class="n-conn">
          <article class="n-card n-conn__item"><header class="n-conn__head"><b>企业微信机器人</b><span class="n-conn__state" data-state="${wk}">${w.label}</span></header>
            <p class="n-conn__use">收材料，并给发送人回执</p>
            <p class="n-conn__meta">${w.text}</p>
            ${w.next ? html`<p class="n-conn__next">${icon('info')}<span>${w.next}</span></p>` : ''}</article>
          ${callCard('MCP', '在 Agent 工具里查人、找人、查任务状态')}
          ${callCard('AgentAPI', '其他系统提交材料和事件草稿')}
        </div>
        <div class="n-lock" style="margin-top:var(--s-3)">${icon('lock')}<span>接入配置（机器人回调地址、MCP 与 AgentAPI 的令牌）在部署时完成，这里只看状态。页面不显示消息正文、文件内容、查询内容和密钥。</span></div>
      </section>
      <section class="nt-sec">
        <h2 class="nt-h2">最近调用 <small>MCP 与 AgentAPI · 只记账号、动作和结果</small></h2>
        ${CALLS.length ? html`<div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>时间</th><th>入口</th><th>账号</th><th>动作</th><th>结果</th></tr></thead>
          <tbody>${CALLS.map(([t, src, pid, act, res, note]) => html`<tr><td style="white-space:nowrap">${t}</td><td style="white-space:nowrap">${src}</td><td style="white-space:nowrap">${st.person(pid).name}</td><td>${act}</td><td><span class="n-badge n-badge--proc" ${NT.raw(CALL_RES[res][2] ? `data-state="${CALL_RES[res][2]}"` : '')}>${icon(CALL_RES[res][1])}${CALL_RES[res][0]}</span><small>${note}</small></td></tr>`)}</tbody>
        </table></div>` : html`<div class="nt-empty">还没有调用记录。</div>`}
      </section>
      <section class="nt-sec">
        <h2 class="nt-h2">绑定失败 <small>发送人对不上人员目录 · 近 7 天 ${BINDS.length} 条</small></h2>
        ${BINDS.length ? html`<div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>时间</th><th>发送人账号</th><th>原因</th><th>接下来</th></tr></thead>
          <tbody>${BINDS.map(([t, acct, why, next]) => html`<tr><td style="white-space:nowrap">${t}</td><td style="white-space:nowrap" title="企业微信账号只显示后四位">${acct}</td><td>${why}</td><td>${next}</td></tr>`)}</tbody>
        </table></div>` : html`<div class="nt-empty">近 7 天没有绑定失败。</div>`}
        <p class="nt-caption">绑定以北森人员目录里的企业微信账号为准，这里不能手动改绑。对不上的消息不入库，并回复发送人「还没有绑定」。</p>
      </section>
      <section class="nt-sec">
        <h2 class="nt-h2">任务失败 <small>${open.length ? `${open.length} 个待处理` : '没有待处理的'}${open.length < tasks.length ? ` · ${tasks.length - open.length} 个已重新排队` : ''}</small></h2>
        ${tasks.length ? html`<ul class="n-tfail">${tasks.map((t) => (requeued.has(t.id)
          ? html`<li class="n-card" data-state="queued">
            <div class="n-tfail__top"><span class="n-badge n-badge--proc" data-state="queued">${icon('clock')}已重新排队</span><b>${t.what}</b><small class="nt-muted">${t.from} · ${st.person(t.by).name}发起 · ${t.at}</small></div>
            <dl class="n-tfail__dl"><dt>上次原因</dt><dd>${t.why}</dd><dt>接下来</dt><dd>排队处理中，结果会更新在这张卡上；处理完会回到发起人的工作台</dd></dl>
          </li>`
          : html`<li class="n-card">
            <div class="n-tfail__top"><span class="n-badge n-badge--proc" data-state="failed">${icon('x')}失败</span><b>${t.what}</b><small class="nt-muted">${t.from} · ${st.person(t.by).name}发起 · ${t.at}</small></div>
            <dl class="n-tfail__dl"><dt>原因</dt><dd>${t.why}</dd><dt>接下来</dt><dd>${t.next}</dd></dl>
            ${t.retry ? html`<div><button class="n-btn n-btn--sm" type="button" data-requeue="${t.id}">${icon('retry')}重试</button></div>` : ''}
          </li>`))}</ul>` : html`<div class="nt-empty">没有失败的任务。重新排队的任务处理完会回到发起人的工作台。</div>`}
      </section>`;
  }

  function audit() {
    return html`
      <section class="nt-sec">
        <h2 class="nt-h2">审计日志 <small>授权变更、查看档案与原件、导出与打印、配置变更都会记录</small></h2>
        <div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th></tr></thead>
          <tbody>${[...st.audits().map((a) => [a.at, a.by, a.act, a.obj]), ...AUDIT].map(([t, pid, act, obj]) => html`<tr><td style="white-space:nowrap">${t}</td><td style="white-space:nowrap">${st.person(pid).name}</td><td>${act}</td><td>${obj}</td></tr>`)}</tbody>
        </table></div>
        <p class="nt-caption">系统管理员和 HR 负责人可以查。日志只记谁在什么时间做了什么，不含档案、评价和导出的内容。</p>
      </section>`;
  }
})();
