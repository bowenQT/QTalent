import { z } from 'zod';
import {
  takeTranscriptionSourceUrl,
  KodoError,
  TRANSCRIPTION_MIN_TTL_MS,
  type TranscriptionSource,
} from '../../kodo';
import { TingwuHttpError, type TingwuRequest } from '../http';
import { OfflineError } from './errors';
import { downloadResult } from './download';
import { parseTranscript } from './transcript';
export { OfflineError } from './errors';
export { parseTranscript } from './transcript';
export type { OfflineTranscript, OfflineSegment } from './transcript';
const taskIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .max(256);
const inputSchema = z.object({
  sourceRef: z.string().min(1),
  operationId: z.string().min(1).max(128),
  media: z.object({
    format: z.enum(['mp3', 'm4a', 'wav', 'aac', 'mp4']),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 ** 3),
    durationMs: z.number().int().nonnegative(),
  }),
});
const taskSchema = z.object({
  RequestId: z.string().optional(),
  Data: z.object({
    TaskId: taskIdSchema,
    TaskStatus: z.enum(['ONGOING', 'COMPLETED', 'FAILED', 'INVALID']),
    Result: z.object({ Transcription: z.string().optional() }).optional(),
  }),
});
export interface OfflineInput {
  sourceRef: string;
  operationId: string;
  source: TranscriptionSource;
  media: {
    format: 'mp3' | 'm4a' | 'wav' | 'aac' | 'mp4';
    byteLength: number;
    durationMs: number;
  };
}
export interface OfflineDependencies {
  request: TingwuRequest;
  appKey: string;
  resultOrigins: string[];
  maxDurationMs: number;
  submitSafetyMs?: number;
  now?: () => number;
  fetch?: typeof fetch;
}
/** Caller owns archive validation, persistence and bounded polling policy. */
export function createOfflineTingwu(dependencies: OfflineDependencies) {
  const { appKey, maxDurationMs } = dependencies;
  const safety = dependencies.submitSafetyMs ?? 0;
  if (
    !appKey.trim() ||
    !Number.isSafeInteger(maxDurationMs) ||
    maxDurationMs <= 0 ||
    maxDurationMs > 21600000 ||
    !Number.isSafeInteger(safety) ||
    safety < 0 ||
    !dependencies.resultOrigins.length
  )
    throw new OfflineError('configuration_error');
  const origins = new Set(
    dependencies.resultOrigins.map((value) => {
      let u: URL;
      try {
        u = new URL(value);
      } catch {
        throw new OfflineError('configuration_error');
      }
      if (
        u.protocol !== 'https:' ||
        u.origin !== value ||
        u.username ||
        u.password
      )
        throw new OfflineError('configuration_error');
      return u.origin;
    }),
  );
  async function query(providerTaskId: string, signal?: AbortSignal) {
    if (!taskIdSchema.safeParse(providerTaskId).success)
      throw new OfflineError('invalid_input');
    if (signal?.aborted) throw new OfflineError('cancelled');
    let raw: unknown;
    try {
      raw = await dependencies.request({
        method: 'GET',
        action: 'GetTaskInfo',
        path: `/openapi/tingwu/v2/tasks/${providerTaskId}`,
        signal,
      });
    } catch (error) {
      throw mapError(error, false);
    }
    if (signal?.aborted) throw new OfflineError('cancelled');
    const parsed = taskSchema.safeParse(raw);
    if (!parsed.success || parsed.data.Data.TaskId !== providerTaskId)
      throw new OfflineError('malformed_result');
    return parsed.data;
  }
  return {
    async submitOffline(input: OfflineInput, signal?: AbortSignal) {
      if (signal?.aborted) throw new OfflineError('cancelled');
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success || parsed.data.media.durationMs > maxDurationMs)
        throw new OfflineError('unsupported_media');
      let url: string;
      try {
        url = takeTranscriptionSourceUrl(input.source, {
          now: dependencies.now,
          requiredRemainingTtlMs: TRANSCRIPTION_MIN_TTL_MS + safety,
        });
      } catch (error) {
        throw new OfflineError(
          error instanceof KodoError && error.code === 'expired'
            ? 'source_expired'
            : 'invalid_input',
        );
      }
      let sourceUrl: URL;
      try {
        sourceUrl = new URL(url);
      } catch {
        throw new OfflineError('invalid_input');
      }
      if (
        sourceUrl.protocol !== 'https:' ||
        sourceUrl.username ||
        sourceUrl.password ||
        sourceUrl.hash
      )
        throw new OfflineError('invalid_input');
      let raw: unknown;
      try {
        raw = await dependencies.request({
          method: 'PUT',
          action: 'CreateTask',
          path: '/openapi/tingwu/v2/tasks',
          query: { type: 'offline' },
          body: {
            AppKey: appKey,
            Input: {
              FileUrl: url,
              SourceLanguage: 'cn',
              TaskKey: input.operationId,
            },
            Parameters: { Transcription: { DiarizationEnabled: true } },
          },
          signal,
        });
      } catch (error) {
        throw mapError(error, true);
      }
      const parsedResponse = z
        .object({
          RequestId: z.string().optional(),
          Data: z.object({ TaskId: taskIdSchema }),
        })
        .safeParse(raw);
      if (!parsedResponse.success) throw new OfflineError('submission_unknown');
      if (signal?.aborted)
        throw new OfflineError(
          'submission_unknown',
          false,
          parsedResponse.data.Data.TaskId,
        );
      return {
        providerTaskId: parsedResponse.data.Data.TaskId,
        requestId: parsedResponse.data.RequestId,
        operationId: input.operationId,
      };
    },
    async queryOffline(providerTaskId: string, signal?: AbortSignal) {
      const r = await query(providerTaskId, signal);
      return {
        providerTaskId,
        requestId: r.RequestId,
        status:
          r.Data.TaskStatus === 'ONGOING'
            ? ('running' as const)
            : r.Data.TaskStatus === 'COMPLETED'
              ? ('completed' as const)
              : ('failed' as const),
      };
    },
    async getTranscript(providerTaskId: string, signal?: AbortSignal) {
      const r = await query(providerTaskId, signal);
      if (r.Data.TaskStatus !== 'COMPLETED')
        throw new OfflineError('not_completed');
      if (!r.Data.Result?.Transcription)
        throw new OfflineError('malformed_result');
      const raw = await downloadResult(
        r.Data.Result.Transcription,
        origins,
        dependencies.fetch ?? fetch,
        signal,
      );
      return parseTranscript(raw, providerTaskId);
    },
  };
}
function mapError(error: unknown, submission: boolean): OfflineError {
  if (error instanceof TingwuHttpError) {
    if (error.code === 'provider_auth')
      return new OfflineError('provider_auth');
    if (error.code === 'rate_limited')
      return new OfflineError('rate_limited', !submission);
    if (submission) return new OfflineError('submission_unknown');
    if (error.code === 'aborted') return new OfflineError('cancelled');
    if (error.code === 'timeout') return new OfflineError('timeout', true);
    if (error.code === 'protocol_error')
      return new OfflineError('malformed_result');
    if (error.code === 'provider_failed')
      return new OfflineError(
        'provider_failed',
        error.httpStatus !== undefined && error.httpStatus >= 500,
      );
  }
  return new OfflineError(
    submission ? 'submission_unknown' : 'transport_error',
    !submission,
  );
}
