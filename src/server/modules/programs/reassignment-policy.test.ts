import { describe, expect, it } from 'vitest';
import {
  assignedEvaluationRelationIsCurrent,
  canWorkOnEvaluationItem,
  evaluationReassignmentFingerprint,
  planEvaluationReassignment,
} from './reassignment-policy';
import {
  evaluationWorkKindSchema,
  evaluationReassignmentReceiptSchema,
  reassignEvaluationWorkInputSchema,
  reassignEvaluationWorkResultSchema,
} from './reassignment-contract';
import {
  evaluationContextFixture,
  evaluationWorkFixture,
  reassignmentInputFixture as input,
  reassignmentNow,
} from './reassignment.fixtures';

describe('D13 ownership transfer and idempotent reassignment', () => {
  it.each(['pending', 'processing'] as const)(
    'transfers %s work without giving the former evaluator access',
    (state) => {
      const ctx = evaluationContextFixture();
      const old = { ...evaluationWorkFixture(), state };
      const result = planEvaluationReassignment(ctx, old, input, null);
      expect(result.replayed).toBe(false);
      expect(result.receipt).toEqual({
        workItemId: old.id,
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        kind: 'confirmation',
        resourceId: 'demo-draft',
        previousRelationId: 'demo-old-relation',
        previousEvaluatorId: 'demo-old-evaluator',
        assignedRelationId: 'demo-new-relation',
        assignedEvaluatorId: 'demo-new-evaluator',
        revision: 2,
        reassignedBy: 'demo-hr-account',
        reassignedAt: reassignmentNow,
      });
      const updated = {
        ...old,
        revision: result.receipt.revision,
        assignedRelationId: result.receipt.assignedRelationId,
        assignedEvaluatorId: result.receipt.assignedEvaluatorId,
      };
      ctx.account = {
        id: 'demo-old-account',
        personId: 'demo-old-evaluator',
        isSystemAdmin: false,
      };
      expect(canWorkOnEvaluationItem(ctx, old)).toBe(false);
      expect(canWorkOnEvaluationItem(ctx, updated)).toBe(false);
      ctx.account = {
        id: 'demo-new-account',
        personId: 'demo-new-evaluator',
        isSystemAdmin: false,
      };
      expect(canWorkOnEvaluationItem(ctx, old)).toBe(false);
      expect(canWorkOnEvaluationItem(ctx, updated)).toBe(true);
      expect(
        canWorkOnEvaluationItem(ctx, { ...updated, state: 'completed' }),
      ).toBe(false);
      expect(
        canWorkOnEvaluationItem(ctx, { ...updated, state: 'cancelled' }),
      ).toBe(false);
      ctx.evaluationRelations[1].revokedAt = ctx.now;
      expect(canWorkOnEvaluationItem(ctx, updated)).toBe(false);
    },
  );
  it('replays the stored receipt after state changes, but checks current HR authority first', () => {
    const ctx = evaluationContextFixture();
    const item = evaluationWorkFixture();
    const first = planEvaluationReassignment(ctx, item, input, null);
    const operation = {
      fingerprint: evaluationReassignmentFingerprint(input),
      receipt: first.receipt,
    };
    const changed = {
      ...item,
      assignedRelationId: first.receipt.assignedRelationId,
      assignedEvaluatorId: first.receipt.assignedEvaluatorId,
      revision: 2,
      state: 'completed' as const,
    };
    expect(planEvaluationReassignment(ctx, changed, input, operation)).toEqual({
      replayed: true,
      receipt: first.receipt,
    });
    expect(() =>
      planEvaluationReassignment(
        ctx,
        changed,
        {
          ...input,
          targetRelationId: 'changed-payload',
        },
        operation,
      ),
    ).toThrow('同一提交编号不能用于不同内容');
    ctx.grants[0].revokedAt = ctx.now;
    expect(() =>
      planEvaluationReassignment(ctx, changed, input, operation),
    ).toThrow('没有重新分派');
  });
  it('rejects missing work, stale revisions, completed work, and active original assignments', () => {
    const ctx = evaluationContextFixture();
    const item = evaluationWorkFixture();
    expect(() => planEvaluationReassignment(ctx, null, input, null)).toThrow(
      '不存在',
    );
    for (const changed of [
      { ...item, revision: 2 },
      { ...item, state: 'completed' as const },
      { ...item, state: 'cancelled' as const },
    ])
      expect(() =>
        planEvaluationReassignment(ctx, changed, input, null),
      ).toThrow('状态已变化');
    ctx.evaluationRelations[0].validTo = null;
    expect(assignedEvaluationRelationIsCurrent(ctx, item)).toBe(true);
    expect(() => planEvaluationReassignment(ctx, item, input, null)).toThrow(
      '状态已变化',
    );
  });
  it('rejects expired, foreign-node and wrong-subject successor relations', () => {
    for (const patch of [
      { validTo: reassignmentNow },
      { revokedAt: reassignmentNow },
      { validFrom: '2026-11-01T00:00:00.000Z' },
      { evaluationNodeId: 'demo-other-node' },
      { personId: 'other-person' },
      { evaluatorId: 'unknown-directory-person' },
    ]) {
      const ctx = evaluationContextFixture();
      Object.assign(ctx.evaluationRelations[1], patch);
      expect(() =>
        planEvaluationReassignment(ctx, evaluationWorkFixture(), input, null),
      ).toThrow('接手评价关系');
    }
  });
  it('does not let a manager, admin, evaluator or out-of-scope HR transfer work', () => {
    for (const mutate of [
      (ctx: ReturnType<typeof evaluationContextFixture>) => {
        ctx.grants[0].role = 'manager';
        ctx.grants[0].scope = 'company';
        ctx.grants[0].cohortId = null;
      },
      (ctx: ReturnType<typeof evaluationContextFixture>) => {
        ctx.account.isSystemAdmin = true;
      },
      (ctx: ReturnType<typeof evaluationContextFixture>) => {
        ctx.grants = [];
        ctx.account.personId = 'demo-new-evaluator';
      },
      (ctx: ReturnType<typeof evaluationContextFixture>) => {
        ctx.enrollments[0].cohortId = 'outside';
      },
    ]) {
      const ctx = evaluationContextFixture();
      mutate(ctx);
      expect(() =>
        planEvaluationReassignment(ctx, evaluationWorkFixture(), input, null),
      ).toThrow('没有重新分派');
    }
  });
  it('requires operation identity, revisions and typed conflicts without a forged actor', () => {
    expect(reassignEvaluationWorkInputSchema.parse(input)).toEqual(input);
    for (const patch of [
      { expectedRevision: 0 },
      { operationId: ' ' },
      { actorId: 'demo-forged' },
      { role: 'hr' },
    ])
      expect(
        reassignEvaluationWorkInputSchema.safeParse({ ...input, ...patch })
          .success,
      ).toBe(false);
    const conflict = { status: 'conflict', message: '版本已变化', input };
    expect(reassignEvaluationWorkResultSchema.parse(conflict)).toEqual(
      conflict,
    );
    expect(
      reassignEvaluationWorkResultSchema.safeParse({
        status: 'forbidden',
        message: '无权',
        input,
      }).success,
    ).toBe(false);
  });
});

