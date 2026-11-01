import { expect, it, vi } from 'vitest';
import { recordBatchDraftSetFixture } from '../../contracts/materials.fixtures';
import {
  evaluationContextFixture,
  reassignmentNow,
} from '../modules/programs/reassignment.fixtures';
import type {
  ConfirmationSourceFact,
  ConfirmationState,
} from '../modules/talent/record-confirmation';
import {
  createConfirmRecordDraftUsecase,
  type ConfirmRecordDraftDependencies,
} from './confirm-record-draft';

function fixture() {
  const state: ConfirmationState = {
    draftSet: structuredClone(recordBatchDraftSetFixture),
    projectId: null,
    mappings: [],
    confirmations: [],
    reviews: [],
    saves: [],
    operations: [],
    withdrawnDraftIds: [],
  };
  const draft = state.draftSet.drafts[0]!;
  const context = evaluationContextFixture();
  context.account = {
    id: 'demo-rater-account',
    personId: 'demo-new-evaluator',
    isSystemAdmin: false,
  };
  context.grants = [];
  const request = {
    operation_id: 'demo-save',
    expected_revision: 1,
    draftId: draft.draftId,
    personIds: draft.personIds,
    projectId: null,
    sbi: draft.sbi,
    decisions: [
      {
        personId: 'demo-person',
        dimensionId: 'demo-professionalism',
        action: 'confirm',
      },
    ],
  };
  const sources: ConfirmationSourceFact[] = [
    {
      reference: structuredClone(draft.sourceReferences[0]!),
      complete: true,
      excerpt: '演示：完成合成任务并记录验证步骤。',
      subjects: [{ evaluationNodeId: 'demo-node', personId: 'demo-person' }],
      kind: 'evaluation',
      requiredKinds: [],
    },
  ];
  let sequence = 0;
  const deps: ConfirmRecordDraftDependencies = {
    businessNow: () => reassignmentNow,
    wallNow: () => reassignmentNow,
    newId: () => `demo-id-${++sequence}`,
    readState: vi.fn(async () => structuredClone(state)),
    loadAuthorization: vi.fn(async () => structuredClone(context)),
    readRules: vi.fn(async () => ({
      dimensionVersionId: draft.dimensionVersionId,
      anchorVersionId: draft.anchorVersionId,
      anchors: [
        {
          id: 'demo-anchor',
          dimensionId: 'demo-professionalism',
          value: 3,
          text: '演示：按已定步骤完成任务',
          ruleVersion: 'demo-anchors-v1',
        },
      ],
    })),
    readSources: vi.fn(async () => structuredClone(sources)),
  };
  return {
    state,
    draft,
    context,
    request,
    sources,
    deps,
    service: () => createConfirmRecordDraftUsecase(deps),
  };
}
it('loads exact frozen versions and returns a plan, with no persistence or public success claim', async () => {
  const f = fixture();
  const before = structuredClone(f.state);
  const result = await f.service().save(f.context.account.id, f.request);
  expect(result.status).toBe('planned');
  expect(f.deps.readRules).toHaveBeenCalledWith({
    dimensionVersionId: 'demo-dimensions-v1',
    anchorVersionId: 'demo-anchors-v1',
  });
  expect(f.state).toEqual(before);
});
it('rejects forged actor/role fields before any loader is called', async () => {
  const f = fixture();
  expect(
    await f.service().save(f.context.account.id, {
      ...f.request,
      actorId: 'other',
      role: 'manager',
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(f.deps.readState).not.toHaveBeenCalled();
});
it('retains typed stale-page input on conflict', async () => {
  const f = fixture();
  f.request.expected_revision = 2;
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    { status: 'conflict', input: f.request },
  );
});
it('rejects revocation that happens during asynchronous source loading', async () => {
  const f = fixture();
  f.deps.readSources = async () => {
    f.context.evaluationRelations = [];
    return structuredClone(f.sources);
  };
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    { status: 'forbidden' },
  );
});
it('rejects a newly hidden mixed fragment after asynchronous loading', async () => {
  const f = fixture();
  f.sources[0]!.subjects.push({
    evaluationNodeId: 'demo-other-node',
    personId: 'demo-person',
  });
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    { status: 'forbidden', reason: 'source_not_visible' },
  );
});
it('rejects regeneration while loading and retains the original input', async () => {
  const f = fixture();
  f.deps.readSources = async () => {
    f.draft.revision++;
    return f.sources;
  };
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    { status: 'conflict', input: f.request },
  );
});
it('fails closed on a missing current-node context', async () => {
  const f = fixture();
  Reflect.deleteProperty(f.context, 'evaluationRelations');
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    { status: 'forbidden' },
  );
});
it('propagates actual dependency failures rather than manufacturing empty facts', async () => {
  const f = fixture();
  f.deps.readRules = async () => {
    throw new Error('synthetic dependency failure');
  };
  await expect(
    f.service().save(f.context.account.id, f.request),
  ).rejects.toThrow('synthetic dependency failure');
});
it('requires every explicit boundary and never installs a fake production default', () => {
  const f = fixture();
  Reflect.deleteProperty(f.deps, 'readSources');
  expect(() => f.service()).toThrow('Missing confirmation method: readSources');
});
it('keeps undo strict and returns not-found for a missing retained save', async () => {
  const f = fixture();
  expect(
    await f
      .service()
      .undo(f.context.account.id, { operation_id: 'undo', saveId: 'missing' }),
  ).toMatchObject({ status: 'not_found' });
  expect(await f.service().undo(f.context.account.id, {})).toMatchObject({
    status: 'validation_error',
  });
});
it('rejects an account-person binding change while resolving evidence', async () => {
  const f = fixture();
  f.deps.readSources = async () => {
    f.context.account.personId = 'demo-hr';
    f.context.evaluationRelations.push({
      ...f.context.evaluationRelations[1]!,
      id: 'replacement-relation',
      evaluatorId: 'demo-hr',
    });
    return f.sources;
  };
  expect(await f.service().save('demo-rater-account', f.request)).toMatchObject(
    { status: 'forbidden', reason: 'account_binding_changed' },
  );
});
it('uses current business time after evidence loading, not the time before waiting', async () => {
  const f = fixture();
  let at = reassignmentNow;
  f.deps.businessNow = () => at;
  f.deps.loadAuthorization = async (_accountId, current) => ({
    ...structuredClone(f.context),
    now: current,
  });
  f.context.evaluationRelations[1]!.validTo = '2026-10-31T16:00:01.000Z';
  f.deps.readSources = async () => {
    at = '2026-10-31T16:00:01.000Z';
    return f.sources;
  };
  expect(await f.service().save('demo-rater-account', f.request)).toMatchObject(
    { status: 'forbidden' },
  );
});
it('keeps dependency unavailability explicit rather than returning a saved receipt', async () => {
  const f = fixture();
  f.deps.readRules = async () => null;
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    { status: 'unavailable', reason: 'frozen_rules_required' },
  );
});
it('replays the original retained operation without consulting a new current rule set', async () => {
  const f = fixture();
  const initial = await f.service().save(f.context.account.id, f.request);
  if (
    initial.status !== 'planned' ||
    initial.plan.replayed ||
    initial.plan.action !== 'save'
  )
    throw new Error('fixture plan');
  const { confirmationFingerprint } =
    await import('../modules/talent/record-confirmation');
  f.state.operations.push({
    action: 'save',
    actorAccountId: f.context.account.id,
    operationId: f.request.operation_id,
    fingerprint: confirmationFingerprint({
      action: 'save',
      input: initial.plan.input,
    }),
    draft: structuredClone(f.draft),
    receipt: initial.plan.receipt,
  });
  f.draft.revision++;
  f.deps.readRules = vi.fn(async () => {
    throw new Error('must not reload current rules on replay');
  });
  expect(await f.service().save(f.context.account.id, f.request)).toMatchObject(
    {
      status: 'planned',
      plan: { replayed: true, receipt: initial.plan.receipt },
    },
  );
  expect(f.deps.readRules).not.toHaveBeenCalled();
});
