import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { authenticateWebEntryRequest } from './web-request';
const boundary = vi.hoisted(() => ({ access: vi.fn(), session: vi.fn() }));
vi.mock('../../access', () => ({ verifyAccessRequest: boundary.access }));
vi.mock('../../env', () => ({ getEnv: () => ({ ACCESS_ENFORCED: false }) }));
vi.mock('../../auth', () => ({ getSession: boundary.session }));
const now = '2026-11-01T01:00:00.000Z';
const expiry = new Date('2026-11-01T02:00:00.000Z');
function fixture() {
  let personId = 'demo-person';
  let enabled = true;
  // Only database I/O is replaced: the production Drizzle builder, Web reader,
  // capability service, directory/program/staffing readers and loader all run.
  const query = vi.fn(async (config: { text: string }) => {
    if (config.text.includes('inner join "directory_account_bindings"'))
      return {
        rows: enabled
          ? [
              [
                'demo-session',
                'demo-account',
                expiry,
                'demo-account',
                personId,
                false,
              ],
            ]
          : [],
      };
    if (config.text.includes('from "directory_account_bindings"'))
      return { rows: [['demo-account', personId, false]] };
    return { rows: [] };
  });
  const db = drizzle({ query } as unknown as Pool);
  const headers = new Headers({ cookie: 'synthetic-request' });
  return {
    db,
    query,
    headers,
    disable: () => {
      enabled = false;
    },
    rebind: () => {
      personId = 'demo-other';
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.access.mockResolvedValue(undefined);
  boundary.session.mockImplementation(async () => ({
    user: { id: 'demo-account' },
    session: { id: 'demo-session', userId: 'demo-account', expiresAt: expiry },
  }));
});
describe('per-request Web production composition', () => {
  it('constructs a fresh single-use authenticator for every request and loads the real current readers', async () => {
    const f = fixture();
    const clocks = { wallNow: () => new Date(now), businessNow: () => now };
    const a = await authenticateWebEntryRequest(f.db, f.headers, clocks);
    const b = await authenticateWebEntryRequest(f.db, f.headers, clocks);
    expect(a.identity).not.toBe(b.identity);
    expect(Object.isFrozen(a)).toBe(true);
    const facts = await a.loadContext(f.db, a.identity);
    expect(facts.account).toEqual({
      id: 'demo-account',
      personId: 'demo-person',
      isSystemAdmin: false,
    });
    expect(facts.now).toBe(now);
    expect(facts.evaluationNodes).toEqual([]);
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.text.includes('programs_evaluation_nodes'),
      ),
    ).toBe(true);
    await expect(a.loadContext(f.db, b.identity)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(await b.loadContext(f.db, b.identity)).toHaveProperty(
      'account.id',
      'demo-account',
    );
  });
  it.each(['logout', 'rebind'] as const)(
    'rechecks %s before current domain context and exposes no header/token',
    async (change) => {
      const f = fixture();
      const request = await authenticateWebEntryRequest(f.db, f.headers, {
        wallNow: () => new Date(now),
      });
      const before = f.query.mock.calls.length;
      if (change === 'logout') f.disable();
      else f.rebind();
      await expect(
        request.loadContext(f.db, request.identity),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      expect(f.query.mock.calls.length - before).toBe(1);
      expect(JSON.stringify(request)).toBe('{"identity":{"channel":"web"}}');
    },
  );
  it('rejects absent authentication before loading any private context', async () => {
    const f = fixture();
    boundary.session.mockResolvedValue(null);
    await expect(
      authenticateWebEntryRequest(f.db, f.headers),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(f.query).not.toHaveBeenCalled();
  });
});
