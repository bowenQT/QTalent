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
  staffingDemandJobSnapshotSchema,
  staffingCreateDemandResultSchema,
  orderStaffingCandidates,
} from './staffing';
import { staffingFixture, staffingDemandJobFixture } from './staffing.fixtures';

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
  it('accepts four conclusions, never progress as a conclusion', () => {
    const states = ['supported', 'not_supported', 'insufficient', 'conflict'];
    for (const state of states) {
      expect(staffingConclusionSchema.safeParse(state).success).toBe(true);
    }
    for (const state of ['failed', 'awaiting_manual', 'conflicting']) {
      expect(staffingConclusionSchema.safeParse(state).success).toBe(false);
    }
  });

  it('accepts the demo page but no connected plan actions', () => {
    const page = staffingFixture();
    expect(staffingPageSchema.parse(page).plan.status).toBe('not_connected');
    const invalid = { ...page, plan: { status: 'connected' } };
    expect(staffingPageSchema.safeParse(invalid).success).toBe(false);
  });

  it('keeps failure and waiting states without conclusions', () => {
    const states = ['queued', 'judging', 'awaiting_manual', 'failed'];
    for (const progress of states) {
      const match = {
        requirementId: 'r',
        progress,
        aiJudgment: null,
        humanJudgment: null,
      };
      expect(staffingMatchSchema.safeParse(match).success).toBe(true);
      const invalid = {
        ...match,
        aiJudgment: staffingFixture().candidates[0].requirements[0].aiJudgment,
      };
      expect(staffingMatchSchema.safeParse(invalid).success).toBe(false);
    }
    const empty = {
      requirementId: 'r',
      progress: 'completed',
      aiJudgment: null,
      humanJudgment: null,
    };
    expect(staffingMatchSchema.safeParse(empty).success).toBe(false);
  });

  it('requires evidence except for insufficient conclusions', () => {
    const match = staffingFixture().candidates[0].requirements[0];
    for (const conclusion of ['supported', 'not_supported', 'conflict']) {
      const invalid = {
        ...match,
        aiJudgment: { conclusion, rationale: '演示', sources: [] },
      };
      expect(staffingMatchSchema.safeParse(invalid).success).toBe(false);
    }
    const insufficient = {
      ...match,
      aiJudgment: {
        conclusion: 'insufficient',
        rationale: '演示：无材料',
        sources: [],
      },
    };
    expect(staffingMatchSchema.safeParse(insufficient).success).toBe(true);
  });

  it('requires the source chain, not a quotation alone', () => {
    const match = staffingFixture().candidates[0].requirements[0];
    const invalid = {
      ...match,
      aiJudgment: {
        ...match.aiJudgment,
        sources: [{ excerpt: '演示引用' }],
      },
    };
    expect(staffingMatchSchema.safeParse(invalid).success).toBe(false);
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
    const parsed = staffingMatchSchema.parse({
      ...match,
      humanJudgment: judgment,
    });
    expect(parsed.aiJudgment?.conclusion).toBe('supported');
    expect(parsed.humanJudgment?.conclusion).toBe('insufficient');
    const invalid = {
      ...match,
      humanJudgment: { ...judgment, judgedBy: undefined },
    };
    expect(staffingMatchSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects score, confidence and percentage in DTOs', () => {
    for (const key of ['confidence', 'score', 'percentage', 'rank']) {
      const page = staffingFixture();
      const invalidPage = { ...page, [key]: 99 };
      expect(staffingPageSchema.safeParse(invalidPage).success).toBe(false);
      const invalidCandidate = {
        ...page,
        candidates: [{ ...page.candidates[0], [key]: 99 }],
      };
      expect(staffingPageSchema.safeParse(invalidCandidate).success).toBe(
        false,
      );
      const match = page.candidates[0].requirements[0];
      const invalidMatch = {
        ...match,
        aiJudgment: { ...match.aiJudgment, [key]: 99 },
      };
      expect(staffingMatchSchema.safeParse(invalidMatch).success).toBe(false);
    }
  });

  it('requires unique people and exact current requirement coverage', () => {
    const page = staffingFixture();
    const candidate = page.candidates[0];
    const cases = [
      candidate.requirements.slice(0, 1),
      [...candidate.requirements, candidate.requirements[0]],
      [
        { ...candidate.requirements[0], requirementId: 'unknown' },
        candidate.requirements[1],
      ],
    ];
    for (const requirements of cases) {
      const invalid = {
        ...page,
        candidates: [{ ...candidate, requirements }],
      };
      expect(staffingPageSchema.safeParse(invalid).success).toBe(false);
    }
    const stale = {
      ...page,
      candidates: [{ ...candidate, demandRevision: 2 }],
    };
    expect(staffingPageSchema.safeParse(stale).success).toBe(false);
    const duplicate = { ...page, candidates: [candidate, candidate] };
    expect(staffingPageSchema.safeParse(duplicate).success).toBe(false);
  });

  it('sorts by required support only, stably, using human conclusions', () => {
    const page = staffingFixture();
    const supported = page.candidates[0];
    const pending = {
      ...structuredClone(supported),
      person: { ...supported.person, id: 'pending' },
      requirements: supported.requirements.map((item) => ({
        ...item,
        progress: 'awaiting_manual' as const,
        aiJudgment: null,
        humanJudgment: null,
      })),
    };
    const overridden = structuredClone(supported);
    overridden.person.id = 'overridden';
    overridden.requirements[1] = {
      ...structuredClone(supported.requirements[0]),
      requirementId: 'bonus-1',
    };
    overridden.requirements[0].humanJudgment = {
      conclusion: 'insufficient',
      rationale: '演示：未能确认',
      sources: [],
      judgedBy: { id: 'demo-reviewer', name: '演示审核人' },
      judgedAt: '2026-10-25T10:00:00Z',
    };
    const input = [pending, overridden, supported];
    const ordered = orderStaffingCandidates(page.demand, input);
    expect(ordered.map((x) => x.person.id)).toEqual([
      'demo-person',
      'pending',
      'overridden',
    ]);
    expect(input[0].person.id).toBe('pending');
  });

  it('validates demand creation, edit and confirmation', () => {
    const create = {
      operationId,
      projectId: 'demo-project',
      inputText: ' 演示需求 ',
    };
    expect(createStaffingDemandInputSchema.parse(create).inputText).toBe(
      '演示需求',
    );
    const blank = { ...create, inputText: ' ' };
    expect(createStaffingDemandInputSchema.safeParse(blank).success).toBe(
      false,
    );
    const page = staffingFixture();
    const edit = {
      operationId,
      demandId: page.demand.id,
      expectedRevision: 1,
      requirements: page.demand.requirements,
    };
    expect(editStaffingDemandInputSchema.safeParse(edit).success).toBe(true);
    const cases = [[], [edit.requirements[0], edit.requirements[0]]];
    for (const requirements of cases) {
      const invalid = { ...edit, requirements };
      expect(editStaffingDemandInputSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
    const confirm = {
      operationId,
      demandId: page.demand.id,
      expectedRevision: 1,
    };
    expect(confirmStaffingDemandInputSchema.safeParse(confirm).success).toBe(
      true,
    );
    const stale = { ...confirm, expectedRevision: 0 };
    expect(confirmStaffingDemandInputSchema.safeParse(stale).success).toBe(
      false,
    );
  });

  it('rejects forged actors and timestamps in commands', () => {
    const input = humanInput();
    expect(humanStaffingJudgmentInputSchema.safeParse(input).success).toBe(
      true,
    );
    const extras = [{ actorId: 'other' }, { judgedAt: '2026-10-25T10:00:00Z' }];
    for (const extra of extras) {
      const invalid = { ...input, ...extra };
      expect(humanStaffingJudgmentInputSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
    const noEvidence = { ...input, sources: [] };
    expect(humanStaffingJudgmentInputSchema.safeParse(noEvidence).success).toBe(
      false,
    );
    const insufficient = { ...noEvidence, conclusion: 'insufficient' };
    const accepted = humanStaffingJudgmentInputSchema.safeParse(insufficient);
    expect(accepted.success).toBe(true);
  });

  it('requires signatures on confirmed demands, not drafts', () => {
    const page = staffingFixture();
    const invalid = {
      ...page,
      demand: { ...page.demand, confirmedBy: undefined },
    };
    expect(staffingPageSchema.safeParse(invalid).success).toBe(false);
    const demand = page.demand;
    const draft = {
      id: demand.id,
      projectId: demand.projectId,
      revision: demand.revision,
      inputText: demand.inputText,
      requirements: demand.requirements,
      status: 'draft',
    };
    const drafted = { ...page, demand: draft };
    expect(staffingPageSchema.safeParse(drafted).success).toBe(true);
  });

  it('preserves input on conflict and explicit errors', () => {
    const success = {
      status: 'success',
      demand: staffingFixture().demand,
      replayed: true,
    };
    expect(staffingDemandResultSchema.safeParse(success).success).toBe(true);
    const input = humanInput();
    for (const status of ['forbidden', 'not_found', 'conflict']) {
      const result = { status, message: '演示：保留输入', input };
      expect(staffingJudgmentResultSchema.safeParse(result).success).toBe(true);
    }
    const missingInput = { status: 'conflict', message: '演示冲突' };
    expect(staffingJudgmentResultSchema.safeParse(missingInput).success).toBe(
      false,
    );
    const invalid = {
      status: 'validation_error',
      fieldErrors: { rationale: ['请填写'] },
      input,
    };
    expect(staffingJudgmentResultSchema.safeParse(invalid).success).toBe(true);
  });

  it('requires a completed signed match on human success', () => {
    const match = staffingFixture().candidates[0].requirements[0];
    const humanJudgment = {
      ...match.aiJudgment,
      judgedBy: { id: 'demo-reviewer', name: '演示审核人' },
      judgedAt: '2026-10-25T10:00:00Z',
    };
    const success = {
      status: 'success',
      demandId: 'demo-demand',
      personId: 'demo-person',
      revision: 2,
      replayed: false,
      match: { ...match, aiJudgment: null, humanJudgment },
    };
    expect(staffingJudgmentResultSchema.safeParse(success).success).toBe(true);
    const unsigned = { ...success, match };
    const rejected = staffingJudgmentResultSchema.safeParse(unsigned);
    expect(rejected.success).toBe(false);
    const failed = {
      ...success,
      match: {
        ...match,
        progress: 'failed',
        aiJudgment: null,
        humanJudgment: null,
      },
    };
    expect(staffingJudgmentResultSchema.safeParse(failed).success).toBe(false);
  });

  it('reuses the typed job envelope without vendor payloads', () => {
    const snapshot = {
      schemaVersion: 1,
      jobId: 'demo-job',
      kind: 'staffing_match',
      status: 'partial',
      attempt: 1,
      revision: 1,
      updatedAt: '2026-10-25T10:00:00Z',
      progress: { completed: 1, total: 2 },
      result: staffingFixture(),
      error: null,
      canRetry: false,
      canCancel: true,
      cancelRequestedAt: null,
    };
    expect(staffingJobSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const invalid = { ...snapshot, result: { vendorPayload: true } };
    expect(staffingJobSnapshotSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('asynchronous demand creation', () => {
  it('returns a trackable shared snapshot before a demand exists', () => {
    const snapshot = staffingDemandJobFixture();
    expect(staffingDemandJobSnapshotSchema.parse(snapshot).result).toBeNull();
    const result = { status: 'success', snapshot, replayed: false };
    const parsed = staffingCreateDemandResultSchema.parse(result);
    expect(parsed.status).toBe('success');
    const syncResult = {
      status: 'success',
      demand: staffingFixture().demand,
      replayed: false,
    };
    const rejected = staffingCreateDemandResultSchema.safeParse(syncResult);
    expect(rejected.success).toBe(false);
  });

  it('uses the demand kind and a typed completed result', () => {
    const snapshot = staffingDemandJobFixture();
    const completed = {
      ...snapshot,
      status: 'completed',
      result: staffingFixture().demand,
      canCancel: false,
    };
    expect(staffingDemandJobSnapshotSchema.safeParse(completed).success).toBe(
      true,
    );
    const wrongKind = { ...snapshot, kind: 'staffing_match' };
    const invalid = staffingDemandJobSnapshotSchema.safeParse(wrongKind);
    expect(invalid.success).toBe(false);
    const untyped = { ...completed, result: { vendorPayload: true } };
    expect(staffingDemandJobSnapshotSchema.safeParse(untyped).success).toBe(
      false,
    );
  });

  it('keeps creation errors separate from edit and confirm results', () => {
    const input = {
      operationId: 'demo-create',
      projectId: 'demo-project',
      inputText: '演示：寻找负责人',
    };
    for (const status of ['forbidden', 'not_found', 'conflict']) {
      const error = { status, message: '演示：保留输入', input };
      expect(staffingCreateDemandResultSchema.safeParse(error).success).toBe(
        true,
      );
      expect(staffingDemandResultSchema.safeParse(error).success).toBe(false);
    }
    const validation = {
      status: 'validation_error',
      fieldErrors: { inputText: ['请填写'] },
      input,
    };
    const result = staffingCreateDemandResultSchema.safeParse(validation);
    expect(result.success).toBe(true);
  });
});
