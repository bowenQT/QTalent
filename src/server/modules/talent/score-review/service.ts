import { createHash } from 'node:crypto';
import {
  reviewActiveItemSchema,
  reviewCalibrationSchema,
  reviewQueueActionSchema,
  reviewQueueListSchema,
  reviewQueueResultSchema,
  type ReviewQueueAction,
  type ReviewQueueResult,
} from '../../../../contracts/review-queue';
import {
  ScoreReviewForbiddenError,
  ScoreReviewStoreConflict,
  type Calibration,
  type ReviewAuthority,
  type ReviewItem,
  type ReviewTarget,
  type ScoreReviewReadPort,
  type ScoreReviewRepository,
} from './ports';

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  }
  return value;
}
export function digest(value: object) {
  return createHash('sha256')
    .update(JSON.stringify(ordered(value)))
    .digest('hex');
}
function scopeFingerprint(target: ReviewTarget) {
  return digest({
    itemId: target.itemId,
    eventId: target.eventId,
    personId: target.personId,
    evaluationNodeId: target.evaluationNodeId,
    dimensionId: target.dimensionId,
    ruleVersion: target.ruleVersion,
  });
}
export function scoreReviewFingerprint(input: ReviewQueueAction) {
  const { operation_id: _operationId, ...semantic } = input;
  void _operationId;
  return digest(semantic);
}
async function requireHr(
  port: ScoreReviewReadPort,
  accountId: string,
): Promise<ReviewAuthority> {
  const authority = await port.currentAuthority(accountId);
  if (
    !authority ||
    authority.accountId !== accountId ||
    authority.isSystemAdmin ||
    !authority.hasHrRole ||
    !authority.personId
  ) {
    throw new ScoreReviewForbiddenError();
  }
  return authority;
}
function checkedItem(raw: ReviewItem, target: ReviewTarget): ReviewItem {
  const item = reviewActiveItemSchema.parse(raw);
  const scores = item.kind === 'rater_gap' ? item.sides : [item.human, item.ai];
  if (
    item.id !== target.itemId ||
    item.eventId !== target.eventId ||
    item.personId !== target.personId ||
    item.dimensionId !== target.dimensionId ||
    scores.some((score) => score.anchor.ruleVersion !== target.ruleVersion)
  ) {
    throw new Error('评分复核可信来源不一致');
  }
  return item;
}
export async function readScoreReviewQueue(
  repository: ScoreReviewRepository,
  accountId: string,
) {
  return repository.read(async (port) => {
    const authority = await requireHr(port, accountId);
    const items: ReviewItem[] = [];
    const seen = new Set<string>();
    for (const target of await port.listOpenTargets()) {
      if (
        target.status !== 'open' ||
        seen.has(target.itemId) ||
        !(await port.canReview(authority, target))
      )
        continue;
      seen.add(target.itemId);
      const item = await port.authorizedItem(authority, target);
      if (item) {
        const parsed = checkedItem(item, target);
        if (parsed.revision !== target.revision)
          throw new Error('评分复核版本不一致');
        items.push(parsed);
      }
    }
    return reviewQueueListSchema.parse({
      items,
      recalibration: { kind: 'recalibration', status: 'not_connected' },
    });
  });
}
const conflict = (
  input: ReviewQueueAction,
  message = '评分复核已变化，请刷新后重试',
): ReviewQueueResult => ({ status: 'conflict', message, input });
const notFound = (): ReviewQueueResult => ({
  status: 'not_found',
  message: '评分复核条目不可用',
});

