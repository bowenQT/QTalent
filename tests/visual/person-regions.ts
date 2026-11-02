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
/**
 * 展开的事件卡里两处已登记差异，只盖这两处：项目徽标（契约不区分课题与项目，工程写
 * 「项目：」）、分数行另画的出处角标（分数出处与事件出处不同时才有）。被盖住的内容由
 * eventCardFacts 另外比对。
 */
export const personEventCardMask = [
  '.n-event__head .n-badge:has(use[href="#i-folder"])',
  '.n-score__note .n-cite',
];

/** 事件卡里被遮罩盖住的内容：项目名、每行分数的维度、评分人和确认状态。 */
export async function eventCardFacts(page: Page) {
  return page
    .locator('.nt-tl-card:not([hidden]) .n-event')
    .first()
    .evaluate((card) => {
      const text = (node: Element | null | undefined) =>
        (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        project: text(
          card.querySelector(
            '.n-event__head .n-badge:has(use[href="#i-folder"])',
          ),
        ),
        scores: [...card.querySelectorAll('.n-score')].map((row) => {
          const note = row.querySelector('.n-score__note')?.cloneNode(true) as
            Element | undefined;
          for (const cite of note?.querySelectorAll('.n-cite') ?? [])
            cite.remove();
          return {
            state: row.getAttribute('data-state'),
            dimension: text(row.querySelector('.n-score__dim')),
            scorer: text(row.querySelector('.ink-hand')),
            note: text(note),
          };
        }),
      };
    });
}

/**
 * 原型把小组级历史评分（源 people 为空）按项目成员推进个人档案；正式来源边界不允许
 * 这样反推（#248 评论 6557401188），工程侧不会出现。比较前从原型侧移除这些条目。
 * 按来源类型认：历史资料点上标「原始事实」的就是小组评分（个人历史评价标「历史资料」），
 * 不按标题文字猜。
 */
export async function hideGroupHistory(prototype: Page) {
  return prototype.evaluate(() => {
    let removed = 0;
    for (const item of document.querySelectorAll('.n-tl__item'))
      if (
        item.querySelector('.n-tl__dot.is-hist') &&
        item.querySelector('.n-tl__meta .n-src')?.textContent?.trim() ===
          '原始事实'
      ) {
        item.remove();
        removed += 1;
      }
    return removed;
  });
}

type Lists = Record<'facts' | 'spectrum' | 'timeline' | 'projects', string[]>;
type Facts = Lists & { name: string[] };
const LISTS = ['facts', 'spectrum', 'timeline', 'projects'] as const;

/**
 * 在页面里取各列表的条目文字；给了 keep 时，同时把不在 keep 里的条目从页面删掉。取文字和
 * 裁剪用同一套规则，裁剪不会和比较对不上。
 */
function collect(keep: Lists | null): Facts {
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const lists: Record<
    keyof Lists,
    [string, (node: Element) => string, (node: Element) => Element]
  > = {
    facts: ['#facts a.nt-plink', text, (node) => node.closest('li') ?? node],
    spectrum: [
      '.n-spectrum__row',
      (row) => row.getAttribute('aria-label') ?? text(row),
      (row) => row,
    ],
    // 日期和标题；受限历史资料的日期写法是已登记差异（原型写半年度），记作「受限」，
    // 「管理受限」徽标本身仍要两侧都有。
    timeline: [
      '.n-tl__item:not(:has(.n-tl__dot.is-change))',
      (item) =>
        `${
          item.querySelector('.n-tl__meta .n-badge:has(use[href="#i-lock"])')
            ? '受限'
            : text(item.querySelector('.n-tl__date'))
        } ${text(item.querySelector('.n-tl__title'))}`,
      (item) => item,
    ],
    projects: ['.n-members b', text, (node) => node.closest('li') ?? node],
  };
  const facts = {
    name: [...document.querySelectorAll('.n-person__name')].map(text),
  } as Facts;
  for (const [list, [selector, key, host]] of Object.entries(lists) as [
    keyof Lists,
    (typeof lists)[keyof Lists],
  ][]) {
    facts[list] = [];
    for (const node of document.querySelectorAll(selector)) {
      const value = key(node);
      if (keep && !keep[list].includes(value)) host(node).remove();
      else facts[list].push(value);
    }
  }
  return facts;
}

/**
 * 导师视角（所有者裁决，#248 评论 6559810703 ②）：团队记录按现行权限逐条判断，不整体
 * 放权，导师看到的可以少于原型。只放过「因权限少了条目」这一种差异：工程侧每一项（整条
 * 文字，能力谱含维度名、均值和条数）都要在原型侧逐字存在，不重复，顺序与原型一致。
 * 姓名严格相等。
 */
export function mentorSubsetGaps(left: Facts, right: Facts): string[] {
  const gaps: string[] = [];
  if (JSON.stringify(left.name) !== JSON.stringify(right.name))
    gaps.push(`name: ${right.name.join('、')}`);
  // 逐条按原型顺序往后找：找得到才算保留下来的条目；重复、乱序、改了字的都找不到。
  for (const key of LISTS) {
    let next = 0;
    for (const item of right[key]) {
      const at = left[key].indexOf(item, next);
      if (at >= 0) next = at + 1;
      else
        gaps.push(
          `${key} ${left[key].includes(item) ? 'out of order or duplicated' : 'not in prototype'}: ${item}`,
        );
    }
  }
  return gaps;
}

/**
 * 导师视角截图前，把原型侧裁到工程侧可见的条目（只删条目，不改剩下的内容）。原型有条目、
 * 工程一条都看不到的卡片，工程画的是空状态，没法比截图：返回这些卡片，由调用方两侧隐藏，
 * 并对工程侧的空状态补语义断言。
 */
export async function trimToVisible(
  prototype: Page,
  left: Facts,
  right: Facts,
) {
  await prototype.evaluate(collect, right);
  // 时间线标题里的关键事件数按裁剪后留下的关键事件重算，和原型对同一组事件的写法一致。
  await prototype.evaluate(() => {
    const count = document.querySelector('#timeline .n-section-title small');
    if (count)
      count.textContent = (count.textContent ?? '').replace(
        /^\d+/,
        String(document.querySelectorAll('#timeline .nt-tl-open').length),
      );
  });
  return {
    facts: right.facts.length === 0 && left.facts.length > 0,
    spectrum: right.spectrum.length === 0 && left.spectrum.length > 0,
  };
}

/** 数据相等闸：像素比较前先比这些文字，不相等就报数据差异，不再比截图。 */
export async function personFacts(page: Page) {
  return page.evaluate(collect, null);
}
