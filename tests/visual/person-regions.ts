import type { Page } from '@playwright/test';

/**
 * 人员档案与原型对比时的版面处理，登记在 docs/reference-route-map.md 的 BOW-840 一节。
 * omit：工程不渲染、原型有，比较前在原型侧隐藏；replace：两侧都有但内容由数据决定，
 * 换成同尺寸占位盒；mask：固定尺寸图形，两侧盖住。取消条件见映射表。
 */
export const personOmit = [
  '.nt-head__acts',
  '#why',
  '#judgechg',
  '#dirwrap',
  '[data-trackwrap]',
  'article:has(#pachanges)',
  '#sigwrap',
  'article:has([data-corr])',
  '#sum-acts',
  '[data-date]',
  '.nt-dl > dt:first-of-type',
  '.nt-dl > dd:first-of-type',
  '.nt-dl ~ .n-notice',
  '.nt-dl ~ .nt-caption:has(.ink-hand)',
  'li:has(.n-tl__dot.is-change)',
  '.n-tags',
  '#timeline > .n-lock',
] as const;
export const personReplace = ['#summary'] as const;
/** 只在工程侧出现、原型没有的版面（待接入的记录），比较前在工程侧隐藏。 */
export const personAppOnly = [
  '#timeline > ul[aria-label="待接入的记录"]',
] as const;
export const personMask = ['.n-miniquad'] as const;
/** 展开的事件卡里两处已登记差异：项目徽标的写法、分数行另画的出处角标。 */
export const personEventCardMask = ['.n-badge', '.n-score__note'];

/**
 * 原型把小组级历史评分（源 people 为空）按项目成员推进个人档案；正式来源边界不允许
 * 这样反推（#248 评论 6557401188），工程侧不会出现。比较前从原型侧移除这些条目。
 */
export async function hideGroupHistory(prototype: Page) {
  await prototype.evaluate(() => {
    for (const item of document.querySelectorAll('.n-tl__item'))
      if (item.querySelector('.n-tl__title')?.textContent?.includes('· 小组级'))
        item.remove();
  });
}

type Facts = Awaited<ReturnType<typeof personFacts>>;
const dimensionOf = (row: string) => row.split(/[，\s]/)[0];

/**
 * 导师视角（所有者裁决，#248 评论 6559810703 ②）：团队记录按现行权限逐条判断，不整体
 * 放权，导师看到的可以少于原型。工程侧出现的每一项都必须在原型侧存在；能力谱按维度名比
 * （条数随可见范围变化）。姓名仍严格相等，避免闸门退化成什么都不比。
 */
export function mentorSubsetGaps(left: Facts, right: Facts): string[] {
  const gaps: string[] = [];
  if (JSON.stringify(left.name) !== JSON.stringify(right.name))
    gaps.push(`name: ${right.name.join('、')}`);
  for (const key of ['facts', 'timeline'] as const)
    for (const item of right[key])
      if (!left[key].includes(item)) gaps.push(`${key}: ${item}`);
  const dimensions = left.spectrum.map(dimensionOf);
  for (const row of right.spectrum)
    if (!dimensions.includes(dimensionOf(row))) gaps.push(`spectrum: ${row}`);
  return gaps;
}

/** 数据相等闸：像素比较前先比这些文字，不相等就报数据差异，不再比截图。 */
export async function personFacts(page: Page) {
  return page.evaluate(() => {
    const texts = (selector: string) =>
      [...document.querySelectorAll(selector)].map((node) =>
        (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
    return {
      name: texts('.n-person__name'),
      facts: texts('#facts a.nt-plink'),
      spectrum: [...document.querySelectorAll('.n-spectrum__row')].map(
        (row) =>
          row.getAttribute('aria-label') ??
          (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ),
      timeline: texts(
        '.n-tl__item:not(:has(.n-tl__dot.is-change)) .n-tl__title',
      ),
      projects: texts('.n-members b'),
    };
  });
}
