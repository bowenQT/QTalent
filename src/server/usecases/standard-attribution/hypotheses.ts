import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  comparisonActorSchema,
  comparisonTableRowSchema,
  selectionVersionIdSchema,
  type ComparisonCase,
} from '../../../contracts/judgment-comparison';
import {
  confirmStandardAttributionInputSchema,
  confirmStandardAttributionResultSchema,
  confirmedStandardAttributionSchema,
  createAuthorizedAttributionModelInputSchema,
  createGroundedStandardHypothesisSchema,
  generateStandardHypothesesInputSchema,
  generateStandardHypothesesResultSchema,
  revisionEligibleAttributionSchema,
  standardIterationActionResultSchema,
  type ConfirmedStandardAttribution,
  type StandardAttributionHypothesis,
} from '../../../contracts/standard-attribution';
import {
  createSelectionRevisionInputSchema,
  selectionAiDraftSchema,
  selectionStandardReadResultSchema,
} from '../../../contracts/selection-standard';
import {
  DRAFT_PROMPT_VERSION,
  HYPOTHESIS_PROMPT_VERSION,
  draftChangesSchema,
  draftMessages,
  hypothesisCandidatesSchema,
  hypothesisMessages,
} from './prompts';
import type {
  AttributionModel,
  AttributionOperation,
  AttributionPorts,
  HrAttributionBatch,
  SelectionDraftProposal,
} from './ports';

const text = z.string().trim().min(1);
export const selectionDraftProposalSchema = z.strictObject({
  id: text,
  attributionId: text,
  baseVersionId: selectionVersionIdSchema,
  aiDraft: selectionAiDraftSchema,
  humanVersion: z.null(),
});
export const draftSelectionProposalResultSchema =
  standardIterationActionResultSchema(
    createSelectionRevisionInputSchema,
    selectionDraftProposalSchema,
  );
type Failure =
  | {
      status: 'validation_error';
      fieldErrors: Record<string, string[]>;
      input: unknown;
    }
  | { status: 'conflict'; message: string; input: unknown }
  | { status: 'forbidden' | 'not_found' | 'model_failed'; message: string };
type Outcome<T> = { status: 'success'; replayed: boolean; result: T } | Failure;
type Input = { operationId: string };
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super(result.status);
  }
}
function reject(
  status: 'forbidden' | 'not_found' | 'model_failed',
  message: string,
): never {
  throw new Rejected({ status, message });
}
function conflict(
  input: unknown,
  message = '资料或请求版本已变化，请重新核对',
): never {
  throw new Rejected({ status: 'conflict', message, input });
}
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const checked = schema.safeParse(input);
  if (checked.success) return checked.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of checked.error.issues) {
    const key = issue.path.map(String).join('.') || '_root';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new Rejected({ status: 'validation_error', fieldErrors, input });
}
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ordered = (ids: readonly string[]) => [...ids].sort();
function currentBatch(
  accountId: string,
  snapshot: HrAttributionBatch | null,
  input: Input,
  batchId?: string,
) {
  if (
    !snapshot ||
    snapshot.accountId !== accountId ||
    (batchId !== undefined && snapshot.batchId !== batchId)
  )
    reject('forbidden', '当前没有该批次的HR归因权限');
  const actor = comparisonActorSchema.safeParse(snapshot.actor);
  if (!actor.success) reject('forbidden', '当前HR身份无法确认');
  const allowed = new Set(snapshot.authorizedCaseIds);
  // Drop outside evidence BEFORE parsing/serializing any model input.
  const cases = snapshot.candidates
    .filter((unit) => allowed.has(unit.id))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const checked = createAuthorizedAttributionModelInputSchema([
    ...allowed,
  ]).safeParse({
    batchId: snapshot.batchId,
    promptVersion: HYPOTHESIS_PROMPT_VERSION,
    mapping: snapshot.mapping,
    cases,
  });
  if (!checked.success) conflict(input, '当前没有一致且可授权引用的已确认案例');
  return { ...checked.data, actor: actor.data };
}
type Batch = ReturnType<typeof currentBatch>;
function selectCases(batch: Batch, caseIds: readonly string[]) {
  const selected = caseIds.map((id) =>
    batch.cases.find((unit) => unit.id === id),
  );
  if (selected.some((unit) => !unit))
    reject('forbidden', '当前不能读取所选案例');
  return selected.filter((unit): unit is ComparisonCase => unit !== undefined);
}
function citations(cases: readonly ComparisonCase[]) {
  return cases.flatMap((unit) =>
    (['front', 'back'] as const).flatMap((side) => {
      const stage = unit[side];
      return stage.state === 'present'
        ? [
            {
              caseId: unit.id,
              side,
              nodeId: stage.judgment.nodeId,
              standardVersionId: stage.judgment.standardVersionId,
              row: stage.judgment.row,
            },
          ]
        : [];
    }),
  );
}
function currentAttribution(
  attribution: ConfirmedStandardAttribution,
  batch: Batch,
  input: unknown,
) {
  const references = citations(batch.cases);
  if (
    attribution.batchId !== batch.batchId ||
    attribution.citations.some(
      (citation) =>
        !references.some(
          (current) =>
            current.caseId === citation.caseId &&
            current.side === citation.side &&
            current.nodeId === citation.nodeId &&
            current.standardVersionId === citation.standardVersionId &&
            JSON.stringify(comparisonTableRowSchema.parse(current.row)) ===
              JSON.stringify(comparisonTableRowSchema.parse(citation.row)),
        ),
    )
  )
    conflict(input, '已确认归因的出处不再与当前可读案例一致');
}
function validateChanges(
  value: unknown,
  content: z.infer<
    typeof import('../../../contracts/selection-standard').selectionStandardContentSchema
  >,
) {
  const output = draftChangesSchema.parse(value);
  const points = new Map(
    content.reviewPoints.map((point) => [point.id, point]),
  );
  for (const change of output.changes) {
    if (change.kind === 'add') {
      if (points.has(change.after.id))
        throw new Error('Model reused a review point');
      points.set(change.after.id, change.after);
    } else {
      if (
        JSON.stringify(points.get(change.before.id)) !==
        JSON.stringify(change.before)
      )
        throw new Error('Model changed base evidence');
      if (change.kind === 'remove') points.delete(change.before.id);
      else points.set(change.after.id, change.after);
    }
  }
  if (points.size === 0) throw new Error('Model removed all review points');
  return output.changes;
}
interface ModelPlan<Tx, T> {
  batch: Batch;
  evidenceFingerprint: string;
  promptVersion: string;
  messages: { role: 'system' | 'user'; content: string }[];
  schema: z.ZodType<Record<string, unknown>>;
  materialize(value: unknown, model: string, generatedAt: string): T;
  persist(tx: Tx, value: T): Promise<void>;
}

