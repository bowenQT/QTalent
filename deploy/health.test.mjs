import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { nativeHealth } from './release.mjs';
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  });
test('local health requires HTTP401 and an actually reachable worker port', async () => {
  const web = createHttpServer((_request, response) =>
    response.writeHead(401).end(),
  );
  const worker = createTcpServer((socket) => socket.end());
  try {
    const webPort = await listen(web),
      workerPort = await listen(worker);
    await nativeHealth({ webPort, workerPort });
    await assert.rejects(
      nativeHealth({ webPort, workerPort: 0 }),
      /worker_health_failed/,
    );
  } finally {
    await close(web);
    await close(worker);
  }
});
test('HTTP200 is rejected as an Access enforcement failure', async () => {
  const web = createHttpServer((_request, response) =>
    response.writeHead(200).end(),
  );
  try {
    const webPort = await listen(web);
    await assert.rejects(
      nativeHealth({ webPort, workerPort: 0 }),
      /web_health_failed/,
    );
  } finally {
    await close(web);
  }
});
