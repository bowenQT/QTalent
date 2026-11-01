import type { ArrangeSnapshot, ModelArrangement } from './schema';

/** Fixed pseudonymous regression inputs. None is a production fallback or real HR material. */
export const arrangeExamples = [
  {
    id: 'demo-text',
    origin: 'text',
    personId: 'demo-lin',
    name: '林舟',
    text: '林舟补写回滚步骤。',
    location: { kind: 'document', paragraph: '一句话输入' },
  },
  {
    id: 'demo-recording',
    origin: 'recording',
    personId: 'demo-xu',
    name: '许禾',
    text: '许禾复现并记录边界条件。',
    location: { kind: 'recording', startMs: 1200, endMs: 4200 },
  },
  {
    id: 'demo-attachment',
    origin: 'attachment',
    personId: 'demo-zhou',
    name: '周岚',
    text: '周岚组织两次验证。',
    location: { kind: 'document', page: 2, paragraph: '3' },
  },
] satisfies Array<{
  id: string;
  origin: ArrangeSnapshot['origin'];
  personId: string;
  name: string;
  text: string;
  location: ArrangeSnapshot['authorization']['sources'][number]['location'];
}>;
export function exampleSnapshot(
  example = arrangeExamples[0]!,
): ArrangeSnapshot {
  const fragmentId = `fragment-${example.origin}`;
  const subject = { personId: example.personId, cohortId: 'cohort-demo' };
  return {
    draftId: `draft-${example.id}`,
    creatorAccountId: 'demo-account',
    inputVersion: 'input-v1',
    originalInput: {
      operation_id: 'demo-operation',
      text: example.text,
      attachmentIds: [],
      personId: example.personId,
      projectId: null,
    },
    origin: example.origin,
    people: [{ state: 'resolved', id: example.personId }],
    project: { state: 'none' },
    requestedSources: [
      {
        fragmentId,
        originalVersionId: 'original-v1',
        attributedPersonIds: [example.personId],
      },
    ],
    inputSource:
      example.origin === 'text'
        ? { fragmentId, originalVersionId: 'original-v1' }
        : null,
    ruleVersionId: 'rule-current',
    dimensions: ['judgment'],
    anchors: [
      {
        id: 'anchor-judgment-4',
        dimensionId: 'judgment',
        ruleVersionId: 'rule-current',
        value: 4,
        text: '通过验证定位边界',
      },
    ],
    authorization: {
      context: {
        account: {
          id: 'demo-account',
          personId: 'demo-rater',
          isSystemAdmin: false,
        },
        now: '2026-10-25',
        people: ['demo-lin', 'demo-xu', 'demo-zhou'].map((id) => ({
          id,
          noReview: false,
        })),
        projects: [],
        members: [],
        assignments: [],
        grants: [
          {
            accountId: 'demo-account',
            role: 'hr',
            scope: 'cohort',
            cohortId: 'cohort-demo',
            validFrom: '2026-01-01',
            validTo: null,
            revokedAt: null,
          },
        ],
        enrollments: ['demo-lin', 'demo-xu', 'demo-zhou'].map((personId) => ({
          personId,
          cohortId: 'cohort-demo',
          confirmed: true,
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        })),
      },
      records: [
        {
          id: `record-${example.id}`,
          subject,
          kind: 'evaluation',
          fields: [
            {
              name: 'excerpt',
              kind: 'evaluation',
              value: example.text,
              subjects: [],
              sources: [{ fragmentId, originalVersionId: 'original-v1' }],
            },
          ],
        },
      ],
      sources: [
        {
          fragmentId,
          originalVersionId: 'original-v1',
          subjects: [subject],
          kind: 'evaluation',
          excerpt: example.text,
          location: example.location,
        },
      ],
    },
  };
}
export function exampleResponse(
  example = arrangeExamples[0]!,
): ModelArrangement {
  return {
    sbi: {
      title: `${example.name}的验证记录（演示）`,
      situation: '',
      behavior: example.text,
      impact: '',
    },
    scores: [
      {
        state: 'suggested',
        personId: example.personId,
        dimensionId: 'judgment',
        value: 4,
        anchor: {
          id: 'anchor-judgment-4',
          ruleVersion: 'rule-current',
          text: '通过验证定位边界',
        },
        citations: [
          {
            kind: 'source',
            quote: example.text,
            reference: {
              fragmentId: `fragment-${example.origin}`,
              originalVersionId: 'original-v1',
              location: example.location,
            },
          },
        ],
      },
    ],
  };
}
