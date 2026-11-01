import type { DbExecutor } from '../../../db/client';
import {
  readEffectiveRuleVersion,
  readTalentEvaluationRules,
} from '../../evaluation-system';
import type { BatchRuleBundle } from './batch';

/** The caller authorizes the material first and supplies the persisted save time.
 * 922's rubric version owns the anchor rows and their dimension membership.
 * Both snapshot fields retain that actual version ID; no invented dimension or
 * anchor version is derived from a name, the wall clock or a different category.
 */
export async function readBatchArrangeRules(
  db: DbExecutor,
  savedAt: string,
): Promise<BatchRuleBundle | null> {
  const effective = await readEffectiveRuleVersion(db, {
    category: 'dimension_anchors',
    at: savedAt,
  });
  if (effective.status !== 'success') return null;
  const versionId = effective.version.versionId;
  const content = await readTalentEvaluationRules(db);
  const selected = content.anchors.filter(
    (anchor) => anchor.ruleVersionId === versionId,
  );
  if (selected.length === 0) return null;
  const members = new Set(selected.map((anchor) => anchor.dimensionId));
  return {
    effective: effective.version,
    contentVersionId: versionId,
    dimensionVersionId: versionId,
    anchorVersionId: versionId,
    dimensions: content.dimensions
      .filter((dimension) => members.has(dimension.id))
      .map((dimension) => dimension.id)
      .sort(),
    anchors: selected
      .map((anchor) => ({
        id: anchor.id,
        dimensionId: anchor.dimensionId,
        versionId: anchor.ruleVersionId,
        value: anchor.value,
        text: anchor.text,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
