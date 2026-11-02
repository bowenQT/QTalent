import { clearSessionDrafts } from '@/lib/session-drafts';

/** Signing in or out ends the previous account's drafts in this tab. */
export async function authRequest(
  path: 'sign-in/email' | 'sign-out',
  body: object = {},
): Promise<boolean> {
  if (path === 'sign-in/email') clearSessionDrafts();
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (path === 'sign-out' && response.ok) clearSessionDrafts();
  return response.ok;
}
