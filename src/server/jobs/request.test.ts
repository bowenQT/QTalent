import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { jobAccount } from './request';
import { createAccessVerifier } from '../access';
import { GET, POST } from '../../app/api/jobs/[jobId]/route';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  env: vi.fn(),
  headers: vi.fn(),
  read: vi.fn(),
  command: vi.fn(),
}));
vi.mock('../auth', () => ({ getSession: mocks.session }));
vi.mock('../env', () => ({ getEnv: mocks.env }));
vi.mock('../access', async (original) => ({
  ...(await original<typeof import('../access')>()),
  verifyAccessRequest: mocks.access,
}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('./runtime', () => ({
  jobService: () => ({ read: mocks.read, command: mocks.command }),
}));
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: ReturnType<typeof createAccessVerifier>;
const assertion = (token = 'synthetic-assertion') =>
  new Headers({ 'cf-access-jwt-assertion': token });
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey);
  verify = createAccessVerifier({
    issuer: 'https://test.cloudflareaccess.com',
    audience: 'test-audience',
    key: createLocalJWKSet({ keys: [{ ...jwk, kid: 'synthetic-key' }] }),
  });
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ APP_ENV: 'test', ACCESS_ENFORCED: true });
  mocks.session.mockResolvedValue({ user: { id: 'account' } });
  mocks.headers.mockResolvedValue(assertion());
});
afterEach(() => vi.useRealTimers());
async function token(
  overrides: {
    issuer?: string;
    audience?: string;
    expires?: string | Date;
    kid?: string;
    privateKey?: CryptoKey;
  } = {},
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: overrides.kid ?? 'synthetic-key' })
    .setIssuer(overrides.issuer ?? 'https://test.cloudflareaccess.com')
    .setAudience(overrides.audience ?? 'test-audience')
    .setSubject('synthetic-subject')
    .setIssuedAt()
    .setExpirationTime(overrides.expires ?? '5m')
    .sign(overrides.privateKey ?? keys.privateKey);
}
it('checks Access and current session, returning only account ID', async () => {
  const headers = assertion();
  expect(await jobAccount(headers)).toBe('account');
  expect(mocks.access).toHaveBeenCalledWith(headers);
  mocks.session.mockResolvedValue(null);
  expect(await jobAccount(headers)).toBeNull();
});
it('rejects absent assertions only when Access is enforced', async () => {
  expect(await jobAccount(new Headers())).toBeNull();
  expect(mocks.access).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
  mocks.env.mockReturnValue({ APP_ENV: 'test', ACCESS_ENFORCED: false });
  expect(await jobAccount(new Headers())).toBe('account');
});
it('accepts an actually verified synthetic assertion', async () => {
  mocks.access.mockImplementation(verify);
  expect(await jobAccount(assertion(await token()))).toBe('account');
});
it.each([
  [
    'signature',
    (): Promise<string> => token({ privateKey: otherKeys.privateKey }),
  ],
  ['expired', (): Promise<string> => token({ expires: '-1m' })],
  ['issuer', (): Promise<string> => token({ issuer: 'https://other.test' })],
  ['audience', (): Promise<string> => token({ audience: 'other' })],
  ['malformed JWT', async (): Promise<string> => 'malformed'],
] as const)(
  'rejects a real %s failure before session access',
  async (_kind, bad) => {
    mocks.access.mockImplementation(verify);
    expect(await jobAccount(assertion(await bad()))).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it('keeps Access expiry on security time when the business clock is fixed', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
  mocks.access.mockImplementation(verify);
  const expired = await token({ expires: new Date('2026-09-30T00:00:00Z') });
  expect(await jobAccount(assertion(expired))).toBeNull();
  expect(mocks.session).not.toHaveBeenCalled();
});
it.each([new errors.JOSEAlgNotAllowed(), new errors.JWTInvalid()])(
  'rejects known credential error $code without treating every JOSE error as authentication failure',
  async (error) => {
    mocks.access.mockRejectedValue(error);
    expect(await jobAccount(assertion())).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it('keeps an unknown signing key recoverable rather than permanently rejecting a rotated token', async () => {
  mocks.access.mockImplementation(verify);
  const headers = assertion(await token({ kid: 'unknown' }));
  await expect(jobAccount(headers)).rejects.toBeInstanceOf(
    errors.JWKSNoMatchingKey,
  );
  mocks.headers.mockResolvedValue(headers);
  const result = await GET(new Request('https://app.test/api/jobs/j'), {
    params: Promise.resolve({ jobId: 'j' }),
  });
  expect(result.status).toBe(503);
  expect(mocks.session).not.toHaveBeenCalled();
});
const dependencyErrors = [
  new errors.JWKSTimeout(),
  new TypeError('fetch failed'),
  new DOMException('synthetic timeout', 'TimeoutError'),
  new errors.JOSEError('synthetic invalid JWKS HTTP response'),
  new errors.JWKSInvalid(),
  new errors.JWKInvalid(),
  new errors.JWKSMultipleMatchingKeys(),
  new errors.JOSENotSupported(),
  new Error('Access authentication required'),
];
it.each(dependencyErrors)(
  'preserves dependency failure $name and exposes 503 through the real facades',
  async (error) => {
    mocks.access.mockRejectedValue(error);
    await expect(jobAccount(assertion())).rejects.toBe(error);
    const context = { params: Promise.resolve({ jobId: 'j' }) };
    const url = 'https://app.test/api/jobs/j';
    const results = [
      await GET(new Request(url), context),
      await POST(
        new Request(url, {
          method: 'POST',
          headers: {
            origin: 'https://app.test',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jobId: 'j',
            action: 'cancel',
            operationId: 'op',
            expectedRevision: 1,
          }),
        }),
        context,
      ),
    ];
    for (const result of results) {
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ status: 'unavailable' });
    }
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  },
);
it('does not turn auth database failure into a successful anonymous read', async () => {
  mocks.session.mockRejectedValue(new Error('database'));
  await expect(jobAccount(assertion())).rejects.toThrow('database');
});
