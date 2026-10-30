import type { Browser, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import { compare, compareElements, stabilize } from './compare';

/**
 * BOW-831 通用组件与原型设计系统页的逐项对照。
 * reference 在 prototype/y/design-system.html 里选，actual 在 /dev/design-system/general 里选；
 * 同一个选择器必须只命中一个元素（Playwright 的 locator 严格模式会拦住多命中），
 * 原型里本来就有多个同类元素时用 nth 指明取第几个。
 * 阈值全部来自 reference-config，不新增遮罩。
 */
type Sample = {
  name: string;
  reference: string;
  actual: string;
  nth?: number;
};

const badges: Sample[] = [
  {
    name: 'badge-yes',
    reference: '.state-table .n-badge--yes',
    actual: '[data-sample="badge-yes"]',
  },
  {
    name: 'badge-no',
    reference: '.state-table .n-badge--no',
    actual: '[data-sample="badge-no"]',
  },
  {
    name: 'badge-unknown',
    reference: '.state-table .n-badge--unknown',
    actual: '[data-sample="badge-unknown"]',
  },
  {
    name: 'badge-conflict',
    reference: '.state-table .n-badge--conflict',
    actual: '[data-sample="badge-conflict"]',
  },
  {
    name: 'badge-ai',
    reference: '#c-desk .n-todo .n-badge--ai',
    actual: '[data-sample="badge-ai"]',
    nth: 0,
  },
  {
    name: 'badge-seal',
    reference: '#c-desk .n-todo .n-badge--seal',
    actual: '[data-sample="badge-seal"]',
    nth: 0,
  },
  {
    name: 'badge-preset',
    reference: '#tasks .n-badge--preset',
    actual: '[data-sample="badge-preset"]',
  },
  {
    name: 'badge-demo',
    reference: '#c-shell .n-person__name .n-badge--demo',
    actual: '[data-sample="badge-demo"]',
  },
  {
    name: 'badge-recal',
    reference: '.n-badge--recal',
    actual: '[data-sample="badge-recal"]',
    nth: 0,
  },
];
const controls: Sample[] = [
  {
    name: 'select-field',
    reference: '#c-controls label.n-field:has(select)',
    actual: '[data-sample="select"] .n-field',
    nth: 0,
  },
  {
    name: 'textarea-error',
    reference: '#c-controls label.n-field.is-error',
    actual: '[data-sample="textarea-error"] .n-field',
  },
  {
    name: 'check',
    reference: '#c-controls .ds-stage > label.n-check',
    actual: '[data-sample="check"] .n-check',
  },
  {
    name: 'tabs',
    reference: '#tabs-demo',
    actual: '[data-sample="tabs"] [role="tablist"]',
  },
  {
    name: 'seg',
    reference: '#c-controls .n-seg.n-seg--md',
    actual: '[data-sample="seg"] .n-seg',
  },
  {
    name: 'chips',
    reference: '#chg-filter',
    actual: '[data-sample="chips"] .n-chips',
  },
];
const peekAndRows: Sample[] = [
  {
    name: 'peek',
    reference: '#c-desk .n-peek.is-demo',
    actual: '[data-sample="peek"] .n-peek',
  },
  {
    name: 'person-row',
    reference: '#c-project .n-person-row:nth-child(1)',
    actual: '[data-sample="person-rows"] .n-person-row:nth-child(1)',
  },
  {
    name: 'person-row-locked',
    reference: '#c-project .n-person-row:nth-child(4)',
    actual: '[data-sample="person-rows"] .n-person-row:nth-child(2)',
  },
];
const states: Sample[] = [1, 2, 3, 4].map((index) => ({
  name: `state-${index}`,
  reference: `#states > .n-state:nth-child(${index})`,
  actual: `[data-sample="states"] > .n-state:nth-child(${index})`,
}));
const failures: Sample[] = [
  {
    name: 'fail',
    reference: '#c-feedback .n-fail',
    actual: '[data-sample="fail"] .n-fail',
    nth: 0,
  },
];

/** 同一个视口里并排打开原型与工程样张，逐项比较。 */
async function openPair(browser: Browser, page: Page) {
  const server = await startPrototypeServer();
  const referenceContext = await browser.newContext({
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const prototype = await referenceContext.newPage();
  await prototype.goto(`${server.url}/prototype/y/design-system.html`);
  await page.goto('/dev/design-system/general');
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
async function compareSamples(
  prototype: Page,
  page: Page,
  samples: Sample[],
  testInfo: TestInfo,
) {
  for (const sample of samples) {
    const reference = prototype.locator(sample.reference);
    await compareElements(
      sample.nth === undefined ? reference : reference.nth(sample.nth),
      page.locator(sample.actual),
      testInfo,
      sample.name,
      { snap: true },
    );
  }
}

test('badges match the design-system state table and lists', async ({
  browser,
  page,
}, testInfo) => {
  const pair = await openPair(browser, page);
  try {
    await compareSamples(pair.prototype, page, badges, testInfo);
  } finally {
    await pair.close();
  }
});
test('form controls, tabs, segmented control and chips match the controls section', async ({
  browser,
  page,
}, testInfo) => {
  const pair = await openPair(browser, page);
  try {
    await compareSamples(pair.prototype, page, controls, testInfo);
  } finally {
    await pair.close();
  }
});
test('opened menu and both confirmation dialogs match the prototype', async ({
  browser,
  page,
}, testInfo) => {
  const pair = await openPair(browser, page);
  const { prototype } = pair;
  try {
    await prototype.locator('#menu-btn').click();
    await page.getByRole('button', { name: '更多操作' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    // 原型的菜单是绝对定位；compareElements 会把它改成 relative 挪进文档流。
    // 先自己改好，再取整布局坐标，两侧才在同一种布局下比较。
    await prototype.locator('#menu').evaluate((menu) => {
      Object.assign(menu.style, {
        position: 'relative',
        top: '0',
        right: 'auto',
      });
    });
    await compareElements(
      prototype.locator('#menu'),
      page.getByRole('menu'),
      testInfo,
      'menu',
      { snap: true },
    );
    await prototype.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    for (const [name, trigger, dialog] of [
      ['dialog-delete', 'open-delete', '#dlg-delete'],
      ['dialog-freeze', 'open-freeze', '#dlg-freeze'],
    ] as const) {
      await prototype
        .locator(`#c-controls .ds-row > button[data-open="${dialog.slice(1)}"]`)
        .click();
      await page.locator(`[data-sample="${trigger}"]`).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      // 模态弹窗是固定定位的居中元素：两侧用同一套居中公式，直接比整块截图，
      // 不经过 compareElements 的 relative 对齐（那会把固定定位改掉）。
      const expected = await prototype.locator(dialog).boundingBox();
      const received = await page.getByRole('dialog').boundingBox();
      expect
        .soft(
          { width: received?.width, height: received?.height },
          `${name} natural CSS geometry`,
        )
        .toEqual({ width: expected?.width, height: expected?.height });
      await compare(
        await prototype.locator(dialog).screenshot({ animations: 'disabled' }),
        await page.getByRole('dialog').screenshot({ animations: 'disabled' }),
        testInfo,
        name,
      );
      await prototype.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  } finally {
    await pair.close();
  }
});
test('peek sample and person rows match the desk and project sections', async ({
  browser,
  page,
}, testInfo) => {
  const pair = await openPair(browser, page);
  try {
    await compareSamples(pair.prototype, page, peekAndRows, testInfo);
  } finally {
    await pair.close();
  }
});
test('undo toast, state cards and failure panel match the feedback section', async ({
  browser,
  page,
}, testInfo) => {
  const pair = await openPair(browser, page);
  try {
    await compareSamples(
      pair.prototype,
      page,
      [...states, ...failures],
      testInfo,
    );
    // 提示容器是固定在视口底部居中的，横向落在小数像素上；样张里改回文档流再比较
    await page.addStyleTag({
      content:
        '.nt-toasts { position: static !important; translate: none !important; }',
    });
    // 提示 5 秒后自己消失，放在最后、点开后马上比较
    await pair.prototype.locator('#toast-run').click();
    await page.locator('[data-sample="toast-run"]').click();
    await compareElements(
      pair.prototype.locator('#toast-slot .n-toast'),
      page.locator('.nt-toasts .n-toast'),
      testInfo,
      'toast',
      { snap: true },
    );
  } finally {
    await pair.close();
  }
});
