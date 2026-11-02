import { createHash } from 'node:crypto';
import {
  completeUploadResultSchema,
  requestUploadResultSchema,
} from '../../../../contracts/media';
import type { createUploadService } from './service';
import type { createOriginalReader } from './read';
import { UploadError } from './types';

const messages = {
  unauthenticated: '请先登录',
  forbidden: '你没有执行此操作的权限',
  not_found: '上传或原件不存在或不可见',
  conflict: '内容或版本已变化，请刷新后重试',
  unavailable: '上传服务暂时不可用，请稍后重试',
  validation_error: '请检查文件与上传信息',
};
const statuses = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  validation_error: 400,
};
const reasons: Record<string, string> = {
  object_missing: '尚未找到完整上传的文件，请完成上传后再重试',
  object_mismatch: '文件大小或类型与申请不一致，请重新上传',
  invalid_content: '文件内容与格式不符，请检查后重新上传',
  attachment_limit: '这条记录最多包含十个附件',
  adapter_limit: '当前上传通道尚未支持这个文件大小，请稍后重试',
  upload_expired_or_changed: '上传已过期或版本已变化，请刷新上传信息',
  completion_payload_changed: '上传完成信息已变化，请刷新后重试',
  operation_payload_changed: '同一上传请求的信息已变化，请重新申请',
  command_too_large: '上传信息过长，请减少本次提交的内容',
  invalid_json: '上传信息格式有误，请重新提交',
  record_collection_expired: '这次记录的上传窗口已过期，请刷新上传信息',
  upload_removed: '附件已从这条记录移除，请刷新记录',
  collection_saved: '这条记录已保存，请先按记录流程修改附件',
};
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
async function commandBody(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    !request.body
  )
    throw new UploadError('validation_error', 'invalid_json');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > 1024 * 1024)
        throw new UploadError('validation_error', 'command_too_large');
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof UploadError) throw error;
    throw new UploadError('validation_error', 'invalid_json');
  } finally {
    reader.releaseLock();
  }
}
function failure(error: unknown, input: unknown) {
  const safe =
    error instanceof UploadError
      ? error
      : new UploadError('unavailable', 'upload_unavailable');
  const message = reasons[safe.reason] ?? messages[safe.status];
  const body =
    safe.status === 'validation_error'
      ? {
          status: safe.status,
          fieldErrors: { form: [message] },
          input,
        }
      : { status: safe.status, message };
  return json(body, statuses[safe.status]);
}
/** Explicit request composition. The parent supplies the existing Access/session
 * verifier, current business policies and shared producer; no runtime singleton.
 * This module registers no route and reads no environment or provider keys.
 */
export function createUploadHttpHandlers(deps: {
  service: ReturnType<typeof createUploadService>;
  reader: ReturnType<typeof createOriginalReader>;
  trustedOrigin: string;
  authenticate(headers: Headers): Promise<string | null>;
  auditOriginalRead(input: {
    accountId: string;
    ticketDigest: string;
  }): Promise<void>;
}) {
  const origin = new URL(deps.trustedOrigin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password
  )
    throw new UploadError('unavailable', 'invalid_trusted_origin');
  const trustedOrigin = origin.origin;
  async function account(request: Request) {
    const id = await deps.authenticate(request.headers);
    if (!id)
      throw new UploadError('unauthenticated', 'authentication_required');
    return id;
  }
  async function command(request: Request, kind: 'request' | 'complete') {
    let input: unknown = null;
    try {
      if (request.method !== 'POST')
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      if (request.headers.get('origin') !== trustedOrigin)
        throw new UploadError('forbidden', 'cross_origin');
      const accountId = await account(request);
      input = await commandBody(request);
      if (kind === 'request')
        return json(
          requestUploadResultSchema.parse({
            status: 'success',
            upload: await deps.service.request(accountId, input),
          }),
        );
      return json(
        completeUploadResultSchema.parse({
          status: 'success',
          result: await deps.service.complete(accountId, input),
        }),
      );
    } catch (error) {
      return failure(error, input);
    }
  }
  return {
    requestUpload: (request: Request) => command(request, 'request'),
    completeUpload: (request: Request) => command(request, 'complete'),
    async readOriginal(request: Request): Promise<Response> {
      try {
        if (request.method !== 'GET')
          return new Response(null, { status: 405, headers: { allow: 'GET' } });
        const accountId = await account(request);
        const tokens = new URL(request.url).searchParams.getAll('ticket');
        if (tokens.length !== 1)
          throw new UploadError('not_found', 'original_not_found');
        const response = await deps.reader.open(
          accountId,
          tokens[0],
          request.headers.get('range') ?? undefined,
        );
        try {
          // The digest links to records_upload_read_tickets and its source pair;
          // the raw capability must never enter the audit/log payload.
          await deps.auditOriginalRead({
            accountId,
            ticketDigest: createHash('sha256').update(tokens[0]).digest('hex'),
          });
          return response;
        } catch (error) {
          await response.body?.cancel().catch(() => {});
          throw error;
        }
      } catch (error) {
        return failure(error, null);
      }
    },
  };
}
