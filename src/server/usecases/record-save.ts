import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import {
  recordSaveInputSchema, recordUndoInputSchema, recordSaveResultSchema,
  recordUndoResultSchema, type RecordSaveInput, type RecordUndoInput,
  type RecordSaveResult, type RecordUndoResult,
} from '../../contracts/record';
import { canReadProject } from '../authz';
import { readTalentSource } from '../authz/talent';
import { loadProjectContext, ForbiddenError } from './project-context';
import { sourcesForDraft, sourceKey } from './talent-source-projection';
import {
  lockRecordDraft, readRecordOperation, readRecordSave, readDraftEvents,
  beginRecordSave, appendRecordEvent, finishRecordSave, withdrawRecordSave,
  appendRecordOperation, readEvidenceForTalent,
} from '../modules/records';
import {
  lockScoreEvents, readEventScoreState, insertConfirmedScore, insertRecordSuggestion,
  withdrawSavedScores, canConfirmOwnScore, isUndoWindowOpen,
} from '../modules/talent';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { recordAudit } from '../platform/audit';

export class RecordConflictError extends Error {}
export class RecordNotFoundError extends Error {}
export interface RecordSaveDependencies {
  db: Database;
  businessDate(): string;
  now(): Date;
}
type LockedDraft = NonNullable<Awaited<ReturnType<typeof lockRecordDraft>>>;
const fingerprint = (input: RecordSaveInput | RecordUndoInput) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

