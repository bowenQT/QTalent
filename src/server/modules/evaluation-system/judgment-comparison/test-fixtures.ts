import type { ComparisonMapping } from '@/contracts/judgment-comparison';
import type {
  ComparisonDataset,
  ComparisonFacts,
  CurrentComparisonAccess,
} from './ports';

export const mapping: ComparisonMapping = {
  versionId: 'map-xe-select-v1',
  frontScaleId: 'selection-scale',
  backScaleId: 'graduation-scale',
  rows: [
    { frontGrade: '高分档', frontPosition: 'highest', backGrade: '建议留用' },
    { frontGrade: '中间档', frontPosition: 'middle', backGrade: '继续观察' },
    {
      frontGrade: '刚过线档',
      frontPosition: 'just_passed',
      backGrade: '不建议',
    },
  ],
  confirmedBy: { id: 'hr', name: '苏晚（演示）' },
  confirmedAt: '2026-01-01T00:00:00Z',
};
export function facts(
  index: number,
  frontGrade = '高分档',
  backGrade = '不建议',
  evaluatorId = 'a',
): ComparisonFacts {
  const row = index + 1;
  const person = { id: `person-${index}`, name: `学员${index}（演示）` };
  const source = (side: string) => ({
    fragmentId: `${side}-${index}`,
    originalVersionId: `${side}-original`,
    originalTitle: `${side}原表（演示）`,
    recordedByName: null,
    location: {
      kind: 'spreadsheet' as const,
      sheet: `${side}（演示）`,
      cell: `A${row}:B${row}`,
    },
    excerpt: `合成${side}评审事实（演示）`,
    sourceType: 'spreadsheet' as const,
    sourceCategory: 'original' as const,
    demo: true,
  });
  return {
    id: `case-${index}`,
    batchId: 'batch',
    person,
    judgment: { id: 'selection-graduation', name: '选拔与结营（演示）' },
    cohort: { id: 'cohort6', name: '第六期（演示）' },
    selectionStandardVersionId: 'xe-select-v1',
    mappingVersionId: mapping.versionId,
    frontNodeId: 'selection',
    backNodeId: 'graduation',
    work:
      index === 1 || index === 3
        ? { kind: 'team', workId: 'team-work', teamId: 'team-demo' }
        : { kind: 'individual', workId: `work-${index}` },
    front: {
      state: 'present',
      judgment: {
        judgmentId: `selection-${index}`,
        nodeId: 'selection',
        cohortId: 'cohort6',
        standardVersionId: 'xe-select-v1',
        scaleId: mapping.frontScaleId,
        grade: frontGrade,
        evaluator: {
          id: evaluatorId,
          name: evaluatorId === 'a' ? '叶青（演示）' : '杜安歌（演示）',
        },
        evaluatedAt: '2026-02-01T00:00:00Z',
        confirmation: 'human_confirmed',
        row: { personId: person.id, row, source: source('front') },
      },
    },
    back: {
      state: 'present',
      judgment: {
        judgmentId: `graduation-${index}`,
        nodeId: 'graduation',
        cohortId: 'cohort6',
        standardVersionId: 'graduation-v1',
        scaleId: mapping.backScaleId,
        grade: backGrade,
        evaluator: { id: 'back-rater', name: '许致远（演示）' },
        evaluatedAt: '2026-06-01T00:00:00Z',
        confirmation: 'human_confirmed',
        row: { personId: person.id, row, source: source('back') },
      },
    },
  };
}
export function dataset(): ComparisonDataset {
  const missing = facts(6);
  missing.back = { state: 'missing', reason: '未取得结营材料（演示）' };
  const marked = facts(7);
  marked.nonComparable = {
    reason: '两次任务范围不同（演示）',
    markedBy: { id: 'hr', name: '苏晚（演示）' },
    markedAt: '2026-07-01T00:00:00Z',
  };
  return {
    batch: {
      id: 'batch',
      name: '对照批次（演示）',
      cohort: { id: 'cohort6', name: '第六期（演示）' },
      selectionStandardVersionId: 'xe-select-v1',
      mappingVersionId: mapping.versionId,
    },
    mapping: structuredClone(mapping),
    cases: [
      facts(1),
      facts(2, '刚过线档', '建议留用'),
      facts(3, '高分档', '建议留用'),
      facts(4, '中间档', '继续观察'),
      facts(5, '高分档', '继续观察'),
      missing,
      marked,
      facts(8, '高分档', '不建议', 'b'),
    ],
    confirmedAttributions: [
      { caseId: 'case-1', category: 'evaluation_standard' },
      { caseId: 'case-8', category: 'person_or_environment' },
    ],
  };
}
export function access(
  data: ComparisonDataset,
  audience: CurrentComparisonAccess['audience'] = 'hr',
): CurrentComparisonAccess {
  return {
    audience,
    viewerId: audience === 'rater' ? 'a' : audience,
    now: '2026-10-31T12:00:00Z',
    grants: data.cases.flatMap((unit) =>
      [unit.frontNodeId, unit.backNodeId].map((nodeId) => ({
        personId: unit.person.id,
        nodeId,
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: null,
      })),
    ),
  };
}
