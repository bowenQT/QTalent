'use server';
import type { SourceReadResult } from '@/contracts/sources';
import { readSourceForCurrentUser } from '@/server/queries/sources';

/**
 * 引用角标展开时读取原文。只读，入参只收片段与原件版本两个标识，授权由服务端按当前
 * 登录人判断。BOW-837 提供 `server/actions/sources.ts` 后改用它并删除本文件。
 */
export async function readSource(input: unknown): Promise<SourceReadResult> {
  return readSourceForCurrentUser(input);
}
