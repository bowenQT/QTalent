import { describe, expect, it } from 'vitest';
import {
  adminConnectionsPageSchema,
  adminConnectionsSchema,
  callSummarySchema,
  taskFailureSchema,
} from './admin-connections';

const notConnected = { status: 'not_connected' } as const;
const pending = {
  wecom: notConnected,
  mcp: notConnected,
  agentapi: notConnected,
  recentCalls: notConnected,
  bindingFailures: notConnected,
  taskFailures: notConnected,
};
const task = {
  jobId: 'job-1',
  revision: 2,
  state: 'failed',
  label: '整理企业微信材料',
  source: 'wecom',
  initiator: { id: 'p-1', name: '测试成员' },
  failedAt: '2026-09-04T04:31:00.000Z',
  reason: '文件是扫描件',
  next: '改发文字版',
  canRetry: false,
};

describe('admin connections contract', () => {
  it('accepts every block as not connected, and the page envelope', () => {
    expect(adminConnectionsSchema.parse(pending)).toEqual(pending);
    expect(
      adminConnectionsPageSchema.parse({ status: 'forbidden' }).status,
    ).toBe('forbidden');
  });

  it('refuses message bodies, raw accounts or secrets added to a record', () => {
    expect(() =>
      taskFailureSchema.parse({ ...task, content: '材料正文' }),
    ).toThrow();
    expect(() =>
      adminConnectionsSchema.parse({
        ...pending,
        bindingFailures: {
          status: 'ready',
          data: {
            windowDays: 7,
            items: [
              {
                at: task.failedAt,
                sender: 'wx-full-account',
                reason: 'ambiguous',
              },
            ],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      adminConnectionsSchema.parse({ ...pending, token: 'secret' }),
    ).toThrow();
  });

  it('keeps call counts consistent with the last call', () => {
    expect(() =>
      callSummarySchema.parse({
        lastCallAt: null,
        calls24h: 2,
        rejectedOrFailed24h: 0,
      }),
    ).toThrow();
    expect(() =>
      callSummarySchema.parse({
        lastCallAt: task.failedAt,
        calls24h: 1,
        rejectedOrFailed24h: 2,
      }),
    ).toThrow();
  });
});
