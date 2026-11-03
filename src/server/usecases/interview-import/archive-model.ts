import type {
  ParsedInterviewReview,
  PdfRegion,
  Selection,
} from '../../modules/records/attachments/interview-review/types';
import { INTERVIEW_TEMPLATES } from '../../modules/records/attachments/interview-review/templates';

export const INTERVIEW_HISTORY_KIND = '北森面评';
export type ArchiveScaleItem = {
  item: string;
  value: string;
  origin: 'parser' | 'hr_entry' | 'not_applicable';
  regions: PdfRegion[];
};

/** Original template values, never dimension scores. HR entries remain separately
 * attributed rather than changing the immutable parser's unrecognized selection. */
export function archiveScale(
  review: ParsedInterviewReview,
  filled: Readonly<Record<string, string>>,
): ArchiveScaleItem[] {
  const template = INTERVIEW_TEMPLATES.find(
    (item) => item.name === review.template,
  );
  if (!template) throw new Error('Unsupported interview archive template');
  const selection = (item: string, choice: Selection): ArchiveScaleItem => {
    if (choice.status === 'not_applicable')
      return {
        item,
        value: '非管理岗免评',
        origin: 'not_applicable',
        regions: [],
      };
    if (choice.status === 'recognized')
      return {
        item,
        value: choice.value,
        origin: 'parser',
        regions: [choice.source],
      };
    const value = filled[item];
    if (!value) throw new Error('Incomplete interview archive entry');
    return { item, value, origin: 'hr_entry', regions: [choice.source] };
  };
  const result = review.metadata.interviewResult;
  if (!result) throw new Error('Incomplete interview archive result');
  return [
    ...review.dimensions.map((item) => selection(item.name, item.selection)),
    selection(template.rating.label, review.interviewRating),
    selection(template.level.label, review.suggestedLevel),
    {
      item: '面试结果',
      value: result.value,
      origin: 'parser',
      regions: result.sources,
    },
  ];
}