export async function resolveScoreReview(
  repository: ScoreReviewRepository,
  accountId: string,
  input: unknown,
  now: () => Date,
): Promise<ReviewQueueResult> {
  const parsed = reviewQueueActionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      (fieldErrors[key] ??= []).push(
        key === 'reason' ? '请填写复核理由' : '请检查此项输入',
      );
    }
    return { status: 'validation_error', fieldErrors, input };
  }
  const action = parsed.data;
  try {
    return await repository.transaction(async (port) => {
      await port.lockOperation(accountId, action.operation_id);
      await requireHr(port, accountId);
      const beforeLock = await port.target(action.itemId);
      if (!beforeLock) return notFound();
      await port.lockEvent(beforeLock.eventId);
      // A blocked lock must not retain authorization from before revocation.
      const authority = await requireHr(port, accountId);
      const target = await port.target(action.itemId);
      if (!target || target.eventId !== beforeLock.eventId)
        return conflict(action);
      if (!(await port.canReview(authority, target))) return notFound();
      const raw = await port.authorizedItem(authority, target);
      if (!raw) return notFound();
      const original = checkedItem(raw, target);
      const fingerprint = scoreReviewFingerprint(action);
      const scope = scopeFingerprint(target);
      // Permission and evidence checks precede every replay, including resolved rows.
      const operation = await port.operation(accountId, action.operation_id);
      // Evidence/receipt reads may wait. Keep the actor that authorized those
      // reads, and recheck current role and target scope before using them.
      const stillAuthorized = async () => {
        const current = await requireHr(port, accountId);
        if (current.personId !== authority.personId)
          throw new ScoreReviewForbiddenError();
        const allowed = await port.canReview(current, target);
        const final = await requireHr(port, accountId);
        if (final.personId !== authority.personId)
          throw new ScoreReviewForbiddenError();
        return allowed;
      };
      if (!(await stillAuthorized())) return notFound();
      if (operation) {
        if (
          operation.accountId !== accountId ||
          operation.operationId !== action.operation_id
        )
          throw new Error('评分复核回执归属不一致');
        if (
          operation.fingerprint !== fingerprint ||
          operation.scopeFingerprint !== scope
        )
          return conflict(action, '同一提交编号不能用于不同内容');
        const receipt = reviewCalibrationSchema.parse(operation.result);
        if (receipt.score.raterId !== authority.personId)
          throw new ScoreReviewForbiddenError();
        if (
          receipt.itemId !== target.itemId ||
          digest(receipt.original) !== digest(original)
        )
          return conflict(action);
        return reviewQueueResultSchema.parse({
          status: 'success',
          replayed: true,
          result: receipt,
        });
      }
      if (
        target.status !== 'open' ||
        target.revision !== action.expected_revision ||
        original.revision !== target.revision ||
        original.kind !== action.kind ||
        (await port.calibration(target.itemId))
      )
        return conflict(action);
      const value =
        action.action === 'keep_score'
          ? original.kind === 'ai_gap'
            ? original.human.value
            : null
          : action.value;
      if (value === null) return conflict(action);
      const anchor = await port.anchor(target, value);
      if (
        !anchor ||
        anchor.dimensionId !== target.dimensionId ||
        anchor.ruleVersion !== target.ruleVersion ||
        anchor.value !== value
      )
        return conflict(action, '原规则版本的评分锚点不可用');
      const scores =
        original.kind === 'rater_gap'
          ? original.sides
          : [original.human, original.ai];
      const citations = [
        ...new Map(
          scores
            .flatMap((score) => score.citations)
            .map((citation) => [digest(citation), citation]),
        ).values(),
      ];
      const result: Calibration = reviewCalibrationSchema.parse({
        itemId: original.id,
        revision: target.revision + 1,
        original,
        score: {
          value,
          anchor: {
            id: anchor.id,
            text: anchor.text,
            ruleVersion: anchor.ruleVersion,
          },
          citations,
          raterId: authority.personId,
          confirmedAt: now().toISOString(),
          reason: action.reason,
        },
      });
      // Anchor/calibration reads can also wait before the first write.
      if (!(await stillAuthorized())) return notFound();
      await port.applyCalibration({
        accountId,
        actorPersonId: authority.personId,
        operationId: action.operation_id,
        fingerprint,
        scopeFingerprint: scope,
        target,
        originalFingerprint: digest(original),
        result,
      });
      return reviewQueueResultSchema.parse({
        status: 'success',
        replayed: false,
        result,
      });
    });
  } catch (error) {
    if (error instanceof ScoreReviewForbiddenError)
      return { status: 'forbidden', message: '当前账号无权处理评分复核' };
    if (error instanceof ScoreReviewStoreConflict) return conflict(action);
    throw error;
  }
}
