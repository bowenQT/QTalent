import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { PgBoss } from 'pg-boss';
import { WebSocketServer } from 'ws';
import { getEnv } from '../server/env';
import { getSession } from '../server/auth';
import { verifyAccessRequest } from '../server/access';
import { registerExampleJob } from '../server/jobs/example';
import { authenticateHandshake, heartbeatReply } from './handshake';
export async function startWorker() {
  const env = getEnv();
  const boss = new PgBoss({ connectionString: env.DATABASE_URL });
  boss.on('error', (error) =>
    console.error('Worker database error', error.name),
  );
  await boss.start();
  try {
    await registerExampleJob(boss);
  } catch (error) {
    await boss.stop();
    throw error;
  }
  const server = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  sockets.on('connection', (socket) => {
    socket.on('error', () => socket.terminate());
    socket.on('message', (message, binary) => {
      if (binary) {
        socket.close(1003, 'Heartbeat only');
        return;
      }
      socket.send(JSON.stringify(heartbeatReply(message.toString())));
    });
  });
  server.on('upgrade', async (request, socket, head) => {
    socket.on('error', () => {
      socket.destroy();
    });
    if (request.url !== '/stream') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers))
      if (value)
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    // Reject cross-origin browser upgrades even when cookies are available.
    if (headers.get('origin') !== new URL(env.BETTER_AUTH_URL).origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    try {
      await authenticateHandshake(headers, {
        access: verifyAccessRequest,
        session: getSession,
      });
      if (!socket.destroyed)
        sockets.handleUpgrade(request, socket, head, (client) =>
          sockets.emit('connection', client, request),
        );
    } catch {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.WORKER_PORT, '127.0.0.1', resolve);
    });
  } catch (error) {
    await boss.stop();
    throw error;
  }
  async function stop() {
    for (const client of sockets.clients)
      client.close(1001, 'Service stopping');
    sockets.close();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(force);
        if (error) reject(error);
        else resolve();
      };
      const force = setTimeout(() => {
        server.closeAllConnections();
        finish();
      }, 10_000);
      server.close((error) => finish(error ?? undefined));
    });
    await boss.stop();
  }
  return { stop, boss, server };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = await startWorker();
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      const kill = setTimeout(() => {
        process.exit(1);
      }, 15_000);
      void worker.stop().then(
        () => {
          clearTimeout(kill);
          process.exit(0);
        },
        () => {
          clearTimeout(kill);
          process.exit(1);
        },
      );
    });
}
