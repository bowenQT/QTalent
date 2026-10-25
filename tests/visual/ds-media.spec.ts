import type { Browser, Locator, Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import { compareElements, stabilize } from './compare';

// 样张与设计系统页 #c-desk 的「上传材料」「记录事件的附件」「进行中的任务」逐项对比。
// 选择器与对应关系写在本文件，不放进共用的 component-samples。
const desk = '#c-desk';
const staticSamples = [
  {
    name: 'media-drop',
    reference: `${desk} #drop`,
    actual: '[data-sample="drop"] .n-drop',
  },
  {
    name: 'media-files',
    reference: `${desk} #files`,
    actual: '[data-sample="files"] .n-files',
  },
  {
    name: 'media-attach',
    reference: `${desk} .n-files.n-attach`,
    actual: '[data-sample="attach"] .n-files',
  },
  ...(
    [
      'uploading',
      'queued',
      'transcribing',
      'shaping',
      'partial',
      'done',
      'failed',
    ] as const
  ).map((state) => ({
    name: `media-task-${state}`,
    reference: `${desk} #tasks .n-task[data-state="${state}"]`,
    actual: `[data-sample="tasks"] .n-task[data-state="${state}"]`,
  })),
] as const;

async function openPair(browser: Browser, page: Page) {
  const server = await startPrototypeServer();
  const referenceContext = await browser.newContext({
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  });
  const prototype = await referenceContext.newPage();
  await prototype.goto(`${server.url}/prototype/y/design-system.html`);
  await page.goto('/dev/design-system/media');
  await stabilize(prototype);
  await stabilize(page);
  return {
    prototype,
    close: async () => {
      await referenceContext.close();
      await server.close();
    },
  };
}

test('upload and long-task samples match the design-system desk section', async ({
  browser,
  page,
}, testInfo) => {
  const { prototype, close } = await openPair(browser, page);
  try {
    for (const sample of staticSamples) {
      const reference = prototype.locator(sample.reference);
      const actual = page.locator(sample.actual);
      await expect(reference, `${sample.name} reference selector`).toHaveCount(
        1,
      );
      await expect(actual, `${sample.name} sample selector`).toHaveCount(1);
      // 文字不一致就不必比像素：先说明是数据或文案对不上。
      expect(await actual.innerText(), `${sample.name} text mismatch`).toBe(
        await reference.innerText(),
      );
      await compareElements(reference, actual, testInfo, sample.name);
    }
  } finally {
    await close();
  }
});

const dropRest = (locator: Locator) =>
  locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderTopColor,
      background: style.backgroundColor,
      shadow: style.boxShadow,
    };
  });

for (const [name, engage] of [
  [
    'hover',
    async (locator: Locator) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.hover();
    },
  ],
  [
    'focus',
    async (locator: Locator) => {
      await locator.scrollIntoViewIfNeeded();
      await locator.focus();
    },
  ],
  [
    'drag-over',
    async (locator: Locator, side: 'prototype' | 'engineering') => {
      // 设计系统页的上传区没有拖入脚本；工作台的原型脚本拖入时只是加上 is-over。
      // 工程一侧用真实的拖入事件触发组件自己的处理。
      if (side === 'prototype') {
        await locator.evaluate((element) => element.classList.add('is-over'));
        return;
      }
      await locator.evaluate((element) => {
        const data = new DataTransfer();
        data.items.add(new File(['x'], '拖入的文件.txt'));
        element.dispatchEvent(
          new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
          }),
        );
      });
    },
  ],
] as const) {
  test(`upload zone ${name} look matches the design-system prototype`, async ({
    browser,
    page,
  }, testInfo) => {
    const { prototype, close } = await openPair(browser, page);
    try {
      const reference = prototype.locator(`${desk} #drop`);
      const actual = page.locator('[data-sample="drop"] .n-drop');
      const resting = await dropRest(actual);
      await engage(reference, 'prototype');
      await engage(actual, 'engineering');
      // 确认状态真的生效，而且和静止时不同；否则两边一起落回静止外观也会「相同」。
      const [referenceLook, actualLook] = [
        await dropRest(reference),
        await dropRest(actual),
      ];
      expect(actualLook, `${name} look is engaged`).not.toEqual(resting);
      expect(actualLook, `${name} look equals prototype`).toEqual(
        referenceLook,
      );
      await compareElements(reference, actual, testInfo, `media-drop-${name}`);
      if (name === 'hover') {
        expect(await reference.evaluate((e) => e.matches(':hover'))).toBe(true);
        expect(await actual.evaluate((e) => e.matches(':hover'))).toBe(true);
      }
      if (name === 'focus') {
        expect(await actual.evaluate((e) => e.matches(':focus-visible'))).toBe(
          true,
        );
      }
      if (name === 'drag-over')
        expect(
          await actual.evaluate((e) => e.classList.contains('is-over')),
        ).toBe(true);
    } finally {
      await close();
    }
  });
}

test('reduced motion freezes the indeterminate bar and keeps the text state', async ({
  browser,
  referenceApp,
}) => {
  const bar =
    '[data-sample="tasks"] .n-task[data-state="transcribing"] .n-progress i';
  const animationNames: Record<string, string> = {};
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    const context = await browser.newContext({
      baseURL: referenceApp.baseURL,
      locale: 'zh-CN',
      reducedMotion,
    });
    try {
      const page = await context.newPage();
      await page.goto('/dev/design-system/media');
      const fill = page.locator(bar);
      animationNames[reducedMotion] = await fill.evaluate(
        (element) => getComputedStyle(element).animationName,
      );
      await expect(
        page.locator(
          '[data-sample="tasks"] .n-task[data-state="transcribing"] [role="progressbar"]',
        ),
      ).toHaveAttribute('aria-valuetext', '处理中');
      await expect(
        page.locator(
          '[data-sample="tasks"] .n-task[data-state="transcribing"] .n-task__state',
        ),
      ).toHaveText('转写中 · 正在区分说话人');
    } finally {
      await context.close();
    }
  }
  expect(animationNames.reduce).toBe('none');
  expect(animationNames['no-preference']).not.toBe('none');
});
