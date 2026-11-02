import {
  recordSaveInputSchema,
  type RecordBatchDraft,
  type RecordSaveInput,
} from '@/contracts/record';
import {
  scoreKey,
  type EditScore,
  type RecordSbi,
  type ScoreKey,
} from './types';

/** 用户在草稿上的修改：SBI 文字与每条建议分的当前值。 */
export type EditState = {
  sbi: RecordSbi;
  scores: Record<ScoreKey, EditScore>;
};

export function initEdit(draft: RecordBatchDraft): EditState {
  const scores: Record<ScoreKey, EditScore> = {};
  for (const score of draft.scores) {
    if (score.state !== 'suggested') continue;
    scores[scoreKey(score.personId, score.dimensionId)] = {
      value: score.value,
      touched: false,
      reason: '',
    };
  }
  return { sbi: { ...draft.sbi }, scores };
}

/** 还没有被用户点击确认的建议分数量（保存时一并确认）。 */
export function untouchedCount(
  draft: RecordBatchDraft,
  edit: EditState,
): number {
  return draft.scores.filter(
    (score) =>
      score.state === 'suggested' &&
      !edit.scores[scoreKey(score.personId, score.dimensionId)]?.touched,
  ).length;
}

export function suggestedCount(draft: RecordBatchDraft): number {
  return draft.scores.filter((score) => score.state === 'suggested').length;
}

/** SBI 或分数相对草稿有修改。 */
export function isEdited(draft: RecordBatchDraft, edit: EditState): boolean {
  const { sbi } = draft;
  if (
    edit.sbi.title !== sbi.title ||
    edit.sbi.situation !== sbi.situation ||
    edit.sbi.behavior !== sbi.behavior ||
    edit.sbi.impact !== sbi.impact
  )
    return true;
  return Object.values(edit.scores).some(
    (score) => score.touched || score.reason !== '',
  );
}

export type BuildFailure = 'empty_title' | 'empty_behavior' | 'invalid';
export type BuildResult =
  { ok: true; input: RecordSaveInput } | { ok: false; reason: BuildFailure };

/**
 * 编辑后的批次草稿 → 846 保存入参。人和项目以草稿为准（897 草稿里已确定）。
 * 每条建议分一项决定：值未改为 confirm，改了为 edit（带理由）；资料不足的行不发决定。
 * 评分人、确认时间、规则版本和锚点校验全部由服务端给出。
 */
export function buildSaveInput(
  draft: RecordBatchDraft,
  edit: EditState,
  operationId: string,
): BuildResult {
  const sbi: RecordSbi = {
    title: edit.sbi.title.trim(),
    situation: edit.sbi.situation.trim(),
    behavior: edit.sbi.behavior.trim(),
    impact: edit.sbi.impact.trim(),
  };
  if (!sbi.title) return { ok: false, reason: 'empty_title' };
  if (!sbi.behavior) return { ok: false, reason: 'empty_behavior' };
  const { personIds } = draft;
  const seen = new Set<ScoreKey>();
  const decisions: RecordSaveInput['decisions'] = [];
  for (const score of draft.scores) {
    if (score.state !== 'suggested' || !personIds.includes(score.personId))
      continue;
    const key = scoreKey(score.personId, score.dimensionId);
    if (seen.has(key)) continue;
    seen.add(key);
    const current = edit.scores[key];
    const base = { personId: score.personId, dimensionId: score.dimensionId };
    decisions.push(
      current && current.value !== score.value
        ? {
            ...base,
            action: 'edit',
            value: current.value,
            reason: current.reason.trim(),
          }
        : { ...base, action: 'confirm' },
    );
  }
  const parsed = recordSaveInputSchema.safeParse({
    operation_id: operationId,
    expected_revision: draft.revision,
    draftId: draft.draftId,
    personIds,
    projectId: draft.projectId,
    sbi,
    decisions,
  });
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, reason: 'invalid' };
}

/** 同一次意图复用同一个 operation_id（服务端按它重放）；内容变了换新的。 */
export type OperationId = { key: string; id: string };
export function reuseOperationId(
  previous: OperationId | null,
  key: string,
  make: () => string,
): OperationId {
  return previous?.key === key ? previous : { key, id: make() };
}

/** 保存入参去掉 operation_id 后的内容签名。 */
export function saveKey(input: Omit<RecordSaveInput, 'operation_id'>): string {
  return JSON.stringify(input);
}
