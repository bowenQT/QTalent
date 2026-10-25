import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessRequest } from './server/access';
export async function proxy(request: NextRequest) {
  try {
    await verifyAccessRequest(request.headers);
  } catch {
    return new NextResponse('需要验证访问身份', { status: 401 });
  }
  return NextResponse.next();
}
export const config = { matcher: '/:path*' };
