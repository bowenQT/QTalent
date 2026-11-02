'use client';
import { useRouter } from 'next/navigation';
import { RecordPage, type RecordPageProps } from '@/features/record/RecordPage';
import type {
  AnchorMap,
  LoadAnchors,
  RecordActions,
} from '@/features/record/types';
import { startRecordArrangeAction } from '@/server/actions/record-arrange';
import { saveRecordAction, undoRecordAction } from '@/server/actions/record';
import {
  readRecordAnchorsAction,
  readRecordBatchAction,
  readRecordSourceAction,
} from '@/server/actions/record-batch';
import { resolveRecordNode } from './ports';

const actions: RecordActions = {
  resolveNode: resolveRecordNode,
  submit: startRecordArrangeAction,
  readBatch: readRecordBatchAction,
  save: saveRecordAction,
  undo: undoRecordAction,
  loadSource: readRecordSourceAction,
};

const levels = [1, 2, 3, 4, 5] as const;

/** 锚点是规则内容，人人相同：按草稿冻结的版本读，再按人展开成页面要的形状。 */
export const loadAnchors: LoadAnchors = async ({ personIds, ruleVersions }) => {
  const rows = await readRecordAnchorsAction({ ruleVersions });
  const map: AnchorMap = {};
  for (const ruleVersion of ruleVersions) {
    const byDimension = new Map<string, string[]>();
    for (const row of rows.filter((item) => item.ruleVersion === ruleVersion)) {
      const texts = byDimension.get(row.dimensionId) ?? [];
      texts[row.value - 1] = row.text;
      byDimension.set(row.dimensionId, texts);
    }
    for (const [dimensionId, texts] of byDimension) {
      // 五档不全的版本不显示锚点，不拿空字符串补位。
      if (!levels.every((value) => texts[value - 1])) continue;
      const set = {
        ruleVersion,
        family: null,
        levels: levels.map((value) => texts[value - 1]!) as unknown as [
          string,
          string,
          string,
          string,
          string,
        ],
      };
      for (const personId of personIds)
        (map[personId] ??= {})[dimensionId] = set;
    }
  }
  return map;
};

/** /record 的客户端部分：把 845 / 846 的 Server Action 接到页面上，批次 id 写进 `?batch=`。 */
export function LiveRecord(
  props: Omit<RecordPageProps, 'actions' | 'loadAnchors' | 'onBatchChange'>,
) {
  const router = useRouter();
  return (
    <RecordPage
      {...props}
      actions={actions}
      loadAnchors={loadAnchors}
      onBatchChange={(id) => {
        // `?batch=` only: the typed text never goes into the URL.
        const params = new URLSearchParams(window.location.search);
        if (id) params.set('batch', id);
        else params.delete('batch');
        params.delete('draft');
        router.replace(`?${params}`, { scroll: false });
      }}
    />
  );
}
