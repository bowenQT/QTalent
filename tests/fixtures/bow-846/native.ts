import { randomUUID } from 'node:crypto';
import type { Database } from '../../../src/server/db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../../src/server/modules/directory';
import {
  cohorts,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../../../src/server/modules/programs';
import { projects } from '../../../src/server/modules/staffing';
import {
  dimensions,
  anchors,
  ruleVersions,
  ruleVersionApplicability,
} from '../../../src/server/modules/evaluation-system';
import {
  originals,
  originalVersions,
  fragments,
  events,
  eventSources,
  storeTrustedRecordDraftBatch,
} from '../../../src/server/modules/records';
import type {
  RecordBatchDraft,
  RecordSaveInput,
} from '../../../src/contracts/record';

export const businessNow = '2026-11-01T00:00:00.000Z';
export const wallStart = '2026-11-01T10:00:00.000Z';
export async function seedRecordRules(db: Database) {
  await db.insert(dimensions).values({
    id: 'native-prof',
    name: '演示专业度',
    axis: 'prof',
    core: true,
  });
  await db.insert(ruleVersions).values([
    { id: 'rubric-v1', provenance: 'published' },
    { id: 'rubric-v2', provenance: 'published' },
  ]);
  await db.insert(ruleVersionApplicability).values([
    {
      periodId: 'native-rule-period-v1',
      versionId: 'rubric-v1',
      category: 'dimension_anchors',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveUntil: new Date(businessNow),
    },
    {
      periodId: 'native-rule-period-v2',
      versionId: 'rubric-v2',
      category: 'dimension_anchors',
      effectiveFrom: new Date(businessNow),
      effectiveUntil: null,
    },
  ]);
  await db.insert(anchors).values(
    [1, 2, 3, 4, 5].flatMap((value) => [
      {
        id: 'native-v1-' + value,
        dimensionId: 'native-prof',
        ruleVersionId: 'rubric-v1',
        value,
        text: '演示旧版锚点 ' + value,
      },
      {
        id: 'native-v2-' + value,
        dimensionId: 'native-prof',
        ruleVersionId: 'rubric-v2',
        value,
        text: '演示新版锚点 ' + value,
      },
    ]),
  );
}

/** All identities and material are synthetic; never load deployment or vendor facts. */
export async function seedRecordCase(
  db: Database,
  options: {
    unknown?: boolean;
    invalidDimension?: boolean;
    secondDraft?: boolean;
    project?: boolean;
  } = {},
) {
  const id = 'demo-' + randomUUID();
  const names = [
    'one',
    'two',
    'rater-one',
    'rater-two',
    'manager',
    'outsider',
  ] as const;
  const person = Object.fromEntries(
    names.map((name) => [name, id + '-' + name]),
  ) as Record<(typeof names)[number], string>;
  const account = {
    one: id + '-account-one',
    two: id + '-account-two',
    manager: id + '-account-manager',
    outsider: id + '-account-outsider',
    admin: id + '-account-admin',
  };
  const node = id + '-node';
  const cohortId = id + '-cohort';
  const projectId = id + '-project';
  await db
    .insert(organizations)
    .values({ id, name: '演示组织', shortName: '演示团队' });
  await db.insert(people).values(
    names.map((name) => ({
      id: person[name],
      organizationId: id,
      name: '演示 ' + name,
      demo: true,
      noReview: false,
    })),
  );
  await db.insert(accountBindings).values([
    { accountId: account.one, personId: person['rater-one'] },
    { accountId: account.two, personId: person['rater-two'] },
    { accountId: account.manager, personId: person.manager },
    { accountId: account.outsider, personId: person.outsider },
    {
      accountId: account.admin,
      personId: person['rater-one'],
      isSystemAdmin: true,
    },
  ]);
  await db.insert(grants).values({
    id: id + '-manager-grant',
    accountId: account.manager,
    role: 'manager',
    scope: 'company',
    validFrom: '2026-01-01',
  });
  await db.insert(cohorts).values({ id: cohortId, name: '演示期次' });
  await db.insert(evaluationNodes).values([
    { id: node, name: '演示节点', kind: 'program_cohort', cohortId },
    { id: id + '-other-node', name: '演示另一节点', kind: 'defense', cohortId },
  ]);
  await db.insert(evaluationNodeSubjects).values([
    { evaluationNodeId: node, personId: person.one },
    { evaluationNodeId: node, personId: person.two },
    { evaluationNodeId: id + '-other-node', personId: person.one },
  ]);
  await db.insert(evaluationRelations).values([
    {
      id: id + '-relation-one',
      evaluationNodeId: node,
      personId: person.one,
      evaluatorId: person['rater-one'],
      kind: 'evaluator',
      validFrom: '2026-01-01T00:00:00Z',
    },
    {
      id: id + '-relation-two',
      evaluationNodeId: node,
      personId: person.one,
      evaluatorId: person['rater-two'],
      kind: 'evaluator',
      validFrom: '2026-01-01T00:00:00Z',
    },
    {
      id: id + '-relation-manager',
      evaluationNodeId: node,
      personId: person.one,
      evaluatorId: person.manager,
      kind: 'evaluator',
      validFrom: '2026-01-01T00:00:00Z',
    },
  ]);
  await db.insert(projects).values({
    id: projectId,
    name: '演示课题',
    type: '课题',
    status: '进行中',
    goal: '演示目标',
    organizationId: id,
    cohortId,
    isTopic: true,
    creatorId: person.manager,
    from: '2026-01-01',
    to: '2026-12-31',
  });
  const originalId = id + '-original';
  const versionId = id + '-version';
  const fragmentId = id + '-fragment';
  const sourceEventId = id + '-source-event';
  const excerpt = '演示：完成任务并逐一记录验证。';
  const reference = {
    fragmentId,
    originalVersionId: versionId,
    location: { kind: 'document' as const, paragraph: '1' },
  };
  await db
    .insert(originals)
    .values({ id: originalId, title: '演示原件', kind: 'original' });
  await db.insert(originalVersions).values({
    id: versionId,
    originalId,
    version: 1,
    contentDigest: 'synthetic-material-content',
  });
  await db.insert(fragments).values({
    id: fragmentId,
    originalVersionId: versionId,
    location: reference.location,
    excerpt,
  });
  await db.insert(events).values({
    id: sourceEventId,
    evaluationNodeId: node,
    personId: person.one,
    recorderId: person.manager,
    projectId: null,
    occurredOn: '2026-09-01',
    title: '演示出处事实',
    situation: '',
    behavior: excerpt,
    impact: '',
    ruleVersionId: 'rubric-v1',
    demo: false,
  });
  await db.insert(eventSources).values({
    eventId: sourceEventId,
    fragmentId,
    originalVersionId: versionId,
  });
  const dimensionId = options.invalidDimension
    ? id + '-missing-dimension'
    : 'native-prof';
  const draft: RecordBatchDraft = {
    batchId: id + '-batch',
    evaluationNodeId: node,
    draftId: id + '-draft',
    revision: 1,
    origin: 'ai_suggestion',
    personIds: [person.one],
    projectId: options.project ? projectId : null,
    sourceReferences: [reference],
    dimensionVersionId: 'rubric-v1',
    anchorVersionId: 'rubric-v1',
    sbi: {
      title: '演示人工确认记录',
      situation: '',
      behavior: excerpt,
      impact: '',
    },
    scores:
      options.unknown || options.invalidDimension
        ? [
            {
              personId: person.one,
              dimensionId,
              state: 'unknown',
              reason: '演示：证据不足以建议分数',
            },
          ]
        : [
            {
              personId: person.one,
              dimensionId,
              state: 'suggested',
              value: 3,
              anchor: {
                id: 'native-v1-3',
                text: '演示旧版锚点 3',
                ruleVersion: 'rubric-v1',
              },
              citations: [{ kind: 'source', quote: excerpt, reference }],
            },
          ],
  };
  const otherDraft = {
    ...structuredClone(draft),
    draftId: id + '-draft-two',
    sbi: { ...draft.sbi, title: '演示第二件事' },
  };
  const originalInput = {
    operation_id: id + '-original-operation',
    text: '  演示原话\n保持原样。  ',
    attachmentIds: [] as string[],
    personId: null,
    projectId: draft.projectId,
  };
  await db.transaction((tx) =>
    storeTrustedRecordDraftBatch(tx, {
      draftSet: {
        batchId: draft.batchId,
        revision: 1,
        duplicateCandidates: [],
        drafts: options.secondDraft ? [draft, otherDraft] : [draft],
      },
      originalInput,
      occurredOn: '2026-09-01',
      modelVersion: 'synthetic-model-846',
      createdByAccountId: account.one,
      createdAt: new Date(wallStart),
    }),
  );
  const input: RecordSaveInput = {
    operation_id: id + '-save',
    expected_revision: 1,
    draftId: draft.draftId,
    personIds: draft.personIds,
    projectId: draft.projectId,
    sbi: draft.sbi,
    decisions:
      options.unknown || options.invalidDimension
        ? [
            {
              personId: person.one,
              dimensionId,
              action: 'unknown',
              reason: '演示人工确认资料不足',
            },
          ]
        : [{ personId: person.one, dimensionId, action: 'confirm' }],
  };
  let wall = Date.parse(wallStart);
  return {
    id,
    account,
    person,
    draft,
    otherDraft,
    input,
    originalInput,
    node,
    projectId,
    sourceEventId,
    fragmentId,
    versionId,
    relationOne: id + '-relation-one',
    relationTwo: id + '-relation-two',
    clock: {
      businessNow: () => businessNow,
      wallNow: () => new Date(wall).toISOString(),
    },
    setWall: (elapsed: number) => {
      wall = Date.parse(wallStart) + elapsed;
    },
  };
}
