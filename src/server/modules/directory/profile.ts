/** Display facts only. This module neither grants access nor infers employment. */
export interface DirectoryProfilePerson {
  id: string;
  demo: boolean;
  organizationId: string;
  jobTitle: string | null;
  jobLevel: string | null;
}
export interface DirectoryProfileOrganization {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyKnown: boolean;
  isGroup: boolean;
}
export interface DirectoryProfile {
  jobTitle: string | null;
  level: string | null;
  organizationPath: string[] | null;
  /** Prototype orgPath: the parent and the organization, grouping nodes skipped. */
  displayPath: string[] | null;
  demo: boolean;
}
export class DirectoryProfileError extends Error {
  constructor() {
    super('Directory profile facts are inconsistent');
    this.name = 'DirectoryProfileError';
  }
}
const nonblank = (value: string) => value.trim().length > 0;

/** Consume authoritative rows only, after the caller has authorized the person.
 * An old/unknown link means the complete path is unknown, never a guessed root.
 * Broken known links and cycles fail rather than returning a plausible prefix.
 */
export function projectDirectoryProfile(
  person: DirectoryProfilePerson,
  organizations: readonly DirectoryProfileOrganization[],
): DirectoryProfile {
  if (
    (person.jobTitle !== null && !nonblank(person.jobTitle)) ||
    (person.jobLevel !== null && !nonblank(person.jobLevel))
  )
    throw new DirectoryProfileError();
  const rows = new Map<string, DirectoryProfileOrganization>();
  for (const row of organizations) {
    if (rows.has(row.id)) throw new DirectoryProfileError();
    rows.set(row.id, row);
  }
  const path: string[] = [];
  const chain: DirectoryProfileOrganization[] = [];
  const visited = new Set<string>();
  let current: string | null = person.organizationId;
  let unknown = false;
  while (current !== null) {
    const row = rows.get(current);
    if (!row || visited.has(current) || !nonblank(row.name))
      throw new DirectoryProfileError();
    visited.add(current);
    if (!row.hierarchyKnown) {
      if (row.parentId !== null) throw new DirectoryProfileError();
      unknown = true;
      break;
    }
    path.unshift(row.name);
    chain.push(row);
    current = row.parentId;
  }
  return {
    jobTitle: person.jobTitle,
    level: person.jobLevel,
    organizationPath: unknown ? null : path,
    displayPath: unknown
      ? null
      : chain
          .slice(0, 2)
          .filter((row, index) => index === 0 || !row.isGroup)
          .reverse()
          .map((row) => row.name),
    demo: person.demo,
  };
}
