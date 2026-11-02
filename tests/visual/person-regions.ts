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
  hiddenKeyEvents = 0,
) {
  await prototype.evaluate(collect, right);
  // 时间线标题里的关键事件数按裁剪后留下的关键事件重算，和原型对同一组事件的写法一致；
  // 工程侧为已登记差异隐藏的关键事件仍计在工程的标题里，这里一并加上。
  await prototype.evaluate((hidden) => {
    const count = document.querySelector('#timeline .n-section-title small');
    if (count)
      count.textContent = (count.textContent ?? '').replace(
        /^\d+/,
        String(
          document.querySelectorAll('#timeline .nt-tl-open').length + hidden,
        ),
      );
  }, hiddenKeyEvents);
  return {
    facts: right.facts.length === 0 && left.facts.length > 0,
    spectrum: right.spectrum.length === 0 && left.spectrum.length > 0,
  };
}

/**
 * 导师可见范围的已登记差异（#341「影响」）：服务端按评价关系授权，没有按记录人过滤，
 * demo-mentor 因此多看到这条黑客松评委记录，原型导师视角看不到。
 */
export const mentorExtraEvents = ['负责语音唤醒与打断，现场演示一次跑通'];

const dimensionOf = (row: string) => row.split('，')[0];

/**
 * 把已登记的多出事件从比较里拿出来，并把它带来的能力谱变化换成原型在这条事件可见时的
 * 写法（原型管理者视角同一维度的整行）。工程侧这一行必须逐字等于管理者视角那一行，才
 * 换；其余规则不变。返回比较用的两侧，以及换过的维度。
 */
export function mentorExtras(left: Facts, manager: Facts, right: Facts) {
  const isExtra = (item: string) =>
    mentorExtraEvents.some(
      (title) => item === title || item.endsWith(` ${title}`),
    );
  const swapped = right.spectrum
    .filter(
      (row) => !left.spectrum.includes(row) && manager.spectrum.includes(row),
    )
    .map(dimensionOf);
  return {
    expected: {
      ...left,
      spectrum: left.spectrum.map(
        (row) =>
          (swapped.includes(dimensionOf(row)) &&
            manager.spectrum.find(
              (other) => dimensionOf(other) === dimensionOf(row),
            )) ||
          row,
      ),
    },
    visible: {
      ...right,
      facts: right.facts.filter((item) => !isExtra(item)),
      timeline: right.timeline.filter((item) => !isExtra(item)),
    },
    swapped,
  };
}

/**
 * 截图前落实 mentorExtras：工程侧隐藏多出的事件（关键事实和时间线各一条），原型侧把换过
 * 的维度行换成管理者视角渲染的那一行。
 */
