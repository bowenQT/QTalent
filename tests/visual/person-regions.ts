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

type Facts = Record<
  'name' | 'heads' | 'facts' | 'spectrum' | 'timeline' | 'projects',
  string[]
>;

/** 两侧按同一规则取各列表的条目文字（数据相等闸）。 */
function collect(): Facts {
  const text = (node: Element | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const all = (selector: string, key: (node: Element) => string) =>
    [...document.querySelectorAll(selector)].map(key);
  return {
    name: all('.n-person__name', text),
    // 能力谱「已确认 N 条事件分」和时间线标题的关键事件数。
    heads: [
      /已确认 \d+ 条事件分/.exec(
        text(document.querySelector('#spectrum')),
      )?.[0] ?? '',
      text(document.querySelector('#timeline .n-section-title small')),
    ],
    // 关键事实：链到的事件 ID 和标题。
    facts: all(
      '#facts a.nt-plink',
      (link) => `${link.getAttribute('href')} ${text(link)}`,
    ),
    spectrum: all(
      '.n-spectrum__row',
      (row) => row.getAttribute('aria-label') ?? text(row),
    ),
    // 日期和标题；受限历史资料的日期写法是已登记差异（原型写半年度），记作「受限」，
    // 「管理受限」徽标由 alignRegisteredText 的来源类型比较核对。
    timeline: all(
      '.n-tl__item:not(:has(.n-tl__dot.is-change))',
      (item) =>
        `${
          item.querySelector('.n-tl__meta .n-badge:has(use[href="#i-lock"])')
            ? '受限'
            : text(item.querySelector('.n-tl__date'))
        } ${text(item.querySelector('.n-tl__title'))}`,
    ),
    projects: all('.n-members b', text),
  };
}

/** 数据相等闸：像素比较前先比这些文字，不相等就报数据差异，不再比截图。 */
export async function personFacts(page: Page) {
  return page.evaluate(collect);
}

/**
 * 导师不可见登记表（#252 评论 6580683682 ①）：原型导师视角有、工程导师按现行权限看不到的
 * 条目，逐条写明依据的权限规则。原型侧先按这张表删掉，再和工程逐条全等比较；工程漏画或
 * 多画任何未登记的条目，比较都会失败。key：projects 为项目名，facts、timeline 为事件 ID。
 */
export const mentorHidden: readonly {
  list: 'projects' | 'facts' | 'timeline';
  key: string;
  rule: string;
}[] = [
  {
    list: 'projects',
    key: '夏季黑客松 · 语音助手赛道（演示）',
    rule: '档案只列调用者可读的项目（person-projection.ts projectsOf → authz canReadProject，projects.read）；demo-mentor 不在这个项目的读取范围。原型 projectsOf(pid, true) 不按视角过滤',
  },
];

/**
 * 导师多看到的已登记事件（#341「影响」）：服务端按评价关系授权，没有按记录人过滤，
 * demo-mentor 看得到这条黑客松评委记录，原型导师视角看不到。预期写法取原型管理者视角对
 * 同一事件的渲染；能力谱只放过这条事件打分的维度（原型 91b297a `data.js:108`：prof、mot），
 * 其余维度仍按原型导师视角全等比较。
 */
export const mentorExtra = {
  id: 'e-hack-2',
  dimensions: ['专业度', '内生动力'],
};

/**
 * 按登记表把原型导师视角改成预期：删掉登记的不可见条目；把 mentorExtra 按原型管理者视角的
 * 渲染插进关键事实（再按原型规则只留前 3 条，`person.js:42`）和时间线，同位置；能力谱换上
 * 管理者视角里这条事件涉及的维度行，「已确认 N 条事件分」和时间线关键事件数随之加上。
 * 只动原型侧，工程侧不改；返回登记表和原型对不上的地方。
 */
export async function applyMentorRegistry(prototype: Page, manager: Page) {
  const extra = await manager.evaluate(({ id, dimensions }) => {
    const dim = (row: Element) =>
      (row.getAttribute('aria-label') ?? '').split('，')[0];
    const facts = [...document.querySelectorAll('#facts a.nt-plink')];
    const fact = facts.find(
      (link) => link.getAttribute('href') === `#ev-${id}`,
    );
    return {
      fact: fact?.closest('li')?.outerHTML ?? null,
      factOrder: facts.map((link) => link.getAttribute('href') ?? ''),
      item: document.getElementById(`ev-${id}`)?.outerHTML ?? null,
      itemOrder: [...document.querySelectorAll('.n-tl__item[id]')].map(
        (item) => item.id,
      ),
      rows: [...document.querySelectorAll('.n-spectrum__row')]
        .filter((row) => dimensions.includes(dim(row)))
        .map((row) => row.outerHTML),
    };
  }, mentorExtra);
  return prototype.evaluate(
    ({ hidden, id, dimensions, extra }) => {
      const gaps: string[] = [];
      const text = (node: Element | null) =>
        (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parse = (markup: string) => {
        const holder = document.createElement('template');
        holder.innerHTML = markup;
        return holder.content.firstElementChild!;
      };
      const factOf = (href: string) =>
        document
          .querySelector(`#facts a.nt-plink[href="${href}"]`)
          ?.closest('li') ?? null;
      // 插到管理者视角里它后面第一条、导师视角也有的条目之前。
      const place = (
        markup: string | null,
        order: string[],
        key: string,
        find: (key: string) => Element | null,
        label: string,
      ) => {
        if (!markup)
          return gaps.push(`extra ${label}: not in the manager view`);
        if (find(key))
          return gaps.push(
            `extra ${label}: already in the prototype mentor view`,
          );
        const next = order
          .slice(order.indexOf(key) + 1)
          .map(find)
          .find((node) => node !== null);
        if (!next)
          return gaps.push(
            `extra ${label}: no anchor in the prototype mentor view`,
          );
        next.before(parse(markup));
      };
      place(extra.fact, extra.factOrder, `#ev-${id}`, factOf, 'fact');
      for (const li of [...document.querySelectorAll('#facts li')].slice(3))
        li.remove();
      place(
        extra.item,
        extra.itemOrder,
        `ev-${id}`,
        (key) => document.getElementById(key),
        'timeline',
      );
      const count = document.querySelector('#timeline .n-section-title small');
      if (count)
        count.textContent = (count.textContent ?? '').replace(/^\d+/, (n) =>
          String(Number(n) + 1),
        );
      const dim = (label: string | null) => (label ?? '').split('，')[0];
      const events = (label: string | null) =>
        Number(/，(\d+) 条事件/.exec(label ?? '')?.[1] ?? 0);
      let added = 0;
      for (const dimension of dimensions) {
        const markup = extra.rows.find((row) =>
          dim(parse(row).getAttribute('aria-label')).startsWith(dimension),
        );
        const current = [...document.querySelectorAll('.n-spectrum__row')].find(
          (row) => dim(row.getAttribute('aria-label')) === dimension,
        );
        if (!markup || !current) {
          gaps.push(`extra spectrum ${dimension}: row missing`);
          continue;
        }
        const next = parse(markup);
        if (dim(next.getAttribute('aria-label')) !== dimension) {
          gaps.push(`extra spectrum ${dimension}: row missing`);
          continue;
        }
        added +=
          events(next.getAttribute('aria-label')) -
          events(current.getAttribute('aria-label'));
        current.replaceWith(next);
      }
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
      // 登记表在补上多看到的事件之后再删，补进来的条目同样按登记表处理。
      for (const entry of hidden) {
        const nodes =
          entry.list === 'projects'
            ? [...document.querySelectorAll('.n-members li')].filter(
                (li) => text(li.querySelector('b')) === entry.key,
              )
            : entry.list === 'facts'
              ? [factOf(`#ev-${entry.key}`)]
              : [document.getElementById(`ev-${entry.key}`)];
        const found = nodes.filter((node) => node !== null);
        if (found.length !== 1)
          gaps.push(
            `hidden ${entry.list} ${entry.key}: ${found.length} in the prototype mentor view`,
          );
        for (const node of found) node.remove();
        // 同一条规则：不可读项目的名称也不出现在关键事实和时间线的说明里（person-evidence.ts
        // 只给可读项目）。
        if (entry.list === 'projects')
          for (const root of document.querySelectorAll('#facts, #timeline')) {
            const walker = document.createTreeWalker(
              root,
              NodeFilter.SHOW_TEXT,
            );
            for (let node = walker.nextNode(); node; node = walker.nextNode())
              node.textContent = (node.textContent ?? '')
                .split(` · ${entry.key}`)
                .join('')
                .split(`${entry.key} · `)
                .join('');
          }
      }
      return gaps;
    },
    { hidden: mentorHidden, ...mentorExtra, extra },
  );
}

type TextSlots = {
  /** 头部两行身份 */
  meta: string[];
  /** 能力谱第一个分组标题（专业度） */
  group: string | null;
  /** 时间线条目：标题 → 日期、来源类型、说明行文字、是否带原文角标 */
  items: Record<
    string,
    {
      date: string;
      hist: boolean;
      /** 说明行里的来源类型与标注（`.n-src`、`.n-badge`），按出现顺序，含样式类 */
      kinds: string[];
      /** 去掉来源类型、标注和原文角标后的说明文字 */
      meta: string;
      cite: boolean;
    }
  >;
};

/** 两侧都按同一规则取：映射表登记过、只差文字的几处。 */
function textSlots(): TextSlots {
  const text = (node: Node | null) =>
    (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const isCite = (node: Node) =>
    node instanceof Element &&
    (node.matches('.n-cite') || !!node.querySelector('.n-cite'));
  const isKind = (node: Node) =>
    node instanceof Element && node.matches('.n-src, .n-badge');
  const items: TextSlots['items'] = {};
  for (const item of document.querySelectorAll('.n-tl__item')) {
    const nodes = [...(item.querySelector('.n-tl__meta')?.childNodes ?? [])];
    items[text(item.querySelector('.n-tl__title'))] = {
      date: text(item.querySelector('.n-tl__date')),
      hist: !!item.querySelector('.n-tl__dot.is-hist, .n-tl__dot.is-self'),
      kinds: nodes
        .filter(isKind)
        .map(
          (node) =>
            `${[...(node as Element).classList].join('.')} ${text(node)}`,
        ),
      meta: nodes
        .filter(
          (node) =>
            node.nodeType !== Node.COMMENT_NODE &&
            !isKind(node) &&
            !isCite(node),
        )
        .map((node) => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
      cite: nodes.some(isCite),
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
 * 的文字搬到工程侧同一位置，让截图继续比版面和其余内容。来源类型与标注（`.n-src`、
 * `.n-badge`）逐条和原型比，不搬、不遮；时间线说明行只换来源类型以外的文字。不在登记
 * 范围里的不同不搬，留给截图报出来。返回不符合登记写法的条目。
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
    texts: string[];
    cites: string[];
  } = { meta: [], group: false, dates: [], texts: [], cites: [] };
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
    if (!theirs) {
      gaps.push(`item not in prototype: ${title}`);
      continue;
    }
    // 来源类型（原始事实、本人自述、管理观察、AI 推断、人工结论）和「管理受限」等标注：
    // 逐条全等，不在登记范围里。
    if (mine.kinds.join('|') !== theirs.kinds.join('|'))
      gaps.push(`source kind: ${title}: ${mine.kinds.join('、')}`);
    // 受限历史资料：原型写半年度，工程写 MM-DD；两侧都要标管理受限。
    if (theirs.date !== mine.date) {
      const restricted = (kinds: string[]) =>
        kinds.some((kind) => kind.endsWith(' 管理受限'));
      if (
        restricted(theirs.kinds) &&
        restricted(mine.kinds) &&
        /^H[12]$/.test(theirs.date) &&
        /^\d\d-\d\d$/.test(mine.date)
      )
        copy.dates.push(title);
      else gaps.push(`date: ${mine.date} ${title}`);
    }
    // 单一来源的关键事件不写来源名称：去掉原型说明文字里的「来源名 · 」后相等。
    if (theirs.meta !== mine.meta) {
      const [who, , ...rest] = theirs.meta.split(' · ');
      if (
        !theirs.meta.includes('个来源') &&
        [who, ...rest].join(' · ') === mine.meta
      )
        copy.texts.push(title);
      else gaps.push(`meta: ${title}: ${mine.meta}`);
    }
    // 自述与历史资料在说明后另加原文角标（工程独有）；别的条目多出角标不放过。
    if (mine.cite && !theirs.cite) {
      if (mine.hist) copy.cites.push(title);
      else gaps.push(`cite: ${title}`);
    }
  }
  const nodes = await prototype.evaluate((plan) => {
    const text = (node: Node | null) =>
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
        (title) => item(title)!.querySelector('.n-tl__date')!.textContent ?? '',
      ),
      // 只取来源类型、标注以外的节点（文字和 `<b>`），来源类型留工程自己的。
      texts: plan.texts.map((title) =>
        [...item(title)!.querySelector('.n-tl__meta')!.childNodes]
          .filter(
            (node) =>
              !(node instanceof Element && node.matches('.n-src, .n-badge')),
          )
          .map((node) =>
            node instanceof Element
              ? node.outerHTML
              : (node.textContent ?? '')
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;'),
          )
          .join(''),
      ),
    };
  }, copy);
  await page.evaluate(
    ({ plan, html }) => {
      const text = (node: Node | null) =>
        (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const item = (title: string) =>
        [...document.querySelectorAll('.n-tl__item')].find(
          (node) => text(node.querySelector('.n-tl__title')) === title,
        )!;
      const isCite = (node: Node) =>
        node instanceof Element &&
        (node.matches('.n-cite') || !!node.querySelector('.n-cite'));
      plan.meta.forEach((index, at) => {
        document.querySelectorAll('.n-person__meta')[index].innerHTML =
          html.meta[at];
      });
      if (html.group)
        document.querySelector('.n-spectrum__group')!.innerHTML = html.group;
      plan.dates.forEach((title, at) => {
        item(title).querySelector('.n-tl__date')!.textContent = html.dates[at];
      });
      for (const title of plan.cites)
        for (const node of [
          ...item(title).querySelector('.n-tl__meta')!.childNodes,
        ])
          if (isCite(node)) node.remove();
      plan.texts.forEach((title, at) => {
        const meta = item(title).querySelector('.n-tl__meta')!;
        const keep = [...meta.childNodes].filter(
          (node) =>
            node instanceof Element &&
            (node.matches('.n-src, .n-badge') || isCite(node)),
        );
        const holder = document.createElement('template');
        holder.innerHTML = html.texts[at];
        const kinds = keep.filter((node) => !isCite(node));
        meta.replaceChildren(
          ...kinds,
          ...holder.content.childNodes,
          ...keep.filter(isCite),
        );
      });
    },
    { plan: copy, html: nodes },
  );
  return gaps;
}
