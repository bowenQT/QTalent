import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nativeDatabase } from '../../../tests/fixtures/bow-845/native';
import {
  organizations,
  people,
  accountBindings,
  grants,
  employments,
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
  historicalEvaluations,
  historicalParticipants,
  arrangeInputs,
  type StoredArrangeInput,
} from '../modules/records';
import {
  dimensions,
  anchors,
  ruleVersions,
} from '../modules/evaluation-system';
import { confirmations } from '../modules/talent';
import { jobSnapshots } from '../jobs/schema';
import { ForbiddenError } from '../usecases/project-context';
import {
  loadPersonData,
  loadPersonDataInTransaction,
  personBusinessDay,
  talentSources,
} from './person-data';
import { nodeFixture } from './person-test-helpers';
import { sourceFromData } from './sources';

const now = '2026-07-01T12:34:56.000Z';
const reference = { fragmentId: 'fragment-0', originalVersionId: 'version' };
const excerpt = '演示：补齐回滚步骤并记录边界条件。';
let connection: Awaited<ReturnType<typeof nativeDatabase>> | undefined;

beforeAll(async () => {
  connection = await nativeDatabase();
  const db = connection.db;
  const data = nodeFixture();
  await db.insert(organizations).values(data.directory.organizations);
  await db.insert(people).values(data.directory.people);
  await db.insert(cohorts).values(data.cohorts);
  await db.insert(employments).values(data.employments);
  await db.insert(enrollments).values({
    ...data.context.enrollments[0],
    id: 'enrollment',
  });
  await db.insert(assignments).values({
    ...data.context.assignments[0],
    id: 'assignment',
  });
  await db.insert(accountBindings).values([
    { accountId: 'account', personId: 'actor', isSystemAdmin: false },
    { accountId: 'other', personId: 'two', isSystemAdmin: false },
    { accountId: 'admin', personId: 'actor', isSystemAdmin: true },
  ]);
  await db.insert(grants).values(data.directory.grants);
  await db.insert(evaluationNodes).values(
    data.context.evaluationNodes!.map((node) => ({
      ...node,
      name: '演示：' + node.id,
    })),
  );
  await db
    .insert(evaluationNodeSubjects)
    .values([
      ...data.context.evaluationNodeSubjects!,
      { evaluationNodeId: 'node-other', personId: 'two' },
    ]);
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
  await db.insert(originals).values({
    ...data.originals[0],
    kind: 'original',
    displayNotice: null,
  });
  await db.insert(originalVersions).values({
    ...data.versions[0],
    contentDigest: createHash('sha256').update(excerpt).digest('hex'),
  });
  await db.insert(fragments).values(
    data.fragments.map((fragment) =>
      fragment.id === reference.fragmentId
        ? {
            ...fragment,
            excerpt,
            location: { kind: 'document' as const, paragraph: 'input' },
          }
        : fragment,
    ),
  );
  await db.insert(events).values(data.events);
  await db.insert(eventSources).values(data.eventSources);
  await db.insert(statements).values(data.statements);
  await db.insert(confirmations).values(data.confirmations);
  await db
    .insert(eventParticipants)
    .values({ eventId: 'event-1', personId: 'two' });
  await db.insert(historicalEvaluations).values({
    id: 'history',
    sourceRecordId: 'history-source',
    evaluationNodeId: 'node-other',
    personId: 'one',
    recorderId: 'actor',
    occurredOn: '2026-06-01',
    kind: '结营评审',
    scale: [],
    ruleVersionId: 'rubric-v1',
    fragmentId: 'fragment-1',
    originalVersionId: 'version',
    sourceCategory: 'prototype_baseline',
  });
  await db
    .insert(historicalParticipants)
    .values({ evaluationId: 'history', personId: 'two' });
}, 30_000);

afterAll(async () => {
  await connection?.close();
});

