import type { MaterialSource, MaterialSourceReference } from './sources';
import type { RecordBatchDraft, RecordBatchDraftSet } from './record';
import type { MaterialReviewItem } from './material-review';
import type { MaterialBatchInput } from './materials';

// Synthetic demo-only material. No original HR files, employee quotes or credentials.
export const materialReferencesFixture = {
  document: {
    fragmentId: 'demo-document-fragment',
    originalVersionId: 'demo-document-v1',
    location: { kind: 'document', paragraph: '2' },
  },
  pdf: {
    fragmentId: 'demo-pdf-fragment',
    originalVersionId: 'demo-pdf-v1',
    location: { kind: 'pdf', page: 2, textRange: { start: 0, end: 18 } },
  },
  spreadsheet: {
    fragmentId: 'demo-sheet-fragment',
    originalVersionId: 'demo-sheet-v1',
    location: { kind: 'spreadsheet', sheet: '演示评审表', cell: 'B3' },
  },
  presentation: {
    fragmentId: 'demo-slide-fragment',
    originalVersionId: 'demo-slide-v1',
    location: { kind: 'presentation', slide: 3 },
  },
  recording: {
    fragmentId: 'demo-audio-fragment',
    originalVersionId: 'demo-audio-v1',
    location: { kind: 'recording', startMs: 1200, endMs: 3400 },
  },
  video: {
    fragmentId: 'demo-video-fragment',
    originalVersionId: 'demo-video-v1',
    location: { kind: 'video', startMs: 100, endMs: 2500 },
  },
  image: {
    fragmentId: 'demo-image-fragment',
    originalVersionId: 'demo-image-v1',
    location: {
      kind: 'image',
      region: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
    },
  },
  code: {
    fragmentId: 'demo-code-fragment',
    originalVersionId: 'demo-code-v1',
    location: {
      kind: 'code',
      repository: 'demo-org/demo-repository',
      commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      path: 'src/demo.ts',
      startLine: 4,
      endLine: 6,
    },
  },
} satisfies Record<string, MaterialSourceReference>;
export const materialSourcesFixture: MaterialSource[] = [
  {
    ...materialReferencesFixture.document,
    sourceCategory: 'original',
    excerpt: '演示：完成合成任务并记录验证步骤。',
    demo: true,
  },
  {
    ...materialReferencesFixture.pdf,
    sourceCategory: 'historical_evaluation',
    evaluationKind: 'interview',
    excerpt: '演示：原量表评级保留，不换算维度分。',
    demo: true,
  },
  {
    ...materialReferencesFixture.spreadsheet,
    sourceCategory: 'original',
    excerpt: '演示：小组交付记录。',
    demo: true,
  },
  {
    ...materialReferencesFixture.presentation,
    sourceCategory: 'original',
    excerpt: '演示：方案验证步骤。',
    demo: true,
  },
  {
    ...materialReferencesFixture.recording,
    sourceCategory: 'original',
    excerpt: '演示：补充了一次边界验证。',
    demo: true,
  },
  {
    ...materialReferencesFixture.video,
    sourceCategory: 'original',
    excerpt: '演示：展示一次合成流程。',
    demo: true,
  },
  {
    ...materialReferencesFixture.image,
    sourceCategory: 'original',
    excerpt: '演示：核对后的图片区域。',
    demo: true,
  },
  {
    ...materialReferencesFixture.code,
    sourceCategory: 'submitted_code_snapshot',
    displayNotice: '提交的代码快照',
    excerpt: 'export const demo = true;',
    demo: true,
  },
];
export const materialBatchInputFixture: MaterialBatchInput = {
  operationId: 'demo-submit-1',
  projectId: null,
  evaluationNodeId: 'demo-node',
  personIds: [],
  text: '',
  files: [
    { clientFileId: 'demo-file-a', uploadId: 'demo-upload-a' },
    { clientFileId: 'demo-file-b', uploadId: 'demo-upload-b' },
  ],
};
export const recordBatchDraftFixture: RecordBatchDraft = {
  batchId: 'demo-batch',
  evaluationNodeId: 'demo-node',
  draftId: 'demo-event-draft-a',
  revision: 1,
  origin: 'ai_suggestion',
  projectId: null,
  personIds: ['demo-person'],
  sourceReferences: [materialReferencesFixture.document],
  dimensionVersionId: 'demo-dimensions-v1',
  anchorVersionId: 'demo-anchors-v1',
  sbi: {
    title: '演示：合成任务',
    situation: '演示环境',
    behavior: '完成合成任务并记录验证步骤',
    impact: '留下可复核记录',
  },
  scores: [
    {
      state: 'suggested',
      personId: 'demo-person',
      dimensionId: 'demo-professionalism',
      value: 3,
      anchor: {
        id: 'demo-anchor',
        text: '演示：按已定步骤完成任务',
        ruleVersion: 'demo-anchors-v1',
      },
      citations: [
        {
          kind: 'source',
          quote: '完成合成任务并记录验证步骤',
          reference: materialReferencesFixture.document,
        },
      ],
    },
    {
      state: 'unknown',
      personId: 'demo-person',
      dimensionId: 'demo-potential',
      reason: '资料不足',
    },
  ],
};
export const recordBatchDraftSetFixture: RecordBatchDraftSet = {
  batchId: 'demo-batch',
  revision: 1,
  drafts: [
    recordBatchDraftFixture,
    {
      ...recordBatchDraftFixture,
      draftId: 'demo-event-draft-b',
      sourceReferences: [materialReferencesFixture.recording],
      sbi: {
        title: '演示：另一次验证',
        situation: '演示环境',
        behavior: '补充了一次边界验证',
        impact: '',
      },
      scores: [],
    },
  ],
  duplicateCandidates: [],
};
const reviewBase = {
  batchId: 'demo-batch',
  evaluationNodeId: 'demo-node',
  materialId: 'demo-material',
  revision: 1,
  state: 'pending' as const,
};
export const materialReviewItemsFixture: MaterialReviewItem[] = [
  {
    ...reviewBase,
    kind: 'speaker',
    itemId: 'demo-speaker-review',
    originalVersionId: 'demo-audio-v1',
    source: materialReferencesFixture.recording,
    recordingId: 'demo-recording',
    transcriptVersionId: 'demo-transcript-v1',
    speakerId: 'demo-speaker',
    quote: '演示：补充了一次边界验证。',
    candidates: [{ personId: 'demo-person', displayName: '演示人员甲' }],
  },
  {
    ...reviewBase,
    kind: 'unknown_person',
    itemId: 'demo-person-review',
    originalVersionId: 'demo-document-v1',
    source: null,
    observedName: null,
    candidates: [],
  },
  {
    ...reviewBase,
    kind: 'image_scope',
    itemId: 'demo-image-review',
    originalVersionId: 'demo-image-v1',
    source: materialReferencesFixture.image,
    proposedRegion: null,
  },
  {
    ...reviewBase,
    kind: 'unknown_interviewer',
    itemId: 'demo-interviewer-review',
    originalVersionId: 'demo-pdf-v1',
    source: materialReferencesFixture.pdf,
    importRowId: 'demo-import-row',
    observedName: '演示面试官乙',
    candidates: [],
  },
  {
    ...reviewBase,
    kind: 'unknown_project',
    itemId: 'demo-project-review',
    originalVersionId: 'demo-document-v1',
    source: materialReferencesFixture.document,
    observedName: '演示课题',
    candidates: [{ projectId: 'demo-project', displayName: '演示课题甲' }],
  },
  {
    ...reviewBase,
    kind: 'unknown_interview_candidate',
    itemId: 'demo-candidate-review',
    originalVersionId: 'demo-pdf-v1',
    source: materialReferencesFixture.pdf,
    importRowId: 'demo-import-row',
    observedName: null,
    candidates: [],
  },
];
