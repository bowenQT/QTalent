export type OfflineErrorCode =
  | 'configuration_error'
  | 'invalid_input'
  | 'unsupported_media'
  | 'source_expired'
  | 'provider_auth'
  | 'rate_limited'
  | 'provider_failed'
  | 'timeout'
  | 'cancelled'
  | 'submission_unknown'
  | 'transport_error'
  | 'malformed_result'
  | 'not_completed'
  | 'result_unavailable';
export class OfflineError extends Error {
  constructor(
    readonly code: OfflineErrorCode,
    readonly retryable = false,
    readonly providerTaskId?: string,
  ) {
    super(code);
    this.name = 'OfflineError';
  }
}
