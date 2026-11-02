import type { MaterialSourceReference } from '../../../../contracts/sources';
import type { BatchSource } from './batch';

/** Fixed synthetic originals/cues for845 and871 regression. These identifiers
 * describe fixture text, not uploaded objects, production bindings or grants.
 * Never installed as an application source-provider fallback. */
export const batchArrangeExamples = [
  {
    id: 'demo-inline',
    personId: 'demo-lin',
    kind: 'text',
    occurredOn: '2026-09-03',
    text: '林舟（演示）在发布前逐步核对回滚清单，补齐了回滚验证步骤。',
    reference: {
      fragmentId: 'demo-inline-paragraph-1',
      originalVersionId: 'demo-inline-v1',
      location: { kind: 'document', paragraph: '1' },
    },
    acquisition: { kind: 'text', version: 'demo-inline-v1' },
  },
  {
    id: 'demo-offline',
    personId: 'demo-xu',
    kind: 'offline_transcript',
    occurredOn: '2026-09-03',
    text: '许禾（演示）在一次联调中复现了边界问题，并记录触发条件。',
    reference: {
      fragmentId: 'demo-offline-cue-1',
      originalVersionId: 'demo-offline-audio-v1',
      location: { kind: 'recording', startMs: 1200, endMs: 4200 },
    },
    acquisition: {
      kind: 'offline_transcript',
      recordingId: 'demo-offline-recording',
      transcriptVersionId: 'demo-offline-transcript-v1',
      bindingRevision: 1,
      binding: 'resolved',
    },
  },
  {
    id: 'demo-paragraph',
    personId: 'demo-zhou',
    kind: 'parsed_attachment',
    occurredOn: '2026-09-03',
    text: '周岚（演示）在附件第三段列出两次验证的差异，安排了复测。',
    reference: {
      fragmentId: 'demo-attachment-page2-paragraph3',
      originalVersionId: 'demo-attachment-v1',
      location: { kind: 'document', page: 2, paragraph: '3' },
    },
    acquisition: {
      kind: 'parsed_attachment',
      parseVersionId: 'demo-attachment-parse-v1',
    },
  },
] satisfies Array<{
  id: string;
  personId: string;
  kind: BatchSource['acquisition']['kind'];
  occurredOn: string;
  text: string;
  reference: MaterialSourceReference;
  acquisition: BatchSource['acquisition'];
}>;
export function batchExampleSource(
  example: (typeof batchArrangeExamples)[number],
  evaluationNodeId = 'demo-node',
  cohortId = 'demo-cohort',
): BatchSource {
  return {
    reference: structuredClone(example.reference),
    text: example.text,
    complete: true,
    scope: 'resolved',
    category: 'original',
    kind: 'evaluation',
    requiredKinds: [],
    reviewItemIds: [],
    attributedPersonIds: [example.personId],
    subjects: [{ personId: example.personId, cohortId, evaluationNodeId }],
    acquisition: structuredClone(example.acquisition),
  };
}
