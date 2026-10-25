import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import manifest from '../fixtures/prototype-manifest.json' with { type: 'json' };
import { referenceConfig } from './reference-config';
/** Serve only manifest-pinned baseline files, never an evolving working-tree prototype. */
export async function startPrototypeServer() {
  const files = new Map<string, Buffer>();
  for (const entry of manifest.files) {
    const bytes = await readFile(resolve('.reference-cache', entry.path));
    const blob = createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex');
    if (blob !== entry.sha)
      throw new Error(
        `Prototype ${referenceConfig.commit} mismatch: ${entry.path}`,
      );
    files.set(`/${entry.path}`, bytes);
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = files.get(path);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    const contentType = path.endsWith('.css')
      ? 'text/css'
      : path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.jpg')
          ? 'image/jpeg'
          : 'text/html';
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(file);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('TCP address required');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
