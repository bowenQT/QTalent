import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ env: vi.fn(), verify: vi.fn(), keys: vi.fn() }));
vi.mock('../env', () => ({ getEnv: f.env }));
vi.mock('jose', () => ({ jwtVerify: f.verify, createRemoteJWKSet: f.keys }));
import { verifyAccessRequest } from './index';
beforeEach(() => {
  vi.clearAllMocks();
  f.env.mockReturnValue({
    ACCESS_ENFORCED: true,
    ACCESS_ISSUER: 'https://runtime.cloudflareaccess.com',
    ACCESS_AUDIENCE: 'runtime',
  });
  f.verify.mockResolvedValue({});
  f.keys.mockReturnValue(() => undefined);
});
it('local bypass does not fetch keys or require a token', async () => {
  f.env.mockReturnValue({ ACCESS_ENFORCED: false });
  await verifyAccessRequest(new Headers());
  expect(f.keys).not.toHaveBeenCalled();
});
it('constructs trusted key URL once, caches verifier and propagates failures', async () => {
  const headers = new Headers({ 'cf-access-jwt-assertion': 'synthetic-token' });
  await verifyAccessRequest(headers);
  await verifyAccessRequest(headers);
  expect(f.keys).toHaveBeenCalledOnce();
  expect(f.keys).toHaveBeenCalledWith(
    new URL('https://runtime.cloudflareaccess.com/cdn-cgi/access/certs'),
    expect.objectContaining({ timeoutDuration: 5000 }),
  );
  expect(f.verify).toHaveBeenCalledTimes(2);
  f.verify.mockRejectedValueOnce(new Error('bad signature'));
  await expect(verifyAccessRequest(headers)).rejects.toThrow('bad signature');
});
