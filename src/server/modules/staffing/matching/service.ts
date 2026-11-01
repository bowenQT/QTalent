import {
  failedReview,
  unsupportedReviewSchema,
  type UnsupportedReview,
} from './review';
import { z } from 'zod';
import {
  humanStaffingJudgmentInputSchema,
  staffingJudgmentResultSchema,
  staffingJobSnapshotSchema,
  staffingPageSchema,
  orderStaffingCandidates,
  type StaffingPage,
} from '../../../../contracts/staffing';
import {
  conclusionSchema,
  JEV_PROMPT_VERSION,
  JevError,
  type JevErrorKind,
} from '../../../integrations/jev';
import {
  advanceJob,
  applyJobCommand,
  newJob,
  type JobRecord,
} from '../../../jobs/state';
import {
  MatchingError,
  type MatchDependencies,
  type MatchRun,
  type MatchScope,
  type Match,
  type MatchCell,
} from './types';
import { isMatchingNature } from './evidence';
import {
  MATCH_INPUT_VERSION,
  demandInputVersion,
  evidenceKey,
  matchingInput,
  referenceKey,
  sourceKey,
} from './prompt';

const startSchema = z.strictObject({
  operationId: z.string().trim().min(1).max(200),
  demandId: z.string().trim().min(1),
  expectedRevision: z.number().int().positive(),
});
const validation = (error: z.ZodError, input: unknown) => ({
  status: 'validation_error' as const,
  input,
  fieldErrors: z.flattenError(error).fieldErrors,
});
function failure(error: unknown, input?: unknown) {
  if (!(error instanceof MatchingError)) throw error;
  return {
    status: error.code === 'stale' ? ('conflict' as const) : error.code,
    message: '匹配范围或需求版本已变化，请重新读取',
    ...(input === undefined ? {} : { input }),
  };
}
const emptyMatch = (requirementId: string): Match => ({
  requirementId,
  progress: 'queued',
  aiJudgment: null,
  humanJudgment: null,
});
function allowedEvidence(
  run: MatchRun['candidates'][number],
  scope: MatchScope,
) {
  const current = scope.candidates.find(
    (candidate) => candidate.person.id === run.person.id,
  );
  return current
    ? run.evidence.filter(
        (unit) =>
          isMatchingNature(unit.nature) &&
          current.evidence.some(
            (value) =>
              isMatchingNature(value.nature) &&
              evidenceKey(unit) === evidenceKey(value),
          ),
      )
    : [];
}
/** Preserve all-or-nothing derived judgments when any contributing source is hidden. */
export function projectMatchingRun(
  run: MatchRun,
  scope: MatchScope,
): StaffingPage {
  if (run.inputVersion !== demandInputVersion(scope.demand))
    throw new MatchingError('stale');
  const candidates = run.candidates.flatMap((candidate) => {
    const current = scope.candidates.find(
      (item) => item.person.id === candidate.person.id,
    );
    if (!current) return [];
    const visible = allowedEvidence(candidate, scope);
    const visibleSourceKeys = new Set(
      visible.map((unit) => sourceKey(unit.source)),
    );
    const requirements = candidate.cells.map(({ match, review }) => {
      const permitted = <T extends NonNullable<Match['aiJudgment']>>(
        judgment: T | null,
      ): T | null =>
        judgment &&
        judgment.sources.every((source) =>
          visibleSourceKeys.has(sourceKey(source)),
        )
          ? judgment
          : null;
      const checkedReview = unsupportedReviewSchema.safeParse(review);
      const aiJudgment = permitted(
          match.aiJudgment?.conclusion === 'not_supported' &&
            (!checkedReview.success ||
              checkedReview.data.status !== 'confirmed')
            ? null
            : match.aiJudgment,
        ),
        humanJudgment = permitted(match.humanJudgment);
      return {
        requirementId: match.requirementId,
        progress:
          match.progress === 'completed' &&
          aiJudgment === null &&
          humanJudgment === null
            ? ('awaiting_manual' as const)
            : match.progress,
        aiJudgment,
        humanJudgment,
      };
    });
    return [
      {
        person: current.person,
        demandRevision: run.demand.revision,
        requirements,
      },
    ];
  });
  return staffingPageSchema.parse({
    demand: scope.demand,
    candidates: orderStaffingCandidates(scope.demand, candidates),
    plan: { status: 'not_connected' },
  });
}
function snapshot(job: JobRecord, page: StaffingPage | null) {
  return staffingJobSnapshotSchema.parse({
    schemaVersion: 1,
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    attempt: job.attempt,
    revision: job.revision,
    updatedAt: job.updatedAt,
    progress:
      page === null
        ? null
        : {
            completed: page.candidates
              .flatMap((candidate) => candidate.requirements)
              .filter((match) => match.progress === 'completed').length,
            total: page.candidates.length * page.demand.requirements.length,
          },
    result: page,
    error:
      job.errorCode === null
        ? null
        : { code: job.errorCode, message: '处理输入已变化，请重新确认' },
    canRetry: false,
    canCancel:
      !['completed', 'cancelled'].includes(job.status) &&
      job.cancelRequestedAt === null,
    cancelRequestedAt: job.cancelRequestedAt,
  });
}
function processingJob(
  job: JobRecord,
  run: MatchRun,
  scope: MatchScope,
  now: string,
): JobRecord {
  const cells = run.candidates.flatMap((candidate) => candidate.cells);
  const status = cells.every((cell) => cell.match.progress === 'completed')
    ? 'completed'
    : cells.some((cell) => ['queued', 'judging'].includes(cell.match.progress))
      ? 'partial'
      : 'awaiting_manual';
  return advanceJob(
    job,
    {
      attempt: job.attempt,
      expectedRevision: job.revision,
      status,
      result: projectMatchingRun(run, scope),
    },
    now,
  );
}
// This exported service can be composed without the default usecase/loader.
// Apply matching eligibility at that independent port as well as during reads
// of old persisted runs; general read authorization alone is not eligibility.
function matchingScope(scope: MatchScope): MatchScope {
  return {
    ...scope,
    candidates: scope.candidates.map((candidate) => ({
      ...candidate,
      evidence: candidate.evidence.filter((unit) =>
        isMatchingNature(unit.nature),
      ),
    })),
  };
}
export const MATCH_CONCURRENCY = 4;
export function createMatchingService<C>(deps: MatchDependencies<C>) {
  if (typeof deps.reviewUnsupported?.review !== 'function')
    throw new Error('Missing Gemini review port');
  async function scopeFor(accountId: string, run: MatchRun) {
    const scope = matchingScope(
      await deps.scope(accountId, run.demand.id, run.demand.revision),
    );
    if (run.inputVersion !== demandInputVersion(scope.demand))
      throw new MatchingError('stale');
    return scope;
  }
  return {
    project: async (accountId: string, run: MatchRun) =>
      projectMatchingRun(run, await scopeFor(accountId, run)),
    async start(accountId: string, raw: unknown) {
      const checked = startSchema.safeParse(raw);
      if (!checked.success) return validation(checked.error, raw);
      const input = checked.data;
      try {
        return await deps.store.transaction(
          JSON.stringify(['operation', accountId, input.operationId]),
          async (tx) => {
            const scope = matchingScope(
              await deps.scope(
                accountId,
                input.demandId,
                input.expectedRevision,
              ),
            );
            const fingerprint = JSON.stringify(['start', input]);
            const previous = await tx.operation(accountId, input.operationId);
            if (previous) {
              if (
                previous.fingerprint !== fingerprint ||
                previous.judgment !== null
              )
                throw new MatchingError('conflict');
              const stored = await tx.load(previous.runId);
              if (!stored) throw new MatchingError('not_found');
              const page = projectMatchingRun(stored.run, scope);
              return {
                status: 'success' as const,
                runId: stored.run.id,
                replayed: true,
                snapshot: snapshot(
                  stored.job,
                  stored.job.result === null ? null : page,
                ),
              };
            }
            const id = deps.id(),
              now = deps.now();
            const run: MatchRun = {
              schemaVersion: 1,
              id,
              initiatorAccountId: accountId,
              demand: scope.demand,
              inputVersion: demandInputVersion(scope.demand),
              inputFormatVersion: MATCH_INPUT_VERSION,
              jevPromptVersion: JEV_PROMPT_VERSION,
              createdAt: now,
              candidates: scope.candidates.map((candidate) => ({
                ...candidate,
                cells: scope.demand.requirements.map((requirement) => ({
                  match: emptyMatch(requirement.id),
                  claim: null,
                  error: null,
                  providerError: null,
                  review: null,
                })),
              })),
            };
            const job = newJob(
              {
                jobId: id,
                kind: 'staffing_match',
                resourceId: id,
                inputVersion: run.inputVersion,
              },
              now,
            );
            await tx.insert(run, job);
            await tx.enqueue(job);
            await tx.saveOperation(accountId, input.operationId, {
              fingerprint,
              runId: id,
              judgment: null,
            });
            return {
              status: 'success' as const,
              runId: id,
              snapshot: snapshot(job, null),
              replayed: false,
            };
          },
        );
      } catch (error) {
        return failure(error, input);
      }
    },
    async read(accountId: string, runId: string) {
      return deps.store.transaction(runId, async (tx) => {
        const stored = await tx.load(runId);
        if (!stored) return { status: 'not_found' as const };
        try {
          const page = projectMatchingRun(
            stored.run,
            await scopeFor(accountId, stored.run),
          );
          return {
            status: 'success' as const,
            page,
            snapshot: snapshot(stored.job, page),
          };
        } catch (error) {
          if (error instanceof MatchingError && error.code === 'stale')
            return {
              status: 'stale' as const,
              runId,
              demandId: stored.run.demand.id,
              demandRevision: stored.run.demand.revision,
            };
          return failure(error);
        }
      });
    },
    async judge(accountId: string, runId: string, raw: unknown) {
      const checked = humanStaffingJudgmentInputSchema.safeParse(raw);
      if (!checked.success) return validation(checked.error, raw);
      const input = checked.data;
      try {
        return await deps.store.transaction(
          JSON.stringify(['operation', accountId, input.operationId]),
          async (tx) => {
            const stored = await tx.load(runId);
            if (!stored) throw new MatchingError('not_found');
            const { run } = stored;
            let { job } = stored;
            const scope = await scopeFor(accountId, run);
            if (
              run.demand.id !== input.demandId ||
              run.demand.revision !== input.expectedRevision ||
              job.cancelRequestedAt !== null ||
              ['cancelled', 'failed'].includes(job.status)
            )
              throw new MatchingError('conflict');
            const visiblePage = projectMatchingRun(run, scope);
            const candidate = run.candidates.find(
              (value) => value.person.id === input.personId,
            );
            const cell = candidate?.cells.find(
              (value) => value.match.requirementId === input.requirementId,
            );
            if (
              !candidate ||
              !cell ||
              !visiblePage.candidates.some(
                (value) => value.person.id === input.personId,
              )
            )
              throw new MatchingError('not_found');
            const evidence = allowedEvidence(candidate, scope);
            const sources = input.sources.map(
              (reference) =>
                evidence.find(
                  (unit) =>
                    referenceKey(unit.source) === referenceKey(reference),
                )?.source,
            );
            if (sources.some((source) => source === undefined))
              throw new MatchingError('conflict');
            const fingerprint = JSON.stringify(['judge', runId, input]);
            const previous = await tx.operation(accountId, input.operationId);
            if (previous) {
              if (
                previous.fingerprint !== fingerprint ||
                previous.judgment === null
              )
                throw new MatchingError('conflict');
              const match = visiblePage.candidates
                .find((value) => value.person.id === input.personId)
                ?.requirements.find(
                  (value) => value.requirementId === input.requirementId,
                );
              if (!match?.humanJudgment) throw new MatchingError('forbidden');
              return staffingJudgmentResultSchema.parse({
                ...previous.judgment,
                match,
                replayed: true,
              });
            }
            if (cell.match.humanJudgment !== null)
              throw new MatchingError('conflict');
            cell.match = {
              ...cell.match,
              progress: 'completed',
              humanJudgment: {
                conclusion: input.conclusion,
                rationale: input.rationale,
                sources: sources.filter((source) => source !== undefined),
                judgedBy: scope.actor,
                judgedAt: deps.now(),
              },
            };
            cell.claim = null;
            cell.error = null;
            // A terminal AI job remains the historical processing result. Manual
            // decisions live in canonical cells and are returned by the policy.
            if (job.status !== 'completed') {
              if (job.status === 'awaiting_manual')
                job = applyJobCommand(
                  job,
                  { action: 'resume', expectedRevision: job.revision },
                  deps.now(),
                );
              if (job.status === 'queued')
                job = advanceJob(
                  job,
                  {
                    status: 'running',
                    attempt: job.attempt,
                    expectedRevision: job.revision,
                  },
                  deps.now(),
                );
              job = processingJob(job, run, scope, deps.now());
            }
            await tx.save(run, job);
            const projected = projectMatchingRun(run, scope)
              .candidates.find((value) => value.person.id === input.personId)
              ?.requirements.find(
                (value) => value.requirementId === input.requirementId,
              );
            const result = staffingJudgmentResultSchema.parse({
              status: 'success',
              demandId: run.demand.id,
              personId: input.personId,
              revision: run.demand.revision,
              match: projected,
              replayed: false,
            });
            await tx.saveOperation(accountId, input.operationId, {
              fingerprint,
              runId,
              judgment: result,
            });
            return result;
          },
        );
      } catch (error) {
        return failure(error, input);
      }
    },
    async execute(runId: string, attempt: number): Promise<void> {
      let stopped = false;
      async function lane() {
        for (; !stopped;) {
          const claimed = await deps.store.transaction(runId, async (tx) => {
            const stored = await tx.load(runId);
            if (
              !stored ||
              stored.job.kind !== 'staffing_match' ||
              stored.job.attempt !== attempt ||
              ['completed', 'cancelled'].includes(stored.job.status)
            )
              return null;
            const { run } = stored;
            let { job } = stored;
            if (job.cancelRequestedAt !== null) {
              await tx.save(
                run,
                advanceJob(
                  job,
                  {
                    status: 'cancelled',
                    attempt,
                    expectedRevision: job.revision,
                  },
                  deps.now(),
                ),
              );
              return null;
            }
            if (['failed', 'awaiting_manual'].includes(job.status)) return null;
            let scope: MatchScope;
            try {
              scope = await scopeFor(run.initiatorAccountId, run);
            } catch (error) {
              if (!(error instanceof MatchingError)) throw error;
              if (job.status === 'queued')
                job = advanceJob(
                  job,
                  {
                    status: 'running',
                    attempt,
                    expectedRevision: job.revision,
                  },
                  deps.now(),
                );
              await tx.save(
                run,
                advanceJob(
                  job,
                  {
                    status: 'failed',
                    attempt,
                    expectedRevision: job.revision,
                    errorCode: 'input_changed',
                    result: null,
                  },
                  deps.now(),
                ),
              );
              return null;
            }
            if (job.status === 'queued')
              job = advanceJob(
                job,
                { status: 'running', attempt, expectedRevision: job.revision },
                deps.now(),
              );
            // Durable run/job locks make this cap apply across duplicate workers too.
            if (
              run.candidates
                .flatMap((value) => value.cells)
                .filter((cell) => cell.match.progress === 'judging').length >=
              MATCH_CONCURRENCY
            )
              return null;
            const candidate = run.candidates.find((value) =>
              value.cells.some((cell) => cell.match.progress === 'queued'),
            );
            const cell = candidate?.cells.find(
              (value) => value.match.progress === 'queued',
            );
            if (!candidate || !cell) {
              if (
                !run.candidates.some((value) =>
                  value.cells.some((item) => item.match.progress === 'judging'),
                )
              )
                await tx.save(run, processingJob(job, run, scope, deps.now()));
              return null;
            }
            const visible = allowedEvidence(candidate, scope);
            const allUnchanged =
              visible.length === candidate.evidence.length &&
              scope.candidates.some(
                (value) => value.person.id === candidate.person.id,
              );
            if (!allUnchanged || visible.length === 0) {
              cell.match = {
                ...emptyMatch(cell.match.requirementId),
                progress: 'awaiting_manual',
              };
              cell.error = allUnchanged ? 'no_evidence' : 'input_changed';
              await tx.save(run, processingJob(job, run, scope, deps.now()));
              return { skip: true as const };
            }
            cell.match.progress = 'judging';
            cell.claim = deps.id();
            if (job.status === 'partial')
              job = advanceJob(
                job,
                {
                  status: 'partial',
                  attempt,
                  expectedRevision: job.revision,
                  result: projectMatchingRun(run, scope),
                },
                deps.now(),
              );
            await tx.save(run, job);
            const requirement = run.demand.requirements.find(
              (value) => value.id === cell.match.requirementId,
            );
            if (!requirement) throw new MatchingError('conflict');
            return {
              skip: false as const,
              personId: candidate.person.id,
              requirementId: requirement.id,
              claim: cell.claim,
              input: matchingInput(run.demand, requirement, {
                ...candidate,
                evidence: visible,
              }),
            };
          });
          if (!claimed) return;
          if (claimed.skip) continue;
          let conclusion: z.infer<typeof conclusionSchema> | null = null;
          let providerError: JevErrorKind | null = null;
          try {
            conclusion = conclusionSchema.parse(
              (await deps.jev.decide(structuredClone(claimed.input)))
                .conclusion,
            );
          } catch (error) {
            // Store only a stable category; provider exceptions may contain evidence.
            providerError =
              error instanceof JevError
                ? error.kind
                : error instanceof z.ZodError
                  ? 'invalid_response'
                  : 'outcome_unknown';
          }
          let review: UnsupportedReview | null = null;
          if (conclusion === 'not_supported') {
            // Recheck current permission/claim/input between the two providers.
            const permitted = await deps.store.transaction(
              runId,
              async (tx) => {
                const stored = await tx.load(runId);
                if (
                  !stored ||
                  stored.job.attempt !== attempt ||
                  stored.job.cancelRequestedAt !== null ||
                  !['running', 'partial'].includes(stored.job.status)
                )
                  return false;
                const candidate = stored.run.candidates.find(
                  (c) => c.person.id === claimed.personId,
                );
                const cell = candidate?.cells.find(
                  (c) => c.match.requirementId === claimed.requirementId,
                );
                if (
                  !candidate ||
                  !cell ||
                  cell.claim !== claimed.claim ||
                  cell.match.progress !== 'judging' ||
                  cell.match.humanJudgment !== null
                )
                  return false;
                try {
                  return (
                    allowedEvidence(
                      candidate,
                      await scopeFor(stored.run.initiatorAccountId, stored.run),
                    ).length === candidate.evidence.length
                  );
                } catch (error) {
                  if (error instanceof MatchingError) return false;
                  throw error;
                }
              },
            );
            if (permitted) {
              try {
                review = unsupportedReviewSchema.parse(
                  await deps.reviewUnsupported.review(claimed.input),
                );
              } catch {
                review = failedReview('outcome_unknown');
              }
            }
            if (review?.status !== 'confirmed') conclusion = null;
          }
          await deps.store.transaction(runId, async (tx) => {
            const stored = await tx.load(runId);
            if (
              !stored ||
              stored.job.attempt !== attempt ||
              !['running', 'partial'].includes(stored.job.status)
            )
              return;
            const { run, job } = stored;
            if (job.cancelRequestedAt !== null) {
              await tx.save(
                run,
                advanceJob(
                  job,
                  {
                    status: 'cancelled',
                    attempt,
                    expectedRevision: job.revision,
                  },
                  deps.now(),
                ),
              );
              return;
            }
            const candidate = run.candidates.find(
              (value) => value.person.id === claimed.personId,
            );
            const cell: MatchCell | undefined = candidate?.cells.find(
              (value) => value.match.requirementId === claimed.requirementId,
            );
            if (
              !candidate ||
              !cell ||
              cell.claim !== claimed.claim ||
              cell.match.progress !== 'judging' ||
              cell.match.humanJudgment !== null
            )
              return;
            let scope: MatchScope;
            try {
              scope = await scopeFor(run.initiatorAccountId, run);
            } catch (error) {
              if (!(error instanceof MatchingError)) throw error;
              await tx.save(
                run,
                advanceJob(
                  job,
                  {
                    status: 'failed',
                    attempt,
                    expectedRevision: job.revision,
                    result: null,
                    errorCode: 'input_changed',
                  },
                  deps.now(),
                ),
              );
              return;
            }
            const unchanged =
              allowedEvidence(candidate, scope).length ===
              candidate.evidence.length;
            cell.match =
              unchanged && conclusion !== null
                ? {
                    requirementId: claimed.requirementId,
                    progress: 'completed',
                    aiJudgment: {
                      conclusion,
                      rationale:
                        review?.status === 'confirmed'
                          ? 'Jev 不支持判断已由 Gemini 同输入复核；所附片段为完整判断输入，程序未生成模型解释。'
                          : 'Jev 四态判断；所附片段为完整判断输入，程序未生成模型解释。',
                      sources: [
                        ...new Map(
                          candidate.evidence.map((unit) => [
                            sourceKey(unit.source),
                            unit.source,
                          ]),
                        ).values(),
                      ],
                    },
                    humanJudgment: null,
                  }
                : {
                    ...emptyMatch(claimed.requirementId),
                    progress: 'awaiting_manual',
                  };
            cell.claim = null;
            cell.providerError = providerError;
            cell.review = review;
            cell.error = unchanged
              ? review?.status === 'disputed'
                ? 'review_disputed'
                : review?.status === 'failed'
                  ? 'review_failed'
                  : conclusion === null
                    ? 'jev_failed'
                    : null
              : 'input_changed';
            await tx.save(run, processingJob(job, run, scope, deps.now()));
          });
        }
      }
      const settled = await Promise.allSettled(
        Array.from({ length: MATCH_CONCURRENCY }, async () => {
          try {
            await lane();
          } catch (error) {
            stopped = true;
            throw error;
          }
        }),
      );
      const failure = settled.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    },
  };
}
