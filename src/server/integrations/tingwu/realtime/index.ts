import { createTingwuHttp } from '../http';
import { createRealtimeRecord } from './client';
import { connectTingwuSocket } from './socket';
export type {
  RealtimeRecord,
  RealtimeCycle,
  Preview,
  CycleCallbacks,
  StopResult,
  FinalizeResult,
} from './client';

/** Explicit opt-in only; the existing offline fake and application wiring are unchanged. */
export function createTingwuRealtimeFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const appKey = env.TINGWU_APP_KEY ?? '';
  const request = createTingwuHttp({
    endpoint: 'https://tingwu.cn-beijing.aliyuncs.com',
    accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    appKey,
  });
  return {
    createRecord(input: { sessionId: string; sampleRate: 8000 | 16000 }) {
      return createRealtimeRecord(input, {
        request,
        connect: connectTingwuSocket,
        appKey,
      });
    },
  };
}
