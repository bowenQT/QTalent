import type { ChildProcess } from 'node:child_process';
import type { Pool, PoolClient } from 'pg';

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function reportErrors(errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, 'Reference fixture cleanup failed');
}

/** Register before the first query. pg-pool removes clients from its array before
 * client.end finishes, so end() can resolve before the public remove event. */
export function trackPoolShutdown(
  pool: Pool,
  timeoutMs = 10_000,
): () => Promise<void> {
  const clients = new Set<PoolClient>();
  const errors: unknown[] = [];
  let onDrained: (() => void) | undefined;
  const onConnect = (client: PoolClient) => {
    clients.add(client);
  };
  const onRemove = (client: PoolClient) => {
    clients.delete(client);
    if (clients.size === 0) onDrained?.();
  };
  const onError = (error: Error) => {
    errors.push(error);
  };
  pool.on('connect', onConnect);
  pool.on('remove', onRemove);
  // Report errors from idle clients during teardown instead of letting an unhandled
  // event abort the worker before its original error and cleanup evidence are saved.
  pool.on('error', onError);
  return async () => {
    try {
      await within(
        (async () => {
          await pool.end();
          if (clients.size > 0)
            await new Promise<void>((resolve) => {
              onDrained = resolve;
            });
        })(),
        timeoutMs,
        'PostgreSQL pool sockets did not close before cleanup deadline',
      );
    } catch (error) {
      errors.push(error);
    } finally {
      pool.off('connect', onConnect);
      pool.off('remove', onRemove);
    }
    reportErrors(errors);
  };
}

/** Track from spawn so an already-closed child is distinguishable from exit-only. */
export function trackChildShutdown(
  child: ChildProcess,
  timeoutMs = 5000,
): () => Promise<void> {
  let closed = false;
  let spawnError: Error | undefined;
  const onError = (error: Error) => {
    spawnError = error;
  };
  const completion = new Promise<void>((resolve) => {
    child.once('close', () => {
      closed = true;
      child.off('error', onError);
      resolve();
    });
  });
  child.on('error', onError);
  return async () => {
    if (!closed) {
      child.kill('SIGTERM');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        timer = setTimeout(() => {
          if (!closed) child.kill('SIGKILL');
        }, timeoutMs);
        await within(
          completion,
          timeoutMs * 2,
          'Application process did not close after SIGKILL',
        );
      } finally {
        clearTimeout(timer);
      }
    }
    if (spawnError) throw spawnError;
  };
}

export async function cleanupReferenceResources(options: {
  databaseName: string;
  stopApp?: () => Promise<void>;
  closeAppPool: () => Promise<void>;
  admin: Pick<Pool, 'query'>;
  closeAdminPool: () => Promise<void>;
}): Promise<void> {
  const errors: unknown[] = [];
  if (!/^qtalent_test_[a-f0-9]{32}$/.test(options.databaseName))
    errors.push(
      new Error(
        'Refusing to drop a database not owned by this random test fixture',
      ),
    );
  try {
    try {
      await options.stopApp?.();
    } catch (error) {
      errors.push(error);
    }
    try {
      await options.closeAppPool();
    } catch (error) {
      errors.push(error);
    }
    // Never use FORCE to conceal a live connection or failed child shutdown.
    if (errors.length === 0)
      await within(
        options.admin.query(`DROP DATABASE "${options.databaseName}"`),
        10_000,
        'Test database drop did not finish before cleanup deadline',
      );
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await options.closeAdminPool();
    } catch (error) {
      errors.push(error);
    }
  }
  reportErrors(errors);
}
