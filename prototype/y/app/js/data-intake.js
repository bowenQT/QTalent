/* Niu-Talent 原型 · 版本 Y 演示数据：采集与评价节点（决赛增补）。
   统一投递的材料批次与回执、北森面评导入、待核对的新类型（说话人、未知人员、图片范围、未知面试官）、
   评价关系与到期后的重新分派、答辩节点结论、节点覆盖提醒。人名为化名并标「演示」。
   在 data.js 之后、store.js 之前加载：往种子里补人员、事件和待核对，其余状态由 intake.js 管。 */
(function () {
  'use strict';
  const NT = window.NT;
  const SEED = NT.SEED;
  // 种子有变化时旧的本地演示数据按新版本重来（store.js 会先备份旧数据）
  SEED.version = `${SEED.version}.i2`;

  // ---------- 试用期转正答辩的两位演示员工（业务成功部） ----------
  SEED.ORGS.push({ id: 'biz', name: '业务成功部', parent: 'fn', group: false });
  [['p-fzx', '方知夏', 150], ['p-glc', '顾临川', 205]].forEach(([id, name, hue]) => SEED.PEOPLE.push({
    id, name, org: 'biz', title: 'TS 工程师', level: 'N3', joined: '2026-03-02', hue, photo: null,
    hrbp: 'p-suwan', manager: null, family: 'eng', orgHist: [['biz', '2026-03-02', null]],
  }));

  // ---------- 评价关系：评价人、被评价人、所在节点、叫法、有效期 ----------
  // 评价人只看本节点；关系到期后没做完的事交 HR 重新分派
  const XE = NT.XE6;
  const team = (id) => XE.teams.find((t) => t.id === id).members;
  const RELATIONS = [
    { id: 'rel-yq', rater: 'p-yeqing', label: '导师', node: 'pg-xe6', people: [...team('t-talk-a'), ...team('t-scene-b')], from: '2026-07-06', to: '2026-09-30' },
    { id: 'rel-gmy', rater: 's-12', label: '导师', node: 'pg-xe6', people: team('t-plan-a'), from: '2026-07-06', to: '2026-08-31', ended: '08-31 起离开导师团' },
    { id: 'rel-xzy', rater: 's-28', label: '答辩评委', node: 'pg-def', people: ['p-fzx', 'p-glc'], from: '2026-09-02', to: '2026-09-09' },
    { id: 'rel-hys', rater: 's-17', label: '答辩评委', node: 'pg-def', people: ['p-fzx', 'p-glc'], from: '2026-09-02', to: '2026-09-09' },
  ];

  // ---------- 答辩节点：试用期转正答辩（演示），节点结论由 HR 确认，评委只确认本人评分 ----------
  SEED.PROGRAMS.push({ id: 'pg-def', kind: '答辩', name: '试用期转正答辩 · 9 月（演示）', from: '2026-09-02', to: '2026-09-02', href: 'actions.html?node=pg-def:n0',
    people: ['p-fzx', 'p-glc'], nodes: [['2026-09-02', '转正答辩 · 2 人']] });
  const TRANSCRIPT = '转正答辩会议转录（演示）';
  const DEF = [
    // [事件 id, 被评价人, 评委, 已确认, 标题, 原话位置, 原话, 分数]
    ['e-def-1', 'p-fzx', 's-28', true, '讲清楚一次线上排障：先复现、再缩小范围，最后补了监控', '06:10–08:40', '我先在测试环境把客户的报错复现出来，再按时间线排除了网关和缓存，最后定位到重试配置', [['prof', 4, '锚点 4 · 引用「先复现、再按时间线排除」'], ['wis', 4, '锚点 4 · 主动补了监控']]],
    ['e-def-2', 'p-fzx', 's-17', true, '试用期独立值班两周，组里沿用了交接文档', '14:20–15:30', '值班那两周我把常见问题整理成交接文档，现在组里新人都按这份来', [['prof', 4, '锚点 4 · 值班两周独立处理'], ['mot', 4, '锚点 4 · 主动整理交接文档']]],
    ['e-def-3', 'p-glc', 's-28', true, '答辩时说明客户工单的分级办法，举了两个例子', '22:05–23:50', '我把工单按影响面分了三级，第一级半小时内回，举两个上个月的例子', [['prof', 3, '锚点 3 · 按分工完成工单分级'], ['wis', 3, '锚点 3 · 有例子']]],
    ['e-def-4', 'p-glc', 's-17', false, '复盘一次延误交付，讲了自己补救的做法', '27:40–29:15', '那次是我低估了联调时间，后来每天和客户对一次进度，最后晚了两天交付', [['grit', 3, '锚点 3 · 每天对一次进度'], ['open', 4, '锚点 4 · 主动说出自己的判断失误']]],
  ];
  DEF.forEach(([id, p, by, done, title, loc, quote, sc]) => SEED.EVENTS.push({
    id, kind: 'obs', date: '2026-09-02', project: null, recorder: by, people: [p], title, bg: '试用期转正答辩', act: quote, res: '', node: 'pg-def:n0',
    srcs: [{ type: 'audio', label: TRANSCRIPT, loc, by, quote }], tags: [],
    scores: sc.map(([d, v, note]) => (done ? { p, d, v, st: 'confirmed', by, ai: v, note } : { p, d, v, st: 'ai', ai: v, note })),
  }));
  const CONCLUSION_TYPES = ['建议转正', '延长试用期', '不建议转正'];
  const CONCLUSIONS = [
    { id: 'nc-fzx', node: 'pg-def:n0', person: 'p-fzx', evs: ['e-def-1', 'e-def-2'], srcs: [{ type: 'audio', label: TRANSCRIPT, loc: '06:10–15:30' }, { type: 'slide', label: '方知夏转正答辩.pptx（演示）', loc: '第 3–6 页' }],
      ai: { type: '建议转正', why: '两位评委都已确认本人评分；排障和值班两件事都有可见结果，组里沿用了交接文档。' }, versions: [] },
    { id: 'nc-glc', node: 'pg-def:n0', person: 'p-glc', evs: ['e-def-3', 'e-def-4'], srcs: [{ type: 'audio', label: TRANSCRIPT, loc: '22:05–29:15' }],
      ai: null, versions: [] },
  ];

  // ---------- 材料批次与回执：不管从哪个入口进来，都走同一条流程，回执给提交人 ----------
  // entry：web 统一投递 / wecom 企业微信单聊 / mcp Claude Code 或 Codex / mobile 手机网页
  // 文件状态：uploading 上传中 · queued 排队中 · parsing 解析中 · transcribing 转写中 · done 已解析 · failed 失败
  const MS = '分镜工厂 · 二组 结营路演';
  const DROPS = [
    { id: 'd-ms2', title: MS, by: 'p-yeqing', entry: 'wecom', at: '2026-09-03 21:10', node: 'pg-xe6', project: 't-scene-b',
      files: [
        { name: '结营路演录像.mp4', kind: 'video', state: 'done', meta: '38:12 · 区分出 4 位说话人' },
        { name: '结营路演.pptx', kind: 'slide', state: 'done', meta: '24 页' },
        { name: '结营评审表.xlsx', kind: 'sheet', state: 'done', meta: '1 张表 · 16 行' },
      ],
      mentions: ['p-x11', 'p-x12', 'p-x13', 'p-x14', 'p-x15'], evs: ['e-d1', 'e-d2', 'e-d3'], held: ['e-d4', 'e-d5'], verify: ['i-spk', 'i-xz'] },
    { id: 'd-pr', title: 'PR 评审时记的一件事', by: 'p-yeqing', entry: 'mcp', tool: 'record_moment', at: '2026-09-03 16:20', node: 'pg-xe6', project: 't-talk-a',
      files: [{ name: 'PR #482 · payment/retry.ts（演示）', kind: 'code', state: 'done', meta: '第 40–118 行' }],
      mentions: ['p-x08'], evs: ['e-d6'], held: [], verify: [] },
    { id: 'd-hr', title: '结营评审补充材料', by: 'p-suwan', entry: 'web', at: '2026-09-04 10:05', node: 'pg-xe6',
      files: [
        { name: '结营评审意见表.docx', kind: 'doc', state: 'done', meta: '9 段 · 定位到段落' },
        { name: '评审群截图.png', kind: 'image', state: 'done', meta: '1 张图 · 定位到区域' },
        { name: '现场照片.heic', kind: 'image', state: 'failed', meta: '.heic 格式待转换：转成 JPG 或 PNG 再传' },
        { name: '评审讨论录音.m4a', kind: 'audio', state: 'transcribing', meta: '42:08 · 转写中' },
      ],
      mentions: ['p-x62', 'p-x65'], evs: ['e-d7', 'e-d8'], held: [], verify: ['i-aze', 'i-region'] },
    { id: 'd-iv', title: '北森面评导入', by: 'p-suwan', entry: 'web', at: '2026-09-04 09:30', kind: 'interview', import: 'imp-1',
      files: [{ name: '北森面评导出 · 2026-07.pdf（演示）', kind: 'pdf', state: 'done', meta: '9 页 · 6 位候选人 · 按版式读分' }],
      mentions: [], evs: [], held: [], verify: ['i-int'] },
  ];
  const ev = (id, p, recorder, date, project, title, act, srcs, sc, extra) => ({
    id, kind: 'obs', date, project, recorder, people: p ? [p] : [], title, bg: '', act, res: '', srcs, tags: [],
    scores: sc.map(([d, v, note]) => ({ p, d, v, st: 'ai', ai: v, note })), ...(extra || {}),
  });
  const VID = '结营路演录像.mp4', PPT = '结营路演.pptx', XLS = '结营评审表.xlsx';
  // 已认出人的事件直接进入事件列表（AI 建议分待评价人确认）；还在待核对的两件事先挂在批次里，核对后才归到人
  const DROP_EVENTS = [
    ev('e-d1', 'p-x12', 'p-yeqing', '2026-08-31', 't-scene-b', '路演讲清分镜生成的三级缓存方案，并给出压测数据', '对比了三种缓存方案后选了分层缓存，现场给出压测前后的耗时对比',
      [{ type: 'video', label: VID, loc: '12:40–13:55', quote: '我们试了三种方案，最后选了分层缓存，压测下来生成耗时从 9 秒降到 3 秒' }, { type: 'slide', label: PPT, loc: '第 7 页', quote: '三级缓存：内存 → 本地盘 → 对象存储，命中率 82%' }],
      [['prof', 4, '锚点 4 · 引用「压测下来生成耗时从 9 秒降到 3 秒」'], ['wis', 3, '锚点 3 · 比较了三种方案']], { drop: 'd-ms2' }),
    ev('e-d2', 'p-x14', 'p-yeqing', '2026-08-31', 't-scene-b', '评委追问排期延误时，当场说明原因并给出补救计划', '承认低估了渲染联调的时间，给出两周内补齐的计划',
      [{ type: 'video', label: VID, loc: '21:05–22:10', quote: '这块是我排期的时候低估了联调，后面两周我每天先把渲染的回归跑一遍' }, { type: 'sheet', label: XLS, loc: '第 9 行', quote: '能正视延误，补救计划具体' }],
      [['grit', 3, '锚点 3 · 给出补救计划'], ['open', 4, '锚点 4 · 主动说出自己的判断失误']], { drop: 'd-ms2' }),
    ev('e-d3', 'p-x11', 'p-yeqing', '2026-08-31', 't-scene-b', '演示时推流卡顿，现场排查三分钟恢复', '先切到备用流，再查出是转码队列堆积，清队列后恢复',
      [{ type: 'video', label: VID, loc: '30:20–31:40', quote: '先切备用流，我看一下转码队列……队列堆了，清掉就好' }],
      [['prof', 4, '锚点 4 · 现场定位到转码队列'], ['grit', 4, '锚点 4 · 有难度的情境下主动处理']], { drop: 'd-ms2' }),
    ev('e-d6', 'p-x08', 'p-yeqing', '2026-09-03', 't-talk-a', '把支付重试改成幂等状态机，评审一次通过', '重试逻辑改成状态机，每一步可重入，补了对应的单测',
      [{ type: 'code', label: 'PR #482 · payment/retry.ts（演示）', loc: '第 40–118 行', quote: '这个 PR 里谷嘉树把支付重试改成了幂等状态机，评审一次就过了' }],
      [['prof', 4, '锚点 4 · 引用「改成了幂等状态机」']], { drop: 'd-pr' }),
    ev('e-d7', 'p-x62', 'p-suwan', '2026-08-31', 't-maker-a', '结营评审会上讲清组内拆分方式，评委认可可复用', '把组内拆分和接口约定整理成一页，评委建议下一期沿用',
      [{ type: 'doc', label: '结营评审意见表.docx', loc: '第 3 段', quote: '拆分和接口约定写成了一页纸，下一期可以直接用' }],
      [['lead', 4, '锚点 4 · 形成可复用的方法']], { drop: 'd-hr' }),
    ev('e-d8', 'p-x65', 'p-suwan', '2026-08-31', 't-maker-a', '回归测试框架接进生产工作流，评审时演示了一次回滚', '在评审现场演示回归失败后自动回滚',
      [{ type: 'doc', label: '结营评审意见表.docx', loc: '第 6 段', quote: '现场演示了回归失败自动回滚，工程习惯好' }],
      [['prof', 4, '锚点 4 · 现场演示']], { drop: 'd-hr' }),
  ];
  SEED.EVENTS.push(...DROP_EVENTS);
  const HELD = {
    'e-d4': ev('e-d4', null, 'p-yeqing', '2026-08-31', 't-scene-b', '讲清时间轴组件的拖拽对齐方案', '说明了时间轴拖拽时按帧吸附的做法',
      [{ type: 'video', label: VID, loc: '16:30–17:45', quote: '时间轴拖的时候按帧吸附，前后各留两帧的容差' }], [['prof', 3, '锚点 3 · 按分工完成']], { drop: 'd-ms2' }),
    'e-d5': ev('e-d5', null, 'p-yeqing', '2026-08-31', 't-scene-b', '光影一致性方案获评委肯定', '评审表写明光影一致性是全组最难的一块，由「小周」攻下',
      [{ type: 'sheet', label: XLS, loc: '第 14 行', quote: '光影一致性这块是小周攻下来的，难度大' }], [['prof', 4, '锚点 4 · 攻下全组最难的一块']], { drop: 'd-ms2' }),
  };

  // ---------- 待核对的新类型 ----------
  SEED.INBOX.push(
    { id: 'i-spk', kind: 'speaker', drop: 'd-ms2', ev: 'e-d4', src: VID, at: '16:30', by: 'p-yeqing', q: '录像里的「说话人 2」是谁？', quote: '时间轴拖的时候按帧吸附，前后各留两帧的容差。', lines: 14,
      options: [['p-x13', '分镜工厂 · 二组 · 前端方向 · 可能性高'], ['p-x15', '分镜工厂 · 二组 · 前端方向']] },
    { id: 'i-xz', kind: 'unknown', drop: 'd-ms2', ev: 'e-d5', src: XLS, at: '第 14 行', by: 'p-yeqing', q: '评审表第 14 行的「小周」指谁？', quote: '光影一致性这块是小周攻下来的，难度大。', name: '小周',
      options: [['p-x15', '分镜工厂 · 二组 · 可能性高']] },
    { id: 'i-aze', kind: 'unknown', drop: 'd-hr', src: '结营评审意见表.docx', at: '第 8 段', by: 'p-suwan', q: '意见表第 8 段的「阿泽」指谁？', quote: '阿泽那组的部署脚本可以给别的组参考。', name: '阿泽',
      options: [] },
    { id: 'i-region', kind: 'region', drop: 'd-hr', src: '评审群截图.png', at: '第 1 张图', by: 'p-suwan', q: '评审群截图里要整理哪几行？',
      rows: [['p-x62', '拆分方案我整理成一页了，下一期能直接用'], [null, ''], ['p-x65', '回滚演示的录屏我晚点发群里'], [null, ''], ['p-x63', '小车的无线控制今天跑通了']],
      options: [] },
    { id: 'i-int', kind: 'interviewer', drop: 'd-iv', src: '北森面评导出 · 2026-07.pdf', at: '第 3 页', by: 'p-suwan', q: '面评第 3 页的面试官「Kevin」是谁？', quote: '面试官：Kevin（专业面试官） · 面试日期 2026-05-14', name: 'Kevin',
      options: [] },
  );

  // ---------- 北森面评导入：一份 PDF 一次导入，HR 在预览里逐行确认「这是谁」 ----------
  // 原量表原样保存，不换算成维度分；只导入已入职的人，淘汰和未入职的候选人跳过
  const TEMPLATES = {
    campus: { name: '校招专业面试通用评价表', scale: '1–5 分', items: ['专业基础', '项目经历', '学习能力', '沟通表达', '管理能力'] },
    expert: { name: '七牛面试评价表 · 专业面试官', scale: 'A–D', items: ['技术深度', '系统设计', '问题解决', '协作沟通', '管理能力'] },
    hr: { name: '七牛面试评价表 · HR', scale: '优 / 良 / 中 / 差', items: ['求职动机', '沟通表达', '团队协作', '价值观契合', '管理能力'] },
  };
  const IMPORTS = [{
    id: 'imp-1', drop: 'd-iv', file: '北森面评导出 · 2026-07.pdf（演示）', pages: 9, by: 'p-suwan', at: '2026-09-04 09:30',
    prior: { at: '2026-08-20', file: '北森面评导出 · 2026-07.pdf（演示）', rows: ['r6'] },
    rows: [
      { id: 'r1', pages: '第 1–2 页', name: '孟逸尘', hr: '已录用', match: 'p-x11', joined: '2026-07-06', tpl: 'campus', at: '2026-05-08', interviewer: 'p-yeqing',
        scores: [['专业基础', '4'], ['项目经历', '4'], ['学习能力', '5'], ['沟通表达', '3'], ['管理能力', null]], verdict: '通过', note: '项目经历讲得具体，能说清自己负责的部分' },
      { id: 'r2', pages: '第 3 页', name: '周初晴', hr: '已录用', match: 'p-x15', joined: '2026-07-06', tpl: 'expert', at: '2026-05-14', interviewer: null, interviewerName: 'Kevin', verify: 'i-int',
        scores: [['技术深度', 'B'], ['系统设计', '?'], ['问题解决', 'A'], ['协作沟通', 'B'], ['管理能力', null]], unread: { item: '系统设计', why: '勾了两个选项', crop: 'p3' }, verdict: '通过', note: '前端基础扎实，做过完整的组件库' },
      { id: 'r3', pages: '第 4–5 页', name: '唐语桐', hr: '淘汰', match: null, tpl: 'campus', at: '2026-05-10' },
      { id: 'r4', pages: '第 6 页', name: '宋知意', hr: '已发 offer · 未入职', match: null, tpl: 'expert', at: '2026-05-16' },
      { id: 'r5', pages: '第 7 页', name: '云致远', hr: '已录用', match: 'p-x10', joined: '2026-07-06', tpl: 'hr', at: '2026-05-20', interviewer: 'p-suwan',
        scores: [['求职动机', '良'], ['沟通表达', '优'], ['团队协作', '良'], ['价值观契合', '良'], ['管理能力', null]], verdict: '通过', note: '想做后端，问到技术选型时能说出取舍', redacted: 1 },
      { id: 'r6', pages: '第 8 页', name: '谷嘉树', hr: '已录用', match: 'p-x08', joined: '2026-07-06', tpl: 'campus', at: '2026-05-09', interviewer: 'p-yeqing', dup: true,
        scores: [['专业基础', '3'], ['项目经历', '3'], ['学习能力', '4'], ['沟通表达', '3'], ['管理能力', null]], verdict: '通过' },
      { id: 'r7', pages: '第 9 页', name: '林嘉禾', hr: '已录用', match: null, tpl: 'campus', at: '2026-05-22', interviewer: 'p-yeqing', unknown: true,
        scores: [['专业基础', '4'], ['项目经历', '3'], ['学习能力', '4'], ['沟通表达', '4'], ['管理能力', null]], verdict: '通过' },
    ],
  }];

  // ---------- 重新分派：关系到期后没做完的事 ----------
  // 每条指向它要办的那件事：review 是这个人这一周的对人复盘，score 是一件事的 AI 建议分；办没办完按那件事的实际状态算
  const REASSIGN = [
    { id: 'ra-1', rel: 'rel-gmy', kind: 'review', person: 'p-x83', week: 'W8', due: '2026-09-04' },
    { id: 'ra-2', rel: 'rel-gmy', kind: 'review', person: 'p-x82', week: 'W8', due: '2026-09-04' },
    { id: 'ra-3', rel: 'rel-gmy', kind: 'score', person: 'p-x85', ev: 'e-ra3', due: '2026-09-06' },
    // 打开列表之后，原评价人到期前的离线修改同步进来：这件已经完成，提交时提示冲突
    { id: 'ra-4', rel: 'rel-gmy', kind: 'review', person: 'p-x84', week: 'W8', due: '2026-09-04', race: '谷牧野 08-31 23:40 的修改刚同步进来，这件已经完成' },
  ];
  // ra-3 指向的那件事：原评价人记下、建议分还没确认就到期了
  SEED.EVENTS.push(ev('e-ra3', 'p-x85', 's-12', '2026-08-28', 't-plan-a', '日程冲突检测的规则设计', '把日程冲突的判断拆成硬冲突和软冲突两类，写成规则表给后端',
    [{ type: 'doc', label: 'W8 对人复盘纪要.docx（演示）', loc: '第 6 段', quote: '冲突检测她拆成了硬冲突和软冲突两类，规则表直接给了后端' }], [['prof', 3, '锚点 3 · 按分工完成']]));

  // ---------- 节点覆盖提醒：节点到了还没有记录的人，进对应评价人的待办 ----------
  const COVERAGE = [
    { id: 'cv-ms4-yq', rater: 'p-yeqing', node: '结营路演', due: '2026-08-29', people: team('t-talk-a') },
  ];

  SEED.INTAKE = { RELATIONS, CONCLUSION_TYPES, CONCLUSIONS, DROPS, HELD, TEMPLATES, IMPORTS, REASSIGN, COVERAGE };
})();
