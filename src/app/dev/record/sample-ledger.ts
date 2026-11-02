import type { RecordSaveInput, RecordUndoInput } from '@/contracts/record';

/**
 * 开发样张的操作台账键，照 846（`record-confirmation.ts` 的 `confirmationFingerprint`、
 * `write.ts` 的台账查询）：按账号、动作、operation_id 分开记；请求内容先归一化
 * （人员、评分决定排序，对象键排序），只调整顺序的同一请求视为相同。
 */
export function ledgerKey(
  accountId: string,
  action: 'save' | 'undo',
  operationId: string,
) {
  return JSON.stringify([accountId, action, operationId]);
}

export function requestKey(
  action: 'save' | 'undo',
  input: RecordSaveInput | RecordUndoInput,
) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 编号不算请求内容
  const { operation_id, ...rest } = input;
  const normalized =
    action === 'save' && 'decisions' in rest
      ? {
          ...rest,
          personIds: [...rest.personIds].sort(),
          decisions: [...rest.decisions].sort(
            (a, b) =>
              a.personId.localeCompare(b.personId) ||
              a.dimensionId.localeCompare(b.dimensionId),
          ),
        }
      : rest;
  return stable(normalized);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
