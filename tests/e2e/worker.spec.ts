import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';
import { test, expect, login } from './fixtures';
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port required');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
function rejectedUpgrade(url: string, origin: string) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode!);
      socket.terminate();
    });
    socket.once('open', () => {
      socket.close();
      reject(new Error('Unauthorized WebSocket unexpectedly opened'));
    });
    socket.on('error', (error) => {
      if (!String(error).includes('closed before')) reject(error);
    });
  });
}
test('real worker rejects anonymous/cross-origin handshakes and accepts session heartbeat', async ({
  context,
  referenceApp,
}) => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const worker = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/worker/index.ts'],
    {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: referenceApp.pool.options.connectionString,
        BETTER_AUTH_URL: referenceApp.baseURL,
        BETTER_AUTH_SECRET: 'isolated-browser-test-secret-at-least-32-chars',
        ACCESS_ENFORCED: 'false',
        WORKER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  worker.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  try {
    await expect
      .poll(
        async () => {
          if (worker.exitCode !== null) throw new Error(logs);
          try {
            return (await fetch(url)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(404);
    expect(
      await rejectedUpgrade(
        `${url.replace('http:', 'ws:')}/stream`,
        referenceApp.baseURL,
      ),
    ).toBe(401);
    expect(
      await rejectedUpgrade(
        `${url.replace('http:', 'ws:')}/stream`,
        'https://invalid.test',
      ),
    ).toBe(403);
    await login(context, 'mentor', referenceApp.baseURL);
    const cookie = (await context.cookies())
      .map((item) => `${item.name}=${item.value}`)
      .join('; ');
    const socket = new WebSocket(`${url.replace('http:', 'ws:')}/stream`, {
      origin: referenceApp.baseURL,
      headers: { Cookie: cookie },
    });
    await once(socket, 'open');
    const message = once(socket, 'message');
    socket.send('{"type":"ping"}');
    expect(JSON.parse(String((await message)[0]))).toEqual({ type: 'pong' });
    socket.close();
    await once(socket, 'close');
  } finally {
    worker.kill('SIGTERM');
    await Promise.race([
      once(worker, 'exit'),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          worker.kill('SIGKILL');
          resolve();
        }, 5000),
      ),
    ]);
  }
});
