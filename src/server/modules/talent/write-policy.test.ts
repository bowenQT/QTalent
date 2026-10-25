import { describe, expect, it } from 'vitest';
import type { AuthzContext } from '../../authz';
import {
  confirmationReviewReasons,
  canConfirmOwnScore,
  isUndoWindowOpen,
} from './write-policy';

const validity = { validFrom: '2026-01-01', validTo: null, revokedAt: null };
const subject = { personId: 'student', cohortId: 'cohort' };
function context(): AuthzContext {
  return {
    account: { id: 'account', personId: 'mentor', isSystemAdmin: false },
    now: '2026-10-25',
    grants: [
      {
        accountId: 'account',
        role: 'mentor',
        scope: 'cohort',
        cohortId: 'cohort',
        ...validity,
      },
    ],
    enrollments: [{ ...subject, confirmed: true, ...validity }],
    assignments: [
      {
        cohortId: 'cohort',
        personId: 'mentor',
        studentId: 'student',
        kind: 'mentor',
        ...validity,
      },
    ],
    people: [{ id: 'student', noReview: false }],
    projects: [],
    members: [],
  };
}
describe('confirmation review reasons', () => {
  it.each([
    [1, '', []],
    [2, '', ['ai_changed_without_reason', 'score_gap']],
    [3, '', ['ai_changed_without_reason', 'score_gap']],
    [2, '   ', ['ai_changed_without_reason', 'score_gap']],
    [2, 'observed another behavior', ['score_gap']],
    [3, 'observed another behavior', ['score_gap']],
  ])('score gap %s with reason %s', (gap, reason, expected) => {
    expect(
      confirmationReviewReasons({
        value: 1 + Number(gap),
        aiValue: 1,
        reason: String(reason),
        evaluatorId: 'mentor',
        peers: [{ evaluatorId: 'other', value: 1 }],
      }),
    ).toEqual(expected);
    expect(
      confirmationReviewReasons({
        value: 1,
        aiValue: 1 + Number(gap),
        reason: String(reason),
        evaluatorId: 'mentor',
        peers: [{ evaluatorId: 'other', value: 1 + Number(gap) }],
      }),
    ).toEqual(expected);
  });
  it('does not compare unknown scores or same evaluator', () => {
    expect(
      confirmationReviewReasons({
        value: null,
        aiValue: 5,
        reason: '',
        evaluatorId: 'mentor',
        peers: [{ evaluatorId: 'other', value: 5 }],
      }),
    ).toEqual([]);
    expect(
      confirmationReviewReasons({
        value: 1,
        aiValue: null,
        reason: '',
        evaluatorId: 'mentor',
        peers: [
          { evaluatorId: 'mentor', value: 5 },
          { evaluatorId: 'other', value: null },
        ],
      }),
    ).toEqual([]);
  });
});
describe('confirming own scores', () => {
  it('permits an active mentor for their own assigned learner score', () => {
    expect(canConfirmOwnScore(context(), subject, 'mentor')).toBe(true);
  });
  it('rejects impersonation, unassigned learners, withdrawn grants and administrators', () => {
    const ctx = context();
    expect(canConfirmOwnScore(ctx, subject, 'other')).toBe(false);
    expect(
      canConfirmOwnScore(ctx, { ...subject, personId: 'other' }, 'mentor'),
    ).toBe(false);
    expect(
      canConfirmOwnScore({ ...ctx, assignments: [] }, subject, 'mentor'),
    ).toBe(false);
    expect(canConfirmOwnScore({ ...ctx, grants: [] }, subject, 'mentor')).toBe(
      false,
    );
    expect(
      canConfirmOwnScore(
        {
          ...ctx,
          account: { ...ctx.account, isSystemAdmin: true },
        },
        subject,
        'mentor',
      ),
    ).toBe(false);
  });
  it('does not turn management read permission into confirmation permission', () => {
    const ctx = context();
    ctx.grants = [
      {
        accountId: 'account',
        role: 'manager',
        scope: 'company',
        cohortId: null,
        ...validity,
      },
    ];
    expect(canConfirmOwnScore(ctx, subject, 'mentor')).toBe(false);
  });
});
describe('server undo window', () => {
  it.each([
    [0, true],
    [4999, true],
    [5000, false],
    [5001, false],
    [-1, false],
  ])('elapsed %s is allowed: %s', (elapsed, allowed) => {
    expect(isUndoWindowOpen(10_000, 10_000 + Number(elapsed))).toBe(allowed);
  });
});
