import type { z } from 'zod';
import type { standardAttributionCategorySchema } from '@/contracts/judgment-comparison';

export type AttributionCategory = z.infer<
  typeof standardAttributionCategorySchema
>;

/** The only chain this page serves (BOW-924): 入营选拔 against 结营评审. */
export const stage = { front: '入营选拔', back: '结营评审' } as const;

export const categoryLabel: Record<AttributionCategory, string> = {
  evaluation_standard: '评价标准',
  evaluator: '评价人',
  method_or_information: '评价方式与信息不足',
  person_or_environment: '本人或环境变化',
  later_evaluation: '后段评价偏差',
};

/** Review questions per category (prototype Y CAT_Q, requirement v1.4 3.22). */
export const categoryQuestion: Record<AttributionCategory, string> = {
  evaluation_standard: '等级定义和观察锚点是否一致？',
  evaluator: '提问、追问和评分是否有偏差？',
  method_or_information: '两个阶段观察到的是同一种能力吗？',
  person_or_environment: '任务难度、带教、资源是否影响了表现？',
  later_evaluation: '后段评价口径是否偏严、证据够不够？',
};

export const categoryOrder = Object.keys(
  categoryLabel,
) as AttributionCategory[];

export const categoryText = (categories: readonly AttributionCategory[]) =>
  categories.map((category) => categoryLabel[category]).join('、');

const monthDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
});

/** `2026-10-31T10:00:00Z` → `10-31`, the business day in Asia/Shanghai. */
export const monthDay = (iso: string) => monthDayFormat.format(new Date(iso));

/** A stable avatar hue for people the contract carries without one. */
export function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
