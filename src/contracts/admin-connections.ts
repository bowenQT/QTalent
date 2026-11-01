import { z } from 'zod';
import { pageResult } from './page-result';
import { notConnectedSchema } from './person';

/*
 * 系统管理 · 接入状态 (BOW-916): whether the WeCom bot, MCP and AgentAPI entries are
 * connected, recent calls, sender binding failures and failed tasks. The system
 * administrator reads technical records only: no message body, file content, query
 * content, credential or raw sender account crosses this boundary, and every object
 * is strict so none can be added by accident.
 *
 * Each block is `not_connected` until its read is wired (BOW-909/910/915), never an
 * empty list or a zero standing in for "unknown". Inside `ready`, `never` means the
 * entry is configured but has not been used yet.
 */
const at = z.iso.datetime();
const count = z.number().int().nonnegative();
const account = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
});
const block = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ready'), data }),
    notConnectedSchema,
  ]);

export const wecomStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('connected'),
    lastMessageAt: at,
    lastReceiptAt: at.nullable(),
  }),
  z.strictObject({
    state: z.literal('disconnected'),
    since: at,
    lastMessageAt: at.nullable(),
  }),
  z.strictObject({ state: z.literal('never') }),
]);

/** MCP or AgentAPI over the last 24 hours; `lastCallAt` null means never called. */
export const callSummarySchema = z
  .strictObject({
    lastCallAt: at.nullable(),
    calls24h: count,
    rejectedOrFailed24h: count,
  })
  .refine((s) => s.rejectedOrFailed24h <= s.calls24h, '失败数不超过调用数')
  .refine(
    (s) => s.lastCallAt !== null || s.calls24h === 0,
    '没有调用就没有次数',
  );

export const callChannelSchema = z.enum(['mcp', 'agentapi']);
/** One call: who, which tool, how it ended. Never the query or its answer. */
export const callRecordSchema = z.discriminatedUnion('result', [
  z.strictObject({
    at,
    channel: callChannelSchema,
    account,
    action: z.string().min(1).max(40),
    result: z.literal('ok'),
    durationMs: count,
  }),
  z.strictObject({
    at,
    channel: callChannelSchema,
    account,
    action: z.string().min(1).max(40),
    result: z.enum(['denied', 'failed']),
    reason: z.string().min(1).max(120),
  }),
]);

/** The server masks the sender to its last four characters before it leaves. */
export const maskedWecomAccount = z.string().regex(/^wx·\*{4}[0-9a-z]{4}$/i);
export const bindingFailureReasonSchema = z.enum([
  'not_in_directory',
  'ambiguous',
  'departed',
]);
export const bindingFailureSchema = z.strictObject({
  at,
  sender: maskedWecomAccount,
  reason: bindingFailureReasonSchema,
});

export const taskSourceSchema = z.enum(['wecom', 'mcp', 'agentapi']);
/**
 * A failed background job raised through an entry. `jobId` and `revision` feed the
 * jobs retry command; `queued` is a retried task until it leaves this list.
 */
export const taskFailureSchema = z.strictObject({
  jobId: z.string().min(1),
  revision: z.number().int().positive(),
  state: z.enum(['failed', 'queued']),
  label: z.string().min(1).max(60),
  source: taskSourceSchema,
  initiator: account,
  failedAt: at,
  reason: z.string().min(1).max(120),
  next: z.string().min(1).max(160),
  canRetry: z.boolean(),
});

export const adminConnectionsSchema = z.strictObject({
  wecom: block(wecomStatusSchema),
  mcp: block(callSummarySchema),
  agentapi: block(callSummarySchema),
  recentCalls: block(z.array(callRecordSchema).max(50)),
  bindingFailures: block(
    z.strictObject({
      windowDays: z.literal(7),
      items: z.array(bindingFailureSchema).max(100),
    }),
  ),
  taskFailures: block(z.array(taskFailureSchema).max(100)),
});
export const adminConnectionsPageSchema = pageResult(adminConnectionsSchema);

export type AdminConnections = z.infer<typeof adminConnectionsSchema>;
export type AdminConnectionsPage = z.infer<typeof adminConnectionsPageSchema>;
export type WecomStatus = z.infer<typeof wecomStatusSchema>;
export type CallSummary = z.infer<typeof callSummarySchema>;
export type CallRecord = z.infer<typeof callRecordSchema>;
export type BindingFailure = z.infer<typeof bindingFailureSchema>;
export type TaskFailure = z.infer<typeof taskFailureSchema>;
