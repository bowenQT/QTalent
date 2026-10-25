import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { readPrototypeSeed, mapPrototypeSeed } from './index';
import { visibleProjects, eligiblePeople } from '../../authz';
import { createClock } from '../../../lib/clock';

/** The oracle executes the unchanged prototype store, never a reimplementation of its filter. */
function prototypeLists(role: string): {
  projects: string[];
  people: string[];
} {
  const today = createClock('test').today();
  const context = createContext({
    window: {
      NT: {
        TODAY: today,
        clone: (value: unknown) => JSON.parse(JSON.stringify(value)),
        param: () => role,
        days: (date: string) =>
          Math.floor((Date.parse(today) - Date.parse(date)) / 86400000),
        addDays: (date: string, days: number) =>
          new Date(Date.parse(date) + days * 86400000)
            .toISOString()
            .slice(0, 10),
        ready: () => undefined,
      },
    },
    localStorage: { getItem: () => null, setItem: () => undefined },
  });
  for (const file of ['data-xe6.js', 'data.js', 'store.js'])
    runInContext(
      readFileSync(
        join(process.cwd(), '.reference-cache/prototype/y/app/js', file),
        'utf8',
      ),
      context,
      { timeout: 1000 },
    );
  return JSON.parse(
    runInContext(
      "JSON.stringify({projects:window.NT.store.search('').projects.map(p=>p.id),people:window.NT.store.visiblePeople().filter(p=>window.NT.store.scope(p.id)==='full').map(p=>p.id)})",
      context,
    ),
  );
}
describe('fixed baseline row-for-row project and picker parity', () => {
  for (const [role, prototypeRole] of [
    ['manager', 'ceo'],
    ['hr', 'hrbp'],
    ['mentor', 'mentor'],
  ] as const)
    it(role, () => {
      const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
      const account = seed.accounts.find((a) => a.role === role)!;
      const ctx = { ...seed, account, now: createClock('test').today() };
      const expected = prototypeLists(prototypeRole);
      expect(visibleProjects(ctx).map((p) => p.id)).toEqual(expected.projects);
      expect(eligiblePeople(ctx).map((p) => p.id)).toEqual(expected.people);
    });
});
