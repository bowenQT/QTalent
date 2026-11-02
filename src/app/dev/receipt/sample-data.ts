import type { ShellData } from '@/contracts/shell';
import type { MaterialFileReceipt } from '@/contracts/materials';
import type { MaterialReviewItem } from '@/contracts/material-review';
import type { RecordBatchDraft } from '@/contracts/record';
import type { MaterialSourceReference } from '@/contracts/sources';
import type { ReceiptView } from '@/features/receipt/types';

/**
 * 回执页开发样张的演示数据，取自原型 Y `data-intake.js` 的「分镜工厂 · 二组 结营路演」
 * 回执（d-ms2，81e4fd4 之后的 main）。人员都是化名并标「演示」；不是真实页面的兜底。
 */
export type SampleRole = 'mentor' | 'hr';
export type SampleScene =
  'normal' | 'processing' | 'conflict' | 'empty' | 'hidden';

const accounts = {
  mentor: {
    id: 'p-yeqing',
    name: '叶青',
    label: '导师',
    scope: '分镜工厂 · 二组、口语搭子 · 一组的学员',
    hue: 66,
  },
  hr: {
    id: 'p-suwan',
    name: '苏晚',
    label: 'HR',
    scope: 'XEngineer、Landing、校招、黑客松',
    hue: 340,
  },
} as const;

export const sampleAccount = (role: SampleRole) => accounts[role];