export async function applyMentorExtras(
  prototype: Page,
  manager: Page,
  page: Page,
  swapped: string[],
) {
  await page.evaluate((titles) => {
    const text = (node: Element | null) =>
      (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    for (const link of document.querySelectorAll('#facts a.nt-plink'))
      if (titles.includes(text(link))) (link.closest('li') ?? link).remove();
    for (const item of document.querySelectorAll('.n-tl__item'))
      if (titles.includes(text(item.querySelector('.n-tl__title'))))
        item.remove();
  }, mentorExtraEvents);
  const rows = await manager.evaluate(
    (dims) =>
      [...document.querySelectorAll('.n-spectrum__row')]
        .filter((row) =>
          dims.includes((row.getAttribute('aria-label') ?? '').split('，')[0]),
        )
        .map((row) => row.outerHTML),
    swapped,
  );
  await prototype.evaluate((html) => {
    const count = (label: string | null) =>
      Number(/，(\d+) 条事件/.exec(label ?? '')?.[1] ?? 0);
    let added = 0;
    for (const markup of html) {
      const holder = document.createElement('div');
      holder.innerHTML = markup;
      const next = holder.firstElementChild!;
      const dim = (next.getAttribute('aria-label') ?? '').split('，')[0];
      const current = [...document.querySelectorAll('.n-spectrum__row')].find(
        (row) => (row.getAttribute('aria-label') ?? '').split('，')[0] === dim,
      );
      if (!current) continue;
      added +=
        count(next.getAttribute('aria-label')) -
        count(current.getAttribute('aria-label'));
      current.replaceWith(next);
    }
    // 能力谱标题的「已确认 N 条事件分」同样加上这条事件带来的分。
    const spectrum = document.querySelector('#spectrum');
    const walker = spectrum
      ? document.createTreeWalker(spectrum, NodeFilter.SHOW_TEXT)
      : null;
    for (let node = walker?.nextNode(); node; node = walker!.nextNode())
      if (/已确认 \d+ 条事件分/.test(node.textContent ?? ''))
        node.textContent = (node.textContent ?? '').replace(
          /已确认 (\d+) 条事件分/,
          (_, n: string) => `已确认 ${Number(n) + added} 条事件分`,
        );
  }, rows);
}

type TextSlots = {
  /** 头部两行身份 */
  meta: string[];
  /** 能力谱第一个分组标题（专业度） */
  group: string | null;
  /** 时间线条目：标题 → 日期、去掉来源徽标后的说明行、是否管理受限 */
  items: Record<
    string,
    { date: string; meta: string; restricted: boolean; sourceCite: boolean }
  >;
};

/** 两侧都按同一规则取：映射表登记过、只差文字的几处。 */
function textSlots(): TextSlots {
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const items: TextSlots['items'] = {};
  for (const item of document.querySelectorAll('.n-tl__item')) {
    const meta = item.querySelector('.n-tl__meta');
    const copy = meta?.cloneNode(true) as Element | undefined;
    for (const node of copy?.querySelectorAll('.n-src, .n-badge, .n-cite') ??
      [])
      node.remove();
    items[text(item.querySelector('.n-tl__title'))] = {
      date: text(item.querySelector('.n-tl__date')),
      meta: text(copy ?? null),
      restricted: !!meta?.querySelector('.n-badge:has(use[href="#i-lock"])'),
      // 自述与历史资料（含受限）在位置后加的原文角标；管理观察不在登记范围里。
      sourceCite:
        !!item.querySelector('.n-tl__dot.is-hist, .n-tl__dot.is-self') &&
        !!meta?.querySelector('.n-cite'),
    };
  }
  return {
    meta: [...document.querySelectorAll('.n-person__meta')].map(text),
    group: text(document.querySelector('.n-spectrum__group')) || null,
    items,
  };
}

/**
 * 映射表 BOW-840「与原型的已知差异」里只差文字的几处：先按登记的写法断言工程侧，再把原型
 * 的文字搬到工程侧同一位置，让截图继续比版面和其余内容。不在登记范围里的不同不搬，留给
 * 截图报出来。返回不符合登记写法的条目。
 */
export async function alignRegisteredText(prototype: Page, page: Page) {
  const [left, right] = [
    await prototype.evaluate(textSlots),
    await page.evaluate(textSlots),
  ];
  const gaps: string[] = [];
  const copy: {
    meta: number[];
    group: boolean;
    dates: string[];
    metas: string[];
  } = { meta: [], group: false, dates: [], metas: [] };
  // 身份行：职位、职级、多级团队路径等 834 的字段接入（#315 之后的下一片）。工程侧第一行
  // 的每一段都要出现在原型第一行里，或是占位「职位未接入」「组织层级未接入」。
  const segments = (line: string) => line.split(' · ');
  if (left.meta[0] !== right.meta[0]) {
    const unknown = segments(right.meta[0] ?? '').filter(
      (part) =>
        !/^(职位|组织层级)未接入$/.test(part) &&
        !segments(left.meta[0] ?? '').includes(part),
    );
    if (unknown.length) gaps.push(`identity: ${right.meta[0]}`);
    else copy.meta.push(0);
  }
  // 第二行：导师栏只列导师，助教下一片接入。去掉「导师 …」后相等，工程列出的导师都在原型里。
  if (left.meta[1] !== right.meta[1]) {
    const split = (line = '') => {
      const [head, mentors = ''] = line.split(' · 导师 ');
      return { head, mentors: mentors.split('、').filter(Boolean) };
    };
    const [l, r] = [split(left.meta[1]), split(right.meta[1])];
    if (
      l.head !== r.head ||
      !r.mentors.length ||
      r.mentors.some((name) => !l.mentors.includes(name))
    )
      gaps.push(`mentors: ${right.meta[1]}`);
    else copy.meta.push(1);
  }
  // 专业度分组标题：职级为空时不写「（对标 …）」。
  if (left.group !== right.group) {
    if (left.group?.replace(/（对标 [^）]+）$/, '') === right.group)
      copy.group = true;
    else gaps.push(`group: ${right.group}`);
  }
  for (const [title, mine] of Object.entries(right.items)) {
    const theirs = left.items[title];
    if (!theirs) continue;
    // 受限历史资料：原型写半年度，工程写 MM-DD；两侧都要标管理受限。
    if (theirs.date !== mine.date) {
      if (
        theirs.restricted &&
        mine.restricted &&
        /^H[12]$/.test(theirs.date) &&
        /^\d\d-\d\d$/.test(mine.date)
      )
        copy.dates.push(title);
      else gaps.push(`date: ${mine.date} ${title}`);
    }
    // 单一来源的关键事件不写来源名称：去掉原型说明行里的「来源名 · 」后相等。
    // 自述与历史资料在位置后另加原文角标：去掉徽标和角标后说明相等，就搬原型那一行。
    if (theirs.meta !== mine.meta) {
      const [who, , ...rest] = theirs.meta.split(' · ');
      if (
        !theirs.meta.includes('个来源') &&
        [who, ...rest].join(' · ') === mine.meta
      )
        copy.metas.push(title);
      else gaps.push(`meta: ${title}: ${mine.meta}`);
    } else if (mine.sourceCite && !theirs.sourceCite) copy.metas.push(title);
  }
  const nodes = await prototype.evaluate((plan) => {
    const text = (node: Element | null) =>
      (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const item = (title: string) =>
      [...document.querySelectorAll('.n-tl__item')].find(
        (node) => text(node.querySelector('.n-tl__title')) === title,
      );
    return {
      meta: plan.meta.map(
        (index) =>
          document.querySelectorAll('.n-person__meta')[index].innerHTML,
      ),
      group: plan.group
        ? document.querySelector('.n-spectrum__group')!.innerHTML
        : null,
      dates: plan.dates.map(
        (title) => item(title)!.querySelector('.n-tl__date')!.innerHTML,
      ),
      metas: plan.metas.map(
        (title) => item(title)!.querySelector('.n-tl__meta')!.innerHTML,
      ),
    };
  }, copy);
  await page.evaluate(
    ({ plan, html }) => {
      const text = (node: Element | null) =>
        (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const item = (title: string) =>
        [...document.querySelectorAll('.n-tl__item')].find(
          (node) => text(node.querySelector('.n-tl__title')) === title,
        );
      plan.meta.forEach((index, at) => {
        document.querySelectorAll('.n-person__meta')[index].innerHTML =
          html.meta[at];
      });
      if (html.group)
        document.querySelector('.n-spectrum__group')!.innerHTML = html.group;
      plan.dates.forEach((title, at) => {
        item(title)!.querySelector('.n-tl__date')!.innerHTML = html.dates[at];
      });
      plan.metas.forEach((title, at) => {
        item(title)!.querySelector('.n-tl__meta')!.innerHTML = html.metas[at];
      });
    },
    { plan: copy, html: nodes },
  );
  return gaps;
}

/** 数据相等闸：像素比较前先比这些文字，不相等就报数据差异，不再比截图。 */
export async function personFacts(page: Page) {
  return page.evaluate(collect, null);
}
