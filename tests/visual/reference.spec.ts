import { test, expect, login, type DemoRole } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import { componentSamples } from './component-samples';
import { compare, compareElements, matchingMasks, stabilize } from './compare';
for (const role of ['ceo', 'hrbp', 'mentor'] satisfies DemoRole[]) {
  for (const [viewportName, viewport] of [
    ['desktop', referenceConfig.desktop],
    ['mobile-width', referenceConfig.mobile],
  ] as const) {
    test(`${role} shell and project list at ${viewportName}`, async ({
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
          `${server.url}/prototype/y/app/projects.html?as=${role}`,
        );
        await page.goto('/projects');
        await expect(prototype.locator('.n-project')).not.toHaveCount(0);
        await expect(page.locator('.n-project')).not.toHaveCount(0);
        expect(
          await page.locator('.n-project__name').allTextContents(),
          'data/order mismatch, screenshot comparison intentionally stopped',
        ).toEqual(
          await prototype.locator('.n-project__name').allTextContents(),
        );
        expect(
          await page.locator('.n-project__goal').allTextContents(),
          'goal mismatch',
        ).toEqual(
          await prototype.locator('.n-project__goal').allTextContents(),
        );
        await stabilize(prototype);
        await stabilize(page);
        await matchingMasks(prototype, page);
        await compare(
          await prototype.screenshot({
            animations: 'disabled',
            fullPage: true,
          }),
          await page.screenshot({ animations: 'disabled', fullPage: true }),
          testInfo,
          `${role}-${viewportName}`,
        );
      } finally {
        await referenceContext.close();
        await server.close();
      }
    });
  }
}
test('new project dialog matches the current prototype render', async ({
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
    await prototype.goto(`${server.url}/prototype/y/app/projects.html?as=ceo`);
    await page.goto('/projects');
    await prototype.getByRole('button', { name: '新建项目' }).click();
    await page.getByRole('button', { name: '新建项目' }).click();
    expect(
      await page.locator('[name="ownerId"] option').allTextContents(),
      'eligible-person data mismatch',
    ).toEqual(await prototype.locator('#np-owner option').allTextContents());
    expect(
      await page.locator('.n-dialog .n-check').allTextContents(),
      'member labels and project load mismatch',
    ).toEqual(await prototype.locator('.n-dialog .n-check').allTextContents());
    await stabilize(prototype);
    await stabilize(page);
    const prototypeGeometry = await prototype
      .locator('.n-dialog')
      .boundingBox();
    const engineeringGeometry = await page.getByRole('dialog').boundingBox();
    await testInfo.attach('new-project-dialog-geometry', {
      contentType: 'application/json',
      body: JSON.stringify({
        prototype: prototypeGeometry,
        engineering: engineeringGeometry,
      }),
    });
    expect
      .soft(
        {
          width: engineeringGeometry?.width,
          height: engineeringGeometry?.height,
        },
        'dialog natural CSS geometry',
      )
      .toEqual({
        width: prototypeGeometry?.width,
        height: prototypeGeometry?.height,
      });
    await compare(
      await prototype
        .locator('.n-dialog')
        .screenshot({ animations: 'disabled' }),
      await page.getByRole('dialog').screenshot({ animations: 'disabled' }),
      testInfo,
      'new-project-dialog',
    );
  } finally {
    await referenceContext.close();
    await server.close();
  }
});
for (const sample of componentSamples) {
  test(`ported component ${sample.name} matches design-system controls`, async ({
    browser,
    page,
  }, testInfo) => {
    const server = await startPrototypeServer();
    const referenceContext = await browser.newContext({
      viewport: referenceConfig.desktop,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    });
    try {
      const prototype = await referenceContext.newPage();
      await prototype.goto(`${server.url}/prototype/y/design-system.html`);
      await page.goto('/dev/design-system');
      await stabilize(prototype);
      await stabilize(page);
      await compareElements(
        prototype.locator(sample.reference),
        page.locator(sample.actual),
        testInfo,
        sample.name,
      );
    } finally {
      await referenceContext.close();
      await server.close();
    }
  });
}
