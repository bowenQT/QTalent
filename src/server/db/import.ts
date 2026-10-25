import { pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { createDatabase, type Database } from './client';
import { readPrototypeSeed, mapPrototypeSeed, type DemoSeed } from './seed';
import {
  people,
  organizations,
  accountBindings,
  grants,
  employments,
} from '../modules/directory';
import { cohorts, enrollments, assignments } from '../modules/programs';
import { projects, members, memberLogs } from '../modules/staffing';
import { user, account } from '../auth/schema';
import { getEnv } from '../env';
/** Explicit command only: never imported into application startup. No destructive reset. */
export async function importDemo(
  db: Database,
  seed: DemoSeed,
  password: string,
) {
  if (password.length < 12)
    throw new Error('DEMO_PASSWORD must contain at least 12 characters');
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    for (const o of seed.organizations)
      await tx
        .insert(organizations)
        .values({ id: o.id, name: o.name, shortName: o.name })
        .onConflictDoNothing();
    for (const p of seed.people) {
      await tx
        .insert(people)
        .values({
          id: p.id,
          name: p.name,
          organizationId: p.organizationId,
          hue: p.hue,
          photo: p.photo,
          noReview: p.noReview,
          demo: true,
        })
        .onConflictDoNothing();
      await tx
        .insert(employments)
        .values({
          id: `demo-employment-${p.id}`,
          personId: p.id,
          organizationId: p.organizationId,
          validFrom: p.joined,
          validTo: null,
        })
        .onConflictDoNothing();
    }
    for (const a of seed.accounts) {
      await tx
        .insert(user)
        .values({ id: a.id, name: a.name, email: a.email, emailVerified: true })
        .onConflictDoNothing();
      await tx
        .insert(account)
        .values({
          id: `credential-${a.id}`,
          accountId: a.id,
          providerId: 'credential',
          userId: a.id,
          password: passwordHash,
        })
        .onConflictDoNothing();
      await tx
        .insert(accountBindings)
        .values({
          accountId: a.id,
          personId: a.personId,
          isSystemAdmin: a.isSystemAdmin,
        })
        .onConflictDoNothing();
    }
    for (const c of seed.cohorts)
      await tx
        .insert(cohorts)
        .values({ id: c.id, name: c.name })
        .onConflictDoNothing();
    for (const [i, g] of seed.grants.entries())
      await tx
        .insert(grants)
        .values({ id: `demo-grant-${i}`, ...g })
        .onConflictDoNothing();
    for (const [i, e] of seed.enrollments.entries())
      await tx
        .insert(enrollments)
        .values({ id: `demo-enrollment-${i}`, ...e })
        .onConflictDoNothing();
    for (const [i, a] of seed.assignments.entries())
      await tx
        .insert(assignments)
        .values({ id: `demo-assignment-${i}`, ...a })
        .onConflictDoNothing();
    for (const p of seed.projects) {
      await tx
        .insert(projects)
        .values({
          id: p.id,
          name: p.name,
          type: p.type,
          status: p.status,
          goal: p.goal,
          organizationId: p.organizationId,
          cohortId: p.cohortId,
          isTopic: p.isTopic,
          ownerId: p.ownerId,
          creatorId: p.creatorId,
          from: p.from,
          to: p.to,
          sortOrder: p.sortOrder,
        })
        .onConflictDoNothing();
    }
    for (const m of seed.members)
      await tx
        .insert(members)
        .values({
          id: m.id,
          projectId: m.projectId,
          personId: m.personId,
          role: m.role,
          mode: m.mode,
          validFrom: m.validFrom,
          validTo: m.validTo,
          by: m.by,
        })
        .onConflictDoNothing();
    for (const l of seed.memberLogs)
      await tx
        .insert(memberLogs)
        .values({
          id: l.id,
          projectId: l.projectId,
          at: l.at,
          text: l.text,
          by: l.by,
        })
        .onConflictDoNothing();
  });
}
export async function runImport() {
  const env = getEnv();
  if (env.APP_ENV === 'production')
    throw new Error('Demo import is forbidden in production');
  const password = env.DEMO_PASSWORD;
  if (!password) throw new Error('DEMO_PASSWORD is required');
  const connection = createDatabase(env.DATABASE_URL);
  try {
    await importDemo(
      connection.db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
      password,
    );
  } finally {
    await connection.pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runImport();
