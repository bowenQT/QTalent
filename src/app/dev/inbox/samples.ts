import {
  materialReviewItemSchema,
  type MaterialReviewItem,
} from '@/contracts/material-review';
import type { ShellData } from '@/contracts/shell';
import type { InboxData } from '@/features/inbox/ports';

/**
 * Development sample of 待核对, built from prototype Y's intake seed
 * (prototype/y/app/js/data-intake.js, the review items added by BOW-898) and parsed
 * through the BOW-897 item schema, so nothing here carries a field the server could
 * not send. Demo pseudonyms only.
 */
export type SampleRole = 'hr' | 'mentor';
export const sampleRoles: readonly SampleRole[] = ['hr', 'mentor'];

const roleLines: Record<SampleRole, [string, string, string]> = {
  hr: ['苏晚', 'HR', '人才项目：XEngineer、Landing、校招、黑客松'],
  mentor: ['叶青', '导师', '分镜工厂 · 二组、口语搭子 · 一组的学员'],
};

export function sampleShell(role: SampleRole): ShellData {
  const [name, roleLabel, scopeLabel] = roleLines[role];
  return {
    account: {
      id: `sample-${role}`,
      name,
      email: `${role}@sample.test`,
      roles: [role],
      hue: 220,
      roleLabel,
      scopeLabel,
    },
    navigation: [
      { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
    ],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role,
  };
}

const base = (id: string, batchId: string, material: string) => ({
  itemId: id,
  batchId,
  evaluationNodeId: 'sample-node-ms2',
  materialId: material,
  originalVersionId: `${material}-v1`,
  revision: 1,
  state: 'pending' as const,
});
const source = (material: string, fragment: string) => ({
  fragmentId: fragment,
  originalVersionId: `${material}-v1`,
});

// The mentor's own submission: the MS2 roadshow video and review sheet.
const speaker = materialReviewItemSchema.parse({
  ...base('i-spk', 'd-ms2', 'm-video'),
  kind: 'speaker',
  source: {
    ...source('m-video', 'f-video-1630'),
    location: { kind: 'video', startMs: 990_000, endMs: 1_065_000 },
  },
  recordingId: 'm-video',
  transcriptVersionId: 'm-video-t1',
  speakerId: 'speaker-2',
  quote: '时间轴拖的时候按帧吸附，前后各留两帧的容差。',
  candidates: [
    { personId: 'p-x13', displayName: '季叙白' },
    { personId: 'p-x15', displayName: '周初晴' },
  ],
});
const xiaozhou = materialReviewItemSchema.parse({
  ...base('i-xz', 'd-ms2', 'm-sheet'),
  kind: 'unknown_person',
  source: {
    ...source('m-sheet', 'f-sheet-14'),
    location: { kind: 'spreadsheet', sheet: '结营评审表', cell: '第 14 行' },
  },
  observedName: '小周',
  candidates: [{ personId: 'p-x15', displayName: '周初晴' }],
});
// HR's submissions: the review comments, the review-group screenshot, the PDF.
const aze = materialReviewItemSchema.parse({
  ...base('i-aze', 'd-hr', 'm-doc'),
  kind: 'unknown_person',
  source: {
    ...source('m-doc', 'f-doc-8'),
    location: { kind: 'document', paragraph: '8' },
  },
  observedName: '阿泽',
  candidates: [],
});
const region = materialReviewItemSchema.parse({
  ...base('i-region', 'd-hr', 'm-image'),
  kind: 'image_scope',
  source: {
    ...source('m-image', 'f-image-1'),
    location: {
      kind: 'image',
      region: { left: 0, top: 0, right: 1, bottom: 1 },
    },
  },
  proposedRegion: { left: 0.04, top: 0.08, right: 0.96, bottom: 0.92 },
});
const interviewer = materialReviewItemSchema.parse({
  ...base('i-int', 'd-iv', 'm-pdf'),
  kind: 'unknown_interviewer',
  source: {
    ...source('m-pdf', 'f-pdf-3'),
    location: { kind: 'pdf', page: 3, textRange: { start: 0, end: 32 } },
  },
  importRowId: 'imp-1-r2',
  observedName: 'Kevin',
  candidates: [{ personId: 's-28', displayName: '许致远' }],
});

const itemsFor: Record<SampleRole, MaterialReviewItem[]> = {
  // HR sees every submission in scope; the interviewer kind is HR's alone.
  hr: [speaker, xiaozhou, aze, region, interviewer],
  // A mentor sees the review items of the materials they submitted.
  mentor: [speaker, xiaozhou],
};

export function sampleData(role: SampleRole): InboxData {
  const items = itemsFor[role];
  const people: Record<string, string> = {};
  for (const item of items)
    if ('candidates' in item && item.kind !== 'unknown_project')
      for (const candidate of item.candidates)
        people[candidate.personId] = candidate.displayName;
  return { items, resolvedItems: [], people };
}
