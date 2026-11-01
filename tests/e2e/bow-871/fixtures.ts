import type { AuthzContext } from '@/server/authz';
import type { LoadTalentSnapshot, TalentSource } from '@/server/authz/talent';

export type DemoRole = 'manager' | 'hr' | 'mentor' | 'admin';
export type TalentSnapshot = Awaited<ReturnType<LoadTalentSnapshot>>;

/** Synthetic boundary inputs, not copied personnel data or production grants. */
export function evidenceFixture(role: DemoRole): TalentSnapshot {
  const validity = {
    validFrom: '2026-01-01T00:00:00Z',
    validTo: null,
    revokedAt: null,
  };
  const subject = { personId: 'demo-in-scope', cohortId: 'demo-six' };
  const outside = { personId: 'demo-outside', cohortId: 'demo-other' };
  const company = role === 'manager' || role === 'admin';
  const context: AuthzContext = {
    account: {
      id: 'demo-account',
      personId: 'demo-evaluator',
      isSystemAdmin: role === 'admin',
    },
    now: '2026-10-31T10:00:00Z',
    grants: [
      {
        accountId: 'demo-account',
        role: role === 'admin' ? 'manager' : role,
        scope: company ? 'company' : 'cohort',
        cohortId: company ? null : 'demo-six',
        ...validity,
      },
    ],
    enrollments: [{ ...subject, confirmed: true, ...validity }],
    assignments: [
      {
        personId: 'demo-evaluator',
        studentId: subject.personId,
        cohortId: 'demo-six',
        kind: 'mentor',
        ...validity,
      },
    ],
    projects: [],
    members: [],
    people: [subject, outside].map(({ personId }) => ({
      id: personId,
      noReview: false,
    })),
  };
  const source = (
    fragmentId: string,
    subjects: TalentSource['subjects'],
    excerpt: string,
    kind: TalentSource['kind'] = 'evaluation',
  ): TalentSource => ({
    fragmentId,
    originalVersionId: 'demo-original-v1',
    subjects,
    kind,
    excerpt,
    location: { kind: 'spreadsheet', sheet: '演示评审表', cell: 'A2:D2' },
  });
  const sources = [
    source('demo-allowed', [subject], '演示：记录一次片段重试行为。'),
    source('demo-mixed', [subject, outside], '演示：同一片段含范围外人员。'),
    source('demo-outside-source', [outside], '演示：范围外人员的原文。'),
    source(
      'demo-personnel-source',
      [subject],
      '演示：历史人事材料。',
      'performance',
    ),
  ];
  const reference = (fragmentId: string) => ({
    fragmentId,
    originalVersionId: 'demo-original-v1',
  });
  return {
    context,
    sources,
    records: [
      {
        id: 'demo-record',
        subject,
        kind: 'evaluation',
        fields: [
          {
            name: 'fact',
            kind: 'evaluation',
            value: '演示：独立复现了失败片段。',
            subjects: [],
            sources: [reference('demo-allowed')],
          },
          {
            name: 'mixedClaim',
            kind: 'evaluation',
            value: 'DEMO_MIXED_PRIVATE',
            subjects: [],
            sources: [reference('demo-mixed')],
          },
          {
            name: 'inferredClaim',
            kind: 'ai-inference',
            value: 'DEMO_MIXED_INFERENCE',
            subjects: [],
            sources: [reference('demo-mixed')],
          },
        ],
      },
      {
        id: 'demo-outside-record',
        subject: outside,
        kind: 'evaluation',
        fields: [
          {
            name: 'fact',
            kind: 'evaluation',
            value: 'DEMO_OUTSIDE_RECORD',
            subjects: [],
            sources: [reference('demo-outside-source')],
          },
        ],
      },
      {
        id: 'demo-personnel-record',
        subject,
        kind: 'performance',
        fields: [
          {
            name: 'historicalNote',
            kind: 'performance',
            value: 'DEMO_PERSONNEL_HISTORY',
            subjects: [],
            sources: [reference('demo-personnel-source')],
          },
        ],
      },
    ],
  };
}

export const allowedReference = {
  fragmentId: 'demo-allowed',
  originalVersionId: 'demo-original-v1',
};

export const mixedReference = {
  fragmentId: 'demo-mixed',
  originalVersionId: 'demo-original-v1',
};
