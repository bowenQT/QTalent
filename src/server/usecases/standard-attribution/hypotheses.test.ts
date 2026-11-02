import { describe, expect, it } from 'vitest';
import {
  createStandardAttributionUsecases,
  draftSelectionProposalResultSchema,
} from './hypotheses';
import { DRAFT_PROMPT_VERSION, HYPOTHESIS_PROMPT_VERSION } from './prompts';
import type {
  AttributionDraftContext,
  AttributionModel,
  AttributionOperation,
  AttributionPorts,
  HrAttributionBatch,
  SelectionDraftProposal,
} from './ports';
import {
  comparisonHrFixture,
  confirmedStandardAttributionFixture,
  iterationDemoHr,
  standardHypothesisFixture,
} from '../../../contracts/standard-iteration.fixtures';
import { standardAttributionCategorySchema } from '../../../contracts/judgment-comparison';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from '../../../contracts/standard-attribution';
import type { StructuredMaasInput } from '../../integrations/maas';

const ACCOUNT = 'demo-hr-account';
const BATCH = 'demo-selection-graduation-xe6';
const NOW = '2026-11-01T00:00:00.000Z';
const MODEL = 'google/gemini-3.8-flash';
const generateInput = { operationId: 'demo-generate', batchId: BATCH };
const confirmInput = {
  operationId: 'demo-confirm',
  batchId: BATCH,
  hypothesisId: null,
  categories: ['person_or_environment'],
  rationale: '演示：同队作品不代表个人营内表现。',
  caseIds: ['demo-comparison-1'],
};
const draftInput = {
  operationId: 'demo-draft',
  attributionId: 'demo-attribution',
  expectedAttributionRevision: 1,
  baseVersionId: 'xe-select-v1',
  reason: '演示：补充可核验的个人贡献说明',
};
const point = {
  id: 'demo-base-point',
  title: '演示作品说明',
  description: '演示：说明作品及本人贡献。',
};
const addedPoint = {
  id: 'demo-new-point',
  title: '演示个人贡献核验',
  description: '演示：引用本人交付记录说明个人贡献。',
};
const hypothesisValue = {
  hypotheses: [
    {
      text: '演示假设：作品评价方式可能没有区分个人贡献。',
      categories: ['method_or_information'],
      citations: [{ caseId: 'demo-comparison-1', side: 'front' }],
    },
  ],
};
const draftValue = { changes: [{ kind: 'add', after: addedPoint }] };
type World = {
  allowed: boolean;
  batch: HrAttributionBatch;
  attribution: ConfirmedStandardAttribution;
  standard: AttributionDraftContext['standard'];
  operations: Map<string, AttributionOperation>;
  hypotheses: Map<string, StandardAttributionHypothesis>;
  attributions: Map<string, ConfirmedStandardAttribution>;
  proposals: Map<string, SelectionDraftProposal>;
  auditCount: number;
  hrEditedContent: string;
};
function setup() {
  const hr = comparisonHrFixture();
  let state: World = {
    allowed: true,
    batch: {
      accountId: ACCOUNT,
      actor: iterationDemoHr,
      batchId: BATCH,
      mapping: hr.mapping,
      authorizedCaseIds: hr.cases.slice(0, 5).map((unit) => unit.id),
      candidates: hr.cases,
    },
    attribution: confirmedStandardAttributionFixture(),
    standard: {
      version: {
        category: 'xe_selection',
        versionId: 'xe-select-v1',
        provenance: 'published',
        effectiveFrom: '2026-07-01T00:00:00Z',
        effectiveUntil: null,
      },
      content: { reviewPoints: [point] },
    },
    operations: new Map(),
    hypotheses: new Map([['demo-hypothesis', standardHypothesisFixture()]]),
    attributions: new Map(),
    proposals: new Map(),
    auditCount: 0,
    hrEditedContent: '演示：真实HR已保存的独立内容',
  };
  let queued: Promise<void> = Promise.resolve();
  const calls = { model: 0, readOperation: 0 };
  const control = {
    value: structuredClone(hypothesisValue) as unknown,
    failure: false,
    throws: false,
    auditFails: false,
    storageFails: false,
    responseModel: MODEL,
    responsePromptVersion: '',
    afterCall: undefined as (() => void | Promise<void>) | undefined,
  };
  const key = (accountId: string, operationId: string) =>
    JSON.stringify([accountId, operationId]);
  // This is a transactional test boundary, not a PostgreSQL adapter or DB proof.
  const ports: AttributionPorts<World> = {
    async transaction(_accountId, _operationId, work) {
      const before = queued;
      let release!: () => void;
      queued = new Promise((resolve) => {
        release = resolve;
      });
      await before;
      const tx = structuredClone(state);
      try {
        const result = await work(tx);
        state = tx;
        return result;
      } finally {
        release();
      }
    },
    async loadHrBatch(tx, accountId, batchId, at) {
      expect(at).toBe(NOW);
      return tx.allowed && accountId === ACCOUNT && batchId === BATCH
        ? tx.batch
        : null;
    },
    async loadDraftContext(tx, accountId, attributionId, _baseVersionId, at) {
      expect(at).toBe(NOW);
      return tx.allowed &&
        accountId === ACCOUNT &&
        attributionId === tx.attribution.id
        ? {
            batch: tx.batch,
            attribution: tx.attribution,
            standard: tx.standard,
          }
        : null;
    },
    async readHypothesis(tx, batchId, hypothesisId) {
      const value = tx.hypotheses.get(hypothesisId);
      return value?.batchId === batchId ? value : null;
    },
    async readOperation(tx, accountId, operationId) {
      calls.readOperation++;
      return tx.operations.get(key(accountId, operationId)) ?? null;
    },
    async writeOperation(tx, accountId, operationId, operation) {
      tx.operations.set(
        key(accountId, operationId),
        structuredClone(operation),
      );
    },
    async saveHypotheses(tx, values) {
      if (control.storageFails)
        throw new Error('synthetic persistence failure');
      for (const item of values) tx.hypotheses.set(item.id, item);
    },
    async saveAttribution(tx, value) {
      tx.attributions.set(value.id, value);
    },
    async saveProposal(tx, value) {
      tx.proposals.set(value.id, value);
    },
    async audit(tx) {
      if (control.auditFails) throw new Error('synthetic audit failure');
      tx.auditCount++;
    },
  };
  const requests: {
    messages: StructuredMaasInput<Record<string, unknown>>['messages'];
    promptVersion: string;
  }[] = [];
  const model: AttributionModel = {
    expectedModel: MODEL,
    client: {
      async generateStructured<T extends Record<string, unknown>>(
        input: StructuredMaasInput<T>,
      ) {
        calls.model++;
        requests.push({
          messages: structuredClone(input.messages),
          promptVersion: input.promptVersion,
        });
        await control.afterCall?.();
        if (control.throws)
          throw new Error('synthetic sensitive provider error');
        const metadata = {
          model: control.responseModel,
          promptVersion: control.responsePromptVersion || input.promptVersion,
          requestId: 'demo-model-request',
        };
        const parsed = input.schema.safeParse(control.value);
        return !control.failure && parsed.success
          ? { ok: true as const, value: parsed.data, metadata }
          : { ok: false as const, metadata };
      },
    },
  };
  let ids = 0;
  const make = () =>
    createStandardAttributionUsecases(ports, model, {
      now: () => new Date(NOW),
      newId: () => `demo-created-${++ids}`,
    });
  return {
    app: make(),
    make,
    ports,
    model,
    calls,
    requests,
    control,
    get state() {
      return state;
    },
    operation: (operationId: string) =>
      state.operations.get(key(ACCOUNT, operationId)),
  };
}

