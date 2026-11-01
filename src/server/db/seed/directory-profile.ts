import { asc, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { people, organizations } from '../../modules/directory';
import { getEnv } from '../../env';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';

const text = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value);
const seedSchema = z.strictObject({
  kind: z.literal('directory_demo_profile'),
  peopleProvenance: z.literal('synthetic_demo'),
  version: z.literal(1),
  people: z
    .array(
      z.strictObject({
        id: text,
        name: text,
        organizationId: text,
        demo: z.literal(true),
        jobTitle: text.nullable(),
        jobLevel: text.nullable(),
      }),
    )
    .max(2000),
  organizations: z
    .array(
      z.strictObject({
        id: text,
        name: text,
        parentId: text.nullable(),
      }),
    )
    .max(2000),
});
export type DirectoryProfileSeed = z.infer<typeof seedSchema>;

/** Explicit directory facts, not prototype role/track/graduation labels. */
export function parseDirectoryProfileSeed(
  value: unknown,
): DirectoryProfileSeed {
  const seed = seedSchema.parse(value);
  const unique = (rows: readonly { id: string }[]) => {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error('Duplicate directory profile identity');
  };
  unique(seed.people);
  unique(seed.organizations);
  const organizations = new Map(seed.organizations.map((row) => [row.id, row]));
  for (const row of seed.organizations) {
    const visited = new Set<string>();
    let current: string | null = row.id;
    while (current !== null) {
      const organization = organizations.get(current);
      if (!organization || visited.has(current))
        throw new Error('Directory hierarchy must be complete and acyclic');
      visited.add(current);
      current = organization.parentId;
    }
  }
  // A people-only update is valid: it must not imply any new hierarchy fact.
  // The native writer checks each person's existing organization and identity.
  return seed;
}

/** The descriptor is fixed by the trusted server composition after source
 * approval; never accept it from a client. No source is selected by default.
 * Existing prototype title/level fields are deliberately not mapped here.
 */
export function readDirectoryProfileSeed(
  root: string,
  source: { relativeFile: string; sha256: string },
): DirectoryProfileSeed {
  if (!/^[a-f0-9]{64}$/.test(source.sha256))
    throw new Error('A reviewed directory source digest is required');
  const file = resolve(root, source.relativeFile);
  const local = relative(resolve(root), file);
  if (
    !local ||
    local.startsWith('..') ||
    isAbsolute(source.relativeFile) ||
    /^(docs\/(sources|design-refs))(\/|$)/.test(local.replaceAll('\\', '/'))
  )
    throw new Error(
      'Directory source must be an approved non-private repository file',
    );
  const bytes = readFileSync(file);
  if (
    bytes.length > 1_048_576 ||
    createHash('sha256').update(bytes).digest('hex') !== source.sha256
  )
    throw new Error('Directory source digest or size mismatch');
  return parseDirectoryProfileSeed(JSON.parse(bytes.toString('utf8')));
}

export interface ExistingDirectoryProfilePerson {
  id: string;
  name: string;
  organizationId: string;
  demo: boolean;
  jobTitle: string | null;
  jobLevel: string | null;
}
export interface ExistingDirectoryProfileOrganization {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyKnown: boolean;
}

/** Plan against rows locked by the native writer in the same transaction.
 * Never create a person, change a real person's row, change membership, or
 * overwrite an already populated fact. Source null means no fact to add.
 */
