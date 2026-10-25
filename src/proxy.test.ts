import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const access = vi.hoisted(() => vi.fn());
vi.mock('./server/access', () => ({ verifyAccessRequest: access }));
import { proxy } from './proxy';
it('passes verified HTTP and blocks failed Access even on login', async () => {
  const request = new NextRequest('https://synthetic.test/login');
  access.mockResolvedValueOnce(undefined);
  expect((await proxy(request)).status).toBe(200);
  access.mockRejectedValueOnce(new Error('expired'));
  expect((await proxy(request)).status).toBe(401);
});
