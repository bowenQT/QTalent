import { describe, expect, it } from 'vitest';
import {
  staffingConclusionSchema,
  staffingPageSchema,
  staffingMatchSchema,
  createStaffingDemandInputSchema,
  editStaffingDemandInputSchema,
  confirmStaffingDemandInputSchema,
  humanStaffingJudgmentInputSchema,
  staffingDemandResultSchema,
  staffingJudgmentResultSchema,
  staffingJobSnapshotSchema,
  orderStaffingCandidates,
} from './staffing';
import { staffingFixture } from './staffing.fixtures';

const operationId = 'demo-operation';
const humanInput = () => ({
  operationId,
  expectedRevision: 1,
  demandId: 'demo-demand',
  personId: 'demo-person',
  requirementId: 'required-1',
  conclusion: 'supported',
  rationale: '演示：人工核对',
  sources: [
    {
      fragmentId: 'demo-fragment-1',
      originalVersionId: 'demo-version-1',
      location: { kind: 'document', paragraph: '演示段落 1' },
    },
  ],
});

describe('staffing contracts', () => {
  it('accepts the four conclusions, never processing states as conclusions', () => {
    for (const state of ['supported', 'not_supported', 'insufficient', 'conflict']) {
      expect(staffingConclusionSchema.safeParse(state).success).toBe(true);
    }
    for (const state of ['failed', 'awaiting_manual', 'conflicting']) {
      expect(staffingConclusionSchema.safeParse(state).success).toBe(false);
    }
  });

  it('accepts the synthetic page and exposes no connected plan actions', () => {
    expect(staffingPageSchema.parse(staffingFixture()).plan.status).toBe('not_connected');
    const page = staffingFixture();
    expect(staffingPageSchema.safeParse({ ...page, plan: { status: 'connected' } }).success).toBe(false);
  });

  it('keeps failures and waiting states without a conclusion', () => {
    for (const progress of ['queued', 'judging', 'awaiting_manual', 'failed']) {
      const match = { requirementId: 'r', progress, aiJudgment: null, humanJudgment: null };
      expect(staffingMatchSchema.safeParse(match).success).toBe(true);
      expect(staffingMatchSchema.safeParse({
        ...match,
        aiJudgment: staffingFixture().candidates[0].requirements[0].aiJudgment,
      }).success).toBe(false);
    }
    expect(staffingMatchSchema.safeParse({
      requirementId: 'r', progress: 'completed', aiJudgment: null, humanJudgment: null,
    }).success).toBe(false);
  });

  it('requires sources for a positive, negative or conflicting conclusion', () => {
    const page = staffingFixture();
    const match = page.candidates[0].requirements[0];
    for (const conclusion of ['supported', 'not_supported', 'conflict']) {
      expect(staffingMatchSchema.safeParse({
        ...match, aiJudgment: { conclusion, rationale: '演示', sources: [] },
      }).success).toBe(false);
    }
    expect(staffingMatchSchema.safeParse({
      ...match, aiJudgment: { conclusion: 'insufficient', rationale: '演示：无材料', sources: [] },
    }).success).toBe(true);
  });

  it('requires a complete source chain rather than a quote alone', () => {
    const match = staffingFixture().candidates[0].requirements[0];
    expect(staffingMatchSchema.safeParse({
      ...match, aiJudgment: { ...match.aiJudgment, sources: [{ excerpt: '演示引用' }] },
    }).success).toBe(false);
  });

  it('keeps AI evidence and requires a signed human conclusion', () => {
    const match = staffingFixture().candidates[0].requirements[0];
    const judgment = {
      conclusion: 'insufficient',
      rationale: '演示：证据不够',
      sources: [],
      judgedBy: { id: 'demo-reviewer', name: '演示审核人' },
      judgedAt: '2026-10-25T10:00:00Z',
    };
    const parsed = staffingMatchSchema.parse({ ...match, humanJudgment: judgment });
    expect(parsed.aiJudgment?.conclusion).toBe('supported');
    expect(parsed.humanJudgment?.conclusion).toBe('insufficient');
    expect(staffingMatchSchema.safeParse({
      ...match, humanJudgment: { ...judgment, judgedBy: undefined },
    }).success).toBe(false);
  });

  it('rejects score, confidence and percentage at DTO boundaries', () => {
    for (const key of ['confidence', 'score', 'percentage', 'rank']) {
      const page = staffingFixture();
      expect(staffingPageSchema.safeParse({ ...page, [key]: 99 }).success).toBe(false);
      expect(staffingPageSchema.safeParse({
        ...page, candidates: [{ ...page.candidates[0], [key]: 99 }],
      }).success).toBe(false);
      const match = page.candidates[0].requirements[0];
      expect(staffingMatchSchema.safeParse({
        ...match, aiJudgment: { ...match.aiJudgment, [key]: 99 },
      }).success).toBe(false);
    }
  });

  it('requires exact current requirement coverage and unique people', () => {
    const page = staffingFixture();
    const candidate = page.candidates[0];
    for (const requirements of [
      candidate.requirements.slice(0, 1),
      [...candidate.requirements, candidate.requirements[0]],
      [{ ...candidate.requirements[0], requirementId: 'unknown' }, candidate.requirements[1]],
    ]) {
      expect(staffingPageSchema.safeParse({
        ...page, candidates: [{ ...candidate, requirements }],
      }).success).toBe(false);
    }
    expect(staffingPageSchema.safeParse({
      ...page, candidates: [{ ...candidate, demandRevision: 2 }],
    }).success).toBe(false);
    expect(staffingPageSchema.safeParse({
      ...page, candidates: [candidate, candidate],
    }).success).toBe(false);
  });

  it('orders only by required supported count, stably, with human conclusion taking precedence', () => {
    const page = staffingFixture();
    const supported = page.candidates[0];
    const pending = {
      ...structuredClone(supported),
      person: { ...supported.person, id: 'pending' },
      requirements: supported.requirements.map((item) => ({
        ...item, progress: 'awaiting_manual' as const, aiJudgment: null, humanJudgment: null,
      })),
    };
    const overridden = structuredClone(supported);
    overridden.person.id = 'overridden';
    overridden.requirements[0].humanJudgment = {
      conclusion: 'insufficient', rationale: '演示：未能确认', sources: [],
      judgedBy: { id: 'demo-reviewer', name: '演示审核人' },
      judgedAt: '2026-10-25T10:00:00Z',
    };
    const input = [pending, overridden, supported];
    expect(orderStaffingCandidates(page.demand, input).map((x) => x.person.id)).toEqual([
      'demo-person', 'pending', 'overridden',
    ]);
    expect(input[0].person.id).toBe('pending');
  });

  it('validates creation, edit and confirmation revision boundaries', () => {
    const page = staffingFixture();
    expect(createStaffingDemandInputSchema.parse({
      operationId, projectId: 'demo-project', inputText: ' 演示需求 ',
    }).inputText).toBe('演示需求');
    expect(createStaffingDemandInputSchema.safeParse({
      operationId, projectId: 'demo-project', inputText: ' ',
    }).success).toBe(false);
    const edit = {
      operationId, demandId: page.demand.id, expectedRevision: 1,
      requirements: page.demand.requirements,
    };
    expect(editStaffingDemandInputSchema.safeParse(edit).success).toBe(true);
    for (const requirements of [[], [edit.requirements[0], edit.requirements[0]]]) {
      expect(editStaffingDemandInputSchema.safeParse({ ...edit, requirements }).success).toBe(false);
    }
    expect(confirmStaffingDemandInputSchema.safeParse({
      operationId, demandId: page.demand.id, expectedRevision: 1,
    }).success).toBe(true);
    expect(confirmStaffingDemandInputSchema.safeParse({
      operationId, demandId: page.demand.id, expectedRevision: 0,
    }).success).toBe(false);
  });

  it('does not accept forged actors or timestamps in human commands', () => {
    expect(humanStaffingJudgmentInputSchema.safeParse(humanInput()).success).toBe(true);
    for (const extra of [{ actorId: 'other' }, { judgedAt: '2026-10-25T10:00:00Z' }]) {
      expect(humanStaffingJudgmentInputSchema.safeParse({ ...humanInput(), ...extra }).success).toBe(false);
    }
    expect(humanStaffingJudgmentInputSchema.safeParse({
      ...humanInput(), sources: [],
    }).success).toBe(false);
    expect(humanStaffingJudgmentInputSchema.safeParse({
      ...humanInput(), conclusion: 'insufficient', sources: [],
    }).success).toBe(true);
  });

  it('requires confirmed demand signatures but keeps drafts unsigned', () => {
    const page = staffingFixture();
    expect(staffingPageSchema.safeParse({
      ...page, demand: { ...page.demand, confirmedBy: undefined },
    }).success).toBe(false);
    const { confirmedBy, confirmedAt, ...draft } = page.demand;
    void confirmedBy;
    void confirmedAt;
    expect(staffingPageSchema.safeParse({
      ...page, demand: { ...draft, status: 'draft' },
    }).success).toBe(true);
  });

  it('returns explicit results and preserves conflicting inputs', () => {
    const page = staffingFixture();
    expect(staffingDemandResultSchema.safeParse({
      status: 'success', demand: page.demand, replayed: true,
    }).success).toBe(true);
    const input = humanInput();
    for (const status of ['forbidden', 'not_found', 'conflict']) {
      expect(staffingJudgmentResultSchema.safeParse({
        status, message: '演示：保留输入', input,
      }).success).toBe(true);
    }
    expect(staffingJudgmentResultSchema.safeParse({
      status: 'conflict', message: '演示冲突',
    }).success).toBe(false);
    expect(staffingJudgmentResultSchema.safeParse({
      status: 'validation_error', fieldErrors: { rationale: ['请填写'] }, input,
    }).success).toBe(true);
  });

  it('uses the shared typed job envelope and does not leak vendor payloads', () => {
    const snapshot = {
      schemaVersion: 1, jobId: 'demo-job', kind: 'staffing_match', status: 'partial',
      attempt: 1, revision: 1, updatedAt: '2026-10-25T10:00:00Z',
      progress: { completed: 1, total: 2 }, result: staffingFixture(),
      error: null, canRetry: false, canCancel: true, cancelRequestedAt: null,
    };
    expect(staffingJobSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(staffingJobSnapshotSchema.safeParse({
      ...snapshot, result: { vendorPayload: true },
    }).success).toBe(false);
  });
});
