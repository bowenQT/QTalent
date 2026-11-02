import 'server-only';
import { headers } from 'next/headers';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { jobAccount } from '../jobs/request';
import { createTalentExportService } from '../usecases/talent-export/service';
import { createPostgresTalentExportStore } from '../usecases/talent-export/postgres';
import {
  TalentExportError,
  type ExportOutcome,
} from '../usecases/talent-export/types';

export function talentExportService() {
  const clock = createClock(getEnv().APP_ENV);
  return createTalentExportService({
    store: createPostgresTalentExportStore(getDatabase()),
    businessNow: () => clock.now(),
    wallNow: () => new Date(),
  });
}
export function talentExportFailure(error: unknown): ExportOutcome {
  if (error instanceof TalentExportError) {
    if (error.code === 'forbidden' || error.code === 'unauthenticated')
      return { status: 'denied' };
    if (error.code === 'changed')
      return { status: 'failed', reason: '权限或已确认内容已变化，请重新生成' };
    if (error.code === 'invalid_input')
      return { status: 'failed', reason: '导出条件无效，请刷新后重试' };
    if (error.code === 'audit_unavailable')
      return { status: 'failed', reason: '审计暂不可用，未提供导出文件' };
  }
  return { status: 'failed', reason: '暂时无法生成导出，请稍后重试' };
}
export async function readTalentExportForCurrentUser() {
  try {
    const h = await headers(),
      accountId = await jobAccount(h);
    if (!accountId) return { status: 'unauthenticated' as const };
    const data = await talentExportService().view(accountId);
    if ((await jobAccount(h)) !== accountId)
      return { status: 'unauthenticated' as const };
    return { status: 'ready' as const, data };
  } catch (error) {
    const result = talentExportFailure(error);
    return {
      status:
        result.status === 'denied'
          ? ('forbidden' as const)
          : ('unavailable' as const),
    };
  }
}
const privateHeaders = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  vary: 'Cookie, cf-access-jwt-assertion',
};
const rejected = (status: number, state: string, message: string) =>
  Response.json(
    { status: state, message },
    { status, headers: privateHeaders },
  );
/** Real request/session -> current DB projection -> fresh CSV. A forwarded URL
 * conveys a scope request only; neither a file identifier nor authorization.
 */
export async function downloadTalentExport(
  request: Request,
): Promise<Response> {
  if (request.method !== 'GET')
    return rejected(405, 'invalid_input', '仅支持下载请求');
  try {
    const accountId = await jobAccount(request.headers);
    if (!accountId) return rejected(401, 'unauthenticated', '请重新登录后导出');
    const params = new URL(request.url).searchParams;
    const valid =
      [...params.keys()].every((k) => ['scopeId', 'range'].includes(k)) &&
      params.getAll('scopeId').length === 1 &&
      params.getAll('range').length === 1;
    const input = valid
      ? { scopeId: params.get('scopeId'), range: params.get('range') }
      : { invalid: true };
    const file = await talentExportService().download(accountId, input);
    if ((await jobAccount(request.headers)) !== accountId)
      return rejected(401, 'unauthenticated', '请重新登录后导出');
    if (!file)
      return rejected(409, 'empty', '当前范围内没有可导出的已确认维度分');
    return new Response(file.csv, {
      status: 200,
      headers: {
        ...privateHeaders,
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.fileName}"`,
      },
    });
  } catch (error) {
    const code =
      error instanceof TalentExportError ? error.code : 'unavailable';
    if (code === 'forbidden')
      return rejected(403, 'denied', '当前账号无权导出这个范围');
    if (code === 'unauthenticated')
      return rejected(401, 'unauthenticated', '请重新登录后导出');
    if (code === 'invalid_input')
      return rejected(400, 'invalid_input', '导出条件无效');
    if (code === 'changed')
      return rejected(409, 'changed', '内容已变化，请重新生成');
    return rejected(503, 'unavailable', '暂时无法导出，请稍后重试');
  }
}

/** Server-side verified core for the print consumer. Missing authoritative
 * summary/position/identity facts remain explicit; never label this printed. */
export async function readConfirmedPersonExportForCurrentUser(
  personId: unknown,
) {
  try {
    const h = await headers();
    const accountId = await jobAccount(h);
    if (!accountId) return { status: 'denied' as const };
    const content = await talentExportService().person(accountId, { personId });
    if ((await jobAccount(h)) !== accountId)
      return { status: 'denied' as const };
    return { status: 'partial' as const, content };
  } catch (error) {
    const result = talentExportFailure(error);
    return result.status === 'denied'
      ? { status: 'denied' as const }
      : { status: 'unavailable' as const };
  }
}
