/**
 * BOW-841 workbench: what the comparison leaves out, per role. Selectors are prototype
 * selectors (prototype/y/app/js/pages/workbench.js at the pinned reference commit).
 * Registered in docs/reference-route-map.md, section「工作台（BOW-841）」.
 */
export type WorkbenchRole = 'manager' | 'hr' | 'mentor';

/** Prototype role parameter (?as=) for each engineering role. */
export const prototypeRole: Record<WorkbenchRole, 'ceo' | 'hrbp' | 'mentor'> = {
  manager: 'ceo',
  hr: 'hrbp',
  mentor: 'mentor',
};

/**
 * Blocks the engineering page does not render at all (their contract fields are
 * `not_connected` or belong to other cards). Never compared; removed from the prototype
 * only to check the order of what is left.
 */
export const notRendered: Record<WorkbenchRole, readonly string[]> = {
  manager: ['#jsig', '.nt-ceo'],
  hr: ['#changes'],
  mentor: ['#recos', '#todo'],
};

/** Inside a compared element, areas that exist on both sides but differ on purpose. */
export const withinMasks = {
  // Voice input is a scripted demo in the prototype; live recording is BOW-869.
  composer: ['#composer-mic'],
  // The manager's find box has no upload section, so no clip either.
  find: ['#composer-mic', 'a[href="#upload"]'],
  // Formats: this round's seven (BOW-858) where the prototype lists every kind.
  drop: ['small'],
  // Trainee activity is unknown in the read (BOW-838): the line shows the topic alone.
  studentLine: ['small'],
} as const;

/*
 * Compared by part instead of as a whole, because a registered difference changes the
 * element's size:
 * - HR and mentor heading: only h1. The date line goes on with programme status in the
 *   prototype (D6: no contract field), which also changes its wrapping.
 * - Manager heading: `.nt-head > div`, without the judgment reminders (#jsig).
 * - HR examples: the first one. The second starts an inventory and is not rendered.
 */
