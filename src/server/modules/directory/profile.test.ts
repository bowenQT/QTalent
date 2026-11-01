import { expect, it } from 'vitest';
import {
  projectDirectoryProfile,
  type DirectoryProfileOrganization,
} from './profile';
const person = {
  id: 'synthetic-person',
  demo: true,
  organizationId: 'leaf',
  jobTitle: '合成职位（演示）',
  jobLevel: '合成职级（演示）',
};
const organizations: DirectoryProfileOrganization[] = [
  { id: 'leaf', name: '合成团队', parentId: 'root', hierarchyKnown: true },
  { id: 'root', name: '合成组织', parentId: null, hierarchyKnown: true },
];
it('returns exact persisted facts and the complete root-to-leaf path', () => {
  expect(projectDirectoryProfile(person, organizations)).toEqual({
    jobTitle: person.jobTitle,
    level: person.jobLevel,
    organizationPath: ['合成组织', '合成团队'],
    demo: true,
  });
  expect(
    projectDirectoryProfile({ ...person, demo: false }, organizations).demo,
  ).toBe(false);
});
it('keeps missing employment facts null without using names, roles or graduation', () => {
  expect(
    projectDirectoryProfile(
      { ...person, jobTitle: null, jobLevel: null },
      organizations,
    ),
  ).toMatchObject({ jobTitle: null, level: null });
});
it('distinguishes legacy unknown ancestry from an explicitly known root', () => {
  expect(
    projectDirectoryProfile(person, [
      { ...organizations[0], parentId: null, hierarchyKnown: false },
    ]).organizationPath,
  ).toBeNull();
  expect(
    projectDirectoryProfile(person, [{ ...organizations[0], parentId: null }])
      .organizationPath,
  ).toEqual(['合成团队']);
});
it('never returns a partial path when an ancestor is unknown', () => {
  expect(
    projectDirectoryProfile(person, [
      organizations[0],
      { ...organizations[1], hierarchyKnown: false },
    ]).organizationPath,
  ).toBeNull();
});
it.each(
  [
    [{ ...organizations[0], parentId: 'absent' }],
    [{ ...organizations[0], parentId: 'leaf' }],
    [organizations[0], { ...organizations[1], parentId: 'leaf' }],
    [organizations[0], organizations[0]],
    [{ ...organizations[0], hierarchyKnown: false }],
    [{ ...organizations[0], name: '  ', parentId: null }],
    [],
  ].map((rows) => ({ rows })),
)('rejects corrupt paths instead of publishing a partial path', ({ rows }) => {
  expect(() => projectDirectoryProfile(person, rows)).toThrow(
    'Directory profile facts are inconsistent',
  );
});
it.each([{ jobTitle: '' }, { jobTitle: '  ' }, { jobLevel: '\t' }])(
  'rejects blank values',
  (patch) => {
    expect(() =>
      projectDirectoryProfile({ ...person, ...patch }, organizations),
    ).toThrow();
  },
);
