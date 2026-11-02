import 'server-only';
import { cache } from 'react';
import type { PersonPage } from '@/contracts/page-result';
import { personReadInputSchema } from '@/contracts/person';
import { readPersonForCurrentUser } from '@/server/queries/person';

/** `?id=` 缺失、重复或不是字符串都按不存在处理，与范围外的人对外一致。 */
export function personIdOf(
  params: Record<string, string | string[] | undefined>,
) {
  const id = params.id;
  return typeof id === 'string' ? id : null;
}

/**
 * 档案读取结果，页面与标题共用同一次读取。系统管理员整页拦下；不存在与范围外都是
 * `not_found`，不带姓名。
 */
export const loadPersonPage = cache(
  async (id: string | null, isAdmin: boolean): Promise<PersonPage> => {
    if (isAdmin) return { status: 'forbidden' };
    const input = personReadInputSchema.safeParse({ id });
    if (!input.success) return { status: 'not_found' };
    const result = await readPersonForCurrentUser(input.data);
    return result.status === 'success'
      ? { status: 'ok', data: result.person }
      : { status: 'not_found' };
  },
);
