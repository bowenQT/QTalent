/* Niu-Talent 原型 · 版本 Y 演示数据。
   学员、导师、助教、评委都来自 XEngineer 第六期，人名和课题名为化名并标「演示」；观察、评审、去向保留原意。
   黑客松一期是少量演示数据。这里只放「原始种子」，象限参考位置、变化、档案版本都由 store.js 按规则算出。 */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});
  const X = NT.XE6;

  // ---------- 维度与规则（rubric-v1） ----------
  const DIMS = [
    { id: 'prof', name: '专业度', axis: 'prof', core: true },
    { id: 'mot', name: '内生动力', axis: 'pot', core: true },
    { id: 'wis', name: '智慧力', axis: 'pot', core: true },
    { id: 'grit', name: '坚毅力', axis: 'pot', core: true },
    { id: 'lead', name: '领导力', axis: 'pot', core: false },
    { id: 'open', name: '开放性', axis: 'pot', core: false },
  ];
  const ANCHORS = {
    pot: ['本次出现与该维度相反的明确行为', '相关行为偶发，需要他人推动才发生', '常规情境下稳定表现出该维度的行为', '有难度或模糊的情境下主动表现，并有可见结果', '高难情境下表现突出，并带动他人或形成可复用的方法'],
    prof: ['明显低于本届学员预期', '部分达到本届学员预期', '达到本届学员预期', '超出本届学员预期', '可以承担正式岗位的职责'],
  };
  const THEMES = { wis: '判断力', mot: '推动力', lead: '推动力' };

  // ---------- 组织：XEngineer 第六期按课题组分组 ----------
  const ORGS = [
    ['camp', '人才项目', null, true], ['xe6', 'XEngineer 第六期', 'camp'],
    ...X.teams.map((t) => [t.id, t.name, 'xe6']),
    ['tdc', '导师与助教', 'camp'],
    ['fn', '职能', null, true], ['hr', '人力资源部', 'fn'], ['strategy', '战略管理中心', 'fn'], ['it', '信息技术部', 'fn'],
  ].map(([id, name, parent, group]) => ({ id, name, parent, group: !!group }));
  const TEAM = Object.fromEntries(X.teams.map((t) => [t.id, t]));

  // ---------- 人员 ----------
  const P = (id, name, org, title, level, joined, hue, extra) => ({ id, name, org, title, level, joined, hue, photo: null, ...(extra || {}) });
  const PEOPLE = [
    P('p-cheng', '程远', 'strategy', '管理者', 'M', '2011-08-01', 212, { role: 'ceo', noReview: true }),
    P('p-suwan', '苏晚', 'hr', 'HR · 人才项目', 'N6', '2019-03-11', 340, { role: 'hrbp', noReview: true }),
    P('p-xuheng', '许衡', 'it', '系统管理员', 'N5', '2018-05-14', 28, { role: 'admin', noReview: true }),
  ];
  const KIND = { mentor: '导师', ta: '助教', judge: '评委' };
  X.staff.forEach((s) => PEOPLE.push(P(s.id, s.name, 'tdc', `${KIND[s.kind]} · XEngineer 第六期`, 'N5', '2020-03-02', s.hue, { noReview: true, staff: s.kind, ...(s.id === 'p-yeqing' ? { role: 'mentor', title: '技术专家 · XEngineer 第六期导师', level: 'N6' } : {}) })));
  X.students.forEach((s) => PEOPLE.push(P(s.id, s.name, s.team, s.track, `${s.grad} 届`, '2026-07-06', s.hue, {
    landing: true, xe: s, manager: s.mentor, hrbp: 'p-suwan',
  })));
  // 演示头像：随机给到管理者工作台默认展示的几个人，其余用姓氏首字
  const PHOTOS = { 'p-x86': 'zhou-yu', 'p-x01': 'gu-nan', 'p-x63': 'lin-zhiyuan', 'p-x11': 'song-xiaoman', 'p-x06': 'he-yining' };
  PEOPLE.forEach((p) => {
    p.photo = PHOTOS[p.id] || null;
    p.hrbp = p.hrbp || null;
    p.manager = p.manager || null;
    p.orgHist = [[p.org, p.joined, null]];
  });

  // ---------- 演示视角：管理者、HR、导师，以及只管系统配置的系统管理员 ----------
  const ROLES = {
    ceo: { label: '管理者', person: 'p-cheng', scope: '公司层：看人、找人，确认规则与方案' },
    hrbp: { label: 'HR', person: 'p-suwan', scope: '人才项目：XEngineer、Landing、校招、黑客松' },
    mentor: { label: '导师', person: 'p-yeqing', scope: '分镜工厂 · 二组、口语搭子 · 一组的学员' },
    admin: { label: '系统管理员', person: 'p-xuheng', scope: '账号与权限、北森同步、集成与审计；看不到人才数据' },
  };

  // ---------- 项目：19 个课题、黑客松（演示）和两个用人项目 ----------
  const PROJECTS = [
    ...X.teams.map((t) => ({ id: t.id, name: t.name, type: 'XEngineer 课题', org: t.id, status: '已结束', from: '2026-07-06', to: '2026-08-31', owner: t.mentor, creator: 'p-suwan', batch: 'b-xe6',
      goal: `${t.domain}。终期为${t.live}，MS1–MS4 按小组评审。` })),
    { id: 'pr-hack', name: '夏季黑客松 · 语音助手赛道（演示）', type: '黑客松', org: 'xe6', status: '已结束', from: '2026-08-20', to: '2026-08-21', owner: 's-28', creator: 'p-suwan', goal: '48 小时做出一个能听懂方言的语音助手原型。' },
    { id: 'pr-ts', name: '业务成功部 TS 新人组', type: '用人项目', org: 'xe6', status: '进行中', from: '2026-09-01', to: '2026-12-31', owner: null, creator: 'p-suwan', goal: '第六期留用进业务成功部 TS 的同学组成新人组，跟一线客户问题，三个月后独立值班。' },
    { id: 'pr-agent', name: 'MaaS 智能体平台 · 应用后端', type: '用人项目', org: 'xe6', status: '筹备中', from: '2026-10-08', to: '2027-03-31', owner: null, creator: 'p-cheng', goal: '给 MaaS 智能体平台补一条应用后端：工具注册、会话持久化和多租户隔离，Q4 内部上线。' },
  ];
  const M = (project, person, role, mode, from, to, by) => ({ project, person, role, mode, from, to: to || null, by });
  const MEMBERS = [];
  X.teams.forEach((t) => {
    MEMBERS.push(M(t.id, t.mentor, '导师', '顾问', '2026-07-06', '2026-08-31', 'p-suwan'));
    t.tas.forEach((ta) => MEMBERS.push(M(t.id, ta, '助教', '顾问', '2026-07-06', '2026-08-31', 'p-suwan')));
    t.members.forEach((pid) => MEMBERS.push(M(t.id, pid, '学员', '全职', '2026-07-06', '2026-08-31', 'p-suwan')));
  });
  const HACK = ['p-x53', 'p-x07', 'p-x89', 'p-x16', 'p-x45', 'p-x70'];
  HACK.forEach((pid) => MEMBERS.push(M('pr-hack', pid, '参赛', '全职', '2026-08-20', '2026-08-21', 'p-suwan')));
  MEMBERS.push(M('pr-hack', 's-28', 'owner', '顾问', '2026-08-20', '2026-08-21', 'p-suwan'));
  const TS = X.students.filter((s) => s.dest === '业务成功部 · TS' && s.accept === '接受').map((s) => s.id);
  TS.forEach((pid) => MEMBERS.push(M('pr-ts', pid, '新人', '全职', '2026-09-01', null, 'p-suwan')));
  const MEMBER_LOG = [
    ['pr-ts', '2026-09-01', `${TS.length} 位留用同学加入：来自第六期结营评审`, 'p-suwan'],
    ['pr-hack', '2026-08-21', '黑客松结束，6 位第六期学员参赛', 'p-suwan'],
  ].map(([project, at, text, by]) => ({ project, at, text, by }));

  // ---------- 关键事件：第六期观察表、MS 评审、奖项答辩（生成数据）+ 黑客松（演示） ----------
  const s = (p, d, v, st, by, x) => ({ p, d, v, st: st || 'confirmed', by, ...(x || {}) });
  const EVENTS = NT.clone(X.events).map((e) => ({ srcs: [], tags: [], scores: [], people: [], ...e }));
  // 周评里的标题多是一句话的前半截，作为事件标题读不出做了什么；按原意改成能独立读懂的说法
  const TITLE_FIX = {
    'e-x07-2': '从零搭起服务端主流程 MVP，是核心框架的主要搭建者',
    'e-x62-3': '推进 Runner 控制面与 Checkpoint 持久化的开发联调',
    'e-x65-3': '实现回归测试框架和生产工作流装配',
    'e-x80-1': '梳理产品链路，用问卷和白板讨论定下功能优先级',
    'e-x80-3': '用 ASR + LLM + TTS 组合替代实时模型，降低成本',
    'e-x01-3': '把自动触达做到增量同步和断点续传',
    'e-x01-2': '当组长的同时，搭起线索到 CRM 准入的运营工作台',
    'e-x62-1': '带团队讨论，推动完成功能拆分和架构设计',
    'e-x65-2': '实现内部 Agent 工作流，接通文生图、图生 3D 和打印机',
    'e-x86-1': '提出接入 Blender 直接生成 3D 图形的方案',
    'e-x42-3': '钻研技术，对工程规范要求高',
    'e-x28-3': '交付节点上自我加压，向组内讲清技术选型',
  };
  EVENTS.forEach((e) => { if (TITLE_FIX[e.id]) e.title = TITLE_FIX[e.id]; });
  const HACK_EV = [
    ['p-x53', '48 小时内把方言识别接进语音助手原型', '赛前没有方言数据，第一晚自己录了两段样本做验证，第二天接进原型。', '演示时三种方言都能识别出指令。', [['prof', 4], ['grit', 4]]],
    ['p-x07', '负责语音唤醒与打断，现场演示一次跑通', '把唤醒词和打断做成两个独立开关，联调时先单测每个开关。', '现场演示没有重来。', [['prof', 4], ['mot', 4]]],
    ['p-x89', '提前一天搭好演示用的中转服务', '没人负责部署，主动认领，第一天晚上就把中转服务和回滚脚本都准备好。', '全组第二天只做功能，没有卡在环境上。', [['mot', 4], ['prof', 4]]],
    ['p-x16', '评委指出流程太长后，当场把演示改成三步', '听完中期点评，先列出评委提到的两个问题，再砍掉两个页面。', '终评时评委提到流程清楚了。', [['open', 4], ['wis', 3]]],
    ['p-x45', '负责对象存储接入和导出', '按分工完成上传与导出接口。', '按时交付，没有额外问题。', [['prof', 3]]],
    ['p-x70', '负责鉴权和部署，赛前补了回滚脚本', '鉴权按分工完成；部署前自己补了一份回滚脚本。', '演示环境出过一次问题，按脚本回滚。', [['prof', 3], ['grit', 3]]],
  ];
  HACK_EV.forEach(([pid, title, act, res, sc], i) => EVENTS.push({
    id: `e-hack-${i + 1}`, date: '2026-08-21', kind: 'obs', project: 'pr-hack', recorder: 's-28', people: [pid], title, bg: '夏季黑客松 · 语音助手赛道', act, res, gap: '', demo: true,
    srcs: [{ type: 'sheet', label: '夏季黑客松评审表（演示）', loc: `第 ${i + 3} 行`, quote: `${act}${res}` }], tags: [], scores: sc.map(([d, v]) => s(pid, d, v, 'confirmed', 's-28', { note: `引用「${act.split('，')[0]}」` })),
  }));
  const ev = (id) => EVENTS.find((e) => e.id === id);
  // 待校准：导师和助教对同一件事的领导力判断差 2 分
  {
    const e = ev('e-x11-3');
    e.scores = e.scores.filter((x) => x.d !== 'lead');
    e.scores.push(s('p-x11', 'lead', null, 'conflict', null, { ai: 3, raters: [
      { by: 'p-yeqing', v: 4, why: '整体流程按 TA 的方案推进，五个模块的链路是 TA 牵头整合的。' },
      { by: 's-09', v: 2, why: '任务集中在自己身上，分工时没有同步任务池，组员接不上。' }] }));
  }
  // 导师刚录完 W8 复盘：AI 建议分还没确认
  ev('e-x15-3').scores.forEach((x) => { x.ai = x.v; x.st = 'ai'; delete x.by; });
  ev('e-x15-3').scores.push(s('p-x15', 'mot', null, 'unknown', null, { note: '只写了攻克的难题，没写是主动认领还是被安排' }));
  // 确认分和 AI 建议差得多，又没写理由：进校准队列
  Object.assign(ev('e-x14-3').scores[0], { ai: 2, bigGap: true });

  // 关键事件的标签：按行为里的关键词归到标签库
  const TAG_RULES = [
    ['架构设计', /架构/], ['测试与 CI', /测试|CI|覆盖率|回归/], ['产品调研', /调研|竞品|用户故事/], ['路演表达', /路演|PPT|ppt|演示|汇报/],
    ['硬件联调', /硬件|固件|焊|打印|小车|舵机|电源/], ['团队推进', /组长|分工|统筹|牵头|组织会议/], ['语音与实时', /语音|TTS|ASR|webRTC|rtc|VAD|vad/],
    ['工程规范', /规范|PR|review|Review/], ['AI 协作', /依赖 ?AI|AI ?生成|ai写|AI 生成/],
  ];
  EVENTS.forEach((e) => {
    if (e.kind !== 'obs' || e.tags.length) return;
    const text = `${e.act || ''}；${e.res || ''}；${e.gap || ''}`;
    e.tags = TAG_RULES.filter(([, re]) => re.test(text)).map(([t]) => t).slice(0, 3);
  });

  // ---------- 盘点、训练营与人才项目 ----------
  const H1_OVERRIDE = {};
  const WEEKS = [['W1', '开营', '对事复盘', '2026-07-06', '2026-07-12'], ['W2', 'MS1', '对事复盘', '2026-07-13', '2026-07-19'], ['W3', '', '对人复盘', '2026-07-20', '2026-07-26'],
    ['W4', 'MS2', '对事复盘 + 周评', '2026-07-27', '2026-08-02'], ['W5', '中期', '对人复盘 + 中期盘点', '2026-08-03', '2026-08-09'], ['W6', 'MS3', '对事复盘', '2026-08-10', '2026-08-16'],
    ['W7', '', '对人复盘', '2026-08-17', '2026-08-23'], ['W8', '结营', '对人复盘 + 结营评审', '2026-08-24', '2026-08-31']];
  const BATCHES = [
    { id: 'b-xe6', kind: 'landing', name: 'XEngineer 第六期', org: 'xe6', status: 'done', starter: 'p-suwan', from: '2026-07-06', to: '2026-08-31',
      topics: X.teams.map((t) => t.id), newcomers: X.students.map((st) => [st.id, st.team, [st.mentor, ...st.tas]]), weeks: WEEKS,
      milestones: [['2026-07-17', 'MS1 产品 Proposal 路演'], ['2026-07-31', 'MS2 架构设计路演'], ['2026-08-14', 'MS3 MVP 演示'], ['2026-08-29', 'MS4 终期路演与奖项答辩'], ['2026-08-31', '结营评审']] },
    { id: 'b-xe6-mid', kind: 'inventory', name: 'XEngineer 第六期 · 中期盘点', org: 'xe6', status: 'confirmed', starter: 'p-suwan', cutoff: '2026-08-07', confirmedAt: '2026-08-10', confirmedBy: 'p-suwan', rubric: 'rubric-v1' },
    { id: 'b-xe6-end', kind: 'inventory', name: 'XEngineer 第六期 · 结营盘点', org: 'xe6', status: 'draft', starter: 'p-suwan', startedAt: '2026-09-01', cutoff: '2026-09-05', compareTo: 'b-xe6-mid', rubric: 'rubric-v1',
      log: [['2026-09-02', 'p-suwan', '导入结营评审：93 人的能力等级、导师留用建议和结营结论'], ['2026-09-01', 'p-suwan', '发起结营盘点，证据截至 09-05']] },
  ];
  const CONCLUSIONS = {
    'p-x62': { text: '组织拆分和攻坚都有可见结果，方向偏大模型应用，可以直接进业务项目承担模块。', by: 'p-suwan', at: '2026-09-03' },
    'p-x08': { text: 'W4 周评需关注，之后测试与 CI 的工作有起色；留用后继续实习观察，看能否独立推进一块工作。', by: 'p-suwan', at: '2026-09-03' },
    'p-x11': { text: '技术主力，推进时偏急；领导力两位评分人判断不一致，校准后再定。', by: 'p-suwan', at: '2026-09-03' },
  };

  // 人才项目的期次：值得关注的项目按「刚过关键节点、有人新进入值得关注、还有留用或落位没定」入选
  const OFFER = X.students.filter((st) => st.final && st.final.includes('正式 offer'));
  const LAND4 = X.students.filter((st) => st.accept === '接受' && st.dest && st.dest !== '待定部门');
  const PROGRAMS = [
    { id: 'pg-xe6', kind: 'XEngineer', name: 'XEngineer 第六期', from: '2026-07-06', to: '2026-08-31', batch: 'b-xe6', href: 'landing.html',
      people: X.students.map((st) => st.id), nodes: [['2026-08-29', 'MS4 终期路演'], ['2026-08-31', '结营评审']], pending: 'plan' },
    { id: 'pg-land4', kind: 'Landing', name: 'Landing 第四期', from: '2026-09-14', to: '2026-10-09', href: 'plan.html?id=b-xe6-end',
      people: LAND4.map((st) => st.id), nodes: [['2026-09-03', `入营名单确定 · ${LAND4.length} 人`]], todo: `${X.students.filter((st) => st.dest === '待定部门').length} 人部门待定` },
    { id: 'pg-campus27', kind: '校招', name: '2027 届校招 · 提前批', from: '2026-08-24', to: '2026-09-30', href: 'plan.html?id=b-xe6-end',
      people: OFFER.filter((st) => st.grad === '2027').map((st) => st.id), nodes: [['2026-09-02', `提前批 offer 锁定 · ${OFFER.filter((st) => st.grad === '2027').length} 人`]] },
    { id: 'pg-hack', kind: '黑客松', name: '夏季黑客松（演示）', from: '2026-08-20', to: '2026-08-21', href: 'project.html?id=pr-hack', people: HACK, nodes: [['2026-08-25', '评审结束']] },
    { id: 'pg-land3', kind: 'Landing', name: 'Landing 第三期', from: '2026-06-08', to: '2026-07-03', people: [], nodes: [['2026-07-03', '结营']] },
    { id: 'pg-xe5', kind: 'XEngineer', name: 'XEngineer 第五期', from: '2026-04-06', to: '2026-05-29', people: [], nodes: [['2026-05-29', '结营评审']] },
  ];

  // 项目复盘：每期人才项目的关键节点。from 是这个节点产生的盘点、判断对照或方案，由它们生成的行动挂到这个节点下
  const RETRO_NODES = {
    'pg-xe6': [
      { id: 'w4', at: '2026-08-02', name: 'W4 周评', from: ['jr-xe6'] },
      { id: 'mid', at: '2026-08-10', name: '中期盘点', from: ['b-xe6-mid'] },
      { id: 'ms', at: '2026-08-29', name: '里程碑路演', sub: 'MS1–MS4' },
      { id: 'end', at: '2026-08-31', name: '结营评审' },
      { id: 'place', at: null, name: '留用与落位', from: ['b-xe6-end'] },
    ],
  };
  // 节点复盘：做得好 / 要改进，HR 署名；最新一条在前，旧的保留
  const NODE_RETROS = {
    'pg-xe6:w4': [{ good: ['交了周评的同学都有导师评语，三档用法一致'], improve: ['「正常发挥」一档缺行为要求，一半以上的同学落在这一档，结营时分成两头', '13 人缺 W4 周评记录，中期盘点只能标资料不足'], by: 'p-suwan', at: '2026-09-03', from: 'edit' }],
    'pg-xe6:mid': [{ good: ['周评需关注的同学都约了导师一对一，两项在营调整按时落实'], improve: ['盘点时大多数人资料不足，下一期中期前先补齐周评和路演记录'], by: 'p-suwan', at: '2026-08-12', from: 'new' }],
    'pg-land3:n0': [{ good: ['结营前完成了全部去向沟通'], improve: ['部门接收确认偏晚，下一期结营前两周发需求'], by: 'p-suwan', at: '2026-07-08', from: 'new' }],
    'pg-xe5:n0': [{ good: ['结营评审和导师留用建议在同一张表里，对得上'], improve: ['周评只有三档，区分不开，下一期补写法要求'], by: 'p-suwan', at: '2026-06-03', from: 'new' }],
  };

  // ---------- 用人需求与方案 ----------
  const NEEDS = [
    { id: 'n-ts', project: 'pr-ts', version: 1, by: 'p-suwan', at: '2026-09-01', text: 'TS 新人组要一个能带大家对齐节奏的牵头人',
      roles: [{ id: 'owner', name: '新人组牵头人' }],
      reqs: [{ id: 'r1', text: '在训练营里担任过组长或牵头过分工', must: true }, { id: 'r2', text: '做过测试、部署或排障相关的工作', must: true }, { id: 'r3', text: '已接受留用', must: true }] },
  ];
  const outcome = (st) => (st.accept === '接受' ? '已沟通 · 接受' : st.accept === '拒绝' ? '已沟通 · 未接受' : '待沟通');
  const moves = X.students.filter((st) => st.final && st.final !== '不建议 offer').map((st) => {
    const t = TEAM[st.team];
    if (st.accept === '拒绝') return { type: '未接受', person: st.id, from: t.name, to: '去向待沟通', basis: `${st.final}；导师结营建议：${st.adv8 || '—'}`, gap: '本人未接受 offer', will: outcome(st), release: '训练营已结束', impact: '不涉及' };
    if (st.final === '应届 · 继续实习观察') return { type: '继续观察', person: st.id, from: t.name, to: st.dest && st.dest !== '待定部门' ? `${st.dest} · 继续实习观察` : '继续实习观察', basis: `导师结营建议：${st.adv8 || '—'}`, next: '实习满 8 周后再评一次', owner: 'p-suwan', due: '2026-11-15', will: outcome(st) };
    return { type: st.dest && st.dest !== '待定部门' ? '落位' : '留用', person: st.id, from: t.name, to: st.dest && st.dest !== '待定部门' ? st.dest : '部门待定',
      basis: `${st.final}；导师结营建议：${st.adv8 || '—'}${st.posFinal || st.posMentor ? `；岗位建议：${st.posFinal || st.posMentor}` : ''}`,
      gap: '', will: outcome(st), release: '训练营已结束', impact: st.dest && st.dest !== '待定部门' ? `${st.dest} 增加 1 名${st.track.replace('方向', '')}` : '待和用人部门确认' };
  });
  const PLANS = [
    { id: 'sp-ts-1', kind: 'staffing', project: 'pr-ts', need: 'n-ts', version: 1, status: 'confirmed', by: 'p-suwan', at: '2026-09-02', confirmedBy: 'p-cheng', confirmedAt: '2026-09-02', slots: { owner: 'p-x47' }, note: '任子衿在训练营担任组长并负责合并全组代码' },
    { id: 'op-xe6-1', kind: 'org', batch: 'b-xe6-end', version: 1, status: 'draft', by: 'p-suwan', at: '2026-09-03', title: '留用与落位方案', moves },
  ];

  // ---------- 行动 ----------
  const ACTIONS = [
    { id: 'a-x08', title: '谷嘉树：导师每周一对一，W6 起负责全组的测试与 CI', from: 'b-xe6-mid', person: 'p-x08', owner: 'p-yeqing', due: '2026-08-14', did: '2026-08-12', state: 'done', observe: '2026-09-15' },
    { id: 'a-x15', title: '周初晴：W6 起和后端一起对齐接口', from: 'b-xe6-mid', person: 'p-x15', owner: 'p-yeqing', due: '2026-08-12', did: '2026-08-11', state: 'done', observe: '2026-09-30' },
    { id: 'a-weekly', title: '修订周评标准：每一档都写明行为证据（xe-weekly-v2）', kind: '修订评价标准', from: 'jr-xe6', owner: 'p-suwan', due: '2026-09-15', state: 'todo', observe: '2026-11-30' },
  ];

  // ---------- 重点跟踪 ----------
  const TRACKS = [
    { id: 't-x08', person: 'p-x08', why: 'W4 周评需关注，之后承担数据库表结构设计，并提升 CI 整体覆盖率', q: '到 TS 后能不能独立把一块测试或排障推到上线？', owner: 'p-yeqing', helper: 'p-suwan', next: '2026-09-02', since: '2026-08-29', state: 'on' },
    { id: 't-x15', person: 'p-x15', why: 'W4 周评表现突出，08-07 独立完成全部前端页面的设计开发落地', q: '前端之外，能不能把服务端那一侧的方案讲清楚？', owner: 'p-suwan', helper: 'p-yeqing', next: '2026-09-18', since: '2026-09-01', state: 'on' },
  ];

  // ---------- 值得聊一聊 ----------
  const SIGNALS = [
    { person: 'p-x06', state: 'open', since: '2026-08-20', items: [
      { src: 'fact', text: '获优秀学员提名', from: '结营评审', detail: 'XEngineer 第六期 · 结营评审 · 优秀学员提名，导师建议留用' },
      { src: 'fact', text: '没有接受正式 offer', from: '录用记录', detail: '结营结论：应届 · 正式 offer 提前锁定；录用记录：未接受（08-20）' },
    ] },
    { person: 'p-x75', state: 'open', since: '2026-08-28', items: [
      { src: 'fact', text: '未接受实习 offer', from: '录用记录', detail: '结营结论：非应届 · 实习 offer；录用记录：未接受（08-28）' },
      { src: 'fact', text: 'W4 周评表现突出', from: '观察表', detail: 'XEngineer 第六期观察表 · W4 周评' },
    ] },
  ];

  // ---------- 值得关注：提名与 AI 线索（N1、T1、I1、I2、I3 由规则实时算出） ----------
  const WATCH_CLUES = [
    { id: 'wc-x42', person: 'p-x42', rule: 'T2', by: 's-04', at: '2026-08-31', state: 'verified', verifiedBy: 'p-suwan', verifiedAt: '2026-09-01', why: '进入最佳架构设计、最佳工程习惯两项答辩；牵头前端整体架构和核心数据模型，日常带组内前端协同', evs: ['e-x42-2', 'e-x42-1'] },
    { id: 'wc-x28', person: 'p-x28', rule: 'T2', by: 's-22', at: '2026-08-31', state: 'verified', verifiedBy: 'p-suwan', verifiedAt: '2026-09-01', why: '进入最佳架构设计答辩；早期主动认领 Agent 编排方向，交付节点上能自我加压，也能向组内讲清选型依据', evs: ['e-x28-3', 'e-x28-2'] },
    { id: 'wc-x63', person: 'p-x63', rule: 'T2', by: 's-15', at: '2026-08-31', state: 'verified', verifiedBy: 'p-suwan', verifiedAt: '2026-09-02', why: '进入最佳 AI 探索实践答辩；从组装、走线到无线控制把硬件方案跑通，已能用手机 App 和语音控制小车', evs: ['e-x63-2', 'e-x63-3'] },
    { id: 'wc-x86', person: 'p-x86', rule: 'T2', by: 's-19', at: '2026-08-31', state: 'verified', verifiedBy: 'p-suwan', verifiedAt: '2026-09-02', why: '进入最佳 AI 探索实践答辩；产品方向由其提出，中期起担任组长，把分散的挖孔路线收成一条主链', evs: ['e-x86-1', 'e-x86-3'] },
    { id: 'wc-x53', person: 'p-x53', rule: 'N2', by: 'ai', at: '2026-09-01', state: 'verified', verifiedBy: 'p-suwan', verifiedAt: '2026-09-02',
      why: 'W7、W8 两周观察都写到语音核心模块由许承宇完成；黑客松赛前没有方言数据，自录样本当晚接通了方言识别',
      srcs: [{ type: 'sheet', label: 'XEngineer 第六期观察表', loc: 'W7–W8 · 突出表现', quote: '语音的核心模块均由TA完成，多模型接口复杂设计是亮点' }, { type: 'sheet', label: '夏季黑客松评审表（演示）', loc: '第 3 行', quote: '赛前没有方言数据，第一晚自己录了两段样本做验证' }], evs: ['e-x53-3', 'e-hack-1'] },
    { id: 'wc-x68', person: 'p-x68', rule: 'T2', by: 's-17', at: '2026-09-02', state: 'pending', why: '深耕 MySQL 交付，从参数配置到生命周期管理连续三周有可见产出', evs: ['e-x68-2', 'e-x68-3'] },
    { id: 'wc-x89', person: 'p-x89', rule: 'N2', by: 'ai', at: '2026-09-03', state: 'pending', why: '观察表和黑客松评审都提到：第一周最早跑通整条链路，没人负责部署时主动认领',
      srcs: [{ type: 'sheet', label: 'XEngineer 第六期观察表', loc: 'W1–W3 · 重点贡献', quote: 'W1最早手动跑通整套流程' }, { type: 'sheet', label: '夏季黑客松评审表（演示）', loc: '第 5 行', quote: '没人负责部署，主动认领' }], evs: ['e-x89-1', 'e-hack-3'] },
    { id: 'wc-reco-x11', person: 'p-x11', rule: 'T2', by: 'p-yeqing', dir: 'tpl-be', at: '2026-09-01', state: 'verified', verifiedBy: 'p-suwan', verifiedAt: '2026-09-02', why: '独立完成 Java 主功能 MVP，承接组里大部分核心开发', evs: ['e-x11-2', 'e-x11-3'] },
    { id: 'wc-reco-x14', person: 'p-x14', rule: 'T2', by: 'p-yeqing', dir: 'tpl-fde', at: '2026-09-03', state: 'pending', why: '会主动找导师交流，路演材料和客户场景都愿意投入', evs: ['e-x14-1', 'e-x14-3'] },
  ];

  // ---------- 我的关注：个人观察名单 ----------
  const FOLLOWS = [
    { by: 'p-cheng', person: 'p-x11', at: '2026-09-01' },
    { by: 'p-cheng', person: 'p-x62', at: '2026-08-30' },
    { by: 'p-cheng', person: 'p-x06', at: '2026-08-22' },
  ];

  // ---------- 标签 ----------
  const TAGLIB = [
    { group: '做事方式', tags: [['架构设计', 1], ['团队推进', 1], ['工程规范', 1], ['产品调研', 0]] },
    { group: '场景', tags: [['路演表达', 0], ['硬件联调', 1], ['测试与 CI', 1]] },
    { group: '技术方向', tags: [['语音与实时', 1]] },
    { group: '工作方式', tags: [['AI 协作', 1]] },
  ];
  const TAG_CANDIDATES = [
    { name: 'AI 产出核对', def: '用 AI 生成文档或代码后，自己核对并能讲清每项决策的理由。', events: ['e-x46-2', 'e-x78-2'], people: 9, count: 12, similar: 'AI 协作',
      why: '「AI 协作」只说用了 AI；这些评语都在讲是否核对过 AI 的产出，导师在意的是这一点，建议单独收录。', at: '2026-09-02' },
    { name: '日报', def: '', events: [], people: 6, count: 7, similar: '工程规范', why: '日报是否按时属于流程规范，建议并入「工程规范」。', at: '2026-09-01' },
  ];

  // ---------- 待核对（AI 拿不准的地方） ----------
  const INBOX = [
    { id: 'i-meng', kind: 'person', src: 'W8 导师团复盘', at: '06:15', by: 'p-yeqing', q: '录音里的「小孟」指的是谁？', quote: '小孟那边服务端的主架构是 TA 搭的，其他人在 TA 的基础上加功能。',
      options: [['p-x07', '口语搭子 · 一组 · 可能性高'], ['p-x11', '分镜工厂 · 二组']],
      draft: { title: '服务端主架构由 TA 搭好，组员在其上加功能', project: 't-talk-a', recorder: 'p-yeqing', date: '2026-08-28', scores: [['prof', 4, '锚点 4 · 引用「服务端的主架构是 TA 搭的」'], ['lead', 3, '锚点 3 · 其他人在 TA 的基础上加功能']] } },
    { id: 'i-team', kind: 'project', src: 'W8 导师团复盘', at: '17:40', by: 'p-yeqing', q: '「分镜那个组」指的是哪个课题？', quote: '分镜那个组最后的打磨还是不错的，难度确实大。',
      options: [['t-scene-b', '叶青带的组 · 可能性高'], ['t-scene-a', '分镜工厂 · 一组']], draft: null },
  ];

  // ---------- 进行中的任务 ----------
  const TASKS = [
    { id: 'tk-w8', name: 'W8 导师团复盘.m4a', state: 'partial', preset: true, minutes: 'w8', by: 'p-yeqing', note: '4 条事件已整理，2 处待核对', link: 'record.html?m=w8' },
    { id: 'tk-end', name: '结营评审表.xlsx', state: 'done', note: '新增 93 条结营评审，涉及 93 人' },
    { id: 'tk-ms4', name: 'MS4 评委意见.xlsx', state: 'done', note: '19 个小组的评审意见已挂到课题' },
    { id: 'tk-hack', name: '夏季黑客松评审表.xlsx', state: 'shaping', note: '转写已完成，正在提取人员和事件' },
    { id: 'tk-1on1', name: '导师一对一 · 谷嘉树.m4a', state: 'failed', note: '转写已保留，人员和事件提取没有完成' },
  ];

  // ---------- 录音纪要（W8 导师团复盘，预先处理的演示任务） ----------
  const MINUTES = {
    w8: { id: 'w8', title: 'W8 导师团复盘', batch: 'b-xe6', at: '2026-08-28', dur: '38:20', by: 'p-yeqing', mode: '多人会议',
      summary: 'W8 导师团复盘，38 分钟。逐组过了口语搭子 · 一组和分镜工厂 · 二组的结营情况；一处人名、一处课题需要确认。',
      people: [['p-x07', 2], ['p-x11', 3], ['p-x06', 1], ['p-x15', 1]],
      events: ['e-x07-3', 'e-x11-3', 'e-x06-3', 'e-x15-3'],
      marks: [375, 1060, 1515],
      lines: [
        ['00:30', 'p-yeqing', '先过口语搭子一组，再过分镜二组。'],
        ['02:10', 'p-yeqing', '季思齐主要负责产品和 UI，组里只有 TA 一个前端，最开始只会 C++，靠 AI coding 做得还不错。', 'flag'],
        ['06:15', 's-09', '小孟那边服务端的主架构是 TA 搭的，其他人在 TA 的基础上加功能。', 'verify'],
        ['11:40', 'p-yeqing', '孟逸尘技术水平还不错，接触面多，悟性高、韧性强。'],
        ['17:40', 'p-yeqing', '分镜那个组最后的打磨还是不错的，难度确实大。', 'verify'],
        ['25:15', 's-09', '孟逸尘分工的时候没同步任务池，组员接不上，活都压在 TA 身上。', 'flag'],
        ['33:05', 'p-yeqing', '周初晴较早做出了 DOM 树展示，九宫格和光影一致性那块是 TA 攻下来的。'],
      ],
      asks: ['谁在这次会议里展现了推动力？', '有要跟进的事吗？', '周初晴的内生动力有证据吗？'],
      answers: {
        '谁在这次会议里展现了推动力？': '孟逸尘：整体流程按 TA 的方案推进，五个模块的链路由 TA 牵头整合（11:40）。推动力是观察主题，挂在「内生动力」维度下。',
        '有要跟进的事吗？': '三件：确认「小孟」指谁（06:15）、确认「分镜那个组」是哪个课题（17:40）；叶青和助教对孟逸尘领导力的判断差 2 分，已经转给 HR 复核。',
        '周初晴的内生动力有证据吗？': '资料不足。这次提到 TA 攻下了光影一致性难题，但没说是主动认领还是被安排的。下次一对一可以问一句。',
      } },
  };

  // ---------- 发展方向：本人意愿取自入营登记，管理判断取自结营的岗位建议 ----------
  const CHANNELS = [{ id: 'be', name: '后端研发' }, { id: 'pa', name: '产品架构师' }, { id: 'pm', name: '产品经理' }, { id: 'fe', name: '前端研发' }, { id: 'fde', name: 'FDE（业务导向技术人才）' }, { id: 'ts', name: '技术支持（TS）' }];
  const chOf = (t) => (/产品架构|架构师/.test(t) ? 'pa' : /FDE/i.test(t) ? 'fde' : /技术支持|TS/.test(t) ? 'ts' : /产品/.test(t) ? 'pm' : /前端/.test(t) ? 'fe' : /后端|服务端|研发|开发|全栈|SRE|运维/.test(t) ? 'be' : null);
  const DIRECTIONS = [];
  X.students.forEach((st) => {
    const first = (st.intent || '').split(/[、,，]/).map((x) => x.trim()).find((x) => x && !/暂未确定/.test(x));
    if (first && chOf(first)) DIRECTIONS.push({ person: st.id, kind: 'self', ch: chOf(first), text: `意向岗位：${st.intent.replace(/\s*,\s*/g, '、')}`, at: '2026-07-06', src: '入营登记 · 意向岗位' });
    const pos = st.posFinal || st.posMentor;
    if (pos && chOf(pos)) DIRECTIONS.push({ person: st.id, kind: 'mgmt', ch: chOf(pos), by: 'p-suwan', at: '2026-08-31', basis: `结营岗位建议：${pos}${st.posMentor && st.posFinal && st.posMentor !== st.posFinal ? `（导师建议：${st.posMentor}）` : ''}`, ev: `e-${st.id.slice(2)}-end` });
  });

  // ---------- 目标角色模板 ----------
  const TEMPLATES = [
    { id: 'tpl-be', name: '后端研发', ch: 'be', duties: '负责一个服务或模块的方案、实现和上线，保证质量和可维护。', dims: ['prof', 'grit'],
      versions: [{ v: 1, by: 'p-suwan', at: '2026-08-20', reqs: [{ id: 'r1', text: '独立负责过一个服务端模块', must: true, alt: '参与过服务端核心模块开发' }, { id: 'r4', text: '写过测试并让 CI 稳定通过', must: false }, { id: 'r5', text: '做过线上部署或排障', must: false }] }] },
    { id: 'tpl-pa', name: '产品架构师', ch: 'pa', duties: '对一个产品方向的方案与取舍负责，从需求到上线。', dims: ['prof', 'wis'],
      versions: [{ v: 1, by: 'p-suwan', at: '2026-08-20', reqs: [{ id: 'a1', text: '主导过一个产品方案从需求到上线', must: true }, { id: 'a2', text: '能在约束下比较并取舍方案', must: true }, { id: 'a3', text: '有用户场景的一手调研', must: false }] }] },
    { id: 'tpl-fde', name: 'FDE', ch: 'fde', duties: '贴近客户交付技术方案，把客户问题带回产品。', dims: ['prof', 'mot'],
      versions: [{ v: 1, by: 'p-suwan', at: '2026-08-20', reqs: [{ id: 'f1', text: '把一个方案交付到真实用户手里', must: true }, { id: 'f2', text: '能把用户问题翻译成产品需求', must: true }, { id: 'f3', text: '做过硬件或现场联调', must: false }] }] },
    { id: 'tpl-ts', name: '技术支持（TS）', ch: 'ts', duties: '跟进一线客户的技术问题，定位、复现并推动解决。', dims: ['prof', 'grit'],
      versions: [{ v: 1, by: 'p-suwan', at: '2026-08-28', reqs: [{ id: 't1', text: '做过测试、部署或排障相关的工作', must: true }, { id: 't2', text: '能把问题复现步骤写清楚', must: true }, { id: 't3', text: '沟通顺畅，愿意面对客户', must: false }] }] },
  ];

  // ---------- 判断对照：W4 周评（助教）× 结营评审（导师） ----------
  // 观察表里每人一行，各页签行号相同；从这个人的观察记录来源里取，不按筛选后的顺序推算
  const SHEET_ROW = {};
  X.events.forEach((e) => e.srcs?.forEach((s) => { const m = /第 (\d+) 行/.exec(s.loc || ''); if (m) (e.people || []).forEach((p) => { SHEET_ROW[p] ??= +m[1]; }); }));
  const ROWS = X.judge.map((r) => [...r, X.students.find((st) => st.id === r[0]).mentor]);
  const GR = ['需关注', '正常发挥', '表现突出'], BG = ['不建议', '继续观察', '建议留用'];
  const stateOf = (r) => { const a = GR.indexOf(r[2].overall), b = BG.indexOf(r[4].overall); return a === b ? 'same' : a > b ? 'high' : 'low'; };
  const caseId = (r) => `jr-xe6:${r[0]}:overall`;
  const normal = ROWS.filter((r) => r[2].overall === '正常发挥');
  const nUp = normal.filter((r) => r[4].overall === '建议留用'), nDown = normal.filter((r) => r[4].overall === '不建议');
  // 评价人方向一致：可对照案例达到门槛、偏高占多数的那位助教
  const byTa = {};
  ROWS.forEach((r) => { (byTa[r[1]] = byTa[r[1]] || []).push(r); });
  const [taId, taRows] = Object.entries(byTa).filter(([, l]) => l.length >= 5).sort((a, b) => b[1].filter((r) => stateOf(r) === 'high').length / b[1].length - a[1].filter((r) => stateOf(r) === 'high').length / a[1].length)[0];
  const taHigh = taRows.filter((r) => stateOf(r) === 'high');
  const edge = ROWS.filter((r) => X.students.find((st) => st.id === r[0]).team === 't-edge');
  const JUDGE = {
    chains: [{ id: 'xe', name: 'XEngineer', front: 'W4 周评', back: '结营评审', scale: 'grade', grades: GR, backGrades: BG, dims: [{ id: 'overall', name: '综合判断' }] }],
    maps: [{ id: 'map-xe-v1', chain: 'xe', by: 'p-suwan', at: '2026-07-01', rows: [['overall', '综合判断', '需关注 ↔ 不建议；正常发挥 ↔ 继续观察；表现突出 ↔ 建议留用']] }],
    stds: [{ id: 'xe-weekly-v1', chain: 'xe', at: '2026-07-01', note: '周评三档：表现突出 / 正常发挥 / 需关注，评语不限' }],
    batches: [{ id: 'jr-xe6', chain: 'xe', name: 'XEngineer 第六期判断对照', std: 'xe-weekly-v1', map: 'map-xe-v1', status: 'open', at: '2026-09-02', by: 'p-suwan', range: 'W4 周评 08-02 · 结营评审 08-31' }],
    xe: { 'jr-xe6': { back: null, src: { front: ['XEngineer 第六期观察表.xlsx', 'W4 周评', '08-02'], back: ['XEngineer 第六期观察表.xlsx', '结营评审', '08-31'], cols: { overall: 'Q', note: 'R' } }, rows: ROWS, sheetRow: SHEET_ROW } },
    hire: {},
    hyps: {
      'jr-xe6': [
        { id: 'h-xe6-1', basis: [{ batch: 'jr-xe6', dim: 'overall' }], cats: ['method'], std: 'xe-weekly-v1',
          text: `W4 周评「正常发挥」的 ${normal.length} 人里，结营时 ${nUp.length} 人建议留用、${nDown.length} 人不建议，两头都多。周评只有三档、评语不限，「正常发挥」一档没有写行为的要求，区分不开。`,
          cases: [...nUp.slice(0, 3), ...nDown.slice(0, 3)].map(caseId) },
        { id: 'h-xe6-2', basis: [{ batch: 'jr-xe6', rater: taId }], cats: ['rater'], rater: taId,
          text: `${PEOPLE.find((p) => p.id === taId).name}周评的 ${taRows.length} 个可对照案例里，${taHigh.length} 个前段偏高，方向一致；评语多写分工和态度，较少写具体产出。样本达到 5 个案例的门槛。`,
          cases: taHigh.slice(0, 5).map(caseId) },
        { id: 'h-xe6-3', cats: ['env'], text: '云边硬件组 MS2 5.0 分、MS4 9.4 分。W4 时方向还在调整，周评时能看到的产出很少，前后两段看的是不同阶段的工作。', cases: edge.map(caseId) },
      ],
    },
    attribs: {
      'jr-xe6:h-xe6-1': { hyp: 'h-xe6-1', batch: 'jr-xe6', cats: ['std'], reason: '周评只有三档、评语不限，正常发挥一档没有写行为的要求；先在标准里补上写法要求，下一期按新标准对照。', by: 'p-suwan', at: '2026-09-03', actions: ['a-weekly'] },
      'jr-xe6:h-xe6-3': { hyp: 'h-xe6-3', cats: ['env'], reason: 'W4 前后课题方向调整是事实，周评标准保持原样，记录情境。', by: 'p-suwan', at: '2026-09-03', actions: [] },
    },
  };

  // ---------- 人才评价规则：六类规则各自的版本 ----------
  const FAMILIES = [['biz', '商业'], ['design', '设计'], ['eng', '工程']];
  PEOPLE.forEach((p) => { p.family = /产品/.test(p.title) ? 'design' : p.xe ? 'eng' : 'biz'; });
  const ENG_ANCHORS = ['拆解和方案常需要他人重做，代码返工多', '能完成拆好的任务，方案和质量要他人把关', '独立完成一个模块的方案、实现和测试', '主导跨模块的技术方案，主动补上工程规范和质量保障', '能为团队定技术方向和规范，带着他人交付'];
  const ENG_THEMES = ['问题拆解', '技术方案', '代码实现', '工程规范', '质量保障', '协作交付'];
  const WATCH_PARAMS = { n1Days: 90, n1Count: 3, n1Min: 4, i2Days: 14 };
  const RULES = {
    rubric: [
      { v: 'rubric-v1', state: 'live', by: 'p-suwan', confirmedBy: 'p-cheng', at: '2026-06-20', effect: 'now', effAt: '2026-06-20', demo: true,
        why: '第一版：心性维度一套锚点，专业度按本届学员预期一套锚点', content: { pot: ANCHORS.pot, prof: { all: ANCHORS.prof } } },
      { v: 'rubric-v2', state: 'draft', base: 'rubric-v1', by: 'p-suwan', at: '2026-09-03', effect: 'next', compat: 'break', demoEng: true,
        why: '专业度按岗位族分锚点，工程族先启用；工程族下设六个观察主题，用于整理和找人',
        basis: [{ type: 'note', text: '人才发展大图把专业能力分成商业、设计、工程三类' }],
        content: { pot: ANCHORS.pot, prof: { all: ANCHORS.prof, eng: ENG_ANCHORS }, themes: { eng: ENG_THEMES } } },
    ],
    place: [
      { v: 'place-v1', state: 'live', by: 'p-suwan', confirmedBy: 'p-cheng', at: '2026-06-20', effect: 'now', effAt: '2026-06-20', from: 'rubric-v1', demo: true,
        why: '由 rubric-v1 拆出，内容保持原样', content: { window: 365, cut: 3.5, profMin: 2, potMin: 2, coreMin: 2, bonus: 4 } },
    ],
    watch: [
      { v: 'watch-v1', state: 'live', by: 'p-suwan', confirmedBy: 'p-cheng', at: '2026-07-01', effect: 'now', effAt: '2026-07-01', demo: true,
        why: '第一版：七条入选规则，提名来自导师、助教和 HR', params: WATCH_PARAMS, t2: '导师、助教或 HR 的提名与推荐，经 HR 核实' },
    ],
    front: [
      { v: 'xe-weekly-v1', line: 'xe-weekly', state: 'live', by: 'p-suwan', confirmedBy: 'p-cheng', at: '2026-07-01', effect: 'now', effAt: '2026-07-01', why: '第一版：周评按三档评综合表现', note: '周评三档：表现突出 / 正常发挥 / 需关注，评语不限' },
      { v: 'xe-weekly-v2', line: 'xe-weekly', state: 'pending', base: 'xe-weekly-v1', by: 'p-suwan', at: '2026-09-03', submittedAt: '2026-09-03', effect: 'next', compat: 'ok',
        why: `第六期判断对照：周评正常发挥的 ${normal.length} 人，结营结论分成两头`, basis: [{ type: 'judge', batch: 'jr-xe6', hyp: 'h-xe6-1', dim: '综合判断', n: `周评正常发挥的 ${normal.length} 人中 ${nUp.length + nDown.length} 人与结营结论不一致`, cat: '评价标准' }],
        note: '周评三档：表现突出 / 正常发挥 / 需关注；每一档都写出本周一个具体行为及结果，正常发挥一档写清是哪件事', preview: { kind: 'map', cells: normal.length } },
      { v: 'map-xe-v1', line: 'map-xe', state: 'live', by: 'p-suwan', confirmedBy: 'p-cheng', at: '2026-07-01', effect: 'now', effAt: '2026-07-01', why: '周评三档与结营结论三档对应', note: '需关注 ↔ 不建议；正常发挥 ↔ 继续观察；表现突出 ↔ 建议留用' },
    ],
  };
  const RULE_SUGS = [
    { id: 'rs-yq-grit', rule: 'rubric', dim: 'grit', level: 3, ver: 'rubric-v1', by: 'p-yeqing', at: '2026-08-30', state: 'open', ev: 'e-x15-3',
      text: '锚点 3「常规情境下稳定表现」太宽：按期交付和攻下一个难题后坚持到有结果，都能落到 3 分，建议写清楚' },
  ];

  NT.SEED = {
    version: 'y8', DIMS, ANCHORS, THEMES, ORGS, PEOPLE, ROLES, PROJECTS, MEMBERS, MEMBER_LOG, EVENTS, H1_OVERRIDE, BATCHES, CONCLUSIONS, PROGRAMS,
    NEEDS, PLANS, ACTIONS, TRACKS, SIGNALS, TAGLIB, TAG_CANDIDATES, INBOX, TASKS, MINUTES, CHANNELS, DIRECTIONS, TEMPLATES, JUDGE, WATCH_CLUES, PUSHES: [], FOLLOWS,
    FAMILIES, ENG_THEMES, RULES, RULE_SUGS, RETRO_NODES, NODE_RETROS,
  };
})();
