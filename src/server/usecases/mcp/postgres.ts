import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Database, Transaction } from '../../db/client';
import type { EntryIdentityService } from '../../auth/entry/identity';
import { createMcpTools, McpCapacityError } from '../../integrations/mcp/tools';
import { createMcpHttpHandler } from '../../integrations/mcp/http';
import { recordArrangeQueue } from '../../jobs/record-arrange';
import { DemandAccessError } from '../../modules/staffing/demand/service';
import { DemandConflictError } from '../../modules/staffing/demand/version';
import { createStaffingDemandRuntime } from '../staffing-demand-runtime';
import {
  ArrangeModelInputBudgetExceeded,
  createRecordBatchArrangeRequests,
} from '../record-batch-arrange-requests';
import {
  createEntryContextLoader,
  loadEntryAuthorizationContext,
  EntryUsecaseError,
  type EntryAudit,
} from '../entry/context';
import { createMcpDomainHandlers } from './handlers';

export interface McpPostgresOptions {
  db: Database;
  boss: PgBoss;
  identities: EntryIdentityService;
  /** Mandatory shared writer. Must persist every EntryAudit field in this tx.
   * No fallback silently drops channel/revision into the legacy audit shape. */
  audit(tx: Transaction, event: EntryAudit): Promise<void>;
  businessNow?: () => string;
  now?: () => Date;
}

/** Concrete producer composition; never constructs credentials, registers a
 * worker or invokes a model. The caller supplies the single existing boss and
 * the actual 903 identity service. An absent auditor refuses construction. */
export function createMcpPostgresTools(options: McpPostgresOptions) {
  if (typeof options.audit !== 'function')
    throw new EntryUsecaseError('unavailable');
  const now = options.now ?? (() => new Date());
  const businessNow = options.businessNow ?? (() => now().toISOString());
  const demands = createStaffingDemandRuntime({
    db: options.db,
    boss: options.boss,
    now: businessNow,
  }).service;
  const records = createRecordBatchArrangeRequests({
    db: options.db,
    now,
    businessNow,
    async enqueue(tx, job) {
      const queued = await options.boss.send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!queued) throw new EntryUsecaseError('unavailable');
    },
  });
  const tools = createMcpTools({
    identities: options.identities,
    entry: {
      loadContext: createEntryContextLoader(options.identities, {
        businessNow,
        load: loadEntryAuthorizationContext,
      }),
      handlers: createMcpDomainHandlers({ demands, records }),
      transactions: {
        async transaction(run) {
          try {
            return await options.db.transaction(run, {
              isolationLevel: 'read committed',
            });
          } catch (error) {
            // This catch runs only AFTER the entire entry transaction rolls back,
            // including any earlier intake, business operation and queue rows.
            if (error instanceof ArrangeModelInputBudgetExceeded)
              throw new EntryUsecaseError('validation_error');
            if (error instanceof DemandAccessError)
              throw new EntryUsecaseError('forbidden');
            if (error instanceof DemandConflictError)
              throw new EntryUsecaseError('conflict');
            throw error;
          }
        },
        audit: options.audit,
      },
    },
  });
  // All credentials for the same current account share a two-call concurrency
  // allowance. The HTTP global bound remains eight. Entries exist only while
  // calls run, and release on every success/error; no token is retained as key.
  const active = new Map<string, number>();
  return {
    ...tools,
    async call(...args: Parameters<typeof tools.call>) {
      const actor = await options.identities.current(args[0]);
      const count = active.get(actor.accountId) ?? 0;
      if (count >= 2) throw new McpCapacityError();
      active.set(actor.accountId, count + 1);
      try {
        return await tools.call(...args);
      } finally {
        const remaining = active.get(actor.accountId)! - 1;
        if (remaining) active.set(actor.accountId, remaining);
        else active.delete(actor.accountId);
      }
    },
  };
}

export function createMcpPostgresHttp(
  options: McpPostgresOptions & {
    endpoint: string;
    allowedOrigins?: readonly string[];
  },
) {
  return createMcpHttpHandler({
    endpoint: options.endpoint,
    allowedOrigins: options.allowedOrigins,
    tools: createMcpPostgresTools(options),
  });
}
