import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { z } from 'zod';
import {
  evidenceSeedFields,
  mapEvidenceSeed,
  EVIDENCE_SOURCES,
  snapshotFieldSources,
} from './evidence';
import type {
  Assignment,
  AuthzContext,
  BusinessRole,
  Grant,
} from '../../authz';

const id = z.string().min(1);
const date = z.iso.date();
const person = z.object({
  id,
  name: z.string(),
  org: id,
  title: z.string(),
  joined: date,
  hue: z.number(),
  photo: z.string().nullable(),
  noReview: z.boolean().optional(),
  staff: z.enum(['mentor', 'ta', 'judge']).optional(),
});
const project = z.object({
  id,
  name: z.string(),
  type: z.string(),
  org: id,
  status: z.enum(['筹备中', '进行中', '已结束', '已归档']),
  from: date,
  to: date,
  owner: id.nullable(),
  creator: id,
  goal: z.string(),
  batch: id.optional(),
});
const seedSchema = z.object({
  ...evidenceSeedFields,
  ORGS: z.array(
    z.object({
      id,
      name: z.string(),
      parent: id.nullable(),
      group: z.boolean(),
    }),
  ),
  PEOPLE: z.array(person),
  PROJECTS: z.array(project),
  MEMBERS: z.array(
    z.object({
      project: id,
      person: id,
      role: z.string(),
      mode: z.string(),
      from: date,
      to: date.nullable(),
      by: id,
    }),
  ),
  MEMBER_LOG: z.array(
    z.object({ project: id, at: date, text: z.string(), by: id }),
  ),
  BATCHES: z.array(
    z.object({
      id,
      kind: z.string(),
      name: z.string(),
      org: id,
      from: date.optional(),
      to: date.optional(),
      topics: z.array(id).optional(),
      newcomers: z.array(z.tuple([id, id, z.array(id)])).optional(),
    }),
  ),
  ROLES: z.object({
    ceo: z.object({ label: z.string(), person: id, scope: z.string() }),
    hrbp: z.object({ label: z.string(), person: id, scope: z.string() }),
    mentor: z.object({ label: z.string(), person: id, scope: z.string() }),
    admin: z.object({ label: z.string(), person: id, scope: z.string() }),
  }),
});
export type PrototypeSeed = z.infer<typeof seedSchema>;
/** Only trusted, digest-pinned repository source is evaluated. VM is not an untrusted-code sandbox. */
export function readPrototypeSeed(root: string): PrototypeSeed {
  const reference = z
    .object({ commit: z.string().min(7) })
    .parse(
      JSON.parse(readFileSync(join(root, 'prototype-reference.json'), 'utf8')),
    );
  const context = createContext(
    { window: { NT: {} } },
    { codeGeneration: { strings: false, wasm: false } },
  );
  runInContext(
    'window.NT.clone = (value) => JSON.parse(JSON.stringify(value))',
    context,
  );
  let firstEvents: unknown = [];
  for (const [file, expected] of Object.entries(EVIDENCE_SOURCES)) {
    const source = readFileSync(
      join(root, '.reference-cache/prototype/y/app/js', file),
      'utf8',
    );
    if (
      createHash('sha256').update(source).digest('hex') !== expected.digest ||
      createHash('sha1')
        .update('blob ' + Buffer.byteLength(source) + '\0')
        .update(source)
        .digest('hex') !== expected.blob
    )
      throw new Error(
        `Prototype baseline ${reference.commit}: source digest mismatch: ${file}`,
      );
    runInContext(source, context, { timeout: 1000, filename: file });
    if (file === 'data-xe6.js')
      firstEvents = JSON.parse(
        runInContext('JSON.stringify(window.NT.XE6.events)', context),
      );
  }
  const final = runInContext('window.NT.SEED', context);
  return validatePrototypeSeed({
    ...final,
    SNAPSHOT_FIELD_SOURCES: snapshotFieldSources(firstEvents, final.EVENTS),
  });
}
export function validatePrototypeSeed(input: unknown): PrototypeSeed {
  const seed = seedSchema.parse(input);
  const keys = (rows: { id: string }[], label: string) => {
    const result = new Set<string>();
    for (const row of rows) {
      if (result.has(row.id)) throw new Error(`duplicate ${label}: ${row.id}`);
      result.add(row.id);
    }
    return result;
  };
  const people = keys(seed.PEOPLE, 'person'),
    orgs = keys(seed.ORGS, 'organization'),
    projects = keys(seed.PROJECTS, 'project'),
    batches = keys(seed.BATCHES, 'batch');
  const ref = (set: Set<string>, value: string | null | undefined) => {
    if (value != null && !set.has(value))
      throw new Error(`unresolved reference: ${value}`);
  };
  for (const org of seed.ORGS) {
    ref(orgs, org.parent);
    const visited = new Set<string>();
    let current: string | null = org.id;
    while (current !== null) {
      if (visited.has(current))
        throw new Error(`cyclic organization: ${org.id}`);
      visited.add(current);
      current = seed.ORGS.find((item) => item.id === current)!.parent;
    }
  }
  for (const person of seed.PEOPLE) ref(orgs, person.org);
  for (const project of seed.PROJECTS) {
    ref(orgs, project.org);
    ref(people, project.owner);
    ref(people, project.creator);
    ref(batches, project.batch);
  }
  for (const member of seed.MEMBERS) {
    ref(projects, member.project);
    ref(people, member.person);
    ref(people, member.by);
  }
  for (const log of seed.MEMBER_LOG) {
    ref(projects, log.project);
    ref(people, log.by);
  }
  for (const role of Object.values(seed.ROLES)) ref(people, role.person);
  for (const batch of seed.BATCHES) {
    if (
      batch.kind === 'landing' &&
      (!batch.from || !batch.newcomers || !batch.topics)
    )
      throw new Error(`missing cohort structure: ${batch.id}`);
    ref(orgs, batch.org);
    for (const topic of batch.topics ?? []) ref(projects, topic);
    for (const [student, topic, mentors] of batch.newcomers ?? []) {
      ref(people, student);
      ref(projects, topic);
      for (const mentor of mentors) ref(people, mentor);
    }
  }
  for (const event of seed.EVENTS) {
    for (const personId of event.people) ref(people, personId);
    ref(people, event.recorder);
    ref(projects, event.project);
    for (const score of event.scores) {
      ref(people, score.p);
      ref(people, score.by);
      for (const rater of score.raters ?? []) ref(people, rater.by);
    }
  }
  return seed;
}
export function mapPrototypeSeed(input: PrototypeSeed) {
  const raw = validatePrototypeSeed(input);
  const cohorts = raw.BATCHES.filter((batch) => batch.kind === 'landing').map(
    (batch) => ({
      id: batch.id,
      name: batch.name,
      organizationId: batch.org,
      validFrom: batch.from!,
      validTo: null,
    }),
  );
  // The teaching/HR authorization continues through closing review, independently of ended project membership.
  const validity = { validFrom: '2026-07-06', validTo: null, revokedAt: null };
  const accounts = Object.entries(raw.ROLES).map(([key, role]) => ({
    id: `demo-${key}`,
    personId: role.person,
    isSystemAdmin: key === 'admin',
    role: (
      { ceo: 'manager', hrbp: 'hr', mentor: 'mentor', admin: 'admin' } as const
    )[key as keyof typeof raw.ROLES],
    email: `${key}@qtalent.test`,
    name: raw.PEOPLE.find((p) => p.id === role.person)!.name,
    roleLabel: role.label,
    scopeLabel: role.scope,
  }));
  const grants: Grant[] = accounts.flatMap((account) =>
    account.isSystemAdmin
      ? []
      : [
          {
            accountId: account.id,
            role: account.role as BusinessRole,
            scope: account.role === 'manager' ? 'company' : 'cohort',
            cohortId: account.role === 'manager' ? null : 'b-xe6',
            ...validity,
          },
        ],
  );
  const enrollments: AuthzContext['enrollments'] = [];
  const assignments: Assignment[] = [];
  for (const batch of raw.BATCHES.filter((batch) => batch.kind === 'landing'))
    for (const [studentId, , mentors] of batch.newcomers ?? []) {
      enrollments.push({
        cohortId: batch.id,
        personId: studentId,
        confirmed: true,
        ...validity,
      });
      for (const personId of mentors)
        assignments.push({
          cohortId: batch.id,
          personId,
          studentId,
          kind:
            raw.PEOPLE.find((p) => p.id === personId)!.staff === 'ta'
              ? 'assistant'
              : 'mentor',
          ...validity,
        });
    }
  const cohortOfOrg = (orgId: string): string | null => {
    let current: string | null = orgId;
    while (current) {
      const cohort = cohorts.find((item) => item.organizationId === current);
      if (cohort) return cohort.id;
      current = raw.ORGS.find((org) => org.id === current)!.parent;
    }
    return null;
  };
  return {
    evidence: mapEvidenceSeed(raw),
    raw,
    accounts,
    cohorts,
    grants,
    enrollments,
    assignments,
    organizations: raw.ORGS.map((org) => ({
      id: org.id,
      name: org.name,
      parentId: org.parent,
      group: org.group,
    })),
    people: raw.PEOPLE.map((person) => ({
      ...person,
      organizationId: person.org,
      noReview: person.noReview ?? false,
      demo: true,
    })),
    projects: raw.PROJECTS.map((project, sortOrder) => ({
      ...project,
      organizationId: project.org,
      cohortId: project.batch ?? cohortOfOrg(project.org),
      isTopic: project.batch !== undefined,
      creatorId: project.creator,
      ownerId: project.owner,
      sortOrder,
    })),
    members: raw.MEMBERS.map((member, index) => ({
      ...member,
      id: `demo-member-${index}`,
      projectId: member.project,
      personId: member.person,
      validFrom: member.from,
      validTo: member.to,
    })),
    memberLogs: raw.MEMBER_LOG.map((log, index) => ({
      ...log,
      id: `demo-log-${index}`,
      projectId: log.project,
    })),
  };
}
export type DemoSeed = ReturnType<typeof mapPrototypeSeed>;
