import {
  sourceReadInputSchema,
  type SourceReadInput,
} from '@/contracts/sources';

/** 原件查看页。档案、确认页、找人的出处都用 sourceHref 生成链接，不各自拼地址。 */
export const SOURCE_VIEWER_PATH = '/sources';

/**
 * 地址里只有片段与原件版本两个标识，位置由服务端按标识解析：同一条出处从哪里点进来，
 * 都落到同一处。传入完整引用也只取这两个字段，客户端带的位置不进地址。
 */
export function sourceHref(
  input: SourceReadInput,
  base: string = SOURCE_VIEWER_PATH,
): string {
  const query = new URLSearchParams({
    fragment: input.fragmentId,
    version: input.originalVersionId,
  });
  return `${base}?${query}`;
}

type SearchParams = Record<string, string | string[] | undefined>;

/** 从查看页地址读出两个标识。缺少、重复或空白都按链接失效处理，返回 null。 */
export function sourceReadInputFrom(
  search: SearchParams,
): SourceReadInput | null {
  const { fragment, version } = search;
  if (typeof fragment !== 'string' || typeof version !== 'string') return null;
  const parsed = sourceReadInputSchema.safeParse({
    fragmentId: fragment,
    originalVersionId: version,
  });
  return parsed.success ? parsed.data : null;
}