async function operationLock(tx: Transaction, accountId: string, action: string, id: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['record-operation', accountId, action, id])},0))`);
}
async function transaction<T>(db: Database, run: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(run, { isolationLevel: 'serializable' });
    } catch (error) {
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (typeof cause === 'object' && cause !== null && 'code' in cause &&
        (cause.code === '40001' || cause.code === '40P01' ||
          (cause.code === '23505' && 'constraint' in cause &&
            ['records_operation_key', 'talent_one_active_confirmation', 'talent_confirmation_revision'].includes(String(cause.constraint))))) {
        if (attempt < 2) continue;
        throw new RecordConflictError('数据已变化，请重试', { cause: error });
      }
      throw error;
    }
  }
}
async function authorizeDraft(
  tx: Transaction, deps: RecordSaveDependencies, accountId: string,
  draft: LockedDraft, personIds: readonly string[], projectId: string | null,
) {
  const base = await loadProjectContext(tx, accountId, deps.businessDate());
  const evidence = await readEvidenceForTalent(tx);
  const subjects = draft.sources.flatMap((source) => source.subjects);
  if (personIds.some((personId) => {
    const matching = subjects.filter((subject) => subject.personId === personId);
    return matching.length === 0 || matching.some((subject) =>
      !canConfirmOwnScore(base.context, subject, base.context.account.personId));
  })) throw new ForbiddenError();
  if (projectId !== null) {
    const project = base.context.projects.find((row) => row.id === projectId);
    if (!project || !canReadProject(base.context, project)) throw new ForbiddenError();
  }
  const sources = sourcesForDraft({ ...base, ...evidence }, draft.sources);
  for (const reference of draft.sources) {
    const visible = await readTalentSource(async () => ({
      context: base.context, records: [], sources,
    }), reference);
    if (!visible) throw new ForbiddenError();
  }
  return { ...base, ...evidence, sources };
}
export function createRecordSaveService(deps: RecordSaveDependencies) {
  return {
    async save(accountId: string, raw: RecordSaveInput): Promise<RecordSaveResult> {
      const input = recordSaveInputSchema.parse(raw);
      try {
        return await transaction(deps.db, async (tx) => {
          await operationLock(tx, accountId, 'save', input.operation_id);
          const draft = await lockRecordDraft(tx, input.draftId);
          if (!draft) throw new RecordNotFoundError();
          const data = await authorizeDraft(tx, deps, accountId, draft, input.personIds, input.projectId);
          const old = await readRecordOperation(tx, accountId, 'save', input.operation_id);
          if (old) {
            if (old.fingerprint !== fingerprint(input)) throw new RecordConflictError();
            const result = recordSaveResultSchema.parse(old.result);
            if (result.status !== 'success') throw new Error('Invalid saved operation result');
            return { ...result, replayed: true };
          }
          if (draft.revision !== input.expected_revision) throw new RecordConflictError();
          const mapping = await readDraftEvents(tx, draft.id);
          if (mapping.some((row) => row.withdrawnAt !== null)) throw new RecordConflictError();
          await lockScoreEvents(tx, mapping.map((row) => row.eventId));
          const state = await readEventScoreState(tx, mapping.map((row) => row.eventId));
          const evaluatorId = data.context.account.personId;
          if (mapping.length && (mapping.length !== input.personIds.length ||
            mapping.some((row) => !input.personIds.includes(row.personId)))) throw new RecordConflictError();
          for (const mapped of mapping) {
            const event = data.events.find((row) => row.id === mapped.eventId);
            if (!event || event.ruleVersionId !== draft.ruleVersionId || event.projectId !== input.projectId ||
              event.title !== input.sbi.title || event.situation !== input.sbi.situation ||
              event.behavior !== input.sbi.behavior || event.impact !== input.sbi.impact) {
              throw new RecordConflictError();
            }
          }
          const rules = await readTalentEvaluationRules(tx);
          const prepared = input.decisions.map((decision) => {
            const evidence = draft.evidence.find((row) =>
              row.personId === decision.personId && row.dimensionId === decision.dimensionId);
            if (!evidence) throw new RecordConflictError('评分来源已变化');
            const source = data.sources.find((row) => sourceKey(row) === sourceKey(evidence));
            if (!source || !draft.sources.some((row) => sourceKey(row) === sourceKey(evidence))) {
              throw new RecordConflictError('评分来源已变化');
            }
            const score = draft.draft.scores.find((row) =>
              row.personId === decision.personId && row.dimensionId === decision.dimensionId);
            if (!score) throw new RecordConflictError('建议分已变化');
            if (score.state === 'suggested') {
              if (score.value !== evidence.suggestedValue || score.anchor.ruleVersion !== draft.ruleVersionId) {
                throw new RecordConflictError('建议分版本已变化');
              }
              for (const citation of score.citations) {
                if (citation.kind === 'input') {
                  if (draft.draft.originalInput.text.slice(citation.start, citation.end) !== citation.quote ||
                    !source.excerpt.includes(citation.quote)) throw new RecordConflictError('引用不一致');
                } else {
                  const actual = data.sources.find((row) => sourceKey(row) === sourceKey(citation.reference));
                  if (!actual || !draft.sources.some((row) => sourceKey(row) === sourceKey(actual)) ||
                    !actual.excerpt.includes(citation.quote) ||
                    JSON.stringify(actual.location) !== JSON.stringify(citation.reference.location)) {
                    throw new RecordConflictError('引用不一致');
                  }
                }
              }
            }
            const value = decision.action === 'unknown' ? null :
              decision.action === 'edit' ? decision.value :
                score.state === 'suggested' ? score.value : null;
            if (decision.action === 'confirm' && value === null) throw new RecordConflictError('未知不能确认成分数');
            const anchor = value === null ? null : rules.anchors.find((row) =>
              row.dimensionId === decision.dimensionId && row.ruleVersionId === draft.ruleVersionId && row.value === value);
            if (value !== null && !anchor) throw new RecordConflictError('评分锚点已变化');
            const mapped = mapping.find((row) => row.personId === decision.personId);
            if (mapped && state.confirmations.some((row) => row.eventId === mapped.eventId &&
              row.dimensionId === decision.dimensionId && row.evaluatorId === evaluatorId)) {
              throw new RecordConflictError('本人已有确认，不能重复提交');
            }
            return { decision, evidence, value, anchor };
          });
          // Wall clock is intentionally independent of the fixed demo business date.
          const savedAt = deps.now();
          const saveId = await beginRecordSave(tx, {
            draftId: draft.id, accountId, personId: evaluatorId, savedAt,
            personIds: input.personIds, projectId: input.projectId,
          });
          const involved = mapping.map(({ personId, eventId }) => ({ personId, eventId }));
          if (!mapping.length) {
            for (const personId of input.personIds) {
              const eventId = await appendRecordEvent(tx, input, {
                personId, recorderId: evaluatorId, saveId, ruleVersionId: draft.ruleVersionId,
                occurredOn: deps.businessDate(),
                sources: draft.sources.filter((source) =>
                  source.subjects.some((subject) => subject.personId === personId)),
              });
              involved.push({ personId, eventId });
            }
          }
          const confirmationIds: string[] = [];
          const reviewIds: string[] = [];
          for (const item of prepared) {
            const eventId = involved.find((row) => row.personId === item.decision.personId)!.eventId;
            const priorSuggestion = state.suggestions.find((row) =>
              row.eventId === eventId && row.dimensionId === item.decision.dimensionId);
            if (priorSuggestion && (priorSuggestion.ruleVersionId !== draft.ruleVersionId ||
              priorSuggestion.value !== item.evidence.suggestedValue ||
              priorSuggestion.fragmentId !== item.evidence.fragmentId ||
              priorSuggestion.originalVersionId !== item.evidence.originalVersionId)) {
              throw new RecordConflictError('建议分版本已变化');
            }
            const aiAnchor = item.evidence.suggestedValue === null ? null :
              rules.anchors.find((row) => row.dimensionId === item.decision.dimensionId &&
                row.ruleVersionId === draft.ruleVersionId && row.value === item.evidence.suggestedValue);
            if (item.evidence.suggestedValue !== null && !aiAnchor) {
              throw new RecordConflictError('建议分锚点已变化');
            }
            const suggestionId = priorSuggestion?.id ?? await insertRecordSuggestion(tx, {
              eventId, dimensionId: item.decision.dimensionId, ruleVersionId: draft.ruleVersionId,
              modelVersion: item.evidence.modelVersion,
              status: item.evidence.suggestedValue === null ? 'unknown' : 'scored',
              value: item.evidence.suggestedValue, anchorId: aiAnchor?.id ?? null,
              fragmentId: item.evidence.fragmentId, originalVersionId: item.evidence.originalVersionId,
              rationale: item.evidence.rationale,
            });
            const result = await insertConfirmedScore(tx, {
              eventId, dimensionId: item.decision.dimensionId, evaluatorId,
              confirmedAt: savedAt, modifiedBy: evaluatorId, suggestionId,
              ruleVersionId: draft.ruleVersionId,
              status: item.value === null ? 'unknown' : 'scored',
              value: item.value, anchorId: item.anchor?.id ?? null,
              fragmentId: item.evidence.fragmentId,
              originalVersionId: item.evidence.originalVersionId,
              reason: item.decision.action === 'confirm' ? '' : item.decision.reason,
            }, {
              saveId, aiValue: item.evidence.suggestedValue,
              peers: state.confirmations.filter((row) => row.active && row.eventId === eventId &&
                row.dimensionId === item.decision.dimensionId),
            });
            confirmationIds.push(result.confirmationId);
            reviewIds.push(...result.reviewIds);
          }
          const revision = draft.revision + 1;
          await finishRecordSave(tx, saveId, draft.id, revision, confirmationIds, reviewIds);
          const result = recordSaveResultSchema.parse({
            status: 'success', replayed: false,
            result: {
              saveId, events: involved, revision, confirmationIds, reviewItemIds: reviewIds,
              savedBy: evaluatorId, savedAt: savedAt.toISOString(),
              undoUntil: new Date(savedAt.getTime() + 5_000).toISOString(),
            },
          });
          await appendRecordOperation(tx, {
            actorAccountId: accountId, action: 'save', operationId: input.operation_id,
            fingerprint: fingerprint(input), draftId: draft.id, result,
          });
          await recordAudit(tx, { actorId: accountId, action: 'record.save', resourceId: saveId });
          return result;
        });
      } catch (error) {
        if (error instanceof ForbiddenError) return { status: 'forbidden', message: '你没有执行此操作的权限' };
        if (error instanceof RecordNotFoundError) return { status: 'not_found', message: '未找到可操作的草稿' };
        if (error instanceof RecordConflictError) return { status: 'conflict', message: error.message || '数据已变化，请重试', input };
        throw error;
      }
    },
    async undo(accountId: string, raw: RecordUndoInput): Promise<RecordUndoResult> {
      const input = recordUndoInputSchema.parse(raw);
      try {
        return await transaction(deps.db, async (tx) => {
          await operationLock(tx, accountId, 'undo', input.operation_id);
          const save = await readRecordSave(tx, input.saveId);
          if (!save) throw new RecordNotFoundError();
          const draft = await lockRecordDraft(tx, save.draftId);
          if (!draft) throw new RecordNotFoundError();
          if (save.actorAccountId !== accountId) throw new ForbiddenError();
          await authorizeDraft(tx, deps, accountId, draft, save.personIds, save.projectId);
          const old = await readRecordOperation(tx, accountId, 'undo', input.operation_id);
          if (old) {
            if (old.fingerprint !== fingerprint(input)) throw new RecordConflictError();
            const result = recordUndoResultSchema.parse(old.result);
            if (result.status !== 'success') throw new Error('Invalid undo operation result');
            return { ...result, replayed: true };
          }
          const mapping = await readDraftEvents(tx, draft.id);
          await lockScoreEvents(tx, mapping.map((row) => row.eventId));
          const currentSave = await readRecordSave(tx, save.id);
          const now = deps.now();
          if (!currentSave || currentSave.withdrawnAt !== null ||
            !isUndoWindowOpen(currentSave.savedAt.getTime(), now.getTime())) throw new RecordConflictError('撤销窗口已结束');
          const created = mapping.filter((row) => row.createdSaveId === save.id);
          const state = await readEventScoreState(tx, mapping.map((row) => row.eventId));
          if (save.confirmationIds.some((id) => !state.confirmations.some((row) => row.id === id && row.active)) ||
            state.confirmations.some((row) => row.active && created.some((event) => event.eventId === row.eventId) &&
              !save.confirmationIds.includes(row.id)) ||
            state.reviews.some((row) => row.withdrawnAt === null &&
              !save.reviewIds.includes(row.id) &&
              ((row.confirmationId !== null && save.confirmationIds.includes(row.confirmationId)) ||
                (row.counterpartConfirmationId !== null && save.confirmationIds.includes(row.counterpartConfirmationId)))) ||
            save.reviewIds.some((id) => !state.reviews.some((row) => row.id === id &&
              row.status === 'open' && row.revision === 1 && row.withdrawnAt === null))) {
            throw new RecordConflictError('已有后续确认或复核，不能撤销本次保存');
          }
          await withdrawSavedScores(tx, save.confirmationIds, save.reviewIds, now);
          await withdrawRecordSave(tx, save.id, created.map((row) => row.eventId), now);
          const result = recordUndoResultSchema.parse({
            status: 'success', replayed: false,
            result: {
              saveId: save.id, withdrawnEvents: created.map(({ personId, eventId }) => ({ personId, eventId })),
              withdrawnConfirmationIds: save.confirmationIds, withdrawnReviewItemIds: save.reviewIds,
              originalInput: draft.draft.originalInput,
            },
          });
          await appendRecordOperation(tx, {
            actorAccountId: accountId, action: 'undo', operationId: input.operation_id,
            fingerprint: fingerprint(input), draftId: draft.id, result,
          });
          await recordAudit(tx, { actorId: accountId, action: 'record.undo', resourceId: save.id });
          return result;
        });
      } catch (error) {
        if (error instanceof ForbiddenError) return { status: 'forbidden', message: '只能撤销本人有权操作的保存' };
        if (error instanceof RecordNotFoundError) return { status: 'not_found', message: '未找到可撤销的保存' };
        if (error instanceof RecordConflictError) return { status: 'conflict', message: error.message || '数据已变化，请重试', input };
        throw error;
      }
    },
  };
}
