import { z } from 'zod';
import { materialBatchReadResultSchema } from '@/contracts/materials';
import { sourceReadResultSchema } from '@/contracts/sources';
import type { RecordActions } from '@/features/record/types';

/** 读取挂住时最多等这么久，到点中止请求（和页面的请求超时一致）。 */
export const READ_TIMEOUT_MS = 10_000;

const anchorRowsSchema = z.array(
  z.object({
    dimensionId: z.string(),
    ruleVersion: z.string(),
    value: z.number().int(),
    text: z.string(),
  }),
);
export type AnchorRow = z.infer<typeof anchorRowsSchema>[number];

/**
 * 记录页的只读请求走 GET Route Handler，不走 Server Action：Server Action 在客户端按
 * 顺序排队，一个慢读取会让 5 秒内点下的撤销排到窗口之后。每次读取用 AbortController
 * 设超时，调用方也可以传 signal 提前取消。
 */
async function getJson<T>(
  url: string,
  parse: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('timeout')),
    READ_TIMEOUT_MS,
  );
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    // 登录失效时会被跳到登录页：不是读取结果，按读取失败处理
    if (!response.ok || response.redirected)
      throw new Error(`read failed: ${response.status}`);
    return parse(await response.json());
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

const parseWith =
  <S extends z.ZodType>(schema: S) =>
  (value: unknown) =>
    schema.parse(value) as z.infer<S>;

export const readBatch: RecordActions['readBatch'] = ({ batchId }, options) =>
  getJson(
    `/api/record/batches/${encodeURIComponent(batchId)}`,
    parseWith(materialBatchReadResultSchema),
    options?.signal,
  );

export const readSource: RecordActions['loadSource'] = (input) =>
  getJson(
    `/api/record/sources?${new URLSearchParams({
      fragmentId: input.fragmentId,
      originalVersionId: input.originalVersionId,
    })}`,
    parseWith(sourceReadResultSchema),
  );

export function readAnchors(ruleVersions: string[]): Promise<AnchorRow[]> {
  const params = new URLSearchParams();
  for (const version of ruleVersions) params.append('ruleVersion', version);
  return getJson(`/api/record/anchors?${params}`, parseWith(anchorRowsSchema));
}
