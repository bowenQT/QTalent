import { testKodoRoute } from '../../../../../server/queries/test-kodo';

/** Kodo v2 multipart upload double for local and e2e test runs; 404 in a
 * production build or outside the test environment. */
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return testKodoRoute(request, (await context.params).path);
}
export const POST = handle;
export const PUT = handle;
