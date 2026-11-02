import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parseOfficeBytes } from './parse';
import { OfficeParseError } from './types';
import {
  encodeOfficeOutcome,
  officeWorkerInputSchema,
  officeWorkerBudgetSchema,
  OfficeIsolationError,
  successfulOfficeOutcome,
  type OfficeWorkerOutcome,
} from './worker-protocol';
/** Also directly exercised for protocol coverage; the application caller always uses the fixed worker. */
export async function executeOfficeWorker(
  data: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  const checked = officeWorkerInputSchema.safeParse(data);
  const budget = checked.success
    ? checked.data.budget
    : officeWorkerBudgetSchema.parse({});
  let outcome: OfficeWorkerOutcome;
  try {
    if (!checked.success)
      throw new OfficeIsolationError(
        'processing_failed',
        'invalid_worker_input',
      );
    const result = await parseOfficeBytes({
      format: checked.data.format,
      bytes: checked.data.bytes,
    });
    return encodeOfficeOutcome(successfulOfficeOutcome(result), budget);
  } catch (error) {
    const known =
      error instanceof OfficeParseError ||
      error instanceof OfficeIsolationError;
    outcome = {
      version: 1,
      status: 'failed',
      kind: known ? error.kind : 'processing_failed',
      reason:
        known && /^[A-Za-z0-9_]{1,96}$/.test(error.reason)
          ? error.reason
          : 'parser_failed',
    };
  }
  return encodeOfficeOutcome(outcome, budget);
}
if (!isMainThread && parentPort) {
  const port = parentPort;
  void executeOfficeWorker(workerData).then((wire) =>
    port.postMessage(wire, [wire.buffer]),
  );
}
