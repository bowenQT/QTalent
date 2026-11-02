import { describe, expect, it } from 'vitest';
import type { BusinessRole, Grant, Validity } from '../authz';
import type {
  EvaluationAuthzContext,
  EvaluationRelation,
} from '../authz/evaluation-node';
import { comparisonAccess } from './judge-access';

const now = '2026-10-31T12:00:00.000Z';
const validity: Validity = {
  validFrom: '2026-10-01T00:00:00.000Z',
  validTo: null,
  revokedAt: null,
};
const selection = 'demo-selection-node';
const closing = 'demo-closing-node';
const elsewhere = 'demo-other-cohort-node';
const talent = 'demo-talent-001';
const rater = 'demo-rater-001';
const cohortId = 'demo-cohort-a';

function grant(role: BusinessRole, overrides: Partial<Grant> = {}): Grant {
  return {
    accountId: 'demo-account',
    role,
    scope: role === 'manager' ? 'company' : 'cohort',
    cohortId: role === 'manager' ? null : cohortId,
    ...validity,
    ...overrides,
  };
}
function relation(
  overrides: Partial<EvaluationRelation> = {},
): EvaluationRelation {
  return {
    id: 'demo-relation',
    evaluationNodeId: selection,
    evaluatorId: rater,
    personId: talent,
    kind: 'judge',
    ...validity,
    ...overrides,
  };
}
function context(
  overrides: Partial<EvaluationAuthzContext> = {},
): EvaluationAuthzContext {
  return {
    account: { id: 'demo-account', personId: rater, isSystemAdmin: false },
    now,
    grants: [],
    enrollments: [{ cohortId, personId: talent, confirmed: true, ...validity }],
    assignments: [],
    projects: [],
    members: [],
    people: [
      { id: talent, noReview: false },
      { id: rater, noReview: false },
    ],
    evaluationNodes: [
      { id: selection, kind: 'interview', cohortId },
      { id: closing, kind: 'defense', cohortId },
      { id: elsewhere, kind: 'defense', cohortId: 'demo-cohort-b' },
    ],
    evaluationNodeSubjects: [
      { evaluationNodeId: selection, personId: talent },
      { evaluationNodeId: closing, personId: talent },
      { evaluationNodeId: elsewhere, personId: talent },
    ],
    evaluationRelations: [],
    ...overrides,
  };
}
const open = { validFrom: validity.validFrom, validUntil: null };

describe('comparisonAccess', () => {
  it('gives an admin or a viewer without a business role no comparison access', () => {
    expect(
      comparisonAccess(
        context({
          account: { id: 'demo-account', personId: rater, isSystemAdmin: true },
          grants: [grant('manager')],
        }),
      ),
    ).toBeNull();
    expect(comparisonAccess(context())).toBeNull();
  });

  it('reads every node subject through the company grant for a manager', () => {
    const access = comparisonAccess(
      context({ grants: [grant('manager'), grant('hr')] }),
    );
    expect(access).toEqual({
      audience: 'manager',
      viewerId: rater,
      now,
      grants: [
        { personId: talent, nodeId: selection, ...open },
        { personId: talent, nodeId: closing, ...open },
        { personId: talent, nodeId: elsewhere, ...open },
      ],
    });
  });

  it('scopes HR to its cohort and skips no-review people', () => {
    const ending = '2026-12-31T00:00:00.000Z';
    const access = comparisonAccess(
      context({
        grants: [grant('hr', { validTo: ending })],
        enrollments: [
          { cohortId, personId: talent, confirmed: false, ...validity },
          {
            cohortId,
            personId: 'demo-talent-002',
            confirmed: true,
            ...validity,
          },
        ],
        people: [
          { id: talent, noReview: false },
          { id: 'demo-talent-002', noReview: true },
        ],
        evaluationNodeSubjects: [
          { evaluationNodeId: selection, personId: talent },
          { evaluationNodeId: elsewhere, personId: talent },
          { evaluationNodeId: selection, personId: 'demo-talent-002' },
        ],
      }),
    );
    expect(access?.audience).toBe('hr');
    // An unconfirmed enrollment only covers nodes of its own cohort.
    expect(access?.grants).toEqual([
      {
        personId: talent,
        nodeId: selection,
        validFrom: validity.validFrom,
        validUntil: ending,
      },
    ]);
  });

  it('gives a rater only their own current relations, ending at the earliest end', () => {
    const revokedAt = '2026-11-15T00:00:00.000Z';
    const access = comparisonAccess(
      context({
        grants: [grant('mentor')],
        evaluationRelations: [
          relation({ validTo: '2026-12-01T00:00:00.000Z', revokedAt }),
          relation({
            id: 'demo-expired',
            evaluationNodeId: closing,
            validTo: '2026-10-15T00:00:00.000Z',
          }),
          relation({
            id: 'demo-revoked',
            evaluationNodeId: elsewhere,
            revokedAt: '2026-10-20T00:00:00.000Z',
          }),
          relation({
            id: 'demo-someone-else',
            evaluationNodeId: closing,
            evaluatorId: 'demo-rater-002',
          }),
        ],
      }),
    );
    expect(access).toEqual({
      audience: 'rater',
      viewerId: rater,
      now,
      grants: [
        {
          personId: talent,
          nodeId: selection,
          validFrom: validity.validFrom,
          validUntil: revokedAt,
        },
      ],
    });
  });

  it('gives a rater without a current relation an empty scope, not a wider one', () => {
    expect(comparisonAccess(context({ grants: [grant('mentor')] }))).toEqual({
      audience: 'rater',
      viewerId: rater,
      now,
      grants: [],
    });
  });
});