it('reads uncommitted authorization and facts in the outer transaction, never commits them', async () => {
  const db = connection!.db;
  const rollback = new Error('Roll back the caller-owned transaction');
  await expect(
    db.transaction(
      async (tx) => {
        await tx.insert(accountBindings).values({
          accountId: 'uncommitted-account',
          personId: 'actor',
          isSystemAdmin: false,
        });
        await tx.insert(grants).values({
          ...nodeFixture().directory.grants[0],
          id: 'uncommitted-grant',
          accountId: 'uncommitted-account',
        });
        await tx
          .update(employments)
          .set({ validFrom: '2024-02-03' })
          .where(eq(employments.id, 'employment-one'));
        const data = await loadPersonDataInTransaction(
          tx,
          'uncommitted-account',
          now,
        );
        expect(data.context.account.id).toBe('uncommitted-account');
        expect(data.context.grants).toHaveLength(1);
        expect(data.employments[0].validFrom).toBe('2024-02-03');
        expect(data.context.now).toBe(now);
        expect(personBusinessDay(data)).toBe('2026-07-01');
        await expect(
          loadPersonData(db, 'uncommitted-account', now),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(
          (await loadPersonData(db, 'account', now)).employments[0].validFrom,
        ).toBe('2025-01-01');
        // The helper leaves the caller's transaction usable and writable.
        await tx
          .update(employments)
          .set({ validFrom: '2024-02-04' })
          .where(eq(employments.id, 'employment-one'));
        expect(
          (await loadPersonDataInTransaction(tx, 'uncommitted-account', now))
            .employments[0].validFrom,
        ).toBe('2024-02-04');
        throw rollback;
      },
      { isolationLevel: 'repeatable read' },
    ),
  ).rejects.toBe(rollback);
  await expect(
    loadPersonData(db, 'uncommitted-account', now),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(
    await db.select().from(grants).where(eq(grants.id, 'uncommitted-grant')),
  ).toEqual([]);
  expect(
    (await loadPersonData(db, 'account', now)).employments[0].validFrom,
  ).toBe('2025-01-01');
});

it('retains all intake subjects and required kinds, including another creator and superseded inputs', async () => {
  const db = connection!.db;
  const before = await loadPersonData(db, 'account', now);
  expect(await sourceFromData(before, reference)).toHaveProperty(
    'status',
    'success',
  );
  const rollback = new Error('Roll back intake provenance');
  await expect(
    db.transaction(
      async (tx) => {
        const inputs: StoredArrangeInput[] = ['current', 'superseded'].map(
          (id) => ({
            id,
            creatorAccountId: id === 'current' ? 'account' : 'other',
            jobId: id + '-job',
            inputVersion: id + '-version',
            batchId: id + '-batch',
            evaluationNodeId: 'node-current',
            boundAt: new Date(now),
            occurredOn: '2026-06-01',
            origin: 'text',
            originalInput: {
              operation_id: id + '-operation',
              text: excerpt,
              attachmentIds: [],
              personId: 'one',
              projectId: null,
            },
            sourceContexts: [
              {
                ...reference,
                subjects: [
                  {
                    personId: id === 'current' ? 'one' : 'two',
                    evaluationNodeId:
                      id === 'current' ? 'node-current' : 'node-other',
                    cohortId: 'cohort',
                  },
                ],
                // AI attribution must not erase the other subject's intake provenance.
                attributedPersonIds: ['one'],
                kind: 'evaluation',
                requiredKinds:
                  id === 'current'
                    ? []
                    : ['management-observation', 'restricted-evaluation'],
              },
            ],
            inputSource: reference,
            personIds: ['one'],
            projectMode: 'none',
            projectId: null,
            projectCandidateIds: [],
            supersededByInputId: id === 'current' ? null : 'current',
            createdAt: new Date(now),
          }),
        );
        await tx.insert(jobSnapshots).values(
          inputs.map((input) => ({
            jobId: input.jobId,
            kind: 'record_arrange',
            resourceId: input.id,
            inputVersion: input.inputVersion,
            status: 'queued' as const,
            attempt: 1,
            revision: 1,
            updatedAt: now,
          })),
        );
        await tx.insert(arrangeInputs).values(inputs);
        const data = await loadPersonDataInTransaction(tx, 'account', now);
        expect(data.intakeInputs).toEqual(expect.arrayContaining(inputs));
        expect(data.intakeInputs).toHaveLength(2);
        expect({ ...data, intakeInputs: [] }).toEqual(before);
        const source = talentSources(data).find(
          (row) => row.fragmentId === reference.fragmentId,
        )!;
        expect(source.subjects).toEqual([
          {
            personId: 'one',
            evaluationNodeId: 'node-current',
            cohortId: 'cohort',
          },
          {
            personId: 'two',
            evaluationNodeId: 'node-other',
            cohortId: 'cohort',
          },
        ]);
        expect(new Set(source.requiredKinds)).toEqual(
          new Set(['management-observation', 'restricted-evaluation']),
        );
        expect(await sourceFromData(data, reference)).toHaveProperty(
          'status',
          'not_found',
        );
        const outside = await loadPersonData(db, 'account', now);
        expect(outside).toEqual(before);
        expect(await sourceFromData(outside, reference)).toHaveProperty(
          'status',
          'success',
        );
        throw rollback;
      },
      { isolationLevel: 'repeatable read' },
    ),
  ).rejects.toBe(rollback);
  expect(await db.select().from(arrangeInputs)).toEqual([]);
  expect(await db.select().from(jobSnapshots)).toEqual([]);
  expect(await loadPersonData(db, 'account', now)).toEqual(before);
});

it('keeps the complete wrapper result and authorization errors on the transaction entry', async () => {
  const db = connection!.db;
  const expected = await loadPersonData(db, 'account', now);
  expect(expected.events).toHaveLength(2);
  expect(expected.eventSources).toHaveLength(2);
  expect(expected.statements).toHaveLength(2);
  expect(expected.confirmations).toHaveLength(4);
  expect(expected.participants).toHaveLength(1);
  expect(expected.historical).toHaveLength(1);
  expect(expected.historicalParticipants).toHaveLength(1);
  expect(expected.originals).toHaveLength(1);
  expect(expected.versions).toHaveLength(1);
  expect(expected.fragments).toHaveLength(2);
  expect(expected.dimensions).toHaveLength(3);
  expect(expected.anchors).toHaveLength(3);
  expect(expected.cohorts).toHaveLength(1);
  expect(expected.employments).toHaveLength(1);
  await db.transaction(
    async (tx) => {
      expect(await loadPersonDataInTransaction(tx, 'account', now)).toEqual(
        expected,
      );
      for (const account of ['missing', 'admin']) {
        await expect(
          loadPersonDataInTransaction(tx, account, now),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
});
