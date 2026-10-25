export async function authRequest(
  path: 'sign-in/email' | 'sign-out',
  body: object = {},
): Promise<boolean> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return response.ok;
}
