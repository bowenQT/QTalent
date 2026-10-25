import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth, getSession } from './index';
import { verifyAccessRequest } from '../access';
export async function requireSession() {
  const requestHeaders = await headers();
  await verifyAccessRequest(requestHeaders);
  const session = await getSession(requestHeaders);
  if (!session) redirect('/login');
  return session;
}
async function handle(request: Request) {
  await verifyAccessRequest(request.headers);
  return getAuth().handler(request);
}
export const authHandlers = { GET: handle, POST: handle };
