import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAccessVerifier } from './index';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: ReturnType<typeof createAccessVerifier>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey);
  verify = createAccessVerifier({
    issuer: 'https://test.cloudflareaccess.com',
    audience: 'test-audience',
    key: createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key' }] }),
  });
});
async function token(
  overrides: { issuer?: string; audience?: string; expires?: string } = {},
) {
  return new SignJWT({ email: 'synthetic@qiniu.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(overrides.issuer ?? 'https://test.cloudflareaccess.com')
    .setAudience(overrides.audience ?? 'test-audience')
    .setSubject('synthetic-test-subject')
    .setIssuedAt()
    .setExpirationTime(overrides.expires ?? '5m')
    .sign(keys.privateKey);
}
describe('Access signature validation', () => {
  it('validates a locally signed token with the security clock', async () =>
    expect(
      await verify(new Headers({ 'cf-access-jwt-assertion': await token() })),
    ).toBeUndefined());
  it('rejects absent tokens and spoofed email headers', async () => {
    await expect(verify(new Headers())).rejects.toThrow();
    await expect(
      verify(
        new Headers({
          'cf-access-authenticated-user-email': 'synthetic@qiniu.com',
        }),
      ),
    ).rejects.toThrow();
  });
  it('rejects wrong audience, issuer, expired and tampered tokens', async () => {
    for (const bad of [
      await token({ audience: 'other' }),
      await token({ issuer: 'https://other.test' }),
      await token({ expires: '-1m' }),
      (await token()).slice(0, -20) + 'tampered',
    ])
      await expect(
        verify(new Headers({ 'cf-access-jwt-assertion': bad })),
      ).rejects.toThrow();
  });
});
