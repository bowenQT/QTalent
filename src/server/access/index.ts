import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { getEnv } from '../env';
export function createAccessVerifier(options: {
  issuer: string;
  audience: string;
  key: JWTVerifyGetKey;
}) {
  return async (headers: Headers): Promise<void> => {
    const token = headers.get('cf-access-jwt-assertion');
    if (!token) throw new Error('Access authentication required');
    await jwtVerify(token, options.key, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
  };
}
const verifiers = new Map<string, ReturnType<typeof createAccessVerifier>>();
export async function verifyAccessRequest(headers: Headers): Promise<void> {
  const env = getEnv();
  if (!env.ACCESS_ENFORCED) return;
  // The environment schema ensures both values are present before any network request.
  const issuer = env.ACCESS_ISSUER!;
  const audience = env.ACCESS_AUDIENCE!;
  const cacheKey = `${issuer}|${audience}`;
  let verifier = verifiers.get(cacheKey);
  if (!verifier) {
    verifier = createAccessVerifier({
      issuer,
      audience,
      key: createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      }),
    });
    verifiers.set(cacheKey, verifier);
  }
  await verifier(headers);
}
