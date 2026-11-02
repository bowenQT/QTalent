import type { PersonData } from './person-data';
export function fixture(
  role: 'manager' | 'hr' | 'mentor' | 'admin' = 'manager',
): PersonData {
  const validity = {
    validFrom: '2026-01-01',
    validTo: null,
    revokedAt: null,
  };
  const people = ['one', 'two', 'actor'].map((id) => ({
    id,
    name: 'Synthetic ' + id,
    organizationId: 'org',
    jobTitle: null,
    jobLevel: null,
    photo: null,
    hue: 220,
    noReview: false,
    demo: true,
  }));
  const account = {
    id: 'account',
    personId: 'actor',
    isSystemAdmin: role === 'admin',
  };
  const company = role === 'manager' || role === 'admin';
  const businessRole = role === 'admin' ? 'manager' : role;
  const grants: PersonData['context']['grants'] = [
    {
      accountId: 'account',
      role: businessRole,
      scope: company ? 'company' : 'cohort',
      cohortId: company ? null : 'cohort',
      ...validity,
    },
  ];
  const context: PersonData['context'] = {
    account,
    grants,
    now: '2026-07-01',
    people,
    projects: [],
    members: [],
    enrollments: [
      {
        personId: 'one',
        cohortId: 'cohort',
        confirmed: true,
        ...validity,
      },
    ],
    assignments: [
      {
        personId: 'actor',
        studentId: 'one',
        cohortId: 'cohort',
        kind: 'mentor',
        ...validity,
      },
    ],
  };
  const data: PersonData = {
    context,
    directory: {
      account,
      grants: grants.map((grant) => ({ ...grant, id: 'grant' })),
      people,
      organizations: [
        {
          id: 'org',
          name: 'Synthetic org',
          shortName: 'Test',
          parentId: null,
          hierarchyKnown: false,
          isGroup: false,
        },
      ],
    },
    staffing: { projects: [], members: [] },
    events: [],
    participants: [],
    eventSources: [],
    statements: [],
    originals: [
      {
        id: 'original',
        title: 'Synthetic snapshot',
        kind: 'prototype_snapshot',
        displayNotice: '原型基线 2e51b50，评语按原意压缩',
      },
    ],
    versions: [
      {
        id: 'version',
        originalId: 'original',
        version: 1,
        contentDigest: 'synthetic',
        sourceCommit: '2e51b50',
        sourceBlob: 'synthetic-blob',
        sourcePath: 'synthetic',
      },
    ],
    fragments: [],
    historical: [],
    historicalParticipants: [],
    anchors: [],
    dimensions: [
      { id: 'prof', name: '专业度', axis: 'prof', core: true },
      { id: 'mot', name: '内生动力', axis: 'pot', core: true },
      { id: 'grit', name: '坚毅力', axis: 'pot', core: true },
    ],
    confirmations: [],
    cohorts: [{ id: 'cohort', name: 'Synthetic cohort' }],
    employments: [
      {
        id: 'employment-one',
        personId: 'one',
        organizationId: 'org',
        validFrom: '2025-01-01',
        validTo: null,
      },
    ],
  };
  for (let i = 0; i < 2; i++) {
    const eventId = 'event-' + i;
    const fragmentId = 'fragment-' + i;
    const reference = { fragmentId, originalVersionId: 'version' };
    data.events.push({
      id: eventId,
      personId: 'one',
      recorderId: 'actor',
      projectId: null,
      // Synthetic legacy fixture; node-aware cases supply explicit node facts.
      evaluationNodeId: null,
      occurredOn: '2026-06-01',
      title: 'Synthetic event',
      situation: 'Synthetic',
      behavior: 'Synthetic behavior',
      impact: '',
      ruleVersionId: 'rubric-v1',
      demo: true,
      withdrawnAt: null,
    });
    data.fragments.push({
      id: fragmentId,
      originalVersionId: 'version',
      excerpt: 'Synthetic observation',
      location: {
        kind: 'snapshot_field',
        fieldPath: eventId + '.srcs[0]',
      },
    });
    data.eventSources.push({ eventId, ...reference });
    data.statements.push({
      id: 'statement-' + i,
      eventId,
      text: 'Synthetic fact',
      kind: 'original_fact',
      authorId: 'actor',
      modelVersion: null,
      uncertainty: null,
      ...reference,
    });
    for (const dimensionId of ['prof', i === 0 ? 'mot' : 'grit']) {
      const id = eventId + '-' + dimensionId;
      if (!data.anchors.some((anchor) => anchor.id === dimensionId))
        data.anchors.push({
          id: dimensionId,
          dimensionId,
          ruleVersionId: 'rubric-v1',
          value: 4,
          text: 'Synthetic anchor',
        });
      data.confirmations.push({
        id,
        eventId,
        dimensionId,
        evaluatorId: 'actor',
        sourceCategory: 'prototype_baseline',
        confirmedAt: null,
        ruleVersionId: 'rubric-v1',
        status: 'scored',
        value: 4,
        anchorId: dimensionId,
        revision: 1,
        active: true,
        modifiedBy: null,
        reason: null,
        previousId: null,
        previousRevision: null,
        suggestionId: null,
        ...reference,
      });
    }
  }
  return data;
}

export function nodeFixture() {
  const data = fixture('mentor');
  Object.assign(data.context, {
    evaluationNodes: [
      { id: 'node-current', kind: 'program_cohort', cohortId: 'cohort' },
      { id: 'node-other', kind: 'defense', cohortId: 'cohort' },
    ],
    evaluationNodeSubjects: [
      { evaluationNodeId: 'node-current', personId: 'one' },
      { evaluationNodeId: 'node-other', personId: 'one' },
    ],
    evaluationRelations: [
      {
        id: 'relation-current',
        evaluationNodeId: 'node-current',
        personId: 'one',
        evaluatorId: 'actor',
        kind: 'mentor',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: null,
        revokedAt: null,
      },
    ],
  });
  for (const event of data.events) event.evaluationNodeId = 'node-current';
  return data;
}
