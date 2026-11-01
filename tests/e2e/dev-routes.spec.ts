import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { test, expect } from '@playwright/test';
import { trackChildShutdown } from './resource-cleanup';

/**
 * /dev/design-system 下的样张只在开发环境提供。父页面的门禁不会作用到子路由，
 * 所以每个子页面自己做门禁；这里对真正的生产构建（next start）逐个确认返回 404。
 * 需要先有 pnpm build 的产物（pnpm check 已包含构建）。
 */
const devRoutes = [
  '/dev/design-system',
  '/dev/design-system/general',
  '/dev/design-system/media',
  '/dev/design-system/talent',
  '/dev/design-system/sources',
  '/dev/design-system/sources/view',
  // A valid role, so only the production gate can answer 404.
  '/dev/workbench?role=mentor',
];

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port required');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test('production build serves no design-system sample routes', async () => {
  expect(
    existsSync('.next/BUILD_ID'),
    '缺少生产构建产物，请先运行 pnpm build',
  ).toBe(true);
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APP_ENV: 'test',
        BETTER_AUTH_URL: baseURL,
        ACCESS_ENFORCED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stop = trackChildShutdown(server);
  let logs = '';
  server.stdout?.on('data', (chunk) => (logs += String(chunk)));
  server.stderr?.on('data', (chunk) => (logs += String(chunk)));
  try {
    const deadline = Date.now() + 60_000;
    // 登录页是生产构建里一定存在的路由，用它确认服务已经起来
    while (true) {
      if (server.exitCode !== null)
        throw new Error(`next start exited ${server.exitCode}: ${logs}`);
      try {
        if ((await fetch(`${baseURL}/login`)).status === 200) break;
      } catch {
        /* 端口还没有监听 */
      }
      if (Date.now() > deadline)
        throw new Error(`next start timed out: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (const route of devRoutes)
      expect(
        (await fetch(`${baseURL}${route}`)).status,
        `${route} must not exist in production`,
      ).toBe(404);
  } finally {
    await stop();
  }
});
