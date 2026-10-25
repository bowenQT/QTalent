import { test as base, expect, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { warmReferenceRoutes } from './app-readiness';
import {
  trackPoolShutdown,
  trackChildShutdown,
  cleanupReferenceResources,
} from './resource-cleanup';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/server/db/client';
import { importDemo } from '../../src/server/db/import';
import { readPrototypeSeed, mapPrototypeSeed } from '../../src/server/db/seed';
export const demoPassword = 'isolated-test-password-only';
export type DemoRole = 'ceo' | 'hrbp' | 'mentor' | 'admin';
export async function login(
  context: BrowserContext,
  role: DemoRole,
  baseURL: string,
) {
  const response = await context.request.post(
    `${baseURL}/api/auth/sign-in/email`,
    {
      data: { email: `${role}@qtalent.test`, password: demoPassword },
      headers: { Origin: baseURL },
    },
  );
  expect(response.ok(), `Login failed for ${role}: ${response.status()}`).toBe(
    true,
  );
}
async function reservePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('TCP address required');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
type ReferenceApp = { baseURL: string; pool: Pool };
export const test = base.extend<{ referenceApp: ReferenceApp }>({
  referenceApp: [
    async ({}, provide, testInfo) => {
      const rawURL = process.env.TEST_DATABASE_URL;
      if (!rawURL)
        throw new Error(
          'TEST_DATABASE_URL is required; browser checks never run against a shared or production database.',
        );
      const url = new URL(rawURL);
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !url.pathname.endsWith('_test')
      )
        throw new Error('Browser database must be localhost and end in _test.');
      const admin = new Pool({ connectionString: rawURL });
      const closeAdminPool = trackPoolShutdown(admin);
      const databaseName = `qtalent_test_${randomUUID().replaceAll('-', '')}`;
      let databaseCreated = false;
      let closeAppPool: () => Promise<void> = async () => {};
      let stopApp: (() => Promise<void>) | undefined;
      let app: ReturnType<typeof spawn> | undefined;
      let logs = '';
      try {
        await admin.query(`CREATE DATABASE "${databaseName}"`);
        databaseCreated = true;
        url.pathname = `/${databaseName}`;
        const connection = createDatabase(url.toString());
        closeAppPool = trackPoolShutdown(connection.pool);
        await migrate(connection.db, {
          migrationsFolder: 'src/server/db/migrations',
        });
        await importDemo(
          connection.db,
          mapPrototypeSeed(readPrototypeSeed(process.cwd())),
          demoPassword,
        );
        const port = await reservePort();
        const baseURL = `http://127.0.0.1:${port}`;
        app = spawn(
          process.execPath,
          [
            'node_modules/next/dist/bin/next',
            'dev',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(port),
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              NODE_ENV: 'development',
              APP_ENV: 'test',
              DATABASE_URL: url.toString(),
              DEMO_PASSWORD: demoPassword,
              BETTER_AUTH_SECRET:
                'isolated-browser-test-secret-at-least-32-chars',
              BETTER_AUTH_URL: baseURL,
              ACCESS_ENFORCED: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        stopApp = trackChildShutdown(app);
        app.stdout?.on('data', (chunk) => {
          logs += String(chunk);
        });
        app.stderr?.on('data', (chunk) => {
          logs += String(chunk);
        });
        const deadline = Date.now() + 120_000;
        while (true) {
          if (app.exitCode !== null)
            throw new Error(`Reference app exited ${app.exitCode}: ${logs}`);
          try {
            const response = await fetch(`${baseURL}/login`);
            if (response.ok) break;
          } catch {
            /* The process has not bound its port yet. */
          }
          if (Date.now() > deadline)
            throw new Error(`Reference app startup timed out: ${logs}`);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        await warmReferenceRoutes(baseURL, deadline);
        await provide({ baseURL, pool: connection.pool });
      } finally {
        try {
          if (databaseCreated) {
            await cleanupReferenceResources({
              databaseName,
              stopApp,
              closeAppPool,
              admin,
              closeAdminPool,
            });
          } else {
            await closeAdminPool();
          }
        } finally {
          await testInfo.attach('app-output', {
            body: logs,
            contentType: 'text/plain',
          });
        }
      }
    },
    { timeout: 180_000 },
  ],
  context: async ({ browser, referenceApp }, provide) => {
    const context = await browser.newContext({
      baseURL: referenceApp.baseURL,
      locale: 'zh-CN',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      viewport: { width: 1366, height: 900 },
    });
    try {
      await provide(context);
    } finally {
      await context.close();
    }
  },
});
export { expect };
