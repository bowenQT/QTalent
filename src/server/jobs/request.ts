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

/**
 * Whether a request that started with a valid account lost it while being handled:
 * `requireSession()` threw its sign-in redirect, or checking the same headers again
 * no longer finds the account. A failure while checking (e.g. JWKS unavailable) is a
 * dependency failure, not a lost session.
 */
export async function sessionLost(
  headers: Headers,
  error?: unknown,
): Promise<boolean> {
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String(error.digest)
      : '';
  if (digest.startsWith('NEXT_REDIRECT') && digest.split(';')[2] === '/login')
    return true;
  try {
    return !(await jobAccount(headers));
  } catch {
    return false;
  }
}
