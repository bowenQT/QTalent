import { test, expect, login, type DemoRole } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import {
  compare,
  compareElements,
  matchingMasks,
  normalizeRegions,
  stabilize,
} from './compare';
import {
  eventCardFacts,
  hideGroupHistory,
  mentorSubsetGaps,
  personAppOnly,
  personEventCardMask,
  personFacts,
  personMask,
  personOmit,
  personReplace,
  trimToVisible,
} from './person-regions';

const SAMPLE = 'p-x07';

for (const role of ['ceo', 'hrbp', 'mentor'] satisfies DemoRole[]) {
  for (const [viewportName, viewport] of [
    ['desktop', referenceConfig.desktop],
    ['mobile-width', referenceConfig.mobile],
  ] as const) {
    test(`${role} person profile at ${viewportName}`, async ({
      browser,
      page,
      context,
      referenceApp,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await login(context, role, referenceApp.baseURL);
      const server = await startPrototypeServer();
      const referenceContext = await browser.newContext({
        viewport,
        locale: 'zh-CN',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      try {
        const prototype = await referenceContext.newPage();
        await prototype.goto(
          `${server.url}/prototype/y/app/person.html?id=${SAMPLE}&as=${role}`,
        );
        await page.goto(`/person?id=${SAMPLE}`);
        await expect(prototype.locator('#timeline')).toBeVisible();
        await expect(page.locator('#timeline')).toBeVisible();
        await hideGroupHistory(prototype);
        const [left, right] = [
          await personFacts(prototype),
          await personFacts(page),
        ];
        const { projects: leftProjects, ...leftRest } = left;
        const { projects: rightProjects, ...rightRest } = right;
        const appHidden: string[] = [];
        const omitted: string[] = [];
        if (role === 'mentor') {
          // 导师只能读到授权后的子集（项目、事件、能力谱、时间线），逐条、按原型顺序。
          expect(
            mentorSubsetGaps(left, right),
            'data/order mismatch, screenshot comparison intentionally stopped',
          ).toEqual([]);
          // 原型侧裁到导师可见的条目再比截图；整张卡都看不到的，比空状态的语义。
          const emptied = await trimToVisible(prototype, left, right);
          if (emptied.facts) {
            await expect(page.locator('#facts a.nt-plink')).toHaveCount(0);
            await expect(page.locator('#facts .nt-empty')).toHaveText(
              '确认后的关键事件会出现在这里',
            );
            omitted.push('#facts');
            appHidden.push('#facts');
          }
          if (emptied.spectrum) {
            await expect(
              page.locator('#spectrum .n-spectrum__row'),
            ).toHaveCount(0);
            await expect(page.locator('#spectrum .nt-empty')).toHaveText(
              '确认后的事件分会出现在这里',
            );
            omitted.push('#spectrum');
            appHidden.push('#spectrum');
          }
        } else {
          expect(
            rightRest,
            'data/order mismatch, screenshot comparison intentionally stopped',
          ).toEqual(leftRest);
          expect(rightProjects, 'project mismatch').toEqual(leftProjects);
        }
        // 工程侧没有摘要（人工结论与 AI 推断都为空）时，原型摘要按 omit 处理。
        const summary = (await page.locator('#summary').count()) > 0;
        await normalizeRegions(prototype, page, {
          omit: summary
            ? [...personOmit, ...omitted]
            : [...personOmit, ...omitted, 'div:has(> #summary)', '#summary'],
          replace: summary ? personReplace : [],
        });
        await page.evaluate(
          (queries) => {
            for (const query of queries)
              for (const node of document.querySelectorAll<HTMLElement>(query))
                node.style.setProperty('display', 'none', 'important');
          },
          [...personAppOnly, ...appHidden],
        );
        await stabilize(prototype);
        await stabilize(page);
        await matchingMasks(prototype, page, personMask);
        await compare(
          await prototype.screenshot({
            animations: 'disabled',
            fullPage: true,
          }),
          await page.screenshot({ animations: 'disabled', fullPage: true }),
          testInfo,
          `person-${role}-${viewportName}`,
        );
      } finally {
        await referenceContext.close();
        await server.close();
      }
    });
  }
}

test('manager expanded event card matches the prototype', async ({
  browser,
  page,
  context,
  referenceApp,
}, testInfo) => {
  await login(context, 'ceo', referenceApp.baseURL);
  const server = await startPrototypeServer();
  const referenceContext = await browser.newContext({
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  });
  try {
    const prototype = await referenceContext.newPage();
    await prototype.goto(
      `${server.url}/prototype/y/app/person.html?id=${SAMPLE}&as=ceo`,
    );
    await page.goto(`/person?id=${SAMPLE}`);
    const open = (target: typeof page) =>
      target.locator('.nt-tl-open').first().click();
    await open(prototype);
    await open(page);
    await normalizeRegions(prototype, page, { omit: ['.n-tags'] });
    // 遮罩盖住的两处另外比：项目名（工程统一写「项目：」）、每行分数的维度、评分人与确认状态。
    const [expected, actual] = [
      await eventCardFacts(prototype),
      await eventCardFacts(page),
    ];
    expect(actual.project).toMatch(/^项目：./);
    expect(actual.project.replace(/^项目：/, '')).toBe(
      expected.project.replace(/^(课题|项目)：/, ''),
    );
    expect(actual.scores.length).toBeGreaterThan(0);
    expect(actual.scores).toEqual(expected.scores);
    for (const score of actual.scores.filter(
      (row) => row.state === 'confirmed',
    )) {
      expect(score.scorer, `${score.dimension} scorer`).not.toBe('');
      expect(score.note, `${score.dimension} status`).toBe(
        `${score.scorer}确认`,
      );
    }
    await stabilize(prototype);
    await stabilize(page);
    await compareElements(
      prototype.locator('.nt-tl-card:not([hidden]) .n-event').first(),
      page.locator('.nt-tl-card:not([hidden]) .n-event').first(),
      testInfo,
      'person-event-card',
      // 映射表 BOW-840「与原型的已知差异」：项目徽标写「项目：」（契约不区分课题与
      // 项目）；分数的出处与事件出处不同时，分数行另画角标。
      { mask: personEventCardMask },
    );
  } finally {
    await referenceContext.close();
    await server.close();
  }
});
