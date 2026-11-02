import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../modules/directory';
import {
  cohorts,
  enrollments,
  assignments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../modules/programs';
import {
  originals,
  originalVersions,
  fragments,
  events,
  eventSources,
  eventParticipants,
  statements,
} from '../modules/records';
import {
  dimensions,
  anchors,
  ruleVersions,
} from '../modules/evaluation-system';
import { confirmations, aiSuggestions } from '../modules/talent';
import { loadPersonData } from './person-data';
import { personFromData } from './person-projection';
import { peopleFromData, quickViewFromData } from './people';
import { sourceFromData } from './sources';
import { fixture, nodeFixture } from './person-test-helpers';
import { expectDirectoryOrder } from '../../../tests/fixtures/p0-contracts';
import { importDemo } from '../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../db/seed';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = 'qtalent_reads_' + randomUUID().replaceAll('-', '') + '_test';
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  const db = connection.db;
  const data = nodeFixture();
  await db.insert(organizations).values(data.directory.organizations);
  await db.insert(people).values(data.directory.people);
  await db.insert(cohorts).values({ id: 'cohort', name: 'Synthetic cohort' });
  await db.insert(enrollments).values({
    ...data.context.enrollments[0],
    id: 'enrollment',
  });
  await db.insert(assignments).values({
    ...data.context.assignments[0],
    id: 'assignment',
  });
  for (const role of ['manager', 'hr', 'mentor', 'admin'] as const) {
    await db.insert(accountBindings).values({
      accountId: role,
      personId: 'actor',
      isSystemAdmin: role === 'admin',
    });
    const grant = fixture(role).context.grants[0];
    await db.insert(grants).values({
      ...grant,
      id: role,
      accountId: role,
    });
  }
  await db.insert(evaluationNodes).values(
    data.context.evaluationNodes!.map((node) => ({
      ...node,
      name: '演示：' + node.id,
    })),
  );
  await db
    .insert(evaluationNodeSubjects)
    .values(data.context.evaluationNodeSubjects!);
  await db
    .insert(evaluationRelations)
    .values(data.context.evaluationRelations!);
  await db.insert(ruleVersions).values({
    id: 'rubric-v1',
    provenance: 'demo_import_snapshot',
    sourceCommit: '2e51b50',
  });
  await db.insert(dimensions).values(data.dimensions);
  await db.insert(anchors).values(data.anchors);
  await db.insert(originals).values(data.originals);
  await db.insert(originalVersions).values(data.versions);
  await db.insert(fragments).values(data.fragments);
  await db.insert(events).values(data.events);
  await db.insert(eventSources).values(data.eventSources);
  await db.insert(statements).values(data.statements);
  await db.insert(confirmations).values(data.confirmations);
  await db.insert(aiSuggestions).values({
    id: 'ai-only',
    eventId: 'event-0',
    dimensionId: 'grit',
    ruleVersionId: 'rubric-v1',
    sourceCategory: 'prototype_baseline',
    modelVersion: 'synthetic-model',
    status: 'scored',
    value: 4,
    anchorId: 'grit',
    fragmentId: 'fragment-0',
    originalVersionId: 'version',
    rationale: 'Synthetic suggestion, never a confirmed score',
  });
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
it('reads actual PostgreSQL confirmation and evidence tables for four accounts', async () => {
  const db = connection!.db;
  for (const role of ['manager', 'hr', 'mentor']) {
    const data = await loadPersonData(db, role, '2026-07-01');
    const result = await personFromData(data, 'one');
    expect(result?.capabilityProfile).toHaveProperty('data.scores.length', 4);
    const list = await peopleFromData(data);
    expect(list.total).toBe(role === 'manager' ? 3 : 1);
    if (role === 'mentor') {
      expect(result).not.toHaveProperty('referencePosition');
      expect(result).not.toHaveProperty('managementObservations');
    } else {
      expect(result).toHaveProperty('referencePosition.status', 'ready');
      expect(result).toHaveProperty(
        'versionsAndChanges.status',
        'not_connected',
      );
    }
  }
  await expect(loadPersonData(db, 'admin', '2026-07-01')).rejects.toThrow(
    '无权限',
  );
  await expect(loadPersonData(db, 'missing', '2026-07-01')).rejects.toThrow(
    '无权限',
  );
});
it('re-reads authorization and complete source relationships', async () => {
  const db = connection!.db;
  await db.insert(eventParticipants).values({
    eventId: 'event-0',
    personId: 'two',
  });
  const data = await loadPersonData(db, 'mentor', '2026-07-01');
  const source = await sourceFromData(data, {
    fragmentId: 'fragment-0',
    originalVersionId: 'version',
  });
  expect(source.status).toBe('not_found');
  const result = await personFromData(data, 'one');
  expect(result?.capabilityProfile).toHaveProperty('data.scores.length', 2);
  await db
    .update(evaluationRelations)
    .set({ revokedAt: '2026-07-01T00:00:00.000Z' })
    .where(eq(evaluationRelations.id, 'relation-current'));
  const revoked = await loadPersonData(db, 'mentor', '2026-07-01');
  expect(await personFromData(revoked, 'one')).toBeNull();
});

it('projects actual pinned seed observations and ended project participation', async () => {
  const seedName =
    'qtalent_profile_seed_' + randomUUID().replaceAll('-', '') + '_test';
  await admin!.query('CREATE DATABASE "' + seedName + '"');
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + seedName;
  const seeded = createDatabase(url.toString());
  try {
    await migrate(seeded.db, { migrationsFolder: 'src/server/db/migrations' });
    const mapped = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
    await importDemo(seeded.db, mapped, 'Synthetic-test-password-only');
    const mentor = mapped.accounts.find((row) => row.id === 'demo-mentor')!;
    const target = mapped.assignments.find(
      (assignment) =>
        assignment.personId === mentor.personId &&
        mapped.evidence.events.some(
          (event) => event.personId === assignment.studentId,
        ),
    )!.studentId;
    for (const account of ['demo-ceo', 'demo-hrbp']) {
      const data = await loadPersonData(seeded.db, account, '2026-10-25');
      const profile = await personFromData(data, target);
      expect(profile?.capabilityProfile.status).toBe('ready');
      expect(profile?.timeline.status).toBe('ready');
      if (profile?.timeline.status !== 'ready')
        throw new Error('Missing timeline');
      expect(profile.timeline.data.length).toBeGreaterThan(0);
      const events = profile.timeline.data.filter(
        (item) => item.kind === 'key_event',
      );
      expect(events.length).toBeGreaterThan(0);
      // Sheet-cell statements are original facts, read as evaluation.
      for (const item of events) {
        expect(item.category).toBe('evaluation');
        expect(item.sources.length).toBeGreaterThan(0);
      }
      // Weekly reviews repeat these readable key events and are not listed.
      const weekly = mapped.evidence.historicalEvaluations.filter(
        (row) => row.personId === target && row.kind === '训练营周评',
      );
      expect(weekly.length).toBeGreaterThan(0);
      for (const row of weekly)
        expect(events.map((item) => item.id)).toContain(row.sourceRecordId);
      expect(
        profile.timeline.data.some((row) => row.title.startsWith('训练营周评')),
      ).toBe(false);
      for (const item of profile.timeline.data.filter(
        (row) => row.kind === 'history',
      ))
        expect(item.category).toBe(
          item.title.startsWith('结营评审')
            ? 'restricted-evaluation'
            : 'evaluation',
        );
    }
    const mentorData = await loadPersonData(
      seeded.db,
      'demo-mentor',
      '2026-10-25',
    );
    const restricted = await personFromData(mentorData, target);
    // The mentor reads the student's key events and confirmed scores, but no
    // quadrant and no management observation.
    expect(restricted?.timeline.status).toBe('ready');
    if (restricted?.timeline.status !== 'ready')
      throw new Error('Missing timeline');
    const targetEvents = mapped.evidence.events.filter(
      (event) => event.personId === target,
    );
    expect(
      restricted.timeline.data
        .filter((row) => row.kind === 'key_event')
        .map((row) => row.id)
        .sort(),
    ).toEqual(targetEvents.map((event) => event.id).sort());
    expect(restricted.capabilityProfile.status).toBe('ready');
    expect(restricted).not.toHaveProperty('referencePosition');
    // The mentor now reads those key events, so their weekly reviews are not
    // listed again (BOW-837 dedupe applies to every caller).
    expect(
      restricted.timeline.data.some((row) =>
        row.title.startsWith('训练营周评'),
      ),
    ).toBe(false);
    expect(JSON.stringify(restricted)).not.toContain('management-observation');
    expect(restricted).not.toHaveProperty('managementObservations');
    const quick = await quickViewFromData(mentorData, target);
    expect(quick?.recentFacts.status).toBe('ready');
    expect(quick?.capabilityLines.status).toBe('ready');
    expect(quick).not.toHaveProperty('referencePosition');
    // The seed has no management observation left, so add one here: the mentor
    // still cannot read that event, while the manager reads it as one.
    const hidden = targetEvents[0]!;
    const link = mapped.evidence.eventSources.find(
      (row) => row.eventId === hidden.id,
    )!;
    await seeded.db.insert(statements).values({
      id: 'synthetic-management-note',
      eventId: hidden.id,
      kind: 'management_observation',
      text: 'Synthetic management note',
      authorId: mentor.personId,
      modelVersion: null,
      uncertainty: null,
      fragmentId: link.fragmentId,
      originalVersionId: link.originalVersionId,
    });
    const afterNote = await personFromData(
      await loadPersonData(seeded.db, 'demo-mentor', '2026-10-25'),
      target,
    );
    if (afterNote?.timeline.status !== 'ready')
      throw new Error('Missing timeline');
    expect(afterNote.timeline.data.map((row) => row.id)).not.toContain(
      hidden.id,
    );
    // With that key event hidden, its own weekly review is listed again.
    const hiddenWeekly = mapped.evidence.historicalEvaluations.find(
      (row) => row.sourceRecordId === hidden.id && row.kind === '训练营周评',
    );
    expect(afterNote.timeline.data.map((row) => row.id)).toContain(
      hiddenWeekly!.id,
    );
    expect(JSON.stringify(afterNote)).not.toContain('Synthetic management');
    const managerView = await personFromData(
      await loadPersonData(seeded.db, 'demo-ceo', '2026-10-25'),
      target,
    );
    if (managerView?.timeline.status !== 'ready')
      throw new Error('Missing timeline');
    expect(
      managerView.timeline.data.find((row) => row.id === hidden.id),
    ).toMatchObject({ category: 'management-observation' });
    const managerData = await loadPersonData(
      seeded.db,
      'demo-ceo',
      '2026-10-25',
    );
    const previous = mapped.members.find(
      (member) =>
        member.validTo !== null &&
        member.validTo <= '2026-10-25' &&
        mapped.projects.some(
          (project) =>
            project.id === member.projectId &&
            project.ownerId !== member.personId,
        ) &&
        mapped.people.some(
          (person) => person.id === member.personId && !person.noReview,
        ),
    )!;
    expect(previous).toBeDefined();
    const history = await personFromData(managerData, previous.personId);
    expect(history?.projects.status).toBe('ready');
    if (history?.projects.status !== 'ready')
      throw new Error('Missing projects');
    expect(history.projects.data).toContainEqual({
      id: previous.projectId,
      name: mapped.projects.find(
        (project) => project.id === previous.projectId,
      )!.name,
      role: previous.role,
      mode: previous.mode,
      from: previous.validFrom,
      to: previous.validTo,
    });
  } finally {
    await seeded.pool.end();
    await admin!.query('DROP DATABASE "' + seedName + '"');
  }
}, 30_000);

it('projects the pinned seed for every demo account inside the contract', async () => {
  const seedName =
    'qtalent_list_seed_' + randomUUID().replaceAll('-', '') + '_test';
  await admin!.query('CREATE DATABASE "' + seedName + '"');
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + seedName;
  const seeded = createDatabase(url.toString());
  try {
    await migrate(seeded.db, { migrationsFolder: 'src/server/db/migrations' });
    const mapped = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
    await importDemo(seeded.db, mapped, 'Synthetic-test-password-only');
    for (const account of ['demo-ceo', 'demo-hrbp', 'demo-mentor']) {
      const data = await loadPersonData(seeded.db, account, '2026-10-25');
      // peopleFromData and personFromData parse their own output strictly.
      const list = await peopleFromData(data);
      expect(list.total).toBeGreaterThan(0);
      expectDirectoryOrder(list.people);
      for (const row of list.people.slice(0, 5)) {
        const profile = await personFromData(data, row.person.id);
        expect(profile?.person).toEqual(row.person);
      }
      if (account === 'demo-mentor') {
        expect(list.role).toBe('mentor');
        expect(JSON.stringify(list)).not.toContain('referencePosition');
        expect(JSON.stringify(list)).not.toContain('management-observation');
      }
    }
  } finally {
    await seeded.pool.end();
    await admin!.query('DROP DATABASE "' + seedName + '"');
  }
}, 120_000);
