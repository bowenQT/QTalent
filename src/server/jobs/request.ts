import { errors } from 'jose';
import { getSession } from '../auth';
import { verifyAccessRequest } from '../access';
import { getEnv } from '../env';
export async function jobAccount(headers: Headers): Promise<string | null> {
  if (getEnv().ACCESS_ENFORCED && !headers.get('cf-access-jwt-assertion'))
    return null;
  try {
    await verifyAccessRequest(headers);
  } catch (error) {
    if (
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWTExpired ||
      error instanceof errors.JOSEAlgNotAllowed ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed
    )
      return null;
    // JWKS availability and key rotation are dependency failures, not proof of invalid credentials.
    throw error;
  }
  const session = await getSession(headers);
  return session?.user.id ?? null;
}