export function planDirectoryProfileBackfill(
  seed: DirectoryProfileSeed,
  current: {
    people: readonly ExistingDirectoryProfilePerson[];
    organizations: readonly ExistingDirectoryProfileOrganization[];
  },
) {
  const index = <T extends { id: string }>(rows: readonly T[]) => {
    const result = new Map(rows.map((row) => [row.id, row]));
    if (result.size !== rows.length)
      throw new Error('Duplicate current directory identity');
    return result;
  };
  const people = index(current.people);
  const organizations = index(current.organizations);
  const personUpdates: {
    id: string;
    jobTitle: string | null;
    jobLevel: string | null;
  }[] = [];
  const organizationUpdates: {
    id: string;
    parentId: string | null;
    hierarchyKnown: true;
  }[] = [];
  for (const row of seed.people) {
    const existing = people.get(row.id);
    if (
      !existing ||
      !existing.demo ||
      existing.name !== row.name ||
      existing.organizationId !== row.organizationId ||
      !organizations.has(row.organizationId)
    )
      throw new Error('Directory profile identity collision');
    for (const key of ['jobTitle', 'jobLevel'] as const) {
      if (
        existing[key] !== null &&
        row[key] !== null &&
        existing[key] !== row[key]
      )
        throw new Error('Directory profile value conflict');
    }
    const jobTitle = existing.jobTitle ?? row.jobTitle;
    const jobLevel = existing.jobLevel ?? row.jobLevel;
    if (jobTitle !== existing.jobTitle || jobLevel !== existing.jobLevel)
      personUpdates.push({ id: row.id, jobTitle, jobLevel });
  }
  for (const row of seed.organizations) {
    const existing = organizations.get(row.id);
    if (
      !existing ||
      existing.name !== row.name ||
      (row.parentId !== null && !organizations.has(row.parentId))
    )
      throw new Error('Directory organization identity collision');
    if (existing.hierarchyKnown) {
      if (existing.parentId !== row.parentId)
        throw new Error('Directory hierarchy value conflict');
    } else {
      if (existing.parentId !== null)
        throw new Error('Unknown hierarchy cannot carry a parent');
      organizationUpdates.push({
        id: row.id,
        parentId: row.parentId,
        hierarchyKnown: true,
      });
    }
  }
  return { personUpdates, organizationUpdates };
}

/** Explicit demo maintenance command, never called by startup, HTTP or a model.
 * The approved file is loaded inside this entry, so caller-mutated parsed rows
 * cannot serve as source proof. The whole import commits or rolls back together.
 */
export async function importDirectoryProfileSeed(
  db: Database,
  root: string,
  source: { relativeFile: string; sha256: string },
) {
  if (getEnv().APP_ENV === 'production')
    throw new Error('Demo directory import is forbidden in production');
  const input = readDirectoryProfileSeed(root, source);
  return db.transaction(
    async (tx) => {
      // Fixed lock order across both maps; competing imports observe the committed
      // winner under RC, then compute an empty replay or reject a value conflict.
      const currentOrganizations = await tx
        .select()
        .from(organizations)
        .orderBy(asc(organizations.id))
        .for('update');
      const currentPeople = await tx
        .select()
        .from(people)
        .orderBy(asc(people.id))
        .for('update');
      const plan = planDirectoryProfileBackfill(input, {
        people: currentPeople,
        organizations: currentOrganizations,
      });
      for (const row of plan.organizationUpdates) {
        const updated = await tx
          .update(organizations)
          .set({ parentId: row.parentId, hierarchyKnown: row.hierarchyKnown })
          .where(eq(organizations.id, row.id))
          .returning({ id: organizations.id });
        if (updated.length !== 1)
          throw new Error('Directory organization update lost its identity');
      }
      for (const row of plan.personUpdates) {
        const updated = await tx
          .update(people)
          .set({ jobTitle: row.jobTitle, jobLevel: row.jobLevel })
          .where(eq(people.id, row.id))
          .returning({ id: people.id });
        if (updated.length !== 1)
          throw new Error('Directory profile update lost its identity');
      }
      return {
        peopleUpdated: plan.personUpdates.length,
        organizationsUpdated: plan.organizationUpdates.length,
      };
    },
    { isolationLevel: 'read committed' },
  );
}

/** Reviewed synthetic facts live in JSON, not in application display code. */
export const DIRECTORY_PROFILE_DEMO_SOURCE = Object.freeze({
  relativeFile: 'src/server/db/seed/directory-profile-demo.json',
  sha256: '2bd3b36c7b217acd51df05f28be06686b7be419221f51fe629620754a342136d',
});
export function importDirectoryProfileDemo(db: Database, root: string) {
  return importDirectoryProfileSeed(db, root, DIRECTORY_PROFILE_DEMO_SOURCE);
}
