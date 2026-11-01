import type { z } from 'zod';
import type {
  confirmStandardAttributionInputSchema,
  confirmStandardAttributionResultSchema,
  generateStandardHypothesesInputSchema,
  generateStandardHypothesesResultSchema,
} from '@/contracts/standard-attribution';
import type {
  createSelectionRevisionInputSchema,
  createSelectionRevisionResultSchema,
  publishSelectionRevisionInputSchema,
  publishSelectionRevisionResultSchema,
  returnSelectionRevisionInputSchema,
  returnSelectionRevisionResultSchema,
  saveSelectionRevisionInputSchema,
  saveSelectionRevisionResultSchema,
  selectionRevisionReadInputSchema,
  selectionRevisionReadResultSchema,
  selectionStandardContentSchema,
  submitSelectionRevisionInputSchema,
  submitSelectionRevisionResultSchema,
  undoSelectionPublicationInputSchema,
  undoSelectionPublicationResultSchema,
  withdrawSelectionRevisionInputSchema,
  withdrawSelectionRevisionResultSchema,
} from '@/contracts/selection-standard';

/*
 * The actions this feature calls, typed by the BOW-917 contract. The page passes
 * Server Actions in; the feature never reaches server code. BOW-918/921 implement
 * them; until a route has them, it renders 待接通 instead of any data.
 */
type Port<I extends z.ZodType, R extends z.ZodType> = (
  input: z.infer<I>,
) => Promise<z.infer<R>>;

export type SelectionStandardContent = z.infer<
  typeof selectionStandardContentSchema
>;

export type AttributionPorts = {
  generate: Port<
    typeof generateStandardHypothesesInputSchema,
    typeof generateStandardHypothesesResultSchema
  >;
  confirm: Port<
    typeof confirmStandardAttributionInputSchema,
    typeof confirmStandardAttributionResultSchema
  >;
  createRevision: Port<
    typeof createSelectionRevisionInputSchema,
    typeof createSelectionRevisionResultSchema
  >;
};

export type HrRevisionPorts = {
  save: Port<
    typeof saveSelectionRevisionInputSchema,
    typeof saveSelectionRevisionResultSchema
  >;
  submit: Port<
    typeof submitSelectionRevisionInputSchema,
    typeof submitSelectionRevisionResultSchema
  >;
  withdraw: Port<
    typeof withdrawSelectionRevisionInputSchema,
    typeof withdrawSelectionRevisionResultSchema
  >;
};

export type ManagerRevisionPorts = {
  read: Port<
    typeof selectionRevisionReadInputSchema,
    typeof selectionRevisionReadResultSchema
  >;
  publish: Port<
    typeof publishSelectionRevisionInputSchema,
    typeof publishSelectionRevisionResultSchema
  >;
  undo: Port<
    typeof undoSelectionPublicationInputSchema,
    typeof undoSelectionPublicationResultSchema
  >;
  return: Port<
    typeof returnSelectionRevisionInputSchema,
    typeof returnSelectionRevisionResultSchema
  >;
};

/** A failed action, phrased for the person who pressed the button. */
export function actionFailure(
  result:
    | { status: 'validation_error' }
    | { status: 'conflict'; message: string }
    | {
        status: 'forbidden' | 'not_found' | 'model_failed';
        message: string;
      },
): string {
  switch (result.status) {
    case 'validation_error':
      return '内容待补全，按提示修改后再试';
    case 'conflict':
      return '状态已被更新，刷新页面后按当前状态处理';
    case 'forbidden':
      return '这一步由有权限的人处理，刷新页面查看当前权限';
    case 'not_found':
      return '这份内容已删除或链接有误，回到判断对照重新进入';
    case 'model_failed':
      return 'AI 整理失败，稍后再试';
  }
}

/** One operation id per user intent; a retry of the same intent reuses it. */
export const newOperationId = () => crypto.randomUUID();
