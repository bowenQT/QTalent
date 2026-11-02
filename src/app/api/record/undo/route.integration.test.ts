import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  recordUndoResultSchema,
  type RecordUndoResult,
} from '../../../../contracts/record';
import { requireSession } from '../../../../server/auth/next';
import { createDatabase, getDatabase } from '../../../../server/db/client';
import { jobAccount } from '../../../../server/jobs/request';
import { saveRecordAction } from '../../../../server/actions/record';
import {
  seedRecordCase,
  seedRecordRules,
} from '../../../../../tests/fixtures/bow-846/native';
import { POST } from './route';

/*
 * 撤销路由接真实 PostgreSQL（BOW-847 第二次裁决）：保存后在 5 秒窗口内 POST 撤销，到达服务端
 * 并成功。会话是替身（vitest 里没有请求作用域），撤销动作、权限检查、事务、时钟和重放是真的。
 */
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../../server/auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../../../../server/jobs/request', async (original) => ({
  ...(await original<typeof import('../../../../server/jobs/request')>()),
  jobAccount: vi.fn(),
}));
vi.mock('../../../../server/db/client', async (original) => ({
  ...(await original<typeof import('../../../../server/db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../../../../server/env', () => ({
  getEnv: () => ({ APP_ENV: 'test' }),
}));

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName =
  'qtalent_receipt_undo_' + randomUUID().replaceAll('-', '') + '_test';
const db = () => connection!.db;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Dedicated local test database required');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
  await seedRecordRules(db());
}, 30_000);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDatabase).mockImplementation(db);
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

const undo = (body: unknown) =>
  POST(
    new Request('https://app.test/api/record/undo', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin: 'https://app.test',
        host: 'app.test',
      },
    }),
  );

it('保存后在窗口内 POST 撤销：到达服务端并成功，同一个操作再发一次按原结果回放', async () => {
  const f = await seedRecordCase(db());
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: f.account.one },
  } as Awaited<ReturnType<typeof requireSession>>);
  vi.mocked(jobAccount).mockResolvedValue(f.account.one);
  const saved = await saveRecordAction(f.input);
  if (saved.status !== 'success') throw new Error('Expected native save');
  expect(Date.now()).toBeLessThan(Date.parse(saved.result.undoUntil));

  const input = {
    operation_id: f.id + '-route-undo',
    saveId: saved.result.saveId,
  };
  const response = await undo(input);
  expect(response.status).toBe(200);
  const body = recordUndoResultSchema.parse(await response.json());
  expect(body).toMatchObject({ status: 'success', replayed: false });
  const result = (body as Extract<RecordUndoResult, { status: 'success' }>)
    .result;
  expect(result.saveId).toBe(saved.result.saveId);
  expect(result.withdrawnEvents).toEqual(saved.result.events);

  const again = await undo(input);
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ...body, replayed: true });
});

it('撤销途中会话失效：答 401，不当作 503', async () => {
  const f = await seedRecordCase(db());
  vi.mocked(jobAccount).mockResolvedValue(f.account.one);
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: f.account.one },
  } as Awaited<ReturnType<typeof requireSession>>);
  const saved = await saveRecordAction(f.input);
  if (saved.status !== 'success') throw new Error('Expected native save');
  const { redirect } = await import('next/navigation');
  vi.mocked(requireSession).mockImplementation(async () => redirect('/login'));
  const response = await undo({
    operation_id: f.id + '-lost-undo',
    saveId: saved.result.saveId,
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ status: 'unauthenticated' });
});
