import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import { parseInterviewReviewPdf } from '../../modules/records/attachments/interview-review/parser';
import type { ParsedInterviewReview } from '../../modules/records/attachments/interview-review/types';
import { archiveScale } from './archive-model';
let campus: ParsedInterviewReview;
let manual: ParsedInterviewReview;
beforeAll(async () => {
  const parse = async (name: string) => {
    const parsed = await parseInterviewReviewPdf(
      await readFile(`tests/fixtures/bow-896/interview/${name}.pdf`),
      { positionKind: 'non_management', allowSyntheticDemo: true },
    );
    if (parsed.status === 'rejected')
      throw new Error('Synthetic fixture rejected');
    return parsed.reviews[0];
  };
  campus = await parse('campus');
  manual = await parse('score-missing');
});
it('keeps the original scale, grade, level, result and true field regions without dimension scores', () => {
  const snapshot = structuredClone(campus);
  const scale = archiveScale(campus, {});
  expect(scale).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        item: '专业能力',
        value: '2',
        origin: 'parser',
      }),
      expect.objectContaining({ item: '潜力', value: '4', origin: 'parser' }),
      expect.objectContaining({
        item: '沟通协作',
        value: '3',
        origin: 'parser',
      }),
      expect.objectContaining({
        item: '面试结果',
        value: campus.metadata.interviewResult!.value,
      }),
    ]),
  );
  expect(scale[0].regions).toEqual(
    campus.dimensions[0].selection.status === 'not_applicable'
      ? []
      : [campus.dimensions[0].selection.source],
  );
  expect(campus).toEqual(snapshot);
  expect(JSON.stringify(scale)).not.toMatch(
    /dimensionId|anchorId|confirmed-score/,
  );
});
it('attributes an unread item to HR without rewriting the parser and preserves explicit non-applicability', () => {
  const item = manual.dimensions.find(
    (item) => item.selection.status === 'unrecognized',
  )!;
  const snapshot = structuredClone(manual);
  expect(() => archiveScale(manual, {})).toThrow('Incomplete');
  const scale = archiveScale(manual, { [item.name]: '5' });
  expect(scale.find((entry) => entry.item === item.name)).toMatchObject({
    value: '5',
    origin: 'hr_entry',
  });
  expect(manual).toEqual(snapshot);
  const exempt = structuredClone(campus);
  exempt.dimensions[0].selection = {
    status: 'not_applicable',
    reason: 'non_management_position',
  };
  expect(archiveScale(exempt, {})[0]).toEqual({
    item: exempt.dimensions[0].name,
    value: '非管理岗免评',
    origin: 'not_applicable',
    regions: [],
  });
});
it('does not accept an unknown template or fabricate a missing interview result', () => {
  expect(() => archiveScale({ ...campus, template: 'unknown' }, {})).toThrow(
    'Unsupported',
  );
  expect(() =>
    archiveScale(
      { ...campus, metadata: { ...campus.metadata, interviewResult: null } },
      {},
    ),
  ).toThrow('Incomplete');
});
