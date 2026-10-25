import { readJobForCurrentUser } from '../../../../server/queries/jobs';
import { commandJobAction } from '../../../../server/actions/jobs';
import type { JobResponse } from '../../../../contracts/jobs';
const statusCodes = {
  success: 200,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_error: 400,
  unavailable: 503,
};
const response = (result: JobResponse) =>
  Response.json(
    result.status === 'success' ? result.snapshot : { status: result.status },
    {
      status: statusCodes[result.status],
      headers: {
        'Cache-Control': 'no-store, private',
        Vary: 'Cookie, Authorization',
      },
    },
  );
type Context = { params: Promise<{ jobId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    return response(await readJobForCurrentUser((await context.params).jobId));
  } catch {
    return response({ status: 'unavailable' });
  }
}
export async function POST(request: Request, context: Context) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return response({ status: 'forbidden' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ status: 'validation_error' });
  }
  const { jobId } = await context.params;
  // A mismatched body ID is not silently replaced with the route's resource.
  if (
    typeof body !== 'object' ||
    body === null ||
    !('jobId' in body) ||
    body.jobId !== jobId
  )
    return response({ status: 'validation_error' });
  try {
    return response(await commandJobAction(body));
  } catch {
    return response({ status: 'unavailable' });
  }
}
