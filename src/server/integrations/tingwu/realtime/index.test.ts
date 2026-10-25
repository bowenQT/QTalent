import { describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ request: vi.fn(), connect: vi.fn() }));
vi.mock('../http', async (original) => ({
  ...(await original<object>()),
  createTingwuHttp: vi.fn(() => mocked.request),
}));
vi.mock('./socket', () => ({ connectTingwuSocket: mocked.connect }));
import { createTingwuRealtimeFromEnv } from './index';
import { createTingwuHttp } from '../http';
describe('explicit realtime factory', () => {
  it('passes only runtime configuration and does not call network during construction', async () => {
    const client = createTingwuRealtimeFromEnv({
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'demo-id',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'demo-secret',
      TINGWU_APP_KEY: 'demo-app',
    });
    expect(createTingwuHttp).toHaveBeenCalledWith({
      endpoint: 'https://tingwu.cn-beijing.aliyuncs.com',
      accessKeyId: 'demo-id',
      accessKeySecret: 'demo-secret',
      appKey: 'demo-app',
    });
    expect(mocked.request).not.toHaveBeenCalled();
    expect(mocked.connect).not.toHaveBeenCalled();
    mocked.request.mockResolvedValue({
      Data: {
        TaskId: 'demo',
        MeetingJoinUrl:
          'wss://tingwu-realtime-cn-beijing.aliyuncs.com/api/ws/v1?mc=demo',
      },
    });
    await client.createRecord({ sessionId: 'app-demo', sampleRate: 8000 });
    expect(mocked.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ AppKey: 'demo-app' }),
      }),
    );
  });
});
