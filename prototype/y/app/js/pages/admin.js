/* 系统管理：只给系统管理员。账号与权限、北森同步、集成与设置、审计日志四个页签，只示意结构，数据为演示。
   系统管理员看配置和技术记录，看不到档案、评价和原件；授予业务权限要管理者确认后生效（架构提案 U-10、U-17）。 */
(function () {
  'use strict';
  const NT = window.NT, st = NT.store, UI = NT.ui;
  const { html, icon, mount, $ } = NT;

  const TABS = [['acct', '账号与权限'], ['hr', '北森同步'], ['intg', '集成与设置'], ['audit', '审计日志']];
  let tab = TABS.some(([k]) => k === NT.param('tab')) ? NT.param('tab') : 'acct';

  NT.shell({
    nav: 'admin', title: '系统管理',
    allow: (r) => r === 'admin',
    denyTitle: '这一页只给系统管理员',
    denyText: '系统管理包括账号与权限、北森同步、集成配置和审计日志。切换到系统管理员视角查看。',
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
    ['10-25 10:12', 'p-xuheng', '发起授权变更', '苏晚 · 负责期次增加 Landing 第四期'],
    ['10-24 16:40', 'p-suwan', '查看档案', '孟逸尘'],
    ['10-24 09:05', 'p-cheng', '确认规则修订', '值得关注的入选规则'],
    ['10-23 18:20', 'p-suwan', '导出', '第六期结营盘点'],
    ['10-23 11:02', 'p-xuheng', '修改集成配置', '通义听悟 · 连接地址'],
  ];

  function render(main) {
    mount(main, html`
      <header class="nt-head nt-head--tabs"><div><h1>系统管理 <span class="n-badge n-badge--demo">演示</span></h1><p>管账号与权限、北森同步、集成配置和审计日志。系统管理员只看配置和技术记录，看不到档案、评价和原件。</p></div></header>
      <div class="n-tabs" role="tablist" id="atabs">${TABS.map(([k, l]) => html`<button role="tab" type="button" data-tab="${k}" aria-selected="${k === tab}" aria-controls="ap-${k}" tabindex="${k === tab ? 0 : -1}">${l}</button>`)}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-acct" ${NT.raw(tab === 'acct' ? '' : 'hidden')}>${accounts()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-hr" ${NT.raw(tab === 'hr' ? '' : 'hidden')}>${beisen()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-intg" ${NT.raw(tab === 'intg' ? '' : 'hidden')}>${integrations()}</div>
      <div class="n-tabpanel" role="tabpanel" id="ap-audit" ${NT.raw(tab === 'audit' ? '' : 'hidden')}>${audit()}</div>`);
    NT.tabs($('#atabs'), (t) => { tab = t; });
    main.onclick = (e) => {
      if (e.target.closest('[data-grant]')) NT.toast('发起后要管理者确认才生效');
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
            <small class="nt-muted" style="margin-left:auto">许衡发起 · 10-25</small>
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
        <p class="nt-caption">密钥在服务端环境变量里配置，界面不显示。模型与提示词版本、用量和失败任务，接入后在这里查看。</p>
      </section>`;
  }

  function audit() {
    return html`
      <section class="nt-sec">
        <h2 class="nt-h2">审计日志 <small>授权变更、查看档案与原件、导出、配置变更都会记录</small></h2>
        <div class="n-card nt-tablewrap" style="padding:var(--s-2) var(--s-4)"><table class="nt-table">
          <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th></tr></thead>
          <tbody>${AUDIT.map(([t, pid, act, obj]) => html`<tr><td style="white-space:nowrap">${t}</td><td style="white-space:nowrap">${st.person(pid).name}</td><td>${act}</td><td>${obj}</td></tr>`)}</tbody>
        </table></div>
        <p class="nt-caption">系统管理员和 HR 负责人可以查。日志只记谁在什么时间做了什么，不含档案和评价内容。</p>
      </section>`;
  }
})();
