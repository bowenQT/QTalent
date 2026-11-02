import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  nativeDatabase,
  seedNativeCase,
  businessAt,
} from '../../../tests/fixtures/bow-845/native';
import { accountBindings, grants, people } from '../modules/directory';
import {
  evaluationNodeSubjects,
  evaluationRelations,
} from '../modules/programs';
import { projects, members } from '../modules/staffing/schema';
import { createRecordEvaluationNodeResolver } from './record-evaluation-node';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'native current record node resolution',
  () => {
    let native: Awaited<ReturnType<typeof nativeDatabase>>;
    beforeAll(async () => {
      native = await nativeDatabase();
    }, 30_000);
    afterAll(async () => {
      await native?.close();
    });
    async function fixture() {
      const f = await seedNativeCase(native.db);
      const resolve = createRecordEvaluationNodeResolver({
        db: native.db,
        businessNow: () => businessAt,
      });
      const input = { personIds: [f.target], projectId: null as string | null };
      return { ...f, input, resolve };
    }
    it('reads actual binding/node/subject/relation and never defaults an empty selection to self', async () => {
      const f = await fixture();
      await expect(f.resolve(f.account, f.input)).resolves.toEqual({
        status: 'unique',
        evaluationNodeId: f.node,
      });
      await expect(
        f.resolve(f.account, { ...f.input, personIds: [] }),
      ).resolves.toEqual({ status: 'none' });
      await expect(f.resolve(f.outsiderAccount, f.input)).resolves.toEqual({
        status: 'none',
      });
      await expect(f.resolve('unknown-account', f.input)).resolves.toEqual({
        status: 'none',
      });
    });
    it('does not choose between multiple actual nodes; duplicate relations alone stay unique', async () => {
      const f = await fixture();
      await native.db.insert(evaluationRelations).values({
        id: f.prefix + '-duplicate',
        evaluationNodeId: f.node,
        personId: f.target,
        evaluatorId: f.evaluator,
        kind: 'mentor',
        validFrom: '2026-01-01T00:00:00Z',
      });
      await expect(f.resolve(f.account, f.input)).resolves.toEqual({
        status: 'unique',
        evaluationNodeId: f.node,
      });
      await native.db
        .insert(evaluationNodeSubjects)
        .values({ evaluationNodeId: f.otherNode, personId: f.target });
      await native.db.insert(evaluationRelations).values({
        id: f.prefix + '-second',
        evaluationNodeId: f.otherNode,
        personId: f.target,
        evaluatorId: f.evaluator,
        kind: 'judge',
        validFrom: '2026-01-01T00:00:00Z',
      });
      await expect(f.resolve(f.account, f.input)).resolves.toEqual({
        status: 'multiple',
      });
    });
    it('requires the intersection of all selected people, not the union of their nodes', async () => {
      const f = await fixture();
      await native.db.insert(evaluationRelations).values({
        id: f.prefix + '-other',
        evaluationNodeId: f.otherNode,
        personId: f.other,
        evaluatorId: f.evaluator,
        kind: 'judge',
        validFrom: '2026-01-01T00:00:00Z',
      });
      const both = { ...f.input, personIds: [f.target, f.other] };
      await expect(f.resolve(f.account, both)).resolves.toEqual({
        status: 'none',
      });
      await native.db
        .insert(evaluationNodeSubjects)
        .values({ evaluationNodeId: f.node, personId: f.other });
      await native.db.insert(evaluationRelations).values({
        id: f.prefix + '-common',
        evaluationNodeId: f.node,
        personId: f.other,
        evaluatorId: f.evaluator,
        kind: 'evaluator',
        validFrom: '2026-01-01T00:00:00Z',
      });
      await expect(f.resolve(f.account, both)).resolves.toEqual({
        status: 'unique',
        evaluationNodeId: f.node,
      });
    });
    it.each(['revokedAt', 'validTo', 'validFrom'] as const)(
      'reloads current %s on every call',
      async (field) => {
        const f = await fixture();
        await expect(f.resolve(f.account, f.input)).resolves.toMatchObject({
          status: 'unique',
        });
        await native.db
          .update(evaluationRelations)
          .set({
            [field]:
              field === 'validFrom' ? '2099-01-01T00:00:00Z' : businessAt,
          })
          .where(eq(evaluationRelations.id, f.relation));
        await expect(f.resolve(f.account, f.input)).resolves.toEqual({
          status: 'none',
        });
      },
    );
    it('reloads account rebinding and cannot reuse a previously unique result', async () => {
      const f = await fixture();
      await expect(f.resolve(f.account, f.input)).resolves.toMatchObject({
        status: 'unique',
      });
      await native.db
        .update(accountBindings)
        .set({ personId: f.other })
        .where(eq(accountBindings.accountId, f.account));
      await expect(f.resolve(f.account, f.input)).resolves.toEqual({
        status: 'none',
      });
    });
    it('rejects noReview subjects without blocking an eligible noReview evaluator', async () => {
      const f = await fixture();
      await native.db
        .update(people)
        .set({ noReview: true })
        .where(eq(people.id, f.evaluator));
      await expect(f.resolve(f.account, f.input)).resolves.toMatchObject({
        status: 'unique',
      });
      await native.db
        .update(people)
        .set({ noReview: true })
        .where(eq(people.id, f.target));
      await expect(f.resolve(f.account, f.input)).resolves.toEqual({
        status: 'none',
      });
    });
    it('uses current native project permission, including membership expiry and grant revocation', async () => {
      const f = await fixture();
      const id = f.prefix + '-project';
      await native.db.insert(projects).values({
        id,
        name: '演示项目',
        type: '演示',
        status: '进行中',
        goal: '合成验证',
        organizationId: f.prefix + '-org',
        cohortId: f.cohort,
        creatorId: f.other,
        from: '2026-01-01',
        to: '2026-12-31',
      });
      const input = { ...f.input, projectId: id };
      await expect(f.resolve(f.account, input)).resolves.toEqual({
        status: 'none',
      });
      await native.db.insert(members).values({
        id: f.prefix + '-member',
        projectId: id,
        personId: f.evaluator,
        role: '演示',
        mode: '演示',
        validFrom: '2026-01-01',
        by: '演示',
      });
      await expect(f.resolve(f.account, input)).resolves.toMatchObject({
        status: 'unique',
      });
      await native.db
        .update(members)
        .set({ validTo: '2026-09-04' })
        .where(eq(members.id, f.prefix + '-member'));
      await expect(f.resolve(f.account, input)).resolves.toEqual({
        status: 'none',
      });
      await native.db
        .update(members)
        .set({ validTo: null })
        .where(eq(members.id, f.prefix + '-member'));
      await native.db
        .update(grants)
        .set({ revokedAt: '2026-09-04' })
        .where(eq(grants.accountId, f.account));
      await expect(f.resolve(f.account, input)).resolves.toEqual({
        status: 'none',
      });
    });
    it('denies system-admin identity even with a matching relation', async () => {
      const f = await fixture();
      await native.db
        .update(accountBindings)
        .set({ isSystemAdmin: true })
        .where(eq(accountBindings.accountId, f.account));
      await expect(f.resolve(f.account, f.input)).resolves.toEqual({
        status: 'none',
      });
    });
  },
);