export function sampleShell(role: SampleRole): ShellData {
  const account = accounts[role];
  return {
    account: {
      id: account.id,
      name: account.name,
      email: `${role}@sample.test`,
      roles: [role],
      hue: account.hue,
      roleLabel: account.label,
      scopeLabel: account.scope,
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
    role,
  };
}

export const BATCH_ID = 'd-ms2';
export const NODE_ID = 'pg-xe6';
const RUBRIC = 'rubric-v1';
const team = '分镜工厂 · 二组';

const versions = {
  video: 'mat-video-v1',
  slides: 'mat-slides-v1',
  sheet: 'mat-sheet-v1',
  audio: 'mat-audio-v1',
  photo: 'mat-photo-v1',
};

export const people: ReceiptView['people'] = {
  'p-x11': {
    name: '孟逸尘',
    hue: 92,
    photo: 'song-xiaoman',
    meta: team,
    demo: true,
  },
  'p-x12': { name: '沈亦初', hue: 265, photo: null, meta: team, demo: true },
  'p-x14': { name: '方景深', hue: 357, photo: null, meta: team, demo: true },
};
export const dimensions = {
  prof: '专业度',
  wis: '智慧力',
  grit: '坚毅力',
  open: '开放性',
};

const video = (
  startMs: number,
  endMs: number,
  n: number,
): MaterialSourceReference => ({
  fragmentId: `frag-video-${n}`,
  originalVersionId: versions.video,
  location: { kind: 'video', startMs, endMs },
});
const ref = {
  d1Video: video(760_000, 835_000, 1),
  d1Slide: {
    fragmentId: 'frag-slide-7',
    originalVersionId: versions.slides,
    location: { kind: 'presentation', slide: 7 },
  },
  d2Video: video(1_265_000, 1_330_000, 2),
  d2Sheet: {
    fragmentId: 'frag-sheet-9',
    originalVersionId: versions.sheet,
    location: { kind: 'spreadsheet', sheet: '评审表', cell: '第 9 行' },
  },
  d3Video: video(1_820_000, 1_900_000, 3),
  heldVideo: video(990_000, 1_065_000, 4),
  heldSheet: {
    fragmentId: 'frag-sheet-14',
    originalVersionId: versions.sheet,
    location: { kind: 'spreadsheet', sheet: '评审表', cell: '第 14 行' },
  },
} satisfies Record<string, MaterialSourceReference>;

type Score = [
  dimensionId: string,
  value: number,
  anchor: string,
  quote: string,
  ref: MaterialSourceReference,
];
const draft = (
  draftId: string,
  personId: string,
  title: string,
  behavior: string,
  sources: MaterialSourceReference[],
  scores: Score[],
): RecordBatchDraft => ({
  batchId: BATCH_ID,
  evaluationNodeId: NODE_ID,
  draftId,
  revision: 1,
  origin: 'ai_suggestion',
  personIds: [personId],
  projectId: 't-scene-b',
  sourceReferences: sources,
  dimensionVersionId: 'dims-v1',
  anchorVersionId: RUBRIC,
  sbi: { title, situation: '结营路演', behavior, impact: '' },
  scores: scores.map(([dimensionId, value, anchor, quote, source]) => ({
    state: 'suggested' as const,
    personId,
    dimensionId,
    value,
    anchor: {
      id: `${dimensionId}-${value}`,
      text: anchor,
      ruleVersion: RUBRIC,
    },
    citations: [{ kind: 'source' as const, quote, reference: source }],
  })),
});

const D1Q =
  '我们试了三种方案，最后选了分层缓存，压测下来生成耗时从 9 秒降到 3 秒';
const D2Q = '这块是我排期的时候低估了联调，后面两周我每天先把渲染的回归跑一遍';
const D3Q = '先切备用流，我看一下转码队列……队列堆了，清掉就好';

export const sampleDrafts: RecordBatchDraft[] = [
  draft(
    'e-d1',
    'p-x12',
    '路演讲清分镜生成的三级缓存方案，并给出压测数据',
    '对比了三种缓存方案后选了分层缓存，现场给出压测前后的耗时对比',
    [ref.d1Video, ref.d1Slide],
    [
      ['prof', 4, '引用「压测下来生成耗时从 9 秒降到 3 秒」', D1Q, ref.d1Video],
      [
        'wis',
        3,
        '比较了三种方案',
        '三级缓存：内存 → 本地盘 → 对象存储，命中率 82%',
        ref.d1Slide,
      ],
    ],
  ),
  draft(
    'e-d2',
    'p-x14',
    '评委追问排期延误时，当场说明原因并给出补救计划',
    '承认低估了渲染联调的时间，给出两周内补齐的计划',
    [ref.d2Video, ref.d2Sheet],
    [
      ['grit', 3, '给出补救计划', D2Q, ref.d2Video],
      [
        'open',
        4,
        '主动说出自己的判断失误',
        '能正视延误，补救计划具体',
        ref.d2Sheet,
      ],
    ],
  ),
  draft(
    'e-d3',
    'p-x11',
    '演示时推流卡顿，现场排查三分钟恢复',
    '先切到备用流，再查出是转码队列堆积，清队列后恢复',
    [ref.d3Video],
    [
      ['prof', 4, '现场定位到转码队列', D3Q, ref.d3Video],
      ['grit', 4, '有难度的情境下主动处理', D3Q, ref.d3Video],
    ],
  ),
];

const file = (
  materialId: string,
  filename: string,
  originalVersionId: string,
): MaterialFileReceipt => ({
  materialId,
  clientFileId: `c-${materialId}`,
  filename,
  status: 'parsed',
  originalVersionId,
  parseVersionId: `${originalVersionId}-parse`,
});
export const sampleFiles: MaterialFileReceipt[] = [
  file('m-video', '结营路演录像.mp4', versions.video),
  file('m-slides', '结营路演.pptx', versions.slides),
  file('m-sheet', '结营评审表.xlsx', versions.sheet),
];
/** processing 样张多交的两份：一份还在转写，一份格式不支持。 */
export const extraFiles: MaterialFileReceipt[] = [
  {
    materialId: 'm-audio',
    clientFileId: 'c-m-audio',
    filename: '评审讨论录音.m4a',
    status: 'processing',
    originalVersionId: null,
    jobId: 'job-audio',
  },
  {
    materialId: 'm-photo',
    clientFileId: 'c-m-photo',
    filename: '现场照片.heic',
    status: 'unsupported',
    originalVersionId: null,
    reason: 'format',
    message: '.heic 格式待转换：转成 JPG 或 PNG 再传',
  },
];
export const parsedAudio: MaterialFileReceipt = {
  ...file('m-audio', '评审讨论录音.m4a', versions.audio),
};

const review = {
  batchId: BATCH_ID,
  evaluationNodeId: NODE_ID,
  revision: 1,
  state: 'pending' as const,
};
export const sampleItems: MaterialReviewItem[] = [
  {
    ...review,
    kind: 'speaker',
    itemId: 'i-spk',
    materialId: 'm-video',
    originalVersionId: versions.video,
    source: ref.heldVideo,
    recordingId: 'rec-video',
    transcriptVersionId: 'tr-video-v1',
    speakerId: 'speaker-2',
    quote: '时间轴拖的时候按帧吸附，前后各留两帧的容差',
    candidates: [
      { personId: 'p-x13', displayName: '季叙白（演示）' },
      { personId: 'p-x15', displayName: '周初晴（演示）' },
    ],
  },
  {
    ...review,
    kind: 'unknown_person',
    itemId: 'i-xz',
    materialId: 'm-sheet',
    originalVersionId: versions.sheet,
    source: ref.heldSheet,
    observedName: '小周',
    candidates: [{ personId: 'p-x15', displayName: '周初晴（演示）' }],
  },
];

export const sampleMeta = {
  title: '分镜工厂 · 二组 结营路演',
  entry: 'wecom' as const,
  tool: null,
  submittedBy: '叶青',
  submittedAt: '2026-09-03T13:10:00.000Z',
};
