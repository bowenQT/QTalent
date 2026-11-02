import {
  recordSaveInputSchema,
  type RecordDraft,
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

export function initEdit(draft: RecordDraft): EditState {
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

/** 草稿里已确定的人，去重并保持顺序。 */
export function resolvedPersonIds(draft: RecordDraft): string[] {
  const ids: string[] = [];
  for (const person of draft.people)
    if (person.state === 'resolved' && !ids.includes(person.id))
      ids.push(person.id);
  return ids;
}

/** 人或项目还有待选择或识别不到时，不能保存。 */
export function hasUnresolvedSelection(draft: RecordDraft): boolean {
  return (
    draft.people.some((person) => person.state !== 'resolved') ||
    draft.people.length === 0 ||
    draft.project.state === 'needs_selection'
  );
}

export function resolvedProjectId(draft: RecordDraft): string | null {
  return draft.project.state === 'resolved' ? draft.project.id : null;
}

/** 还没有被用户点击确认的建议分数量（保存时一并确认）。 */
export function untouchedCount(draft: RecordDraft, edit: EditState): number {
  return draft.scores.filter(
    (score) =>
      score.state === 'suggested' &&
      !edit.scores[scoreKey(score.personId, score.dimensionId)]?.touched,
  ).length;
}

export function suggestedCount(draft: RecordDraft): number {
  return draft.scores.filter((score) => score.state === 'suggested').length;
}

/** SBI 或分数相对草稿有修改。 */
export function isEdited(draft: RecordDraft, edit: EditState): boolean {
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

export type BuildFailure =
  'unresolved_selection' | 'empty_title' | 'empty_behavior' | 'invalid';
export type BuildResult =
  { ok: true; input: RecordSaveInput } | { ok: false; reason: BuildFailure };

/**
 * 编辑后的草稿 → 保存入参。
 * 每条建议分一项决定：值未改为 confirm，改了为 edit（带理由）；资料不足的行不发决定。
 * 评分人、确认时间、规则版本和锚点校验全部由服务端给出。
 */
export function buildSaveInput(
  draft: RecordDraft,
  edit: EditState,
  operationId: string,
): BuildResult {
  if (hasUnresolvedSelection(draft)) {
    return { ok: false, reason: 'unresolved_selection' };
  }
  const sbi: RecordSbi = {
    title: edit.sbi.title.trim(),
    situation: edit.sbi.situation.trim(),
    behavior: edit.sbi.behavior.trim(),
    impact: edit.sbi.impact.trim(),
  };
  if (!sbi.title) return { ok: false, reason: 'empty_title' };
  if (!sbi.behavior) return { ok: false, reason: 'empty_behavior' };
  const personIds = resolvedPersonIds(draft);
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
    projectId: resolvedProjectId(draft),
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
