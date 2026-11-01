/**
 * BOW-853 find-people page: what the comparison leaves out. Selectors are prototype
 * selectors (prototype/y/app/js/pages/staffing.js at the pinned reference commit).
 * Registered in docs/reference-route-map.md, section「找人（BOW-853）」.
 */
export type StaffingScene = {
  name: string;
  /** Engineering sample route. */
  sample: string;
  /** Prototype page, relative to prototype/y/app/. */
  prototype: string;
};

export const scenes: readonly StaffingScene[] = [
  {
    name: 'manager-project',
    sample: '/dev/staffing?role=manager&scene=agent',
    prototype: 'staffing.html?as=ceo&project=pr-agent',
  },
  {
    name: 'hr-project',
    sample: '/dev/staffing?role=hr&scene=ts',
    prototype: 'staffing.html?as=hrbp&project=pr-ts',
  },
];

export const entryScene: StaffingScene = {
  name: 'manager-entry',
  sample: '/dev/staffing?role=manager&scene=new',
  prototype: 'staffing.html?as=ceo&new=1',
};

/** Inside a compared element, areas that exist on both sides but differ on purpose. */
export const withinMasks = {
  // Rewriting a requirement into its looser form has no contract field (no alternatives).
  requirements: ['.nt-req'],
  // The searched pool size is not in the contract; the heading keeps the listed count.
  candidatesHeading: ['#cand-meta'],
  // The contract asks a source for every explicit state; the prototype cites only the
  // observation table, so some rows have a citation mark only on the engineering side.
  candidateRows: ['.n-cite'],
} as const;

/*
 * Compared by part instead of as a whole, because a registered difference changes the
 * element's size:
 * - Demand card: title, requirement list, add row and caption. The AI badge drops
 *  「点要求可以改写」(no rewriting on this page), which changes its wrapping. The prototype's
 *  「来自」line names the author and date and its role row lists roles (no contract
 *   fields); the engineering card adds the confirm step (BOW-853 10/31: match only after
 *   confirmation; design pending BOW-925).
 * - Candidate card: the name link and the requirement list. The demo badge, level,
 *   project count, dimension line, direction line, intent and release (`.n-cmeta`) and
 *   plan buttons have no contract fields; avatars are not colored per person.
 * - Entry: the target role templates (`.n-tpls`) have no contract, so the composer is
 *   compared on its own and its offset is not; the heading compares the title only,
 *   because the lead line drops「或者从目标角色模板开始」.
 * Not rendered at all: the plan column (`#plan`, plan contract `not_connected`); its
 * grid column stays, empty.
 */