it.each(['unknown_interviewer', 'unknown_interview_candidate'] as const)(
  'requires the assigned %s handler to retain current HR scope through completion',
  (kind) => {
    const ctx = evaluationContextFixture();
    ctx.account = {
      id: 'demo-new-account',
      personId: 'demo-new-evaluator',
      isSystemAdmin: false,
    };
    const item = {
      ...evaluationWorkFixture(),
      assignedRelationId: 'demo-new-relation',
      assignedEvaluatorId: 'demo-new-evaluator',
      kind,
    };
    expect(canWorkOnEvaluationItem(ctx, item)).toBe(false);
    ctx.grants = [{ ...ctx.grants[0], accountId: ctx.account.id }];
    expect(canWorkOnEvaluationItem(ctx, item)).toBe(true);
    ctx.grants[0].revokedAt = ctx.now;
    expect(canWorkOnEvaluationItem(ctx, item)).toBe(false);
  },
);

it.each(['unknown_project', 'unknown_interview_candidate'] as const)(
  'preserves the stable source item for a %s reassignment and replay',
  (kind) => {
    expect(evaluationWorkKindSchema.parse(kind)).toBe(kind);
    const ctx = evaluationContextFixture();
    const successorGrant = {
      ...ctx.grants[0],
      accountId: 'demo-new-account',
    };
    const context = {
      ...ctx,
      hrCandidateGrants: [
        {
          personId: 'demo-new-evaluator',
          accountId: 'demo-new-account',
          isSystemAdmin: false,
          grant: successorGrant,
        },
      ],
    };
    const work = {
      ...evaluationWorkFixture(),
      kind,
      resourceId: 'demo-review-item-1',
    };
    const first = planEvaluationReassignment(context, work, input, null);
    expect(
      evaluationReassignmentReceiptSchema.parse(first.receipt),
    ).toMatchObject({
      workItemId: work.id,
      kind,
      resourceId: work.resourceId,
    });
    const replay = planEvaluationReassignment(
      context,
      {
        ...work,
        state: 'completed',
        revision: 3,
        assignedRelationId: first.receipt.assignedRelationId,
        assignedEvaluatorId: first.receipt.assignedEvaluatorId,
      },
      input,
      {
        fingerprint: evaluationReassignmentFingerprint(input),
        receipt: first.receipt,
      },
    );
    expect(replay).toEqual({ replayed: true, receipt: first.receipt });
    const second = {
      ...work,
      id: 'demo-work-item-2',
      resourceId: 'demo-review-item-2',
    };
    expect(
      planEvaluationReassignment(
        context,
        second,
        {
          ...input,
          workItemId: second.id,
          operationId: 'demo-operation-2',
        },
        null,
      ).receipt.resourceId,
    ).toBe(second.resourceId);
  },
);
