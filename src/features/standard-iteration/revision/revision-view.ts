import type { z } from 'zod';
import type { comparisonManagerBasisSchema } from '@/contracts/judgment-comparison';
import type { ConfirmedStandardAttribution } from '@/contracts/standard-attribution';
import type {
  SelectionImpactPreview,
  SelectionReviewPointChange,
} from '@/contracts/selection-standard';
import { categoryText } from '../copy';
import type { SelectionStandardContent } from '../ports';

export type ReviewPoint = SelectionStandardContent['reviewPoints'][number];
export type ManagerBasis = z.infer<typeof comparisonManagerBasisSchema>;
export type RevisionState =
  'draft' | 'pending_confirmation' | 'active' | 'superseded';

export const stateLabel: Record<RevisionState, string> = {
  draft: '草稿',
  pending_confirmation: '待确认',
  active: '生效中',
  superseded: '已替代',
};
/** data-s of the prototype's .n-rstate for each lifecycle state. */
export const stateTone: Record<RevisionState, string> = {
  draft: 'draft',
  pending_confirmation: 'pending',
  active: 'live',
  superseded: 'old',
};

/** The working list: base points with each change applied in place; additions last. */
export function applyChanges(
  base: readonly ReviewPoint[],
  changes: readonly SelectionReviewPointChange[],
): ReviewPoint[] {
  const edits = new Map<string, SelectionReviewPointChange>();
  for (const change of changes)
    edits.set(
      change.kind === 'add' ? change.after.id : change.before.id,
      change,
    );
  const kept = base.flatMap((point) => {
    const change = edits.get(point.id);
    if (change?.kind === 'remove') return [];
    if (change?.kind === 'edit') return [change.after];
    return [point];
  });
  const added = changes.flatMap((change) =>
    change.kind === 'add' ? [change.after] : [],
  );
  return [...kept, ...added];
}

const same = (a: ReviewPoint, b: ReviewPoint) =>
  a.title === b.title && a.description === b.description;

/** The contract's change list from the base and the working list, keyed by point id. */
export function changesBetween(
  base: readonly ReviewPoint[],
  working: readonly ReviewPoint[],
): SelectionReviewPointChange[] {
  const now = new Map(working.map((point) => [point.id, point]));
  const before = new Set(base.map((point) => point.id));
  const changes: SelectionReviewPointChange[] = [];
  for (const point of base) {
    const after = now.get(point.id);
    if (!after) changes.push({ kind: 'remove', before: point });
    else if (!same(point, after))
      changes.push({ kind: 'edit', before: point, after });
  }
  for (const point of working)
    if (!before.has(point.id)) changes.push({ kind: 'add', after: point });
  return changes;
}

export const changeCount = (changes: readonly unknown[]) =>
  changes.length
    ? `改了 ${changes.length} 处`
    : '在原处直接改，改过的地方会标出原值';

export const pointText = (point: ReviewPoint) =>
  `${point.title}：${point.description}`;

/** The prototype's neutral diff: only the changed middle is marked. */
export function diffParts(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start])
    start += 1;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end += 1;
  return {
    head: a.slice(0, start),
    removed: a.slice(start, a.length - end),
    added: b.slice(start, b.length - end),
    tail: a.slice(a.length - end),
  };
}

/** Cohorts keeping a version, by name: 第六期（演示）. */
export function boundText(
  preview: SelectionImpactPreview,
  versionId: string,
): string {
  return preview.preservedBindings
    .filter((binding) => binding.standardVersionId === versionId)
    .map((binding) => binding.cohort.name)
    .join('、');
}

export const keptResults = (preview: SelectionImpactPreview) =>
  preview.existingResults.reduce((n, result) => n + result.count, 0);

/** One line for the check bar and the publish dialog. */
export function impactLine(preview: SelectionImpactPreview): string {
  const bound = preview.preservedBindings
    .map((binding) => `${binding.cohort.name}（${binding.standardVersionId}）`)
    .join('、');
  return `之后新建的期次默认用新版，${preview.nextCohort.name}建立时绑定；${bound || '已建立的期次'}保持原版本，${keptResults(preview)} 条选拔记录保持原版本。`;
}

export function hrBasisText(attribution: ConfirmedStandardAttribution): string {
  const cases = new Set(attribution.citations.map((c) => c.caseId)).size;
  return `判断对照 · 依据 ${cases} 个案例 · 归因：${categoryText(attribution.categories)}`;
}

export function managerBasisText(basis: ManagerBasis): string {
  return `${basis.batch.name}：${basis.discrepancyPeople} 人前后判断不一致 · ${
    basis.attributionCategories.length
      ? `归因：${categoryText(basis.attributionCategories)}`
      : '归因待确认'
  }`;
}