describe('BOW-921 当前授权案例与可追溯AI假设', () => {
  it('过滤范围外案例后才发送提示词，原表行由服务器解析并保留模型追踪', async () => {
    const f = setup();
    const outside = f.state.batch.candidates[5];
    outside.person.name = 'OUTSIDE_SCOPE_SENTINEL';
    const result = await f.app.generateHypotheses(ACCOUNT, generateInput);
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('fixture');
    const hypothesis = result.result[0];
    expect(hypothesis.origin).toBe('ai_hypothesis');
    expect(hypothesis.model).toEqual({
      service: 'Modelink',
      model: MODEL,
      promptVersion: HYPOTHESIS_PROMPT_VERSION,
    });
    expect(hypothesis.citations[0]).toEqual(
      standardHypothesisFixture().citations[0],
    );
    expect(hypothesis.generatedAt).toBe(NOW);
    expect(JSON.stringify(f.requests)).not.toContain('OUTSIDE_SCOPE_SENTINEL');
    expect(JSON.stringify(f.requests)).not.toContain('demo-comparison-6');
    expect(f.requests[0].promptVersion).toBe(HYPOTHESIS_PROMPT_VERSION);
    expect(f.requests[0].messages[0].content).toContain('没有可成立的假设');
    expect(f.state.attributions.size).toBe(0);
    expect(f.state.proposals.size).toBe(0);
    expect(f.operation(generateInput.operationId)?.state).toBe('finished');
  });
  it('成功空假设是可重放的成功，不变成人工归因或草稿', async () => {
    const f = setup();
    f.control.value = { hypotheses: [] };
    expect(
      await f.app.generateHypotheses(ACCOUNT, generateInput),
    ).toMatchObject({ status: 'success', result: [] });
    expect(
      await f.make().generateHypotheses(ACCOUNT, generateInput),
    ).toMatchObject({ status: 'success', replayed: true, result: [] });
    expect(f.calls.model).toBe(1);
    expect(f.state.proposals.size).toBe(0);
  });
  it.each([null, '', 'outside-account'])(
    '没有当前HR身份%s时模型零调用',
    async (accountId) => {
      const f = setup();
      expect(
        (await f.app.generateHypotheses(accountId, generateInput)).status,
      ).toBe('forbidden');
      expect(f.calls.model).toBe(0);
      expect(f.state.operations.size).toBe(0);
    },
  );
  it('查询回来的账号或批次不符时拒绝，不采信调用者角色', async () => {
    const f = setup();
    f.state.batch.accountId = 'another-account';
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('forbidden');
    f.state.batch.accountId = ACCOUNT;
    f.state.batch.batchId = 'another-batch';
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('forbidden');
    expect(f.calls.model).toBe(0);
  });
  it('身份不完整、无授权案例或对应表口径不一致都不能发给模型', async () => {
    const f = setup();
    f.state.batch.actor = { id: '', name: '' };
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('forbidden');
    f.state.batch.actor = iterationDemoHr;
    f.state.batch.authorizedCaseIds = [];
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('conflict');
    f.state.batch.authorizedCaseIds = ['demo-comparison-1'];
    f.state.batch.candidates[0].outcome = { state: 'consistent' };
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('conflict');
    expect(f.calls.model).toBe(0);
  });
  it('输入保留字段错误，不能注入actor或模型追踪', async () => {
    const f = setup();
    const result = await f.app.generateHypotheses(ACCOUNT, {
      ...generateInput,
      actor: iterationDemoHr,
    });
    expect(result.status).toBe('validation_error');
    expect(result).toHaveProperty('input.actor');
    expect(f.calls.model).toBe(0);
  });
  it.each(['outside', 'missing-side', 'extra-human-field', 'invalid-category'])(
    '模型%s输出拒绝且不保存假设',
    async (kind) => {
      const f = setup();
      if (kind === 'outside')
        f.control.value = {
          hypotheses: [
            {
              ...hypothesisValue.hypotheses[0],
              citations: [{ caseId: 'demo-comparison-10', side: 'front' }],
            },
          ],
        };
      if (kind === 'missing-side') {
        f.state.batch.authorizedCaseIds = ['demo-comparison-6'];
        f.control.value = {
          hypotheses: [
            {
              ...hypothesisValue.hypotheses[0],
              citations: [{ caseId: 'demo-comparison-6', side: 'back' }],
            },
          ],
        };
      }
      if (kind === 'extra-human-field')
        f.control.value = {
          hypotheses: [
            { ...hypothesisValue.hypotheses[0], confirmedBy: iterationDemoHr },
          ],
        };
      if (kind === 'invalid-category')
        f.control.value = {
          hypotheses: [
            {
              ...hypothesisValue.hypotheses[0],
              categories: ['employee_score'],
            },
          ],
        };
      expect(
        (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
      ).toBe('model_failed');
      expect(f.state.hypotheses.size).toBe(1); // Only the pre-existing seed hypothesis.
      expect(f.state.proposals.size).toBe(0);
    },
  );
  it.each(['failure', 'throw', 'wrong-model', 'wrong-prompt', 'wrong-family'])(
    '模型%s不降级成成功空列表或草稿',
    async (kind) => {
      const f = setup();
      if (kind === 'failure') f.control.failure = true;
      if (kind === 'throw') f.control.throws = true;
      if (kind === 'wrong-model') f.control.responseModel = 'different-model';
      if (kind === 'wrong-prompt')
        f.control.responsePromptVersion = 'another-prompt';
      if (kind === 'wrong-family') f.model.expectedModel = 'deepseek/model';
      const result = await f.app.generateHypotheses(ACCOUNT, generateInput);
      expect(result).toEqual({
        status: 'model_failed',
        message: '模型未生成可用结果，未生成归因草稿',
      });
      expect(JSON.stringify(result)).not.toContain('sensitive');
      expect(f.state.proposals.size).toBe(0);
      await f.app.generateHypotheses(ACCOUNT, generateInput);
      expect(f.calls.model).toBe(kind === 'wrong-family' ? 0 : 1);
    },
  );
});

describe('BOW-921 人工归因与标准归因门槛', () => {
  it.each(standardAttributionCategorySchema.options)(
    'HR可确认%s，签名/时间只来自当前服务端',
    async (category) => {
      const f = setup();
      const result = await f.app.confirmAttribution(ACCOUNT, {
        ...confirmInput,
        categories: [category],
      });
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('fixture');
      expect(result.result).toMatchObject({
        origin: 'human_conclusion',
        confirmedBy: iterationDemoHr,
        confirmedAt: NOW,
        categories: [category],
        hypothesisId: null,
      });
      expect(result.result.citations).toHaveLength(2);
      expect(f.calls.model).toBe(0);
      expect(f.state.proposals.size).toBe(0);
    },
  );
  it('可多选且重放不依赖类别/案例顺序，AI原假设不被改写', async () => {
    const f = setup();
    const before = structuredClone(f.state.hypotheses.get('demo-hypothesis'));
    const input = {
      ...confirmInput,
      hypothesisId: 'demo-hypothesis',
      categories: ['evaluation_standard', 'method_or_information'],
      caseIds: ['demo-comparison-1', 'demo-comparison-2'],
    };
    expect((await f.app.confirmAttribution(ACCOUNT, input)).status).toBe(
      'success',
    );
    expect(
      await f.app.confirmAttribution(ACCOUNT, {
        ...input,
        categories: [...input.categories].reverse(),
        caseIds: [...input.caseIds].reverse(),
      }),
    ).toMatchObject({ status: 'success', replayed: true });
    expect(f.state.attributions.size).toBe(1);
    expect(f.state.hypotheses.get('demo-hypothesis')).toEqual(before);
  });
  it.each([
    'rationale',
    'categories',
    'actor',
    'outside-case',
    'missing-hypothesis',
    'stale-hypothesis',
    'no-reference',
  ])('人工%s错误不制造结论', async (kind) => {
    const f = setup();
    let input: unknown = confirmInput;
    if (kind === 'rationale') input = { ...confirmInput, rationale: ' ' };
    if (kind === 'categories') input = { ...confirmInput, categories: [] };
    if (kind === 'actor')
      input = {
        ...confirmInput,
        confirmedBy: { id: 'spoof', name: '伪造（演示）' },
      };
    if (kind === 'outside-case')
      input = { ...confirmInput, caseIds: ['demo-comparison-10'] };
    if (kind === 'missing-hypothesis')
      input = { ...confirmInput, hypothesisId: 'missing' };
    if (kind === 'stale-hypothesis') {
      input = { ...confirmInput, hypothesisId: 'demo-hypothesis' };
      f.state.hypotheses.get('demo-hypothesis')!.citations[0].nodeId =
        'another-node';
    }
    if (kind === 'no-reference') {
      f.state.batch.authorizedCaseIds = ['demo-comparison-8'];
      input = { ...confirmInput, caseIds: ['demo-comparison-8'] };
    }
    const result = await f.app.confirmAttribution(ACCOUNT, input);
    expect(result.status).not.toBe('success');
    expect(f.state.attributions.size).toBe(0);
    expect(f.calls.model).toBe(0);
  });
  it.each([
    'evaluator',
    'method_or_information',
    'person_or_environment',
    'later_evaluation',
  ] as const)('%s归因不能触发标准草稿', async (category) => {
    const f = setup();
    f.state.attribution.categories = [category];
    expect(
      (await f.app.draftSelectionProposal(ACCOUNT, draftInput)).status,
    ).toBe('forbidden');
    expect(f.calls.model).toBe(0);
    expect(f.state.proposals.size).toBe(0);
    expect(f.state.operations.size).toBe(0);
  });
  it('只保存AI提案和真实HR归因，不生成HR编辑或918发布状态', async () => {
    const f = setup();
    f.control.value = draftValue;
    const before = f.state.hrEditedContent;
    const result = await f.app.draftSelectionProposal(ACCOUNT, draftInput);
    expect(draftSelectionProposalResultSchema.safeParse(result).success).toBe(
      true,
    );
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('fixture');
    expect(result.result).toMatchObject({
      humanVersion: null,
      baseVersionId: 'xe-select-v1',
      aiDraft: {
        origin: 'ai_draft',
        basis: { origin: 'human_conclusion' },
        changes: draftValue.changes,
        model: {
          service: 'Modelink',
          model: MODEL,
          promptVersion: DRAFT_PROMPT_VERSION,
        },
      },
    });
    expect(result.result).not.toHaveProperty('state');
    expect(f.state.hrEditedContent).toBe(before);
    expect(f.requests[0].messages[0].content).toContain('不要生成humanVersion');
    expect(JSON.stringify(f.requests)).not.toContain('demo-comparison-2');
  });
  it.each(['edit', 'remove'])(
    '验证%s基准要点，不把AI内容当原版',
    async (kind) => {
      const f = setup();
      const change =
        kind === 'edit'
          ? {
              kind,
              before: point,
              after: { ...point, description: '演示：核验引用后说明贡献。' },
            }
          : { kind, before: point };
      f.state.standard.content.reviewPoints.push({
        ...point,
        id: 'demo-other-point',
      });
      f.control.value = { changes: [change] };
      expect(
        (await f.app.draftSelectionProposal(ACCOUNT, draftInput)).status,
      ).toBe('success');
    },
  );
  it.each([
    'reused-id',
    'fake-before',
    'remove-all',
    'no-changes',
    'human-version',
  ])('AI草稿%s拒绝且零提案', async (kind) => {
    const f = setup();
    if (kind === 'reused-id')
      f.control.value = { changes: [{ kind: 'add', after: point }] };
    if (kind === 'fake-before')
      f.control.value = {
        changes: [
          {
            kind: 'edit',
            before: { ...point, description: '伪造原要点（演示）' },
            after: { ...point, description: '改动（演示）' },
          },
        ],
      };
    if (kind === 'remove-all')
      f.control.value = { changes: [{ kind: 'remove', before: point }] };
    if (kind === 'no-changes') f.control.value = { changes: [] };
    if (kind === 'human-version')
      f.control.value = {
        ...draftValue,
        humanVersion: { origin: 'hr_edited' },
      };
    expect(
      (await f.app.draftSelectionProposal(ACCOUNT, draftInput)).status,
    ).toBe('model_failed');
    expect(f.state.proposals.size).toBe(0);
  });
  it.each(['missing', 'revision', 'source', 'base-id', 'wrong-category'])(
    '起草前%s不一致不调用模型',
    async (kind) => {
      const f = setup();
      let input = draftInput;
      if (kind === 'missing')
        input = { ...draftInput, attributionId: 'missing-attribution' };
      if (kind === 'revision')
        input = { ...draftInput, expectedAttributionRevision: 2 };
      if (kind === 'source')
        f.state.attribution.citations[0].row.source.excerpt =
          '另一个引用（演示）';
      if (kind === 'base-id')
        f.state.standard.version.versionId = 'xe-select-v2';
      if (kind === 'wrong-category')
        f.state.standard.version = {
          ...f.state.standard.version,
          category: 'dimension_anchors',
          versionId: 'rubric-v1',
        };
      expect(
        (await f.app.draftSelectionProposal(ACCOUNT, input)).status,
      ).not.toBe('success');
      expect(f.calls.model).toBe(0);
      expect(f.state.proposals.size).toBe(0);
    },
  );
});

describe('BOW-921 操作幂等、重新授权及事务端口', () => {
  it('成功重放先重新授权，撤权后不读缓存业务结果', async () => {
    const f = setup();
    await f.app.generateHypotheses(ACCOUNT, generateInput);
    const reads = f.calls.readOperation;
    f.state.allowed = false;
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('forbidden');
    expect(f.calls.readOperation).toBe(reads);
    expect(f.calls.model).toBe(1);
  });
  it('相同operation改变语义不重用旧结果，授权证据变化也冲突', async () => {
    const f = setup();
    await f.app.confirmAttribution(ACCOUNT, confirmInput);
    expect(
      (
        await f.app.confirmAttribution(ACCOUNT, {
          ...confirmInput,
          rationale: '另一个理由（演示）',
        })
      ).status,
    ).toBe('conflict');
    f.state.batch.candidates[0].person.name = '已变更姓名（演示）';
    expect((await f.app.confirmAttribution(ACCOUNT, confirmInput)).status).toBe(
      'conflict',
    );
    expect(f.state.attributions.size).toBe(1);
  });
  it('模型调用中重复操作返回冲突，首次收口后可重放且不二次付费', async () => {
    const f = setup();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.control.afterCall = async () => {
      entered();
      await waiting;
    };
    const first = f.app.generateHypotheses(ACCOUNT, generateInput);
    await started;
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('conflict');
    release();
    expect((await first).status).toBe('success');
    expect(
      await f.app.generateHypotheses(ACCOUNT, generateInput),
    ).toMatchObject({ status: 'success', replayed: true });
    expect(f.calls.model).toBe(1);
  });
  it.each(['revocation', 'scope', 'evidence'])(
    '模型返回前发生%s则不发布或保存AI假设',
    async (kind) => {
      const f = setup();
      f.control.afterCall = () => {
        if (kind === 'revocation') f.state.allowed = false;
        if (kind === 'scope')
          f.state.batch.authorizedCaseIds = ['demo-comparison-2'];
        if (kind === 'evidence')
          f.state.batch.candidates[0].person.name = '新版本名字（演示）';
      };
      const result = await f.app.generateHypotheses(ACCOUNT, generateInput);
      expect(result.status).toBe(
        kind === 'revocation' ? 'forbidden' : 'conflict',
      );
      expect(f.state.hypotheses.size).toBe(1);
      expect(f.state.proposals.size).toBe(0);
      expect(f.operation(generateInput.operationId)?.state).toBe('finished');
    },
  );
  it('较新操作栅栏不能被旧模型响应覆盖', async () => {
    const f = setup();
    f.control.afterCall = () => {
      const op = f.operation(generateInput.operationId);
      if (!op) throw new Error('fixture');
      f.state.operations.set(
        JSON.stringify([ACCOUNT, generateInput.operationId]),
        { ...op, reservationId: 'new-reservation' },
      );
    };
    expect(
      (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
    ).toBe('conflict');
    expect(f.state.hypotheses.size).toBe(1);
  });
  it.each(['model-audit', 'model-storage', 'human-audit'])(
    '%s基础设施失败向调用者传播，不能伪装model_failed或部分成功',
    async (kind) => {
      const f = setup();
      if (kind === 'model-storage') f.control.storageFails = true;
      else f.control.auditFails = true;
      const call =
        kind === 'human-audit'
          ? f.app.confirmAttribution(ACCOUNT, confirmInput)
          : f.app.generateHypotheses(ACCOUNT, generateInput);
      await expect(call).rejects.toThrow(/synthetic/);
      expect(f.state.hypotheses.size).toBe(1);
      expect(f.state.attributions.size).toBe(0);
      if (kind !== 'human-audit') {
        expect(f.operation(generateInput.operationId)?.state).toBe('pending');
        expect(
          (await f.app.generateHypotheses(ACCOUNT, generateInput)).status,
        ).toBe('conflict');
        expect(f.calls.model).toBe(1);
      }
    },
  );
});
