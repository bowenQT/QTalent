import type { PeopleList, QuickView } from '@/contracts/people';
import { quadrantNames, type Quadrant } from '@/components/ui/MiniQuad';

type ManagerView = Extract<QuickView, { role: 'manager' | 'hr' }>;
type ReferenceQuadrant = Extract<
  ManagerView['referencePosition'],
  { status: 'ready' }
>['data']['quadrant'];

/** Contract quadrant → prototype key (potential first, then professional level). */
export const quadrantKey: Record<ReferenceQuadrant, Quadrant> = {
  high_professional_high_potential: 'hh',
  low_professional_high_potential: 'hl',
  high_professional_low_potential: 'lh',
  low_professional_low_potential: 'll',
};

export type Kind = 'all' | 'batch' | 'insufficient';
export type Filter = { query: string; teamId: string; kind: Kind };
export const allTeams = 'all';

/** The one cohort every listed person belongs to, if there is exactly one. */
export function onlyBatch(people: readonly QuickView[]) {
  const names = new Set(
    people.flatMap((view) =>
      view.person.batch ? [view.person.batch.name] : [],
    ),
  );
  return names.size === 1 ? [...names][0] : null;
}

/** Filter chips. 资料不足 only where the reference position is part of the list. */
export function kinds(list: PeopleList): { value: Kind; label: string }[] {
  const batch = onlyBatch(list.people);
  // 「XEngineer 第六期」→「第六期学员」; several cohorts share one plain label.
  const period = batch?.match(/第.+期/)?.[0];
  return [
    { value: 'all', label: '全部' },
    ...(list.people.some((view) => view.person.batch)
      ? [{ value: 'batch' as const, label: `${period ?? '训练营'}学员` }]
      : []),
    ...(list.role === 'mentor'
      ? []
      : [{ value: 'insufficient' as const, label: '资料不足' }]),
  ];
}

/** Teams in the order the server listed people (team name by pinyin). */
export function teams(people: readonly QuickView[]) {
  const seen = new Map<string, string>();
  for (const { person } of people)
    if (!seen.has(person.teamId)) seen.set(person.teamId, person.teamName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * Who stays under the current filter, in the server's order. Nothing here reads a
 * reference position or capability line except the 资料不足 chip, which only keeps
 * or drops a person and never reorders anyone.
 */
export function visible(people: readonly QuickView[], filter: Filter) {
  const query = filter.query.trim();
  return people.filter(
    ({ person, ...view }) =>
      (filter.teamId === allTeams || person.teamId === filter.teamId) &&
      (!query ||
        person.name.includes(query) ||
        person.jobTitle.includes(query)) &&
      (filter.kind === 'all' ||
        (filter.kind === 'batch' && person.batch !== null) ||
        (filter.kind === 'insufficient' &&
          'referencePosition' in view &&
          view.referencePosition.status === 'insufficient_evidence')),
  );
}

/** Consecutive people of one team, keeping the server's order inside and across. */
export function groups(people: readonly QuickView[]) {
  const out: { teamId: string; teamPath: string; people: QuickView[] }[] = [];
  for (const view of people) {
    const last = out.at(-1);
    if (last?.teamId === view.person.teamId) last.people.push(view);
    else
      out.push({
        teamId: view.person.teamId,
        teamPath: view.person.teamPath,
        people: [view],
      });
  }
  return out;
}

/** 岗位 · 职级 · 项目数 · 批次; the project count only when there is one. */
export function rowMeta({ person, projectLoad }: QuickView) {
  return [
    person.jobTitle,
    person.level,
    projectLoad.current
      ? `在 ${projectLoad.current} 个项目`
      : projectLoad.ever
        ? `参与过 ${projectLoad.ever} 个项目`
        : null,
    person.batch?.name,
  ]
    .filter(Boolean)
    .join(' · ');
}

export type Reference =
  | { state: 'placed'; quadrant: Quadrant; label: string }
  | { state: 'insufficient'; reason: string }
  | { state: 'unknown'; reason: string };

/** The reference position for the list's right column; mentors get none. */
export function reference(view: QuickView): Reference | null {
  if (view.role === 'mentor') return null;
  const position = view.referencePosition;
  switch (position.status) {
    case 'ready': {
      const quadrant = quadrantKey[position.data.quadrant];
      return { state: 'placed', quadrant, label: quadrantNames[quadrant] };
    }
    case 'insufficient_evidence':
      return { state: 'insufficient', reason: position.reason };
    case 'unknown':
      return { state: 'unknown', reason: position.reason };
  }
}

/** 「2026-09-04」→「09-04」, as the prototype's dates. */
export const monthDay = (date: string) => date.slice(5);