export function createStandardAttributionUsecases<Tx>(
  ports: AttributionPorts<Tx>,
  model: AttributionModel,
  options: { now?: () => Date; newId?: () => string } = {},
) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const at = () => now().toISOString();
  async function settle<T>(
    work: () => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Rejected) return error.result;
      throw error;
    }
  }
  function requireAccount(
    accountId: string | null,
  ): asserts accountId is string {
    if (!accountId) reject('forbidden', '请使用当前认证的HR身份');
  }
  function replay<T>(
    existing: AttributionOperation | null,
    fingerprint: string,
    evidenceFingerprint: string,
    input: unknown,
    resultSchema: z.ZodType<Outcome<T>>,
  ): Outcome<T> | undefined {
    if (!existing) return undefined;
    if (existing.fingerprint !== fingerprint)
      conflict(input, '同一操作编号不能用于不同语义');
    if (existing.evidenceFingerprint !== evidenceFingerprint) conflict(input);
    if (existing.state === 'pending')
      conflict(input, '该模型操作结果尚未收口，不自动重复调用');
    const result = resultSchema.parse(existing.result);
    return result.status === 'success' ? { ...result, replayed: true } : result;
  }
  async function executeModel<T>(
    accountId: string,
    input: Input,
    action: 'hypotheses' | 'draft',
    resultSchema: z.ZodType<Outcome<T>>,
    prepare: (tx: Tx) => Promise<ModelPlan<Tx, T>>,
  ): Promise<Outcome<T>> {
    const fingerprint = digest({ action, input });
    const start = await ports.transaction(
      accountId,
      input.operationId,
      async (tx) => {
        const plan = await prepare(tx); // Current scope BEFORE returning any saved result.
        const existing = await ports.readOperation(
          tx,
          accountId,
          input.operationId,
        );
        const cached = replay(
          existing,
          fingerprint,
          plan.evidenceFingerprint,
          input,
          resultSchema,
        );
        if (cached) return { cached };
        const reservation: AttributionOperation = {
          state: 'pending',
          fingerprint,
          evidenceFingerprint: plan.evidenceFingerprint,
          reservationId: newId(),
        };
        await ports.writeOperation(
          tx,
          accountId,
          input.operationId,
          reservation,
        );
        return { plan, reservation };
      },
    );
    if ('cached' in start && start.cached) return start.cached;
    if (!('plan' in start) || !start.plan || !start.reservation)
      throw new Error('Missing reserved model action');
    const { plan, reservation } = start;
    let outcome: Outcome<T>;
    let modelRequestId: string | undefined;
    // Only provider work / model-output validation is mapped to model_failed.
    // Storage failures below propagate, never masquerade as model failures.
    try {
      if (!model.expectedModel.toLowerCase().includes('gemini'))
        throw new Error('Gemini client required');
      const response = await model.client.generateStructured({
        messages: plan.messages,
        schema: plan.schema,
        promptVersion: plan.promptVersion,
      });
      modelRequestId = response.metadata.requestId;
      if (
        !response.ok ||
        response.metadata.model !== model.expectedModel ||
        response.metadata.promptVersion !== plan.promptVersion
      )
        throw new Error('No matching structured model result');
      outcome = {
        status: 'success',
        replayed: false,
        result: plan.materialize(response.value, response.metadata.model, at()),
      };
    } catch {
      outcome = {
        status: 'model_failed',
        message: '模型未生成可用结果，未生成归因草稿',
      };
    }
    return ports.transaction(accountId, input.operationId, async (tx) => {
      const current = await ports.readOperation(
        tx,
        accountId,
        input.operationId,
      );
      if (
        !current ||
        current.state !== 'pending' ||
        current.reservationId !== reservation.reservationId ||
        current.fingerprint !== fingerprint
      )
        conflict(input, '该模型操作已被其他结果替代');
      let fresh: ModelPlan<Tx, T> | undefined;
      try {
        fresh = await prepare(tx);
        if (fresh.evidenceFingerprint !== reservation.evidenceFingerprint)
          conflict(input);
      } catch (error) {
        if (!(error instanceof Rejected)) throw error;
        outcome = error.result;
      }
      if (outcome.status === 'success' && fresh) {
        await fresh.persist(tx, outcome.result);
        await ports.audit(tx, {
          accountId,
          action,
          batchId: fresh.batch.batchId,
          operationId: input.operationId,
          at: at(),
        });
      }
      const checked = resultSchema.parse(outcome);
      await ports.writeOperation(tx, accountId, input.operationId, {
        ...reservation,
        state: 'finished',
        result: checked,
        ...(modelRequestId ? { modelRequestId } : {}),
      });
      return checked;
    });
  }
  return {
    async generateHypotheses(accountId: string | null, input: unknown) {
      return generateStandardHypothesesResultSchema.parse(
        await settle<StandardAttributionHypothesis[]>(async () => {
          requireAccount(accountId);
          const command = parse(generateStandardHypothesesInputSchema, input);
          return executeModel(
            accountId,
            command,
            'hypotheses',
            generateStandardHypothesesResultSchema,
            async (tx) => {
              const batch = currentBatch(
                accountId,
                await ports.loadHrBatch(tx, accountId, command.batchId, at()),
                command,
                command.batchId,
              );
              const request = {
                batchId: batch.batchId,
                promptVersion: HYPOTHESIS_PROMPT_VERSION,
                mapping: batch.mapping,
                cases: batch.cases,
              };
              return {
                batch,
                evidenceFingerprint: digest(request),
                promptVersion: HYPOTHESIS_PROMPT_VERSION,
                messages: hypothesisMessages(request),
                schema: hypothesisCandidatesSchema,
                materialize(value, modelId, generatedAt) {
                  return hypothesisCandidatesSchema
                    .parse(value)
                    .hypotheses.map((candidate) => {
                      const references = candidate.citations.map((citation) => {
                        const unit = batch.cases.find(
                          (item) => item.id === citation.caseId,
                        );
                        const stage = unit?.[citation.side];
                        if (!unit || stage?.state !== 'present')
                          throw new Error('Model cited outside evidence');
                        return {
                          ...citation,
                          nodeId: stage.judgment.nodeId,
                          standardVersionId: stage.judgment.standardVersionId,
                          row: stage.judgment.row,
                        };
                      });
                      return createGroundedStandardHypothesisSchema(
                        batch.cases,
                      ).parse({
                        id: newId(),
                        batchId: batch.batchId,
                        origin: 'ai_hypothesis',
                        ...candidate,
                        citations: references,
                        model: {
                          service: 'Modelink',
                          model: modelId,
                          promptVersion: HYPOTHESIS_PROMPT_VERSION,
                        },
                        generatedAt,
                      });
                    });
                },
                persist: (storeTx, hypotheses) =>
                  ports.saveHypotheses(storeTx, hypotheses),
              };
            },
          );
        }),
      );
    },
    async confirmAttribution(accountId: string | null, input: unknown) {
      return confirmStandardAttributionResultSchema.parse(
        await settle<ConfirmedStandardAttribution>(async () => {
          requireAccount(accountId);
          const parsed = parse(confirmStandardAttributionInputSchema, input);
          const command = {
            ...parsed,
            categories: [...parsed.categories].sort(),
            caseIds: ordered(parsed.caseIds),
          };
          return ports.transaction(
            accountId,
            command.operationId,
            async (tx) => {
              const batch = currentBatch(
                accountId,
                await ports.loadHrBatch(tx, accountId, command.batchId, at()),
                command,
                command.batchId,
              );
              const selected = selectCases(batch, command.caseIds);
              let hypothesis: StandardAttributionHypothesis | null = null;
              if (command.hypothesisId !== null) {
                hypothesis = await ports.readHypothesis(
                  tx,
                  batch.batchId,
                  command.hypothesisId,
                );
                if (!hypothesis) reject('not_found', '当前范围内没有该假设');
                if (
                  !createGroundedStandardHypothesisSchema(
                    batch.cases,
                  ).safeParse(hypothesis).success
                )
                  conflict(command, '假设依据已变化');
              }
              const fingerprint = digest({ action: 'confirm', input: command });
              const evidenceFingerprint = digest({
                cases: selected,
                hypothesis,
              });
              const cached = replay(
                await ports.readOperation(tx, accountId, command.operationId),
                fingerprint,
                evidenceFingerprint,
                command,
                confirmStandardAttributionResultSchema,
              );
              if (cached) return cached;
              const references = citations(selected);
              if (references.length === 0)
                conflict(command, '所选案例没有当前可引用的已确认原文');
              const attribution = confirmedStandardAttributionSchema.parse({
                id: newId(),
                revision: 1,
                batchId: batch.batchId,
                origin: 'human_conclusion',
                hypothesisId: command.hypothesisId,
                categories: command.categories,
                rationale: command.rationale,
                citations: references,
                confirmedBy: batch.actor,
                confirmedAt: at(),
              });
              await ports.saveAttribution(tx, attribution);
              await ports.audit(tx, {
                accountId,
                action: 'confirm',
                batchId: batch.batchId,
                operationId: command.operationId,
                at: at(),
              });
              const result = {
                status: 'success' as const,
                replayed: false,
                result: attribution,
              };
              await ports.writeOperation(tx, accountId, command.operationId, {
                state: 'finished',
                fingerprint,
                evidenceFingerprint,
                reservationId: newId(),
                result,
              });
              return result;
            },
          );
        }),
      );
    },
    async draftSelectionProposal(accountId: string | null, input: unknown) {
      return draftSelectionProposalResultSchema.parse(
        await settle<SelectionDraftProposal>(async () => {
          requireAccount(accountId);
          const command = parse(createSelectionRevisionInputSchema, input);
          return executeModel(
            accountId,
            command,
            'draft',
            draftSelectionProposalResultSchema,
            async (tx) => {
              const context = await ports.loadDraftContext(
                tx,
                accountId,
                command.attributionId,
                command.baseVersionId,
                at(),
              );
              if (!context)
                reject('not_found', '当前范围内没有可起草的归因或标准');
              const batch = currentBatch(accountId, context.batch, command);
              const attribution = confirmedStandardAttributionSchema.parse(
                context.attribution,
              );
              if (
                attribution.id !== command.attributionId ||
                attribution.revision !== command.expectedAttributionRevision
              )
                conflict(command);
              if (
                !revisionEligibleAttributionSchema.safeParse(attribution)
                  .success
              )
                reject('forbidden', '只有HR确认含评价标准的归因可以起草');
              currentAttribution(attribution, batch, command);
              const standard = selectionStandardReadResultSchema.safeParse({
                status: 'success',
                ...context.standard,
              });
              if (
                !standard.success ||
                standard.data.status !== 'success' ||
                standard.data.version.versionId !== command.baseVersionId
              )
                conflict(command, '选拔标准版本无法确认');
              const selected = selectCases(batch, [
                ...new Set(
                  attribution.citations.map((citation) => citation.caseId),
                ),
              ]);
              const content = standard.data.content;
              return {
                batch,
                evidenceFingerprint: digest({
                  attribution,
                  standard: standard.data,
                  cases: selected,
                }),
                promptVersion: DRAFT_PROMPT_VERSION,
                messages: draftMessages({
                  attribution,
                  content,
                  cases: selected,
                }),
                schema: draftChangesSchema,
                materialize(value, modelId, generatedAt) {
                  return selectionDraftProposalSchema.parse({
                    id: newId(),
                    attributionId: attribution.id,
                    baseVersionId: command.baseVersionId,
                    aiDraft: {
                      origin: 'ai_draft',
                      basis: attribution,
                      changes: validateChanges(value, content),
                      model: {
                        service: 'Modelink',
                        model: modelId,
                        promptVersion: DRAFT_PROMPT_VERSION,
                      },
                      generatedAt,
                    },
                    humanVersion: null,
                  });
                },
                persist: (storeTx, proposal) =>
                  ports.saveProposal(storeTx, proposal),
              };
            },
          );
        }),
      );
    },
  };
}
