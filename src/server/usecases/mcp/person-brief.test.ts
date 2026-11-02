import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nodeFixture } from '../../queries/person-test-helpers';
import { quickViewFromData } from '../../queries/people';
import type { StoredArrangeInput } from '../../modules/records';
import type { IntakeTable } from '../talent-source-projection';
import { intakeTableOf } from '../talent-source-projection.test-support';
import { mcpPersonBriefFromData, type McpPersonData } from './person-brief';

/** Intake rows stay editable until the call; sealed() issues the whole table. */
type Fixture = McpPersonData & { intakeInputs: StoredArrangeInput[] };

async function sealed({
  intakeInputs,
  ...data
}: Fixture): Promise<McpPersonData> {
  return { ...data, intake: await intakeTableOf(intakeInputs) };
}

function fixture(): Fixture {
  const data: Fixture = { ...nodeFixture(), intakeInputs: [] };
  data.context.account.isSystemAdmin = false;
  data.context.grants = [
    {
      accountId: 'account',
      role: 'hr',
      scope: 'cohort',
      cohortId: 'cohort',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    },
  ];
  data.context.now = '2026-07-01T00:00:00.000Z';
  data.originals[0]!.kind = 'original';
  data.versions[0]!.contentDigest = createHash('sha256')
    .update('Synthetic observation')
    .digest('hex');
  for (const score of data.confirmations) score.sourceCategory = 'original';
  for (const [index, fragment] of data.fragments.entries()) {
    fragment.location = { kind: 'document', paragraph: 'input' };
    const source = {
      fragmentId: fragment.id,
      originalVersionId: fragment.originalVersionId,
    };
    data.intakeInputs.push({
      id: `input-${index}`,
      creatorAccountId: 'account',
      jobId: `job-${index}`,
      inputVersion: `input-version-${index}`,
      batchId: `batch-${index}`,
      evaluationNodeId: 'node-current',
      boundAt: new Date('2026-06-01T00:00:00.000Z'),
      occurredOn: '2026-06-01',
      origin: 'text',
      originalInput: {
        operation_id: `operation-${index}`,
        text: fragment.excerpt,
        attachmentIds: [],
        personId: 'one',
        projectId: null,
      },
      inputSource: source,
      sourceContexts: [
        {
          ...source,
          kind: 'evaluation',
          requiredKinds: [],
          subjects: [
            {
              personId: 'one',
              cohortId: 'cohort',
              evaluationNodeId: 'node-current',
            },
          ],
          attributedPersonIds: ['one'],
        },
      ],
      personIds: ['one'],
      projectMode: 'none',
      projectId: null,
      projectCandidateIds: [],
      supersededByInputId: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
  }
  return data;
}

describe('MCP brief over the canonical full provenance snapshot', () => {
  it('uses the existing role projection and keeps authorized source positions', async () => {
    const data = fixture();
    const result = await mcpPersonBriefFromData(await sealed(data), 'one');
    expect(result).toEqual(await quickViewFromData(await sealed(data), 'one'));
    expect(result?.recentFacts.status).toBe('ready');
    if (result?.recentFacts.status !== 'ready')
      throw new Error('missing facts');
    expect(result.recentFacts.data).toHaveLength(2);
    expect(result.recentFacts.data[0]!.sources[0]!.location).toEqual({
      kind: 'document',
      paragraph: 'input',
    });
  });

  it.each(['kind', 'requiredKinds'] as const)(
    'excludes personnel %s before facts and derived capability are built',
    async (field) => {
      const data = fixture();
      for (const input of data.intakeInputs) {
        if (field === 'kind') input.sourceContexts[0]!.kind = 'performance';
        else input.sourceContexts[0]!.requiredKinds = ['performance'];
      }
      const result = await mcpPersonBriefFromData(await sealed(data), 'one');
      expect(result?.recentFacts).toEqual({ status: 'empty' });
      expect(result?.capabilityLines.status).toBe('insufficient_evidence');
      expect(JSON.stringify(result)).not.toContain('Synthetic event');
      expect(JSON.stringify(result)).not.toContain('fragment-');
    },
  );

  it('preserves authorized pinned prototype evidence through the existing demo checks', async () => {
    const data: Fixture = { ...nodeFixture(), intakeInputs: [] };
    const result = await mcpPersonBriefFromData(await sealed(data), 'one');
    expect(result).toEqual(await quickViewFromData(await sealed(data), 'one'));
    expect(result?.recentFacts.status).toBe('ready');
  });

  it('does not return a fragment whose original version cannot be resolved', async () => {
    const data = fixture();
    data.versions = [];
    expect(
      (await mcpPersonBriefFromData(await sealed(data), 'one'))?.recentFacts,
    ).toEqual({
      status: 'empty',
    });
  });

  it('keeps an unknown original out without guessing from a benign title', async () => {
    const data = fixture();
    data.intakeInputs = [];
    expect(
      (await quickViewFromData(await sealed(data), 'one'))?.recentFacts.status,
    ).toBe('ready');
    expect(
      (await mcpPersonBriefFromData(await sealed(data), 'one'))?.recentFacts,
    ).toEqual({
      status: 'empty',
    });
  });

  it('rejects an intake inventory not issued by the whole-table reader', async () => {
    const { intakeInputs, ...data } = fixture();
    const forged = { rows: intakeInputs } as unknown as IntakeTable;
    await expect(
      mcpPersonBriefFromData({ ...data, intake: forged }, 'one'),
    ).rejects.toThrow('intake table was not read by readIntakeTable');
  });

  it('honors an out-of-scope subject in a superseded shared intake', async () => {
    const data = fixture();
    const shared = structuredClone(data.intakeInputs[0]!);
    shared.id = 'superseded-other-creator';
    shared.creatorAccountId = 'other-account';
    shared.supersededByInputId = data.intakeInputs[0]!.id;
    shared.sourceContexts[0]!.subjects.push({
      personId: 'two',
      evaluationNodeId: 'node-other',
      cohortId: 'other-cohort',
    });
    data.intakeInputs.push(shared);
    const result = await mcpPersonBriefFromData(await sealed(data), 'one');
    expect(result?.recentFacts.status).toBe('ready');
    if (result?.recentFacts.status !== 'ready')
      throw new Error('missing allowed event');
    expect(result.recentFacts.data.map((row) => row.eventId)).toEqual([
      'event-1',
    ]);
  });

  it('does not erase a hidden contributing source while preserving the event', async () => {
    const data = fixture();
    data.intakeInputs[1]!.sourceContexts[0]!.requiredKinds = ['performance'];
    data.eventSources.push({
      eventId: 'event-0',
      fragmentId: 'fragment-1',
      originalVersionId: 'version',
    });
    expect(
      (await mcpPersonBriefFromData(await sealed(data), 'one'))?.recentFacts,
    ).toEqual({
      status: 'empty',
    });
  });

  it('rechecks current permissions and does not give a mentor any quadrant', async () => {
    const data = fixture();
    data.context.grants[0]!.role = 'mentor';
    const result = await mcpPersonBriefFromData(await sealed(data), 'one');
    expect(result?.role).toBe('mentor');
    expect(result).not.toHaveProperty('referencePosition');
    data.context.grants = [];
    data.context.evaluationRelations = [];
    expect(await mcpPersonBriefFromData(await sealed(data), 'one')).toBeNull();
  });
});
