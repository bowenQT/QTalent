import { beforeEach, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client';
import { loadEvaluationContext } from './evaluation-context';
import { evaluationContextFixture } from '../modules/programs/reassignment.fixtures';

const mocks = vi.hoisted(() => ({
  base: vi.fn(),
  facts: vi.fn(),
  candidates: vi.fn(),
}));
vi.mock('./project-context', () => ({ loadProjectContext: mocks.base }));
vi.mock('./reassignment-handler-context', () => ({
  readReassignmentHrCandidates: mocks.candidates,
}));
vi.mock('../modules/programs', () => ({
  readEvaluationAuthorizationFacts: mocks.facts,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.candidates.mockResolvedValue([]);
});
it('loads fresh node facts for every invocation without accepting caller scope', async () => {
  const context = evaluationContextFixture();
  const {
    evaluationNodes,
    evaluationNodeSubjects,
    evaluationRelations,
    ...base
  } = context;
  mocks.base.mockResolvedValue({ context: base, directory: {}, staffing: {} });
  mocks.facts.mockResolvedValue({
    evaluationNodes,
    evaluationNodeSubjects,
    evaluationRelations,
  });
  const db = {} as DbExecutor;
  expect(
    (await loadEvaluationContext(db, context.account.id, context.now)).context,
  ).toEqual({ ...context, hrCandidateGrants: [] });
  mocks.facts.mockResolvedValue({
    evaluationNodes,
    evaluationNodeSubjects,
    evaluationRelations: [],
  });
  expect(
    (await loadEvaluationContext(db, context.account.id, context.now)).context
      .evaluationRelations,
  ).toEqual([]);
  expect(mocks.facts).toHaveBeenCalledTimes(2);
});
it('denies a rejected base session before loading node facts', async () => {
  mocks.base.mockRejectedValue(new Error('synthetic forbidden'));
  await expect(
    loadEvaluationContext({} as DbExecutor, 'demo-account', '2026-10-31'),
  ).rejects.toThrow('forbidden');
  expect(mocks.facts).not.toHaveBeenCalled();
});
