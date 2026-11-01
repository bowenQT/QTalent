import type { ShellData } from '@/contracts/shell';
import type {
  DirectoryMatch,
  ImportBatch,
  ImportRow,
  Selection,
} from '@/features/interview-import/model';

/**
 * Sample batch for the interview import preview while BOW-906 (import decisions) and
 * BOW-900 (parsing) are not on main. Demo pseudonyms, file and scores from the prototype
 * Y seed (data-intake.js IMPORTS imp-1 at 81e4fd4); not real people and not a fallback
 * for the real page.
 */
export const sampleBatchId = 'imp-1';

const templates = {
  campus: {
    name: '校招专业面试通用评价表',
    scale: '1–5 分',
    options: ['1', '2', '3', '4', '5'],
  },
  expert: {
    name: '七牛面试评价表 · 专业面试官',
    scale: 'A–D',
    options: ['A', 'B', 'C', 'D'],
  },
  hr: {
    name: '七牛面试评价表 · HR',
    scale: '优 / 良 / 中 / 差',
    options: ['优', '良', '中', '差'],
  },
} as const;

const read = (value: string): Selection => ({ status: 'recognized', value });
const exempt: Selection = {
  status: 'not_applicable',
  reason: 'non_management_position',
};
const scale = (pairs: [string, Selection][]) =>
  pairs.map(([item, selection]) => ({ item, selection }));

const person = (
  personId: string,
  name: string,
  hue: number,
  photo: string | null,
  org: string,
  title: string,
): DirectoryMatch => ({
  personId,
  name,
  hue,
  photo,
  org,
  title,
  joinedOn: '2026-07-06',
});

const row = (
  base: Pick<
    ImportRow,
    | 'rowId'
    | 'pages'
    | 'observedName'
    | 'candidateStatus'
    | 'template'
    | 'interviewedOn'
  > &
    Partial<ImportRow>,
): ImportRow => ({
  match: null,
  interviewer: { status: 'matched', name: '叶青' },
  scale: [],
  result: '通过',
  comment: null,
  redacted: 0,
  duplicate: null,
  reviewItemId: null,
  confirmed: false,
  filled: {},
  ...base,
});

const tpl = ({ name, scale }: { name: string; scale: string }) => ({
  name,
  scale,
});

export const sampleRows: readonly ImportRow[] = [
  row({
    rowId: 'r1',
    pages: { from: 1, to: 2 },
    observedName: '孟逸尘',
    candidateStatus: 'hired',
    template: tpl(templates.campus),
    interviewedOn: '2026-05-08',
    match: person(
      'p-x11',
      '孟逸尘',
      92,
      'song-xiaoman',
      '分镜工厂 · 二组',
      '后端方向',
    ),
    scale: scale([
      ['专业基础', read('4')],
      ['项目经历', read('4')],
      ['学习能力', read('5')],
      ['沟通表达', read('3')],
      ['管理能力', exempt],
    ]),
    comment: '项目经历讲得具体，能说清自己负责的部分',
  }),
  row({
    rowId: 'r2',
    pages: { from: 3, to: 3 },
    observedName: '周初晴',
    candidateStatus: 'hired',
    template: tpl(templates.expert),
    interviewedOn: '2026-05-14',
    match: person('p-x15', '周初晴', 213, null, '分镜工厂 · 二组', '前端方向'),
    interviewer: {
      status: 'pending',
      observedName: 'Kevin',
      reviewItemId: 'i-int',
    },
    scale: scale([
      ['技术深度', read('B')],
      [
        '系统设计',
        {
          status: 'unrecognized',
          reason: 'multiple_selections',
          page: 3,
          options: templates.expert.options,
          marked: ['A', 'B'],
        },
      ],
      ['问题解决', read('A')],
      ['协作沟通', read('B')],
      ['管理能力', exempt],
    ]),
    comment: '前端基础扎实，做过完整的组件库',
  }),
  row({
    rowId: 'r3',
    pages: { from: 4, to: 5 },
    observedName: '唐语桐',
    candidateStatus: 'rejected',
    template: tpl(templates.campus),
    interviewedOn: '2026-05-10',
  }),
  row({
    rowId: 'r4',
    pages: { from: 6, to: 6 },
    observedName: '宋知意',
    candidateStatus: 'offer_pending',
    template: tpl(templates.expert),
    interviewedOn: '2026-05-16',
  }),
  row({
    rowId: 'r5',
    pages: { from: 7, to: 7 },
    observedName: '云致远',
    candidateStatus: 'hired',
    template: tpl(templates.hr),
    interviewedOn: '2026-05-20',
    match: person('p-x10', '云致远', 40, null, '口语搭子 · 一组', '后端方向'),
    interviewer: { status: 'matched', name: '苏晚' },
    scale: scale([
      ['求职动机', read('良')],
      ['沟通表达', read('优')],
      ['团队协作', read('良')],
      ['价值观契合', read('良')],
      ['管理能力', exempt],
    ]),
    comment: '想做后端，问到技术选型时能说出取舍',
    redacted: 1,
  }),
  row({
    rowId: 'r6',
    pages: { from: 8, to: 8 },
    observedName: '谷嘉树',
    candidateStatus: 'hired',
    template: tpl(templates.campus),
    interviewedOn: '2026-05-09',
    match: person('p-x08', '谷嘉树', 160, null, '口语搭子 · 一组', '后端方向'),
    duplicate: { importedOn: '2026-08-20' },
  }),
  row({
    rowId: 'r7',
    pages: { from: 9, to: 9 },
    observedName: '林嘉禾',
    candidateStatus: 'hired',
    template: tpl(templates.campus),
    interviewedOn: '2026-05-22',
    scale: scale([
      ['专业基础', read('4')],
      ['项目经历', read('3')],
      ['学习能力', read('4')],
      ['沟通表达', read('4')],
      ['管理能力', exempt],
    ]),
  }),
];

export const sampleBatch: ImportBatch = {
  id: sampleBatchId,
  file: '北森面评导出 · 2026-07.pdf（演示）',
  pageCount: 9,
  uploadedBy: '苏晚',
  uploadedAt: '2026-09-04T09:30:00',
  prior: { importedOn: '2026-08-20' },
  rows: sampleRows,
};

export const sampleShell: ShellData = {
  account: {
    id: 'sample-hr',
    name: '苏晚',
    email: 'hr@sample.test',
    roles: ['hr'],
    hue: 220,
    roleLabel: 'HR',
    scopeLabel: 'XEngineer、Landing、校招、黑客松',
  },
  navigation: [
    { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
    {
      id: 'projects',
      label: '项目与课题',
      href: '/projects',
      icon: 'folder',
      group: null,
    },
  ],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: false,
  role: 'hr',
};
