/* Niu-Talent 原型演示数据。
   人员一律化名并标「演示」；组织名称取自公司组织表（可公开使用）；事件、评价、项目与议题均为虚构。
   这里只放「原始种子」。象限参考位置、变化、档案版本等都由 store.js 按规则从种子算出，不在这里手写结论。 */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});

  // ---------- 维度与规则（rubric-v1，需求 3.7.2） ----------
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
    prof: ['明显低于当前职级预期', '部分达到当前职级预期', '达到当前职级预期', '超出当前职级预期', '可以承担更高一级职责'],
  };
  const THEMES = { wis: '判断力', mot: '推动力', lead: '推动力' }; // CEO 关注的观察主题，挂在维度下，不改维度名

  // ---------- 组织（取自组织表：一级 24 个；增长产品部下 6 个二级） ----------
  const ORGS = [
    ['rd', '产品研发部', null, true], ['rd-l', 'L事业部', 'rd'], ['miku-obj', 'Miku对象', 'rd'], ['miku-media', 'Miku流媒体', 'rd'], ['ai-infra', 'AI infra（暂定）', 'rd'],
    ['innov', '创新业务部', 'rd'], ['infra', '技术保障部', 'rd'], ['ux', '用户体验技术部', 'rd'], ['supply', '供应链生态合作部', 'rd'],
    ['fn', '职能', null, true], ['fin', '财务部', 'fn'], ['legal', '法务部', 'fn'], ['pa', '公共事务部', 'fn'], ['admin', '综合管理部', 'fn'], ['hr', '人力资源部', 'fn'], ['ir', '投资者关系管理部', 'fn'], ['strategy', '战略管理中心', 'fn'],
    ['growth', '增长', null, true], ['dev', '开发者生态', 'growth'], ['pmm', '产品市场部', 'growth'], ['gp', '增长产品部', 'growth'],
    ['gp-ai', 'AI 效能部', 'gp'], ['gp-acq', '增长获客部', 'gp'], ['gp-conv', '客户转化部', 'gp'], ['gp-ret', '存量经营部', 'gp'], ['gp-cs', '业务成功部', 'gp'], ['gp-ops', '运营平台部', 'gp'],
    ['sales', '销售', null, true], ['ka', '大客户销售部', 'sales'], ['industry', '行业拓展部', 'sales'], ['sea', '东南亚业务部', 'sales'], ['pioneer', '先锋拓展部', 'sales'], ['mid', '中坚开拓部', 'sales'], ['salesops', '销售运营部', 'sales'],
  ].map(([id, name, parent, group]) => ({ id, name, parent, group: !!group }));

  // ---------- 人员 ----------
  // [id, 化名, 二级组织, 职位, 职级, 加入日期, 色相, 照片, 其他]
  const P = (id, name, org, title, level, joined, hue, photo, extra) => ({ id, name, org, title, level, joined, hue, photo: photo || null, ...(extra || {}) });
  const PEOPLE = [
    // 演示账号背后的人
    P('p-cheng', '程远', 'strategy', 'CEO', 'M', '2011-08-01', 212, null, { role: 'ceo', noReview: true }),
    P('p-suwan', '苏晚', 'hr', 'HRBP（增长产品部、产品市场部）', 'N6', '2019-03-11', 340, null, { role: 'hrbp', noReview: true }),
    P('p-jianghe', '江禾', 'hr', 'HRBP（全公司演示账号）', 'N6', '2018-05-02', 20, null, { noReview: true }),
    P('p-qinshu', '秦舒', 'gp', '增长产品部负责人', 'N8', '2016-04-18', 230, null, { isLead: true, leads: 'gp' }),
    P('p-hance', '韩策', 'gp-cs', '业务成功部负责人', 'N7', '2017-09-04', 320, null, { isLead: true, leads: 'gp-cs', role: 'lead' }),
    P('p-yeqing', '叶青', 'gp-ai', '高级产品经理 · Landing 导师', 'N6', '2018-07-16', 170, null, { role: 'mentor' }),
    P('p-mengxia', '孟夏', 'gp-ops', '技术专家 · Landing 导师', 'N6', '2017-11-20', 15, null),
    P('p-jiangyb', '江屿白', 'gp-acq', '增长负责人 · Landing 导师', 'N6', '2019-02-25', 262, null),
    P('p-songchuan', '宋川', 'gp-cs', '解决方案工程师 · Landing 助教', 'N5', '2021-06-07', 45, null),

    // Landing 第三期新人
    P('p-lin', '林知远', 'gp-cs', '初级产品架构师', 'N3', '2026-07-20', 200, 'lin-zhiyuan', { role: 'self', landing: true, hire: 'social' }),
    P('p-wangyz', '王一舟', 'gp-conv', '客户成功专员', 'N2', '2026-08-03', 100, null, { landing: true, hire: 'campus' }),
    P('p-tangguo', '唐果', 'gp-ai', '产品经理', 'N2', '2026-08-24', 292, null, { landing: true, hire: 'campus' }),
    P('p-songxm', '宋小满', 'gp-ret', '运营专员', 'N2', '2026-09-28', 60, 'song-xiaoman', { landing: true, hire: 'campus' }),
    P('p-xuqh', '许清和', 'gp-acq', '增长分析师', 'N3', '2026-08-17', 132, null, { landing: true, hire: 'social' }),
    P('p-xiayao', '夏遥', 'gp-ops', '后端工程师', 'N2', '2026-08-24', 188, null, { landing: true, hire: 'campus' }),

    // 有故事的老员工
    P('p-heyn', '何以宁', 'gp-conv', '客户转化经理', 'N4', '2023-04-10', 250, 'he-yining'),
    P('p-zhouyu', '周屿', 'gp-ops', '高级后端工程师', 'N5', '2021-03-15', 30, 'zhou-yu'),
    P('p-shenyan', '沈砚', 'gp-ops', '后端专家', 'N5', '2020-06-08', 75, null, { levelSince: '2023-08-01' }),
    P('p-chenyh', '陈一禾', 'gp-ops', '后端工程师', 'N4', '2024-07-08', 150, null, { orgHist: [['gp-cs', '2024-07-08', '2026-08-04'], ['gp-ops', '2026-08-04', null]] }),
    P('p-gunan', '顾南', 'gp-cs', '技术支持工程师', 'N3', '2024-11-04', 280, 'gu-nan'),
    P('p-luchuan', '陆川', 'gp-acq', '投放运营', 'N4', '2024-02-19', 225, null),
    P('p-luoyi', '罗伊', 'gp-ret', '存量运营经理', 'N4', '2022-01-10', 8, null, { levelSince: '2023-06-01' }),
    P('p-wangman', '王蔓', 'gp-cs', 'FED 工程师', 'N4', '2023-09-18', 330, null),
    P('p-xieling', '谢灵', 'gp-conv', '高级客户经理', 'N5', '2021-09-06', 350, null),

    // SDR 与 SMB 并入（组织调整已公开宣布，10-20 起归属增长产品部）
    ...[['p-shenxh', '沈星河', 'gp-conv', 'SDR', 'N3', 345], ['p-anran', '安然', 'gp-conv', 'SDR', 'N3', 160], ['p-duheng', '杜衡', 'gp-conv', 'SMB 销售', 'N4', 95],
      ['p-yiqing', '易晴', 'gp-conv', 'SMB 销售', 'N3', 300], ['p-pengpai', '彭湃', 'gp-acq', 'SDR', 'N3', 55], ['p-wenyan', '温言', 'gp-acq', 'SDR', 'N3', 205]]
      .map(([id, name, org, title, level, hue]) => P(id, name, org, title, level, '2025-03-03', hue, null, { merged: true, orgHist: [['salesops', '2025-03-03', '2026-10-20'], [org, '2026-10-20', null]] })),

    // 其他增长产品部同事
    P('p-fangyu', '方屿', 'gp-ai', '产品经理', 'N4', '2022-05-09', 140, null, { gen: 'lh' }),
    P('p-baizhi', '白芷', 'gp-ai', '交互设计师', 'N3', '2023-07-03', 300, null, { gen: 'hl' }),
    P('p-shaoming', '邵明', 'gp-ai', '算法工程师', 'N5', '2020-10-12', 180, null, { gen: 'hh' }),
    P('p-qinlang', '秦朗', 'gp-acq', '内容运营', 'N3', '2024-04-22', 40, null, { gen: 'll' }),
    P('p-kelan', '柯蓝', 'gp-acq', 'SEO 专员', 'N4', '2022-10-17', 196, null, { gen: 'lh' }),
    P('p-liangzhou', '梁舟', 'gp-conv', '客户经理', 'N4', '2022-03-14', 118, null, { gen: 'lh' }),
    P('p-mofan', '莫凡', 'gp-conv', '客户经理', 'N3', '2024-01-08', 268, null, { gen: 'll' }),
    P('p-jianning', '简宁', 'gp-ret', '存量运营负责人', 'N5', '2019-12-02', 24, null, { gen: 'hh', isLead: true, leads: 'gp-ret' }),
    P('p-miaomiao', '苗苗', 'gp-ret', '数据运营', 'N3', '2024-06-03', 312, null, { gen: 'hl' }),
    P('p-lixin', '黎昕', 'gp-cs', '技术支持工程师', 'N4', '2021-11-15', 68, null, { gen: 'lh' }),
    P('p-chengnuo', '程诺', 'gp-cs', 'FED 工程师', 'N3', '2024-03-04', 240, null, { gen: 'hl' }),
    P('p-gaoyuan', '高原', 'gp-ops', '后端工程师', 'N4', '2022-08-08', 110, null, { gen: 'lh' }),
    P('p-fuxiao', '付晓', 'gp-ops', '测试工程师', 'N3', '2025-02-17', 355, null, { gen: 'na' }),

    // 增长产品部以外（只有 CEO 和全公司 HRBP 看得到）
    P('p-shuran', '舒然', 'pmm', '市场经理', 'N4', '2022-11-07', 286, null, { gen: 'hl' }),
    P('p-zhaoym', '赵一鸣', 'miku-obj', '高级工程师', 'N5', '2019-05-20', 205, null, { gen: 'hh' }),
    P('p-jifeng', '季风', 'miku-obj', '工程师', 'N4', '2023-02-13', 170, null, { gen: 'lh' }),
    P('p-suncheng', '孙澄', 'miku-media', '音视频工程师', 'N5', '2020-09-01', 35, null, { gen: 'lh' }),
    P('p-wutong', '吴桐', 'infra', 'SRE', 'N4', '2023-05-15', 150, null, { gen: 'll' }),
    P('p-fanxi', '范西', 'ux', '前端工程师', 'N4', '2022-12-05', 322, null, { gen: 'hl' }),
    P('p-lian', '黎安', 'sea', '海外客户经理', 'N4', '2021-04-12', 12, null),
    P('p-peiyuan', '裴远', 'ka', 'KA 销售', 'N5', '2018-10-08', 260, null, { gen: 'lh' }),
  ];
  // 直线经理：二级负责人；没有二级负责人的归到增长产品部负责人
  const MANAGER = { 'gp-cs': 'p-hance', 'gp-ret': 'p-jianning', 'gp-ai': 'p-qinshu', 'gp-acq': 'p-qinshu', 'gp-conv': 'p-qinshu', 'gp-ops': 'p-qinshu' };
  PEOPLE.forEach((p) => {
    if (p.org.startsWith('gp') || p.org === 'pmm') p.hrbp = 'p-suwan'; else p.hrbp = 'p-jianghe';
    p.manager = p.id === MANAGER[p.org] ? 'p-qinshu' : MANAGER[p.org] || null;
    if (!p.orgHist) p.orgHist = [[p.org, p.joined, null]];
  });

  // ---------- 演示视角（需求 3.5：五类用户） ----------
  const ROLES = {
    ceo: { label: 'CEO', person: 'p-cheng', scope: '全公司' },
    hrbp: { label: 'HRBP', person: 'p-suwan', scope: '归属人员：增长产品部、产品市场部' },
    lead: { label: '部门负责人', person: 'p-hance', scope: '业务成功部，以及本人担任 owner 的项目成员' },
    mentor: { label: '导师', person: 'p-yeqing', scope: 'Landing 第三期所带学员' },
    self: { label: '员工', person: 'p-lin', scope: '本人' },
  };

  // ---------- 项目（需求 3.6：人与项目多对多） ----------
  const PROJECTS = [
    { id: 'pr-search', name: '海外加速搜索体验', type: '业务项目', org: 'gp-ai', status: '进行中', from: '2026-09-01', to: '2026-12-31', owner: 'p-zhouyu', creator: 'p-cheng', goal: '让海外客户在控制台里一次搜到加速相关的全部入口，Q4 上线。' },
    { id: 'pr-ticket', name: '工单检索', type: 'Landing 议题', org: 'gp-cs', status: '进行中', from: '2026-10-08', to: '2026-11-02', owner: 'p-yeqing', creator: 'p-yeqing', batch: 'b-land3', goal: '让技术支持在一个入口里检索历史工单和解决方案。' },
    { id: 'pr-kb', name: '客服知识库', type: 'Landing 议题', org: 'gp-ai', status: '进行中', from: '2026-10-08', to: '2026-11-02', owner: 'p-yeqing', creator: 'p-yeqing', batch: 'b-land3', goal: '把客服常见问答整理成可检索、可维护的知识库。' },
    { id: 'pr-recall', name: '存量客户召回', type: 'Landing 议题', org: 'gp-ret', status: '进行中', from: '2026-10-08', to: '2026-11-02', owner: 'p-mengxia', creator: 'p-mengxia', batch: 'b-land3', goal: '找出 90 天未活跃的存量客户，设计一轮召回并验证效果。' },
    { id: 'pr-attrib', name: '投放归因看板', type: 'Landing 议题', org: 'gp-acq', status: '进行中', from: '2026-10-08', to: '2026-11-02', owner: 'p-jiangyb', creator: 'p-jiangyb', batch: 'b-land3', goal: '统一各渠道的归因口径，给投放复盘一个可信的看板。' },
    { id: 'pr-migrate', name: '增长中台数据迁移', type: '业务项目', org: 'gp-ops', status: '进行中', from: '2026-04-10', to: '2026-12-15', owner: 'p-shenyan', creator: 'p-qinshu', goal: '把增长中台的冷数据迁到新存储，查询成本降一半。' },
    { id: 'pr-gray', name: '灰度发布平台', type: '业务项目', org: 'gp-ops', status: '筹备中', from: '2026-11-15', to: '2027-03-31', owner: null, creator: 'p-mengxia', goal: '给增长中台的发布加上按客户分批的灰度和一键回滚。' },
    { id: 'pr-tracking', name: '控制台埋点治理', type: '业务项目', org: 'gp-ai', status: '已结束', from: '2026-03-02', to: '2026-08-14', owner: 'p-fangyu', creator: 'p-qinshu', goal: '清理重复埋点，统一事件命名，给增长分析一份可信的数据。' },
    { id: 'pr-xe', name: 'XEngineer 训练营 · 存储课题', type: '训练营课题', org: 'gp-ops', status: '已结束', from: '2026-05-06', to: '2026-06-12', owner: 'p-mengxia', creator: 'p-mengxia', goal: '做一个冷热分层存储的可运行原型。' },
    { id: 'pr-hack', name: '秋季黑客松 · 智能客服', type: '黑客松', org: 'gp-ai', status: '已结束', from: '2026-09-12', to: '2026-09-14', owner: 'p-baizhi', creator: 'p-qinshu', goal: '48 小时做出一个能回答控制台常见问题的客服助手。' },
    { id: 'pr-manual', name: '客户成功手册', type: '专项', org: 'gp-cs', status: '已归档', from: '2025-06-02', to: '2025-12-19', owner: 'p-hance', creator: 'p-hance', goal: '把售后常见处理方式整理成手册。' },
    { id: 'pr-sea', name: '东南亚渠道拓展', type: '业务项目', org: 'sea', status: '进行中', from: '2026-07-01', to: '2026-12-31', owner: 'p-lian', creator: 'p-cheng', goal: '在两个东南亚市场建立渠道伙伴。' },
  ];
  // [项目, 人, 角色, 投入, 加入, 退出, 操作人]
  const M = (project, person, role, mode, from, to, by) => ({ project, person, role, mode, from, to: to || null, by });
  const MEMBERS = [
    M('pr-search', 'p-zhouyu', 'owner', '兼职', '2026-09-28', null, 'p-cheng'), M('pr-search', 'p-shaoming', '搜索算法', '全职', '2026-09-01', null, 'p-cheng'),
    M('pr-search', 'p-heyn', '海外客户顾问', '兼职', '2026-09-01', null, 'p-cheng'), M('pr-search', 'p-chenyh', '后端', '全职', '2026-09-01', '2026-10-20', 'p-zhouyu'),
    M('pr-search', 'p-lin', '前端', '兼职', '2026-10-15', null, 'p-zhouyu'),
    M('pr-ticket', 'p-lin', '议题成员', '全职', '2026-10-08', null, 'p-yeqing'), M('pr-ticket', 'p-wangyz', '议题成员', '全职', '2026-10-08', null, 'p-yeqing'),
    M('pr-ticket', 'p-yeqing', '导师', '顾问', '2026-10-08', null, 'p-suwan'), M('pr-ticket', 'p-songchuan', '助教', '顾问', '2026-10-08', null, 'p-suwan'),
    M('pr-kb', 'p-tangguo', '议题成员', '全职', '2026-10-08', null, 'p-yeqing'), M('pr-kb', 'p-yeqing', '导师', '顾问', '2026-10-08', null, 'p-suwan'),
    M('pr-recall', 'p-songxm', '议题成员', '全职', '2026-10-08', null, 'p-mengxia'), M('pr-recall', 'p-xiayao', '议题成员', '全职', '2026-10-08', null, 'p-mengxia'),
    M('pr-recall', 'p-mengxia', '导师', '顾问', '2026-10-08', null, 'p-suwan'),
    M('pr-attrib', 'p-xuqh', '议题成员', '全职', '2026-10-08', null, 'p-jiangyb'), M('pr-attrib', 'p-jiangyb', '导师', '顾问', '2026-10-08', null, 'p-suwan'),
    M('pr-migrate', 'p-shenyan', 'owner', '全职', '2026-04-10', null, 'p-qinshu'), M('pr-migrate', 'p-gaoyuan', '后端', '全职', '2026-04-10', null, 'p-shenyan'),
    M('pr-migrate', 'p-chenyh', '后端', '全职', '2026-10-20', null, 'p-shenyan'),
    M('pr-tracking', 'p-fangyu', 'owner', '全职', '2026-03-02', '2026-08-14', 'p-qinshu'), M('pr-tracking', 'p-heyn', '数据分析', '兼职', '2026-03-02', '2026-08-14', 'p-fangyu'),
    M('pr-tracking', 'p-baizhi', '交互', '兼职', '2026-03-02', '2026-08-14', 'p-fangyu'),
    M('pr-xe', 'p-chenyh', '学员', '全职', '2026-05-06', '2026-06-12', 'p-mengxia'), M('pr-xe', 'p-fuxiao', '学员', '全职', '2026-05-06', '2026-06-12', 'p-mengxia'),
    M('pr-hack', 'p-baizhi', 'owner', '全职', '2026-09-12', '2026-09-14', 'p-qinshu'), M('pr-hack', 'p-tangguo', '产品', '全职', '2026-09-12', '2026-09-14', 'p-baizhi'),
    M('pr-hack', 'p-wangyz', '数据', '全职', '2026-09-12', '2026-09-14', 'p-baizhi'), M('pr-hack', 'p-chengnuo', '前端', '全职', '2026-09-12', '2026-09-14', 'p-baizhi'),
    M('pr-manual', 'p-hance', 'owner', '兼职', '2025-06-02', '2025-12-19', 'p-hance'), M('pr-manual', 'p-lixin', '编写', '兼职', '2025-06-02', '2025-12-19', 'p-hance'),
    M('pr-manual', 'p-gunan', '编写', '兼职', '2025-09-01', '2025-12-19', 'p-hance'),
    M('pr-sea', 'p-lian', 'owner', '全职', '2026-07-01', null, 'p-cheng'),
  ];
  const MEMBER_LOG = [
    ['pr-search', '2026-10-20', '陈一禾退出：转去增长中台数据迁移', 'p-zhouyu'],
    ['pr-search', '2026-10-15', '林知远加入：前端 · 兼职', 'p-zhouyu'],
    ['pr-search', '2026-09-28', '周屿成为 owner：来自项目用人方案 v2', 'p-cheng'],
    ['pr-search', '2026-09-01', '项目创建，邵明、何以宁、陈一禾加入', 'p-cheng'],
    ['pr-migrate', '2026-10-20', '陈一禾加入：后端 · 全职', 'p-shenyan'],
  ].map(([project, at, text, by]) => ({ project, at, text, by }));

  // ---------- 关键事件 ----------
  // s(人, 维度, 分, 状态, 评分人, 额外)；状态：ai 建议未确认 / confirmed 已确认 / calibrated 已校准 / unknown 资料不足 / conflict 待校准
  const s = (p, d, v, st, by, x) => ({ p, d, v, st: st || 'confirmed', by, ...(x || {}) });
  const E = (o) => ({ kind: 'obs', srcs: [], tags: [], scores: [], people: [], ...o });
  const EVENTS = [
    // 林知远：Landing 第三期，W2 后还差一条专业度证据才满足落位门槛
    E({ id: 'e-lin-hire', date: '2026-07-14', kind: 'hist', histType: '招聘评估', title: '招聘评估', people: ['p-lin'], recorder: 'p-hance',
      srcs: [{ type: 'sheet', label: '社招面试评价表', loc: '2 位面试官' }], scale: [['专业能力', '4'], ['潜力', '4'], ['沟通协作', '3'], ['建议职级', 'N3']],
      quote: '能把需求拆成可验证的小步，表达偏简略。' }),
    E({ id: 'e-lin-camp', date: '2026-10-06', kind: 'hist', histType: '训练营评审', title: '新人训练营评审', people: ['p-lin'], recorder: 'p-yeqing',
      srcs: [{ type: 'sheet', label: '实训营评审表', loc: 'C14 单元格' }], scale: [['作品分', '86'], ['个人分', 'B+'], ['能力等级', 'A']], quote: '亮点：主动补齐文档；不足：排查问题时不够系统。' }),
    E({ id: 'e-lin-1', date: '2026-10-09', project: 'pr-ticket', recorder: 'p-yeqing', people: ['p-lin'], title: '搜索接口联调时独立定位跨域问题',
      bg: '工单检索接入搜索服务，联调第一天前端一直报跨域错误。', act: '自己读网关配置，定位到预检请求被拦，写清复现步骤后找运维改了白名单。', res: '当天联调打通，问题和改法写进了议题文档。',
      srcs: [{ type: 'doc', label: 'Landing W1 周报', loc: '第 2 段', quote: '跨域问题由林知远定位，附了复现步骤和网关配置截图。' }],
      tags: ['故障定位', '跨团队协作'], scores: [s('p-lin', 'prof', 3, 'confirmed', 'p-yeqing'), s('p-lin', 'wis', 3, 'confirmed', 'p-yeqing')] }),
    E({ id: 'e-lin-2', date: '2026-10-12', recorder: 'p-hance', people: ['p-lin'], title: '周会主动认领没人接的联调文档',
      bg: '业务成功部周会上，联调文档没有人负责，已经拖了两周。', act: '会上主动认领，三天内补完，并约了两个使用方确认。', res: '文档被两个团队采用，之后的联调问题少了一半。',
      srcs: [{ type: 'note', label: '一句话记录', loc: '韩策 · 10-12', quote: '没人接的联调文档，林知远主动认了，三天补完。' }],
      tags: ['主动推进'], scores: [s('p-lin', 'mot', 5, 'confirmed', 'p-hance'), s('p-lin', 'lead', 3, 'confirmed', 'p-hance')] }),
    E({ id: 'e-lin-3', date: '2026-10-21', project: 'pr-ticket', recorder: 'p-yeqing', people: ['p-lin'], title: '需求变更后主动给出两个备选方案',
      bg: 'W2 中途，客户反馈搜索结果看不懂内部标识，原方案需要调整。', act: '第二天带着方案 A、B 找导师，各自写清验收标准与风险；排查缓存问题时主要靠逐个尝试。', res: '方案 B 被采纳，他把剩余任务重新拆成 5 个 Issue。',
      srcs: [
        { type: 'audio', label: 'W2 导师团复盘', loc: '03:12–03:28', by: 'p-yeqing', quote: '他没等我安排，第二天就拿了 A、B 两个方案过来，每个方案的验收标准都写清楚了。' },
        { type: 'audio', label: 'W2 导师团复盘', loc: '18:40', by: 'p-songchuan', quote: '缓存那个问题，他主要是一个个试，没先缩小范围。' },
        { type: 'doc', label: 'Landing W2 周报', loc: '第 3 段', quote: '剩余任务按方案 B 重新拆分为 5 个 Issue，原 #14、#15 关闭。' },
      ],
      tags: ['需求变更', '方案对比', '任务拆解'], tagsAI: ['客户视角'],
      scores: [
        s('p-lin', 'wis', null, 'conflict', null, { raters: [{ by: 'p-yeqing', v: 4, why: '方案对比清楚，结论、依据、取舍都有。' }, { by: 'p-songchuan', v: 2, why: '排查问题靠试，不是系统性收敛。' }], ai: 4 }),
        s('p-lin', 'mot', 4, 'confirmed', 'p-yeqing', { ai: 4 }),
        s('p-lin', 'open', 4, 'confirmed', 'p-yeqing', { ai: 4 }),
        s('p-lin', 'prof', 3, 'ai', null, { ai: 3, note: '锚点 3 · 引用「每个方案的验收标准都写清楚了」' }),
        s('p-lin', 'grit', null, 'unknown', null, { note: '涉及方案被改，但没写他受挫后的反应' }),
      ] }),
    E({ id: 'e-lin-4', date: null, recorder: 'p-zhouyu', people: ['p-lin'], project: 'pr-search', title: '联调时独立定位缓存问题',
      bg: '海外加速搜索联调中，搜索结果偶尔返回旧数据。', act: '他自己对比了缓存键，发现语言参数没进键里。', res: '修复后旧数据问题消失。',
      srcs: [{ type: 'note', label: '周屿一对一记录', loc: '没有说是哪一次', quote: '缓存那个问题是林知远自己查出来的。' }],
      tags: ['故障定位'], scores: [s('p-lin', 'prof', 4, 'ai', null, { ai: 4, note: '锚点 4 · 引用「自己查出来的」' })] }),
    E({ id: 'e-lin-self', date: '2026-09-28', kind: 'self', recorder: 'p-lin', people: ['p-lin'], title: '「下个阶段想离客户近一点，试试售前。」',
      srcs: [{ type: 'audio', label: '入职季度沟通', loc: '12:31', quote: '下个阶段想离客户近一点，试试售前。' }] }),
    E({ id: 'e-lin-eng', date: '2026-10-17', kind: 'hist', histType: '工程规范评分', group: true, project: 'pr-ticket', title: '工程规范评分 · 小组级', people: [], recorder: 'p-songchuan',
      srcs: [{ type: 'sheet', label: '工程规范评分表', loc: 'W2 · 工单检索组' }], scale: [['PR', 'A'], ['Issue', 'B'], ['CI', 'A'], ['AI 使用', 'B']] }),

    // 多人事件：各自按本人行为打分
    E({ id: 'e-demo-1015', date: '2026-10-15', project: 'pr-search', recorder: 'p-zhouyu', people: ['p-heyn', 'p-lin'], title: '客户现场演示后调整搜索结果的展示方式',
      bg: '给一家海外客户演示搜索原型，客户看不懂结果里的内部产品代号。', act: '何以宁主讲，当场记下客户的说法，演示后提出用客户能懂的名字展示；林知远负责搭演示环境。', res: '展示方式在第二天改好，客户确认可以理解。',
      roles: { 'p-heyn': '主讲、提出改法', 'p-lin': '搭演示环境' },
      srcs: [{ type: 'doc', label: '客户演示纪要', loc: '第 1–2 段', quote: '客户看不懂内部代号；何以宁提出按客户熟悉的产品名展示。' }],
      tags: ['客户现场'], tagsAI: ['客户视角'],
      scores: [
        s('p-heyn', 'wis', 3, 'confirmed', 'p-zhouyu', { ai: 3 }), s('p-heyn', 'open', 4, 'confirmed', 'p-zhouyu', { ai: 4 }),
        s('p-heyn', 'mot', 5, 'confirmed', 'p-zhouyu', { ai: 2, bigGap: true }),
        s('p-lin', 'prof', null, 'unknown', null, { note: '只写了参与（搭演示环境），没有具体行为或结果' }),
      ] }),

    // 何以宁：之前 9 个月智慧力稳定在 4，近 3 个月走低
    E({ id: 'e-he-1', date: '2025-12-05', recorder: 'p-qinshu', people: ['p-heyn'], title: '续费复盘里先找出流失的三类原因再定动作',
      bg: '季度续费率下滑，团队想直接加大回访。', act: '先把流失客户按原因分成三类，再分别定动作。', res: '针对第二类的动作当月见效。', tags: ['复盘习惯'],
      scores: [s('p-heyn', 'wis', 4, 'confirmed', 'p-qinshu'), s('p-heyn', 'prof', 4, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-he-2', date: '2026-03-18', project: 'pr-tracking', recorder: 'p-fangyu', people: ['p-heyn'], title: '埋点治理：需求拆解清楚，先做最小验证',
      bg: '埋点治理范围很大，各团队都想先改自己的。', act: '先选两个核心页面做最小验证，拿数据说服其他团队。', res: '验证结果让排期顺利对齐。', tags: ['任务拆解'],
      scores: [s('p-heyn', 'wis', 4, 'confirmed', 'p-fangyu'), s('p-heyn', 'mot', 4, 'confirmed', 'p-fangyu')] }),
    E({ id: 'e-he-3', date: '2026-05-12', project: 'pr-tracking', recorder: 'p-fangyu', people: ['p-heyn'], title: '对比两种埋点方案后选了可回滚的那个',
      bg: '新旧埋点并存期，有两种迁移方案。', act: '列出两种方案的风险和回滚成本，选了可回滚的方案。', res: '迁移中出过一次问题，按方案回滚，没有影响数据。', tags: ['方案对比'],
      scores: [s('p-heyn', 'wis', 4, 'confirmed', 'p-fangyu'), s('p-heyn', 'open', 4, 'confirmed', 'p-fangyu'), s('p-heyn', 'prof', 4, 'confirmed', 'p-fangyu')] }),
    E({ id: 'e-he-4', date: '2026-06-20', project: 'pr-tracking', recorder: 'p-fangyu', people: ['p-heyn'], title: '埋点上线后主动做数据核对',
      bg: '埋点上线后，没有人负责核对新旧数据是否一致。', act: '主动拉了两周的数据逐项核对，列出 7 处差异。', res: '差异在一周内修完。',
      scores: [s('p-heyn', 'mot', 4, 'confirmed', 'p-fangyu'), s('p-heyn', 'grit', 3, 'confirmed', 'p-fangyu')] }),
    E({ id: 'e-he-5', date: '2026-09-26', project: 'pr-search', recorder: 'p-zhouyu', people: ['p-heyn'], title: '第一次海外客户演示被问住，事后补了问题清单',
      bg: '第一次给海外客户演示，客户问到计费口径，她没准备。', act: '当场如实说明会后答复，事后整理了 12 个可能被问到的问题。', res: '下一次演示没有再被问住。',
      scores: [s('p-heyn', 'wis', 2, 'confirmed', 'p-zhouyu'), s('p-heyn', 'grit', 4, 'confirmed', 'p-zhouyu')] }),
    E({ id: 'e-he-6', date: '2026-10-14', project: 'pr-search', recorder: 'p-zhouyu', people: ['p-heyn'], title: '客户反馈后直接改了实现，没有比较方案',
      bg: '客户说结果排序不对。', act: '直接改了排序实现，没和团队讨论其他做法。', res: '改动引出另一个客户的问题，第二天回退。',
      scores: [s('p-heyn', 'wis', 2, 'confirmed', 'p-zhouyu')] }),

    // 周屿：2026 H1 校准为双高；近期潜力维度的分偏低，参考位置移到专业骨干
    E({ id: 'e-zy-1', date: '2025-11-20', recorder: 'p-mengxia', people: ['p-zhouyu'], title: '融合线路配置改造：协调两条线按期交付',
      bg: '配置改造牵涉运维与销售两条线，过去两次都延期。', act: '拉两边每周对一次进度，自己补上中间缺的工具。', res: '按期交付，配置耗时降低一半。',
      srcs: [{ type: 'doc', label: '项目复盘文档', loc: '第 2 节', quote: '协调了运维与销售两条线，按期交付并把耗时降低一半。' }], tags: ['跨团队协作', '主动推进'],
      scores: [s('p-zhouyu', 'prof', 5, 'confirmed', 'p-mengxia'), s('p-zhouyu', 'lead', 4, 'confirmed', 'p-mengxia'), s('p-zhouyu', 'mot', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-zy-2', date: '2026-01-15', recorder: 'p-mengxia', people: ['p-zhouyu'], title: '线上故障中带队定位，写复盘并推动加告警',
      bg: '一次夜间故障影响了两个大客户。', act: '带两个人定位，事后写复盘，推动加了三条告警。', res: '同类故障之后没有再发生。', tags: ['线上故障', '复盘习惯'],
      scores: [s('p-zhouyu', 'prof', 4, 'confirmed', 'p-mengxia'), s('p-zhouyu', 'grit', 4, 'confirmed', 'p-mengxia'), s('p-zhouyu', 'wis', 4, 'calibrated', 'p-suwan', { hist: [{ v: 4, kind: 'calib', by: 'p-suwan', at: '2026-01-22', why: '定位是两个人一起做的，复盘写得好，但还不到带出可复用方法。' }, { v: 5, kind: 'confirm', by: 'p-mengxia', at: '2026-01-15' }] })] }),
    E({ id: 'e-zy-3', date: '2026-03-02', recorder: 'p-mengxia', people: ['p-zhouyu'], title: '主动给新人做存储模块带教',
      bg: '组里来了两位新人。', act: '主动排了四次带教，并把讲义留在知识库。', res: '新人一个月内能独立改存储模块。', tags: ['导师带教'],
      scores: [s('p-zhouyu', 'lead', 4, 'confirmed', 'p-mengxia'), s('p-zhouyu', 'open', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-zy-4', date: '2026-05-28', recorder: 'p-mengxia', people: ['p-zhouyu'], title: '评审中接受别组方案，调整了自己的设计',
      bg: '设计评审中别组提出了更简单的方案。', act: '当场承认自己方案的问题，按别组方案改了设计。', res: '实现工作量减少约三分之一。',
      scores: [s('p-zhouyu', 'open', 4, 'confirmed', 'p-mengxia'), s('p-zhouyu', 'wis', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-zy-5', date: '2026-09-03', project: 'pr-search', recorder: 'p-cheng', people: ['p-zhouyu'], title: '海外加速搜索立项：拆出 4 个里程碑',
      bg: '项目目标只有一句话。', act: '拆成 4 个里程碑并定了每个的验收标准。', res: '前两个里程碑按期完成。', tags: ['任务拆解'],
      scores: [s('p-zhouyu', 'prof', 4, 'confirmed', 'p-cheng'), s('p-zhouyu', 'mot', 3, 'confirmed', 'p-cheng')] }),
    E({ id: 'e-zy-6', date: '2026-09-24', project: 'pr-search', recorder: 'p-qinshu', people: ['p-zhouyu'], title: '搜索延迟问题两周没进展，后来交给了邵明',
      bg: '海外节点搜索延迟偏高。', act: '尝试两周没有进展，之后把问题交给邵明，没有继续跟进。', res: '邵明一周内解决。',
      scores: [s('p-zhouyu', 'grit', 2, 'confirmed', 'p-qinshu'), s('p-zhouyu', 'prof', 4, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-zy-7', date: '2026-10-10', project: 'pr-search', recorder: 'p-qinshu', people: ['p-zhouyu'], title: '评审时不太接受客户提出的改法',
      bg: '客户希望按地区排序搜索结果。', act: '评审中坚持原排序，没有给出比较。', res: '一周后按客户意见改了。',
      scores: [s('p-zhouyu', 'open', 2, 'confirmed', 'p-qinshu'), s('p-zhouyu', 'wis', 3, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-zy-8', date: '2026-10-18', project: 'pr-search', recorder: 'p-mengxia', people: ['p-zhouyu'], title: '搜索索引重建一次完成，无回滚',
      bg: '上线前需要重建全部索引。', act: '提前做了两次演练，写好回滚步骤。', res: '一次完成，没有回滚。',
      scores: [s('p-zhouyu', 'prof', 5, 'confirmed', 'p-mengxia')] }),

    // 沈砚：最近一条事件在 07-22，之后没有新记录
    E({ id: 'e-sy-1', date: '2025-12-10', project: 'pr-migrate', recorder: 'p-mengxia', people: ['p-shenyan'], title: '冷数据迁移方案设计',
      bg: '冷数据越来越多，查询成本上升。', act: '对比三种存储方案，给出分批迁移的设计。', res: '方案通过评审。', tags: ['存储', '方案对比'],
      scores: [s('p-shenyan', 'prof', 4, 'confirmed', 'p-mengxia'), s('p-shenyan', 'wis', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-sy-2', date: '2026-02-14', project: 'pr-migrate', recorder: 'p-mengxia', people: ['p-shenyan'], title: '迁移演练中发现数据校验漏洞并补上',
      bg: '第一次演练时校验脚本漏了一类数据。', act: '加班补上校验，把演练又跑了一遍。', res: '正式迁移零差错。', tags: ['存储'],
      scores: [s('p-shenyan', 'prof', 4, 'confirmed', 'p-mengxia'), s('p-shenyan', 'grit', 3, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-sy-3', date: '2026-04-10', project: 'pr-migrate', recorder: 'p-qinshu', people: ['p-shenyan'], title: '牵头增长中台数据迁移立项',
      bg: '迁移从实验变成正式项目。', act: '按要求写了立项材料，人员由上级安排。', res: '项目按期立项。',
      scores: [s('p-shenyan', 'mot', 3, 'confirmed', 'p-qinshu'), s('p-shenyan', 'lead', 3, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-sy-4', date: '2026-07-22', project: 'pr-migrate', recorder: 'p-mengxia', people: ['p-shenyan'], title: '冷数据迁移方案评审',
      bg: '第二批迁移评审。', act: '方案和第一批基本一致，评审顺利。', res: '第二批按计划启动。',
      scores: [s('p-shenyan', 'prof', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-sy-self', date: '2026-07-15', kind: 'self', recorder: 'p-suwan', people: ['p-shenyan'], title: '「做的事情挺熟了，没什么新鲜感。」',
      srcs: [{ type: 'audio', label: '7 月季度沟通', loc: '12:31–12:52', by: 'p-suwan', quote: '做的事情挺熟了，没什么新鲜感。' }] }),

    // 陆川：内生动力近 3 个月明显走高
    E({ id: 'e-lc-1', date: '2025-12-02', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '按排期完成投放素材更新', scores: [s('p-luchuan', 'mot', 3, 'confirmed', 'p-jiangyb'), s('p-luchuan', 'prof', 3, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-lc-2', date: '2026-02-25', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '等需求明确后才开始做渠道测试', scores: [s('p-luchuan', 'mot', 2, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-lc-3', date: '2026-05-06', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '渠道数据异常时按流程上报', scores: [s('p-luchuan', 'mot', 3, 'confirmed', 'p-jiangyb'), s('p-luchuan', 'prof', 3, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-lc-4', date: '2026-06-18', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '投放复盘只列了数据，没有结论', scores: [s('p-luchuan', 'wis', 2, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-lc-5', date: '2026-08-14', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '主动发现某渠道重复计费并追回费用',
      bg: '例行对账时没人注意到一个渠道的计费。', act: '自己拉了三个月的明细比对，找到重复计费并和渠道谈回。', res: '追回约 4 万元。', tags: ['主动推进'],
      scores: [s('p-luchuan', 'mot', 5, 'calibrated', 'p-suwan', { hist: [{ v: 5, kind: 'calib', by: 'p-suwan', at: '2026-08-20', why: '追回费用是他自己发起的，之后还把对账做成了每月例行，符合锚点 5。' }, { v: 4, kind: 'confirm', by: 'p-jiangyb', at: '2026-08-14' }] }), s('p-luchuan', 'prof', 4, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-lc-6', date: '2026-09-10', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '自己搭了投放归因的临时看板，后来成了 Landing 议题',
      scores: [s('p-luchuan', 'mot', 4, 'confirmed', 'p-jiangyb'), s('p-luchuan', 'wis', 3, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-lc-7', date: '2026-10-16', project: 'pr-attrib', recorder: 'p-jiangyb', people: ['p-luchuan'], title: '带许清和熟悉投放数据口径',
      scores: [s('p-luchuan', 'mot', 5, 'confirmed', 'p-jiangyb'), s('p-luchuan', 'lead', 3, 'confirmed', 'p-jiangyb')] }),

    // 陈一禾：训练营后调岗，H1 时资料不足
    E({ id: 'e-cy-camp', date: '2026-06-12', kind: 'hist', histType: '训练营评审', project: 'pr-xe', title: '训练营评审', people: ['p-chenyh'], recorder: 'p-mengxia',
      srcs: [{ type: 'sheet', label: 'XEngineer 训练营评审表', loc: 'B7 单元格' }], scale: [['作品分', '88'], ['个人分', 'A-'], ['能力等级', 'A']] }),
    E({ id: 'e-cy-1', date: '2026-05-20', project: 'pr-xe', recorder: 'p-mengxia', people: ['p-chenyh'], title: '训练营课题：冷热分层存储原型', tags: ['存储'],
      scores: [s('p-chenyh', 'prof', 3, 'confirmed', 'p-mengxia'), s('p-chenyh', 'mot', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-cy-2', date: '2026-06-10', project: 'pr-xe', recorder: 'p-mengxia', people: ['p-chenyh'], title: '训练营答辩时讲清了取舍',
      scores: [s('p-chenyh', 'wis', 4, 'confirmed', 'p-mengxia'), s('p-chenyh', 'open', 3, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-cy-3', date: '2026-08-28', recorder: 'p-mengxia', people: ['p-chenyh'], title: '独立负责缓存模块，上线无回滚',
      srcs: [{ type: 'doc', label: '发布记录', loc: '08-28', quote: '缓存模块上线，零回滚。' }],
      scores: [s('p-chenyh', 'prof', 4, 'confirmed', 'p-mengxia'), s('p-chenyh', 'grit', 3, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-cy-4', date: '2026-09-30', recorder: 'p-mengxia', people: ['p-chenyh'], title: '第二次上线无回滚，补充了监控',
      scores: [s('p-chenyh', 'prof', 4, 'confirmed', 'p-mengxia'), s('p-chenyh', 'mot', 4, 'confirmed', 'p-mengxia')] }),

    // 顾南：只有专业度证据
    E({ id: 'e-gn-1', date: '2026-03-11', recorder: 'p-hance', people: ['p-gunan'], title: '处理大客户故障工单，按 SOP 升级', scores: [s('p-gunan', 'prof', 3, 'confirmed', 'p-hance')] }),
    E({ id: 'e-gn-2', date: '2026-09-05', recorder: 'p-hance', people: ['p-gunan'], title: '把常见问题整理进客户成功手册', scores: [s('p-gunan', 'prof', 3, 'confirmed', 'p-hance'), s('p-gunan', 'mot', null, 'unknown', null, { note: '没写是主动还是被安排' })] }),

    // 罗伊
    E({ id: 'e-ly-1', date: '2025-11-08', recorder: 'p-jianning', people: ['p-luoyi'], title: '季度召回活动按计划执行', scores: [s('p-luoyi', 'prof', 4, 'confirmed', 'p-jianning')] }),
    E({ id: 'e-ly-2', date: '2026-01-20', recorder: 'p-jianning', people: ['p-luoyi'], title: '年初续费高峰期稳定交付', scores: [s('p-luoyi', 'prof', 4, 'confirmed', 'p-jianning'), s('p-luoyi', 'grit', 3, 'confirmed', 'p-jianning')] }),
    E({ id: 'e-ly-3', date: '2026-03-15', recorder: 'p-jianning', people: ['p-luoyi'], title: '主动优化召回话术', scores: [s('p-luoyi', 'mot', 4, 'confirmed', 'p-jianning'), s('p-luoyi', 'wis', 3, 'confirmed', 'p-jianning')] }),
    E({ id: 'e-ly-self', date: '2026-08-19', kind: 'self', recorder: 'p-jianning', people: ['p-luoyi'], title: '「这些活动闭着眼都能做了，想试试别的。」',
      srcs: [{ type: 'audio', label: '8 月一对一', loc: '07:05', by: 'p-jianning', quote: '这些活动闭着眼都能做了，想试试别的。' }] }),

    // 谢灵：转化经验与带人经历
    E({ id: 'e-xl-1', date: '2025-11-14', recorder: 'p-qinshu', people: ['p-xieling'], title: '带两名新人跑通 SMB 首单', tags: ['导师带教'],
      bg: '两名新人入职一个月还没有成单。', act: '陪跑三周，每单复盘一次话术。', res: '两人都在第四周成单。',
      scores: [s('p-xieling', 'lead', 4, 'confirmed', 'p-qinshu'), s('p-xieling', 'mot', 4, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-xl-2', date: '2026-01-28', recorder: 'p-qinshu', people: ['p-xieling'], title: '大客户续约谈判，提前准备三套报价',
      scores: [s('p-xieling', 'wis', 4, 'confirmed', 'p-qinshu'), s('p-xieling', 'prof', 5, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-xl-3', date: '2026-04-16', recorder: 'p-qinshu', people: ['p-xieling'], title: '转化漏斗复盘：找到首次跟进超时是主因', tags: ['复盘习惯'],
      srcs: [{ type: 'doc', label: '转化漏斗复盘', loc: '第 3 页', quote: '首次跟进超过 48 小时的线索，转化率只有正常的三分之一。' }],
      scores: [s('p-xieling', 'wis', 5, 'confirmed', 'p-qinshu'), s('p-xieling', 'prof', 4, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-xl-4', date: '2026-08-21', recorder: 'p-qinshu', people: ['p-xieling'], title: '客户投诉时第一时间到场，事后补流程', tags: ['客户现场'],
      scores: [s('p-xieling', 'grit', 4, 'confirmed', 'p-qinshu'), s('p-xieling', 'mot', 4, 'confirmed', 'p-qinshu')] }),
    E({ id: 'e-xl-5', date: '2026-10-11', recorder: 'p-qinshu', people: ['p-xieling'], title: '主动整理 SDR 交接清单，迎接并入', tags: ['跨团队协作'],
      scores: [s('p-xieling', 'mot', 5, 'confirmed', 'p-qinshu'), s('p-xieling', 'lead', 4, 'confirmed', 'p-qinshu')] }),

    // 黎安：有海外客户经验（增长产品部以外）
    E({ id: 'e-la-1', date: '2026-02-09', recorder: 'p-cheng', people: ['p-lian'], title: '独立谈下第一家东南亚渠道伙伴', tags: ['海外客户'],
      scores: [s('p-lian', 'prof', 4, 'confirmed', 'p-cheng'), s('p-lian', 'mot', 4, 'confirmed', 'p-cheng')] }),
    E({ id: 'e-la-2', date: '2026-06-03', recorder: 'p-cheng', people: ['p-lian'], title: '渠道伙伴流失后三个月里重新谈回', tags: ['海外客户'],
      scores: [s('p-lian', 'grit', 5, 'confirmed', 'p-cheng'), s('p-lian', 'prof', 4, 'confirmed', 'p-cheng')] }),
    E({ id: 'e-la-3', date: '2026-09-17', project: 'pr-sea', recorder: 'p-cheng', people: ['p-lian'], title: '按市场拆分渠道策略', scores: [s('p-lian', 'wis', 4, 'confirmed', 'p-cheng')] }),

    // Landing 第三期其他新人
    E({ id: 'e-wy-camp', date: '2026-10-06', kind: 'hist', histType: '训练营评审', title: '新人训练营评审', people: ['p-wangyz'], recorder: 'p-songchuan', srcs: [{ type: 'sheet', label: '实训营评审表', loc: 'C15 单元格' }], scale: [['作品分', '79'], ['个人分', 'B'], ['能力等级', 'B']] }),
    E({ id: 'e-wy-1', date: '2026-09-13', project: 'pr-hack', recorder: 'p-baizhi', people: ['p-wangyz'], title: '黑客松中负责数据清洗', scores: [s('p-wangyz', 'prof', 3, 'confirmed', 'p-baizhi')] }),
    E({ id: 'e-wy-2', date: '2026-10-16', project: 'pr-ticket', recorder: 'p-songchuan', people: ['p-wangyz'], title: '把工单分类规则写成文档',
      bg: '工单分类全靠经验。', act: '整理了 40 条历史工单，归纳成 8 类并写了判断规则。', res: '导师在 W2 复盘中采用。',
      scores: [s('p-wangyz', 'prof', 3, 'ai', null, { ai: 3, note: '锚点 3 · 引用「归纳成 8 类并写了判断规则」' }), s('p-wangyz', 'mot', 3, 'ai', null, { ai: 3, note: '锚点 3 · 引用「整理了 40 条历史工单」' })] }),
    E({ id: 'e-tg-1', date: '2026-09-13', project: 'pr-hack', recorder: 'p-baizhi', people: ['p-tangguo'], title: '黑客松上提出客服知识库的方向', scores: [s('p-tangguo', 'mot', 4, 'confirmed', 'p-baizhi')] }),
    E({ id: 'e-tg-2', date: '2026-10-14', project: 'pr-kb', recorder: 'p-yeqing', people: ['p-tangguo'], title: '先访谈 5 位客服再定知识库结构',
      scores: [s('p-tangguo', 'wis', 4, 'confirmed', 'p-yeqing'), s('p-tangguo', 'mot', 4, 'confirmed', 'p-yeqing')] }),
    E({ id: 'e-tg-3', date: '2026-10-20', project: 'pr-kb', recorder: 'p-yeqing', people: ['p-tangguo'], title: '方案被否后两天拿出新版本',
      scores: [s('p-tangguo', 'grit', 4, 'confirmed', 'p-yeqing'), s('p-tangguo', 'open', 4, 'confirmed', 'p-yeqing'), s('p-tangguo', 'prof', 3, 'confirmed', 'p-yeqing')] }),
    E({ id: 'e-sx-1', date: '2026-10-17', project: 'pr-recall', recorder: 'p-mengxia', people: ['p-songxm'], title: '参与召回名单清洗',
      scores: [s('p-songxm', 'prof', null, 'unknown', null, { note: '只写了参与，没有具体行为或结果' })] }),
    E({ id: 'e-xq-1', date: '2026-10-12', project: 'pr-attrib', recorder: 'p-jiangyb', people: ['p-xuqh'], title: '归因口径对齐会上讲清两种算法的差别', scores: [s('p-xuqh', 'wis', 4, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-xq-2', date: '2026-10-19', project: 'pr-attrib', recorder: 'p-jiangyb', people: ['p-xuqh'], title: '看板第一版按期交付', scores: [s('p-xuqh', 'prof', 3, 'confirmed', 'p-jiangyb'), s('p-xuqh', 'mot', 3, 'confirmed', 'p-jiangyb')] }),
    E({ id: 'e-xy-1', date: '2026-10-13', project: 'pr-recall', recorder: 'p-mengxia', people: ['p-xiayao'], title: '先写测试再改分配规则', scores: [s('p-xiayao', 'prof', 3, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-xy-2', date: '2026-10-20', project: 'pr-recall', recorder: 'p-mengxia', people: ['p-xiayao'], title: '主动问清楚边界条件再动手', scores: [s('p-xiayao', 'wis', 3, 'confirmed', 'p-mengxia'), s('p-xiayao', 'mot', 4, 'confirmed', 'p-mengxia')] }),
    E({ id: 'e-xy-3', date: '2026-10-21', project: 'pr-recall', recorder: 'p-mengxia', people: ['p-xiayao'], title: 'W2 对人复盘：联调延期后主动加了两个晚上补上', scores: [s('p-xiayao', 'prof', 3, 'confirmed', 'p-mengxia'), s('p-xiayao', 'grit', 3, 'confirmed', 'p-mengxia')] }),

    // SDR 并入：原系统里只迁过来一条记录
    E({ id: 'e-sxh-1', date: '2026-07-08', recorder: 'p-suwan', people: ['p-shenxh'], title: '季度外呼量达标（从原系统导入）', srcs: [{ type: 'sheet', label: 'SDR 周报导入', loc: '7 月第 2 周' }], scores: [s('p-shenxh', 'prof', 3, 'confirmed', 'p-suwan')] }),

    // 绩效：管理受限、含评价成分，不当作客观事实
    E({ id: 'e-lin-perf', date: '2026-06-30', kind: 'hist', histType: '绩效等级', restricted: true, title: '绩效等级', people: ['p-zhouyu'], recorder: 'p-suwan', srcs: [{ type: 'sheet', label: '2026 H1 绩效结果', loc: '管理受限' }], scale: [['等级', 'A']] }),
  ];

  // ---------- 其他人员：按画像生成近 12 个月的事件 ----------
  // 画像：hh 双高 / hl 高潜待练 / lh 专业骨干 / ll 待观察 / na 资料不足（只有 0–1 条）
  const POOL = [
    ['把线索分配从人工改成按地区自动分配', ['prof', 'wis']], ['客户投诉后当天给出临时方案并跟进到上线', ['mot', 'grit']],
    ['复盘会上主动认领没人负责的指标口径问题', ['mot', 'lead']], ['把入职材料整理成可复用的检查清单', ['mot', 'open']],
    ['对比三家短信服务商的到达率并给出切换建议', ['wis', 'prof']], ['大促前压测发现瓶颈，提前扩容', ['prof', 'mot']],
    ['跨部门对齐活动口径，减少返工', ['lead', 'wis']], ['方案评审时提出被采纳的替代方案', ['wis', 'open']],
    ['灰度发布失败后补上回滚开关并复盘', ['grit', 'prof']], ['整理常见问题，客服工单量下降', ['mot', 'prof']],
    ['接手遗留系统，一个月内理清依赖', ['prof', 'grit']], ['听取用户反馈后重做了交互流程', ['open', 'wis']],
    ['带新同事完成第一次上线', ['lead', 'open']], ['数据口径有分歧时先拉齐定义再讨论', ['wis', 'lead']],
  ];
  const TARGET = { hh: [4.2, 4.1], hl: [2.8, 4.1], lh: [4.1, 2.8], ll: [2.7, 2.7] };
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const recorderFor = (p) => (p.manager && p.manager !== p.id ? p.manager : 'p-qinshu');
  PEOPLE.filter((p) => p.gen).forEach((p, idx) => {
    const r = rng(1000 + idx * 97);
    if (p.gen === 'na') {
      EVENTS.push(E({ id: `e-g-${p.id}-0`, date: '2026-09-15', recorder: recorderFor(p), people: [p.id], title: '参与版本回归测试', scores: [s(p.id, 'prof', null, 'unknown', null, { note: '只写了参与' })] }));
      return;
    }
    const [tp, tq] = TARGET[p.gen];
    const n = 5 + Math.floor(r() * 2);
    const span = 340; // 天
    const jitter = (t) => Math.max(1, Math.min(5, Math.round(t + (r() - 0.5) * 1.6)));
    const dims = [['prof'], ['prof', 'mot'], ['wis', 'grit'], ['mot', 'wis'], ['prof', 'grit'], ['open', 'lead']];
    for (let i = 0; i < n; i++) {
      const [title] = POOL[(idx * 3 + i * 5) % POOL.length];
      const date = new Date(Date.UTC(2026, 9, 20) - Math.floor((span * (n - i)) / n + r() * 20) * 864e5).toISOString().slice(0, 10);
      const ds = dims[i % dims.length];
      EVENTS.push(E({ id: `e-g-${p.id}-${i}`, date, recorder: recorderFor(p), people: [p.id], title,
        scores: ds.map((d) => s(p.id, d, jitter(d === 'prof' ? tp : tq), 'confirmed', recorderFor(p))) }));
    }
  });

  // ---------- 2026 H1 盘点（已确认，06-30 冻结）：正式位置的覆盖（其余按当时的参考位置） ----------
  const H1_OVERRIDE = { 'p-heyn': { q: 'hh', reason: '' }, 'p-zhouyu': { q: 'hh', reason: '' } };

  // ---------- 批次 ----------
  const BATCHES = [
    { id: 'b-h1', kind: 'inventory', name: '增长产品部 · 2026 H1 盘点', org: 'gp', status: 'confirmed', starter: 'p-suwan', cutoff: '2026-06-20', confirmedAt: '2026-06-30', confirmedBy: 'p-suwan', rubric: 'rubric-v1' },
    { id: 'b-h2', kind: 'inventory', name: '增长产品部 · 2026 H2 盘点', org: 'gp', status: 'draft', starter: 'p-suwan', startedAt: '2026-10-15', cutoff: '2026-10-31', compareTo: 'b-h1', rubric: 'rubric-v1',
      log: [['2026-10-20', 'p-suwan', '加入 SDR 与 SMB 并入的 6 人（组织调整已公开宣布）'], ['2026-10-18', 'p-suwan', '证据截止时间从 10-25 改为 10-31']] },
    { id: 'b-land3', kind: 'landing', name: 'Landing 第三期', org: 'gp', status: 'running', starter: 'p-suwan', from: '2026-10-08', to: '2026-11-02',
      topics: ['pr-ticket', 'pr-kb', 'pr-recall', 'pr-attrib'],
      newcomers: [['p-lin', 'pr-ticket', ['p-yeqing', 'p-songchuan']], ['p-wangyz', 'pr-ticket', ['p-yeqing', 'p-songchuan']], ['p-tangguo', 'pr-kb', ['p-yeqing']],
        ['p-songxm', 'pr-recall', ['p-mengxia']], ['p-xiayao', 'pr-recall', ['p-mengxia']], ['p-xuqh', 'pr-attrib', ['p-jiangyb']]],
      weeks: [['W1', '进组', '对事复盘', '2026-10-08', '2026-10-14'], ['W2', '', '对事 + 对人复盘', '2026-10-15', '2026-10-21'], ['W3', '', '对事复盘', '2026-10-22', '2026-10-28'], ['W4', '结营', '对人复盘 + 结营评估', '2026-10-29', '2026-11-02']],
      milestones: [['2026-10-14', 'W1 周终 Roleplay'], ['2026-10-21', 'W2 导师团复盘'], ['2026-10-24', 'W3 Milestone 分享'], ['2026-11-02', '终期 Milestone 与结营评估']] },
  ];
  // 盘点逐人结论（已写的部分）
  const CONCLUSIONS = {
    'p-zhouyu': { text: '专业度稳定在高位；近期两次在压力下没有坚持跟进，下次校准重点看潜力维度。', by: 'p-suwan', at: '2026-10-21' },
    'p-xieling': { text: '转化经验和带人经历都扎实，适合承担新转化团队的组建。', by: 'p-suwan', at: '2026-10-21' },
    'p-luchuan': { text: '近期主动性明显提升，可以给更多独立负责的机会。', by: 'p-suwan', at: '2026-10-22' },
  };

  // ---------- 用人需求与方案 ----------
  const NEEDS = [
    { id: 'n-search', project: 'pr-search', version: 2, by: 'p-cheng', at: '2026-09-01', text: '海外加速搜索要一个能 owner 的人，加一个前端',
      roles: [{ id: 'owner', name: '项目 owner' }, { id: 'fe', name: '前端' }],
      reqs: [{ id: 'r1', text: '主导过跨团队交付', must: true }, { id: 'r2', text: '有海外客户经验', must: false }, { id: 'r3', text: 'Q4 有余量', must: true }] },
  ];
  const PLANS = [
    { id: 'sp-search-1', kind: 'staffing', project: 'pr-search', need: 'n-search', version: 1, status: 'superseded', by: 'p-cheng', at: '2026-09-01', slots: { owner: null, fe: null }, note: '' },
    { id: 'sp-search-2', kind: 'staffing', project: 'pr-search', need: 'n-search', version: 2, status: 'confirmed', by: 'p-cheng', at: '2026-09-28', confirmedBy: 'p-cheng', slots: { owner: 'p-zhouyu', fe: null }, note: 'owner 由周屿兼任，前端后补' },
    { id: 'sp-search-3', kind: 'staffing', project: 'pr-search', need: 'n-search', version: 3, status: 'draft', by: 'p-hance', at: '2026-10-22', slots: { owner: 'p-zhouyu', fe: 'p-lin' }, slotNote: { fe: '兼职，观察到 12-15' }, note: '林知远 10-15 起以兼职身份参与前端，建议写进方案' },
    { id: 'op-h1-1', kind: 'org', batch: 'b-h1', version: 1, status: 'confirmed', by: 'p-suwan', at: '2026-07-20', confirmedBy: 'p-suwan',
      moves: [{ type: '调岗', person: 'p-chenyh', from: '业务成功部 FED', to: '运营平台部 后端', basis: '训练营存储课题表现好，本人想做后端', gap: '后端线上经验', will: '已沟通 · 愿意', release: '业务成功部同意', impact: '业务成功部少 1 名 FED' }] },
    { id: 'op-h2-1', kind: 'org', batch: 'b-h2', version: 1, status: 'draft', by: 'p-suwan', at: '2026-10-22',
      moves: [
        { type: '负责人安排', person: null, pending: 'pr-newconv', from: '', to: '新转化团队 owner', basis: '组织调整后需要新的转化团队负责人', gap: '人选来自项目用人方案', will: '未知', release: '未知', impact: '新团队有了 owner' },
        { type: '调岗', kind: '激活', person: 'p-shenyan', from: '增长中台数据迁移 owner', to: '灰度发布平台（试任 3 个月）', basis: '来自「值得聊一聊」，待沟通确认本人意愿', ev: 'e-sy-self', gap: '灰度发布相关经历资料不足', will: '未知 · 待沟通', release: '未知 · 待和孟夏确认', impact: '数据迁移需要新 owner' },
        { type: '继续观察', person: 'p-shenxh', from: '', to: '资料不足，本期不做调整', basis: '并入后只有 1 条导入事件', next: '补录原系统里的客户跟进记录', owner: 'p-suwan', due: '2026-12-15' },
      ] },
  ];

  // ---------- 行动 ----------
  const ACTIONS = [
    { id: 'a-chen', title: '陈一禾转入运营平台部做后端', from: 'op-h1-1', person: 'p-chenyh', owner: 'p-suwan', due: '2026-08-01', did: '2026-08-04', state: 'done', observe: '2026-10-31',
      then: ['目标：补上运营平台部的存储经验', '假设：他在训练营做过存储课题', '观察：3 个月内独立负责一个模块'],
      now: [['独立负责缓存模块，两次上线无回滚', 'e-cy-3'], ['背景变化：Q4 预算削减，模块范围缩小', null]] },
    { id: 'a-lin', title: '林知远以兼职加入海外加速搜索体验', from: 'sp-search-3', person: 'p-lin', owner: 'p-zhouyu', due: '2026-10-15', did: '2026-10-15', state: 'done', observe: '2026-12-15' },
    { id: 'a-luoyi', title: '罗伊参与存量客户召回议题的带教', kind: '激活', from: 'signal', person: 'p-luoyi', owner: 'p-jianning', due: '2026-10-20', did: '2026-10-20', state: 'doing', observe: '2026-12-31' },
    { id: 'a-wang', title: '王一舟牵头黑客松项目的后续落地', person: 'p-wangyz', owner: 'p-baizhi', due: '2026-10-08', state: 'cancel', why: '项目优先级下调，换到下一期，不是个人原因' },
  ];

  // ---------- 重点跟踪 ----------
  const TRACKS = [
    { id: 't-he', person: 'p-heyn', why: '近 3 个月智慧力明显走低，情境从埋点治理换成了海外客户', q: '客户场景模糊时，她能不能先比较方案再动手？', owner: 'p-suwan', helper: 'p-zhouyu', next: '2026-11-06', since: '2026-10-09', state: 'on' },
    { id: 't-lin', person: 'p-lin', why: '判断力的证据都发生在导师在场时', q: '没有导师在场时，能不能独立做方案取舍？', owner: 'p-yeqing', helper: 'p-suwan', next: '2026-11-02', since: '2026-10-21', state: 'on' },
  ];

  // ---------- 值得聊一聊 ----------
  const SIGNALS = [
    { person: 'p-shenyan', state: 'open', items: [
      { src: 'fact', text: '职级 38 个月没有变化', from: '任职记录', detail: '在职人员信息表 · 职级列 · 2023-08 定级 N5，之后无变更（截至 10-23）' },
      { src: 'fact', text: '近 6 个月没有加入新项目', from: '项目成员记录', detail: '最近一次加入项目：增长中台数据迁移（04-10），目前仍在该项目' },
      { src: 'self', text: '「做的事情挺熟了，没什么新鲜感。」', from: '7 月季度沟通 · 12:31', detail: '7 月季度沟通录音 12:31–12:52 · 录入人 苏晚', event: 'e-sy-self' },
    ] },
    { person: 'p-luoyi', state: 'acted', items: [
      { src: 'fact', text: '职级 40 个月没有变化', from: '任职记录', detail: '2023-06 定级 N4，之后无变更' },
      { src: 'self', text: '「这些活动闭着眼都能做了，想试试别的。」', from: '8 月一对一 · 07:05', detail: '8 月一对一录音 07:05 · 录入人 简宁', event: 'e-ly-self' },
    ], result: { type: 'talk', by: 'p-jianning', at: '2026-09-02', note: '聊过，本人愿意带 Landing 新人，已生成激活行动。', action: 'a-luoyi' } },
  ];

  // ---------- 标签 ----------
  const TAGLIB = [
    { group: '做事方式', tags: [['方案对比', 1], ['主动推进', 1], ['任务拆解', 0], ['需求理解', 1], ['复盘习惯', 0]] },
    { group: '场景', tags: [['需求变更', 1], ['线上故障', 1], ['跨团队协作', 0], ['客户现场', 0], ['海外客户', 1]] },
    { group: '技术方向', tags: [['存储', 1], ['音视频', 1], ['搜索与检索', 1], ['故障定位', 0]] },
    { group: '带人', tags: [['导师带教', 1]] },
  ];
  const TAG_CANDIDATES = [
    { name: '客户视角', def: '从客户实际的使用场景出发重新理解需求，而不是只照着需求文档执行。', events: ['e-lin-3', 'e-demo-1015'], people: 4, count: 6, similar: '需求理解',
      why: '库里最接近的是「需求理解」，但它的定义偏向读懂文档；这几条都在讲站到客户的场景里想问题，建议单独收录。', at: '2026-10-22' },
    { name: '灰度发布', def: '按客户或流量分批发布，并能快速回滚。', events: [], people: 2, count: 3, similar: null, why: '只出现在运营平台部的 3 条事件里，库里没有相近标签。', at: '2026-10-19' },
    { name: '带新人', def: '', events: [], people: 3, count: 4, similar: '导师带教', why: '和「导师带教」说的是同一件事，建议并入。', at: '2026-10-18' },
  ];

  // ---------- 待核对（AI 拿不准的地方） ----------
  const INBOX = [
    { id: 'i-wang', kind: 'person', src: 'W2 导师团复盘', at: '05:40', by: 'p-songchuan', q: '录音里的「小王」指的是谁？', quote: '小王那边也是，联调的时候他先把日志都拉出来了。',
      options: [['p-wangyz', '同议题组员 · 可能性高'], ['p-wangman', '业务成功部 · 同部门']],
      draft: { title: '联调时先把日志都拉出来再排查', project: 'pr-ticket', recorder: 'p-songchuan', date: '2026-10-21', scores: [['prof', 3, '锚点 3 · 引用「先把日志都拉出来了」'], ['wis', 3, '锚点 3 · 先收集信息再排查']] } },
    { id: 'i-song', kind: 'person', src: 'W2 导师团复盘', at: '22:15', by: 'p-yeqing', q: '「宋老师说缓存要先缩小范围」里的宋老师是谁？', quote: '宋老师说缓存要先缩小范围，他第二天就照着做了。',
      options: [['p-songchuan', '工单检索助教 · 可能性高'], ['p-songxm', 'Landing 新人']], note: '这条会决定「他」的评价归到谁的复盘里引用的指导人', draft: null },
    { id: 'i-proj', kind: 'project', src: 'Landing W2 周报', at: '第 5 段', by: 'p-yeqing', q: '「海外那个项目」指的是哪个项目？', quote: '林知远这周还抽空帮海外那个项目搭了演示环境。',
      options: [['pr-search', '林知远是成员 · 可能性高'], ['pr-sea', '东南亚业务部']], draft: null },
  ];

  // ---------- 进行中的任务 ----------
  const TASKS = [
    { id: 'tk-w3', name: 'W3 导师团复盘.m4a', state: 'uploading', progress: 62, note: '182 MB 中的 113 MB · 上传完成前别关页面' },
    { id: 'tk-conv', name: '客户转化部周会.m4a', state: 'queued', note: '10:42 提交 · 可以离开，结果会回到这里' },
    { id: 'tk-w2', name: 'W2 导师团复盘.m4a', state: 'partial', preset: true, note: '9 条事件已整理，3 处待核对', link: 'record.html?m=w2' },
    { id: 'tk-report', name: 'Landing W2 周报.docx', state: 'shaping', note: '转写已完成，正在提取人员和事件' },
    { id: 'tk-camp', name: '实训营评审表.xlsx', state: 'done', note: '新增 6 条训练营评审，涉及 6 人' },
    { id: 'tk-mentor', name: '导师访谈.m4a', state: 'failed', note: '转写已保留，人员和事件提取没有完成' },
  ];

  // ---------- 录音纪要（W2 导师团复盘，预先处理的演示任务） ----------
  const MINUTES = {
    w2: { id: 'w2', title: 'W2 导师团复盘', batch: 'b-land3', at: '2026-10-21', dur: '42:10', by: 'p-yeqing', mode: '多人会议',
      summary: 'W2 导师团复盘，42 分钟。重点讨论了工单检索议题的方案变更和两位新人的排查方式；两处人名、一处项目需要确认是谁。',
      people: [['p-lin', 3], ['p-wangyz', 1], ['p-tangguo', 2]],
      events: ['e-lin-3', 'e-tg-3', 'e-wy-2'],
      marks: [192, 1120, 1335],
      lines: [
        ['00:20', 'p-yeqing', '先从工单检索开始，这周方案变了一次。'],
        ['03:12', 'p-yeqing', '他没等我安排，第二天就拿了 A、B 两个方案过来，每个方案的验收标准都写清楚了。', 'flag'],
        ['05:40', 'p-songchuan', '小王那边也是，联调的时候他先把日志都拉出来了。', 'verify'],
        ['11:02', 'p-yeqing', '唐果这周方案被否了一次，两天后拿了新版本，改得挺彻底。'],
        ['18:40', 'p-songchuan', '缓存那个问题，他主要是一个个试，没先缩小范围。', 'flag'],
        ['22:15', 'p-yeqing', '宋老师说缓存要先缩小范围，他第二天就照着做了。', 'verify'],
        ['31:50', 'p-yeqing', '下周 Milestone 分享，每个人十分钟。'],
      ],
      asks: ['谁在这次会议里展现了推动力？', '有要跟进的事吗？', '林知远的坚毅力有证据吗？'],
      answers: {
        '谁在这次会议里展现了推动力？': '两位。林知远：需求变更后第二天就带着 A、B 两个方案来（03:12）；唐果：方案被否后两天拿出新版本（11:02）。推动力是观察主题，挂在「内生动力」维度下。',
        '有要跟进的事吗？': '三件：确认「小王」指谁（05:40）、确认「宋老师」是谁（22:15）；叶青和宋川对林知远智慧力的判断差 2 分，已经进了 HRBP 校准队列。',
        '林知远的坚毅力有证据吗？': '资料不足。这次会议提到他的方案被改，但没有说他受挫后的反应。下次复盘可以留意：方案被否之后他怎么做。',
      } },
  };

  NT.SEED = {
    version: 3, DIMS, ANCHORS, THEMES, ORGS, PEOPLE, ROLES, PROJECTS, MEMBERS, MEMBER_LOG, EVENTS, H1_OVERRIDE, BATCHES, CONCLUSIONS,
    NEEDS, PLANS, ACTIONS, TRACKS, SIGNALS, TAGLIB, TAG_CANDIDATES, INBOX, TASKS, MINUTES,
  };
})();
