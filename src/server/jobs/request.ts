import { getSession } from '../auth';
import { verifyAccessRequest } from '../access';
export async function jobAccount(headers: Headers): Promise<string | null> {
  try {
    await verifyAccessRequest(headers);
  } catch {
    return null;
  }
  const session = await getSession(headers);
  return session?.user.id ?? null;
}
