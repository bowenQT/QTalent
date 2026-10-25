type ReadinessResponse = Pick<Response, 'status' | 'headers' | 'text'>;
type ReadinessTransport = (
  url: string,
  init?: RequestInit,
) => Promise<ReadinessResponse>;
/** Dev compilation belongs to fixture startup, not the user-facing action budget. */
export async function warmReferenceRoutes(
  baseURL: string,
  deadline: number,
  transport: ReadinessTransport = fetch,
): Promise<void> {
  function signal() {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error('Reference app startup deadline exceeded');
    return AbortSignal.timeout(remaining);
  }
  // Read-only, anonymous warmup: no browser cookie, password, or synthetic login.
  const session = await transport(`${baseURL}/api/auth/get-session`, {
    redirect: 'manual',
    signal: signal(),
  });
  const sessionBody = await session.text();
  if (session.status !== 200 || sessionBody.trim() !== 'null') {
    throw new Error(`Anonymous session readiness failed (${session.status})`);
  }
  const projects = await transport(`${baseURL}/projects`, {
    redirect: 'manual',
    signal: signal(),
  });
  await projects.text();
  const location = projects.headers.get('location');
  if (
    ![303, 307].includes(projects.status) ||
    !location ||
    new URL(location, baseURL).href !== `${baseURL}/login`
  ) {
    throw new Error(`Anonymous projects readiness failed (${projects.status})`);
  }
}
