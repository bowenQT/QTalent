import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { compareElements, stabilize } from './compare';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';

type Sample = {
  name: string;
  /** Selector in prototype/y/design-system.html at the pinned reference commit. */
  reference: string;
  /** Selector on /dev/design-system/talent. */
  actual: string;
};

type Group = {
  name: string;
  samples: readonly Sample[];
  /** Same interaction on both pages before the comparison, e.g. expanding rows. */
  prepare?: (prototype: Page, actual: Page) => Promise<void>;
};

const stage = '[data-sample="spectrum"]';

/**
 * Sample list for BOW-832 PR-1. Not covered by a screenshot, with the reason:
 * - Score "suggested": only its dots are compared. The prototype sample row has no AI
 *   marker in its note, while the component always prints one (spec: AI suggestions must
 *   carry n-badge--ai), so a whole-row comparison would measure that intended difference.
 * - MiniQuad: not compared. The prototype sample draws a hand-authored curve that does not
 *   pass through its own dots, while the component draws the production polyline
 *   (ui.js:332); the whole element would measure that difference and the absolutely
 *   positioned plane cannot be isolated by the shared capture helper. DOM tests cover it.
 * - EventCard, Cite popover: no static counterpart in the design-system page; covered by
 *   DOM tests.
 */
const groups: readonly Group[] = [
  {
    name: 'material-sources-and-states',
    samples: [
      ...(['fact', 'self', 'obs', 'ai', 'human'] as const).map((kind) => ({
        name: `src-${kind}`,
        reference: `#material .src-card--${kind} .n-src`,
        actual: `[data-sample="src-${kind}"] .n-src`,
      })),
      ...(['yes', 'no', 'unknown', 'conflict'] as const).map((state) => ({
        name: `match-${state}`,
        reference: `.state-table .n-badge--${state}`,
        actual: `[data-sample="match-${state}"] .n-badge`,
      })),
    ],
  },
  {
    name: 'material-scores',
    samples: [
      {
        name: 'score-suggested-dots',
        reference: '#material .n-score[data-state="ai"] .n-score__dots',
        actual: '[data-sample="score-suggested"] .n-score__dots',
      },
      ...(['confirmed', 'calibrated'] as const).map((state) => ({
        name: `score-${state}`,
        reference: `#material .n-score[data-state="${state}"]`,
        actual: `[data-sample="score-${state}"] .n-score`,
      })),
      {
        name: 'score-insufficient',
        reference: '#material .n-score[data-state="unknown"]',
        actual: '[data-sample="score-insufficient"] .n-score',
      },
      {
        name: 'score-absent',
        reference: '#material .n-score[data-state="absent"]',
        actual: '[data-sample="score-absent"] .n-score',
      },
    ],
  },
  {
    name: 'input-trail',
    samples: [
      {
        name: 'trail',
        reference: '#trail-demo',
        actual: '[data-sample="trail"] .n-trail',
      },
    ],
  },
  {
    name: 'input-trail-failed',
    samples: [
      {
        name: 'trail-failed',
        reference: '#c-input .ds-stage > .n-trail:nth-of-type(2)',
        actual: '[data-sample="trail-failed"] .n-trail',
      },
    ],
  },
  {
    name: 'plan-judge-progress',
    samples: [
      {
        name: 'judge-progress',
        reference: '#c-plan .n-reqs--proc',
        actual: '[data-sample="judge-progress"] .n-reqs--proc',
      },
    ],
  },
  {
    name: 'doc-blocks',
    samples: [
      {
        name: 'block-ink-with-cites',
        reference: '#c-doc .n-block[data-state="ink"]',
        actual: '[data-sample="block-ink"] .n-block',
      },
      {
        name: 'block-light',
        reference: '#c-doc .n-block[data-state="light"]',
        actual: '[data-sample="block-light"] .n-block',
      },
    ],
  },
  {
    name: 'event-anchor-and-history',
    samples: [
      {
        name: 'anchor',
        reference: '#anchor',
        actual: '[data-sample="anchor"] .n-anchor',
      },
      {
        name: 'history',
        reference: '#c-event .ds-hist-card',
        actual: '[data-sample="history-card"]',
      },
    ],
  },
  {
    name: 'event-history-narrow',
    // The card's own container query, not the viewport, moves the note to its own line
    // and drops the panel indent; compare the same narrow card on both pages.
    prepare: async (prototype, actual) => {
      await prototype
        .locator('#c-event .ds-hist-card')
        .evaluate((el) => ((el as HTMLElement).style.width = '300px'));
      await actual
        .locator('[data-sample="history-card"]')
        .evaluate((el) => ((el as HTMLElement).style.width = '300px'));
    },
    samples: [
      {
        name: 'history-narrow',
        reference: '#c-event .ds-hist-card',
        actual: '[data-sample="history-card"]',
      },
    ],
  },
  {
    name: 'profile-spectrum',
    samples: [
      {
        name: 'spectrum-scale',
        reference: '#spectrum .n-spectrum__scale',
        actual: `${stage} .n-spectrum__scale`,
      },
      {
        name: 'spectrum-rows',
        reference: '#spectrum-rows',
        actual: `${stage} .n-spectrum__scale + div`,
      },
      {
        name: 'spectrum-legend',
        reference: '#spectrum .n-spectrum__legend',
        actual: `${stage} .n-spectrum__legend`,
      },
    ],
  },
  {
    name: 'profile-spectrum-expanded',
    prepare: async (prototype, actual) => {
      for (const [page, root] of [
        [prototype, '#spectrum-rows'],
        [actual, `${stage} .n-spectrum__scale + div`],
      ] as const)
        for (const name of ['内生动力', '智慧力'])
          await page
            .locator(`${root} button.n-spectrum__row`, { hasText: name })
            .click();
    },
    samples: [
      {
        name: 'spectrum-rows-expanded',
        reference: '#spectrum-rows',
        actual: `${stage} .n-spectrum__scale + div`,
      },
    ],
  },
];

