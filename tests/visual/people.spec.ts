import { test, expect, login, type DemoRole } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import { compare, matchingMasks, normalizeRegions, stabilize } from './compare';

/**
 * BOW-839 人才列表。原型的「重点跟踪」「值得聊一聊」页签和页头操作不在本卡范围，
 * 只从原型一侧去掉；行右侧的位置徽标（原型有正式位置与导师周评，契约只有参考位置）
 * 两侧都去掉，图例说明两侧遮罩。差异登记在 docs/reference-route-map.md。
 */
for (const role of ['ceo', 'hrbp', 'mentor'] satisfies DemoRole[])
  for (const [viewportName, viewport] of [
    ['desktop', referenceConfig.desktop],
    ['mobile-width', referenceConfig.mobile],
  ] as const)
    test(`${role} people list at ${viewportName}`, async ({
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
          `${server.url}/prototype/y/app/people.html?as=${role}`,
        );
        await page.goto('/people');
        await expect(page.locator('#plist .n-person-row')).not.toHaveCount(0);
        expect(
          await page.locator('#plist .n-person__name').allTextContents(),
          'data/order mismatch, screenshot comparison intentionally stopped',
        ).toEqual(
          await prototype.locator('#pp-list .n-person__name').allTextContents(),
        );
        await page.evaluate(() => {
          for (const node of document.querySelectorAll<HTMLElement>(
            '.n-person-row > :nth-child(2)',
          ))
            node.style.setProperty('display', 'none', 'important');
        });
        await normalizeRegions(prototype, page, {
          omit: [
            '#ptabs [role="tab"]:not(:first-child)',
            '.nt-head__acts',
            // The row's right column differs by contract (formal position and the
            // mentor's weekly review are not in the read); taken out on both sides
            // so the rows wrap the same way at phone width.
            '.n-person-row > :nth-child(2)',
          ],
          // Team parent path, job title and level have no columns yet (BOW-834
          // S1 / S2): same-size placeholders on both sides.
          replace: ['.n-tabpanel .nt-h2', '.n-tabpanel .n-person__meta'],
        });
        // Avatar photos lazy-load below the fold; a lazy image never decodes until it
        // is scrolled to, so the full-page capture loads them all first.
        await page.evaluate(() => {
          for (const image of document.images) image.loading = 'eager';
        });
        await stabilize(prototype);
        await stabilize(page);
        await matchingMasks(prototype, page, ['.nt-caption']);
        await compare(
          await prototype.screenshot({
            animations: 'disabled',
            fullPage: true,
          }),
          await page.screenshot({ animations: 'disabled', fullPage: true }),
          testInfo,
          `people-${role}-${viewportName}`,
        );
      } finally {
        await referenceContext.close();
        await server.close();
      }
    });
