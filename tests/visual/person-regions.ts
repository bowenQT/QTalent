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
export const personMask = ['.n-miniquad'] as const;

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