for (const group of groups) {
  test(`talent components ${group.name} match the design-system page`, async ({
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
      await page.goto('/dev/design-system/talent');
      await stabilize(prototype);
      await stabilize(page);
      // The Next.js development badge sits at the viewport corner and can cover a sample.
      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; }',
      });
      await group.prepare?.(prototype, page);
      for (const sample of group.samples)
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

async function motion(browser: Browser, baseURL: string, reduced: boolean) {
  const context = await browser.newContext({
    baseURL,
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  await page.goto('/dev/design-system/talent');
  return { context, page };
}

const animationOf = (selector: string, pseudo?: '::before') =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)});` +
  ` return el ? getComputedStyle(el, ${JSON.stringify(pseudo ?? null)}).animationName : null; })()`;

test('active trail step pulses and the caret blinks, unless the viewer prefers less motion', async ({
  browser,
  referenceApp,
}) => {
  const normal = await motion(browser, referenceApp.baseURL, false);
  try {
    // The stylesheet names the animations; reduced motion must remove them, not slow them.
    expect(
      await normal.page.evaluate(
        animationOf('[data-sample="trail"] [data-state="active"]', '::before'),
      ),
    ).toBe('pulse-dot');
    expect(
      await normal.page.evaluate(animationOf('[data-sample="caret"] .n-caret')),
    ).toContain('caret-blink');
    expect(
      await normal.page.evaluate(
        animationOf(
          '[data-sample="judge-progress"] [data-state="judging"] svg',
        ),
      ),
    ).toBe('proc-pulse');
    // Streaming is still under way: one paragraph, the trail has not finished.
    await expect(
      normal.page.locator(
        '[data-sample="stream"] .n-trail__step[data-state="done"]',
      ),
    ).toHaveCount(0);
    await expect(normal.page.locator('[data-sample="stream"] p')).toHaveCount(
      1,
    );
  } finally {
    await normal.context.close();
  }
  const reduced = await motion(browser, referenceApp.baseURL, true);
  try {
    expect(
      await reduced.page.evaluate(
        animationOf('[data-sample="trail"] [data-state="active"]', '::before'),
      ),
    ).toBe('none');
    expect(
      await reduced.page.evaluate(
        animationOf('[data-sample="caret"] .n-caret'),
      ),
    ).toBe('none');
    expect(
      await reduced.page.evaluate(
        animationOf(
          '[data-sample="judge-progress"] [data-state="judging"] svg',
        ),
      ),
    ).toBe('none');
    // Reduced motion shows the whole result at once instead of typing it out.
    await expect(
      reduced.page.locator(
        '[data-sample="stream"] .n-trail__step[data-state="done"]',
      ),
    ).toHaveCount(4);
    await expect(reduced.page.locator('[data-sample="stream"] p')).toHaveCount(
      3,
    );
  } finally {
    await reduced.context.close();
  }
});

test('citation popover opens by hover, focus and click and closes with Escape in the browser', async ({
  page,
}) => {
  await page.goto('/dev/design-system/talent');
  // Pointer events before hydration would only exercise the stylesheet, not the component.
  await page.waitForFunction(() =>
    Object.keys(document.querySelector('.n-cite__mark')!).some((key) =>
      key.startsWith('__reactProps'),
    ),
  );
  const cite = page.locator('[data-sample="block-ink"] .n-cite').first();
  const mark = cite.locator('.n-cite__mark');
  const pop = cite.locator('.n-cite__pop');
  // A placed popover stays in layout at opacity 0 when closed, so judge what the viewer sees.
  const seen = () =>
    pop.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.opacity === '1';
    });
  await expect.poll(seen).toBe(false);
  await mark.hover();
  await expect.poll(seen).toBe(true);
  await expect(pop).toContainText('验收标准都写清楚了');
  // Placed against the viewport, fully inside it.
  const box = await pop.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    referenceConfig.desktop.width,
  );
  await page.keyboard.press('Escape');
  await expect.poll(seen).toBe(false);
  await page.mouse.move(0, 0);
  await mark.focus();
  await expect.poll(seen).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(seen).toBe(false);
  await page.locator('h1').click();
  await mark.click();
  await page.mouse.move(0, 0);
  await page.locator('h1').hover();
  await expect.poll(seen).toBe(true);
  // A locked citation shows provenance and no original.
  const locked = page
    .locator('p', { hasText: '来源受限的引用' })
    .locator('.n-cite');
  await locked.locator('.n-cite__mark').hover();
  await expect(locked.locator('.n-cite__pop')).toContainText(
    '只能看到它被引用了',
  );
  await expect(locked.locator('.n-cite__quote')).toHaveCount(0);
});
