import { describe, expect, it } from 'vitest';
import {
  buildAuthorizedModelInput,
  canReadTalent,
  readTalentSource,
  type TalentRecord,
  type TalentSource,
} from './talent';
import { evaluationContextFixture } from '../modules/programs/reassignment.fixtures';

function evaluatorContext() {
  const ctx = evaluationContextFixture();
  ctx.account = {
    id: 'demo-new-account',
    personId: 'demo-new-evaluator',
    isSystemAdmin: false,
  };
  ctx.grants = [
    {
      accountId: ctx.account.id,
      role: 'mentor',
      scope: 'cohort',
      cohortId: 'demo-cohort',
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  ctx.assignments = [
    {
      personId: ctx.account.personId,
      studentId: 'demo-person',
      cohortId: 'demo-cohort',
      kind: 'mentor',
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  return ctx;
}
const subject = {
  personId: 'demo-person',
  cohortId: 'demo-cohort',
  evaluationNodeId: 'demo-node',
};
const source: TalentSource = {
  fragmentId: 'demo-fragment',
  originalVersionId: 'demo-version',
  subjects: [subject],
  kind: 'evaluation',
  excerpt: '演示：本节点原文',
  location: { kind: 'document', paragraph: '1' },
};
const record: TalentRecord = {
  id: 'demo-record',
  subject,
  kind: 'evaluation',
  fields: [
    {
      name: 'suggestion',
      kind: 'ai-inference',
      value: '演示：本节点 AI 建议',
      subjects: [],
      sources: [
        {
          fragmentId: source.fragmentId,
          originalVersionId: source.originalVersionId,
        },
      ],
    },
  ],
};

describe('node-aware talent/source/model input boundary', () => {
  it('uses the content node and never falls back to legacy mentor assignments', () => {
    const ctx = evaluatorContext();
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(true);
    expect(
      canReadTalent(
        ctx,
        { ...subject, evaluationNodeId: 'demo-other-node', kind: 'evaluation' },
        'person-profile',
      ),
    ).toBe(false);
    expect(
      canReadTalent(
        ctx,
        { ...subject, evaluationNodeId: null, kind: 'evaluation' },
        'person-profile',
      ),
    ).toBe(false);
    expect(
      canReadTalent(
        ctx,
        { ...subject, evaluationNodeId: null, kind: 'person' },
        'people-list',
      ),
    ).toBe(true);
    ctx.evaluationRelations = [];
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(false);
    expect(
      canReadTalent(
        ctx,
        { ...subject, evaluationNodeId: null, kind: 'person' },
        'people-list',
      ),
    ).toBe(false);
    ctx.evaluationRelations = evaluationContextFixture().evaluationRelations;
    ctx.evaluationNodes = [];
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(false);
  });
  it('fails closed when a shared loader supplies only part of the new node facts', () => {
    const ctx = evaluatorContext();
    for (const key of [
      'evaluationNodes',
      'evaluationNodeSubjects',
      'evaluationRelations',
    ] as const) {
      const incomplete = { ...ctx, [key]: undefined };
      expect(
        canReadTalent(
          incomplete,
          { ...subject, kind: 'evaluation' },
          'person-profile',
        ),
      ).toBe(false);
    }
  });
  it('preserves existing HR visibility for unmapped history without extending evaluator access', () => {
    expect(
      canReadTalent(
        evaluationContextFixture(),
        {
          personId: 'demo-person',
          cohortId: null,
          kind: 'evaluation',
        },
        'person-profile',
      ),
    ).toBe(true);
    const ctx = evaluationContextFixture();
    ctx.enrollments = [];
    expect(
      canReadTalent(
        ctx,
        {
          personId: 'demo-person',
          cohortId: null,
          kind: 'evaluation',
        },
        'person-profile',
      ),
    ).toBe(false);
  });
  it('filters shared sources by every node before a model call can receive them', async () => {
    const ctx = evaluatorContext();
    const load = async () => ({
      context: ctx,
      records: [record],
      sources: [source],
    });
    expect((await buildAuthorizedModelInput(load)).items).toHaveLength(1);
    const mixed = {
      ...source,
      subjects: [subject, { ...subject, evaluationNodeId: 'demo-other-node' }],
    };
    const filtered = await buildAuthorizedModelInput(async () => ({
      context: ctx,
      records: [record],
      sources: [mixed],
    }));
    expect(filtered).toEqual({ items: [] });
    expect(JSON.stringify(filtered)).not.toContain('本节点 AI');
    expect(
      await readTalentSource(
        async () => ({ context: ctx, records: [], sources: [mixed] }),
        source,
      ),
    ).toBeNull();
    ctx.evaluationRelations[1].validTo = ctx.now;
    expect(await buildAuthorizedModelInput(load)).toEqual({ items: [] });
    expect(await readTalentSource(load, source)).toBeNull();
  });
  it('rejects a cross-node field even when the event itself is visible', async () => {
    const ctx = evaluatorContext();
    const crossNode = {
      ...record,
      fields: [
        {
          ...record.fields[0],
          subjects: [{ ...subject, evaluationNodeId: 'demo-other-node' }],
        },
      ],
    };
    expect(
      await buildAuthorizedModelInput(async () => ({
        context: ctx,
        records: [crossNode],
        sources: [source],
      })),
    ).toEqual({ items: [] });
  });
});
