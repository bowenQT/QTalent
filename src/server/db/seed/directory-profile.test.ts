import { readPrototypeSeed } from './index';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  parseDirectoryProfileSeed,
  planDirectoryProfileBackfill,
  DIRECTORY_PROFILE_DEMO_SOURCE,
  readDirectoryProfileSeed,
} from './directory-profile';
const seed = {
  kind: 'directory_demo_profile',
  peopleProvenance: 'synthetic_demo',
  version: 1,
  people: [
    {
      id: 'synthetic-person',
      name: '化名（演示）',
      organizationId: 'leaf',
      demo: true,
      jobTitle: '合成职位（演示）',
      jobLevel: '合成职级（演示）',
    },
  ],
  organizations: [
    { id: 'leaf', name: '合成团队', parentId: 'root', isGroup: false },
    { id: 'root', name: '合成组织', parentId: null, isGroup: true },
  ],
};
it('retains explicit values and root facts without prototype-derived substitutions', () => {
  expect(parseDirectoryProfileSeed(seed)).toEqual(seed);
  expect(
    parseDirectoryProfileSeed({
      ...seed,
      organizations: [],
      people: [{ ...seed.people[0], jobTitle: null, jobLevel: null }],
    }).people[0],
  ).toMatchObject({ jobTitle: null, jobLevel: null });
});
it.each([
  { ...seed, people: [seed.people[0], seed.people[0]] },
  { ...seed, organizations: [seed.organizations[0], seed.organizations[0]] },
  { ...seed, organizations: [seed.organizations[0]] },
  { ...seed, organizations: [{ ...seed.organizations[0], parentId: 'leaf' }] },
  { ...seed, people: [{ ...seed.people[0], demo: false }] },
  { ...seed, people: [{ ...seed.people[0], jobLevel: ' ' }] },
  { ...seed, people: [{ ...seed.people[0], role: 'manager' }] },
  { ...seed, kind: 'prototype_snapshot' },
])(
  'rejects invalid/ambiguous input rather than silently stripping it',
  (input) => {
    expect(() => parseDirectoryProfileSeed(input)).toThrow();
  },
);
it('requires the reviewed digest and refuses changed bytes or private paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'directory-profile-'));
  try {
    const bytes = JSON.stringify(seed);
    const source = {
      relativeFile: 'approved.json',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    writeFileSync(join(root, source.relativeFile), bytes);
    expect(readDirectoryProfileSeed(root, source)).toEqual(seed);
    writeFileSync(join(root, source.relativeFile), bytes + ' ');
    expect(() => readDirectoryProfileSeed(root, source)).toThrow(/digest/);
    for (const relativeFile of [
      '../outside.json',
      '/tmp/outside.json',
      'docs/sources/table.json',
      'docs/design-refs/table.json',
      '.',
    ])
      expect(() =>
        readDirectoryProfileSeed(root, { ...source, relativeFile }),
      ).toThrow();
    // Private folders are refused by path even when the bytes match the digest.
    for (const folder of ['docs/sources', 'docs/design-refs']) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, 'table.json'), bytes);
      expect(() =>
        readDirectoryProfileSeed(root, {
          ...source,
          relativeFile: `${folder}/table.json`,
        }),
      ).toThrow(/non-private/);
    }
    expect(() =>
      readDirectoryProfileSeed(root, { ...source, sha256: '' }),
    ).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const current = () => ({
  people: [
    {
      ...seed.people[0],
      jobTitle: null as string | null,
      jobLevel: null as string | null,
    },
  ],
  organizations: seed.organizations.map((row) => ({
    ...row,
    parentId: null as string | null,
    hierarchyKnown: false,
    isGroup: false,
  })),
});
it('plans only explicit missing values without mutating its inputs', () => {
  const facts = current();
  const before = structuredClone(facts);
  expect(
    planDirectoryProfileBackfill(parseDirectoryProfileSeed(seed), facts),
  ).toEqual({
    personUpdates: [
      {
        id: seed.people[0].id,
        jobTitle: seed.people[0].jobTitle,
        jobLevel: seed.people[0].jobLevel,
      },
    ],
    organizationUpdates: seed.organizations.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      hierarchyKnown: true,
      isGroup: row.isGroup,
    })),
  });
  expect(facts).toEqual(before);
});
it('is an empty plan on exact replay and does not erase known values with null', () => {
  const facts = {
    people: seed.people,
    organizations: seed.organizations.map((row) => ({
      ...row,
      hierarchyKnown: true,
    })),
  };
  const empty = { personUpdates: [], organizationUpdates: [] };
  expect(
    planDirectoryProfileBackfill(parseDirectoryProfileSeed(seed), facts),
  ).toEqual(empty);
  expect(
    planDirectoryProfileBackfill(
      parseDirectoryProfileSeed({
        ...seed,
        people: [{ ...seed.people[0], jobTitle: null, jobLevel: null }],
      }),
      facts,
    ),
  ).toEqual(empty);
});
it.each([
  'person-missing',
  'real-person',
  'name',
  'membership',
  'jobTitle',
  'jobLevel',
  'organization-missing',
  'organization-name',
  'known-parent',
  'corrupt-unknown',
  'duplicate-person',
  'duplicate-organization',
])(
  'rejects the whole plan on %s instead of attaching facts to an incompatible identity',
  (kind) => {
    const facts = current();
    switch (kind) {
      case 'person-missing':
        facts.people = [];
        break;
      case 'real-person':
        facts.people[0].demo = false;
        break;
      case 'name':
        facts.people[0].name = '另一化名（演示）';
        break;
      case 'membership':
        facts.people[0].organizationId = 'root';
        break;
      case 'jobTitle':
        facts.people[0].jobTitle = '已有职位';
        break;
      case 'jobLevel':
        facts.people[0].jobLevel = '已有职级';
        break;
      case 'organization-missing':
        facts.organizations = [];
        break;
      case 'organization-name':
        facts.organizations[0].name = '另一个组织';
        break;
      case 'known-parent':
        facts.organizations[0].hierarchyKnown = true;
        break;
      case 'corrupt-unknown':
        facts.organizations[0].parentId = 'root';
        break;
      case 'duplicate-person':
        facts.people.push(facts.people[0]);
        break;
      case 'duplicate-organization':
        facts.organizations.push(facts.organizations[0]);
        break;
    }
    expect(() =>
      planDirectoryProfileBackfill(parseDirectoryProfileSeed(seed), facts),
    ).toThrow();
  },
);

