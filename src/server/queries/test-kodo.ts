import 'server-only';
import { getEnv } from '../env';
import { testKodoFor } from '../integrations/kodo/test-kodo';

export function testKodoForServer() {
  return testKodoFor({ ...getEnv(), NODE_ENV: process.env.NODE_ENV });
}

export async function testKodoRoute(request: Request, path: readonly string[]) {
  const kodo = testKodoForServer();
  if (!kodo) return new Response(null, { status: 404 });
  return kodo.handle(request, path);
}