it('pins the 93 explicit synthetic profiles to existing pseudonymous identities, not prototype levels', () => {
  const demo = readDirectoryProfileSeed(
    process.cwd(),
    DIRECTORY_PROFILE_DEMO_SOURCE,
  );
  const existing = readPrototypeSeed(process.cwd()).PEOPLE.filter(
    (person) => !person.noReview,
  );
  expect(demo.peopleProvenance).toBe('synthetic_demo');
  expect(demo.people).toHaveLength(93);
  // Hierarchy is copied from the reviewed prototype tree, names verbatim.
  expect(demo.organizations).toEqual(
    readPrototypeSeed(process.cwd()).ORGS.map((org) => ({
      id: org.id,
      name: org.name,
      parentId: org.parent,
      isGroup: org.group,
    })),
  );
  expect(new Set(demo.people.map((row) => row.id))).toEqual(
    new Set(existing.map((row) => row.id)),
  );
  for (const row of demo.people) {
    const identity = existing.find((person) => person.id === row.id)!;
    expect(row).toMatchObject({
      name: identity.name,
      organizationId: identity.org,
      demo: true,
    });
    expect(row.jobTitle).toContain('（演示）');
    expect(row.jobLevel).toMatch(/^N[123]（演示）$/);
    expect(row.jobLevel).not.toContain('届');
  }
});
