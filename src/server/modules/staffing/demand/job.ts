import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AuthzContext } from '../../../authz';
import { metadataFor } from '../../../integrations/maas';
import type { StructuredMaasClient } from '../../../integrations/maas';
import { createJobStore } from '../../../jobs/repository';
import { advanceJob, type JobRecord } from '../../../jobs/state';
import type { JobPolicy } from '../../../jobs/service';
import type { Transaction } from '../../../db/client';
import { staffingDemandSchema } from '../../../../contracts/staffing';
import { canReadDemand, canWriteDemand } from './policy';
import { generateDemandRequirements, DEMAND_PROMPT_VERSION } from './prompt';
import { demandRoots, demandVersions } from './schema';
import {
  loadDemandRoot,
  inputVersion,
  DemandAccessError,
  type DemandDependencies,
} from './service';

async function currentContext(
  deps: DemandDependencies,
  tx: Transaction,
  accountId: string,
): Promise<AuthzContext | null> {
  try {
    return (await deps.loadContext(tx, accountId, deps.now())).context;
  } catch (error) {
    if (error instanceof DemandAccessError) return null;
    throw error;
  }
}

export function demandJobPolicy(
  deps: DemandDependencies,
): JobPolicy<Transaction> {
  return {
    kind: 'staffing_demand',
    resultSchema: staffingDemandSchema,
    async can(tx, accountId, job, action) {
      const root = await loadDemandRoot(tx, job.resourceId);
      if (!root) return false;
      const context = await currentContext(deps, tx, accountId);
      if (!context) return false;
      if (!canReadDemand(context, root)) return false;
      if (action === 'read') return true;
      if (!context || !canWriteDemand(context, root) || action === 'resume')
        return false;
      return (
        action !== 'retry' || (root.retryable && root.currentRevision === 0)
      );
    },
    async canReplay(tx, accountId, job, action) {
      const root = await loadDemandRoot(tx, job.resourceId);
      if (!root || action === 'resume') return false;
      const context = await currentContext(deps, tx, accountId);
      return context !== null && canWriteDemand(context, root);
    },
    async project(_tx, _accountId, job) {
      return {
        result:
          job.result === null ? null : staffingDemandSchema.parse(job.result),
        progress: { completed: job.status === 'completed' ? 1 : 0, total: 1 },
      };
    },
    async inputVersion(tx, job) {
      const root = await loadDemandRoot(tx, job.resourceId);
      return root &&
        root.currentRevision === 0 &&
        root.promptVersion === DEMAND_PROMPT_VERSION
        ? inputVersion(root.inputText, root.promptVersion)
        : null;
    },
    async canResume() {
      return false;
    },
    async enqueue(tx, job) {
      await deps.enqueue(tx, job);
    },
  };
}
/** Only a queued attempt may call the provider. Redelivery of running is deliberately not resent. */
export async function runDemandGeneration(
  deps: DemandDependencies,
  client: StructuredMaasClient,
  payload: { jobId: string; attempt: number },
) {
  const store = createJobStore(deps.db);
  const claimed = await store.locked(payload.jobId, async (tx) => {
    const job = tx.record;
    if (
      !job ||
      job.kind !== 'staffing_demand' ||
      job.attempt !== payload.attempt ||
      ['completed', 'cancelled'].includes(job.status)
    )
      return null;
    if (job.cancelRequestedAt !== null) {
      await tx.save(
        advanceJob(
          job,
          {
            status: 'cancelled',
            attempt: job.attempt,
            expectedRevision: job.revision,
          },
          deps.now(),
        ),
      );
      return null;
    }
    if (job.status !== 'queued') return null;
    const root = await loadDemandRoot(tx.context, job.resourceId, true);
    if (!root) throw new Error('Missing demand job resource');
    const context = await currentContext(
      deps,
      tx.context,
      root.initiatorAccountId,
    );
    let running = advanceJob(
      job,
      {
        status: 'running',
        attempt: job.attempt,
        expectedRevision: job.revision,
      },
      deps.now(),
    );
    if (
      !context ||
      !canWriteDemand(context, root) ||
      root.currentRevision !== 0 ||
      root.promptVersion !== DEMAND_PROMPT_VERSION ||
      inputVersion(root.inputText, root.promptVersion) !== job.inputVersion
    ) {
      running = advanceJob(
        running,
        {
          status: 'failed',
          attempt: job.attempt,
          expectedRevision: running.revision,
          errorCode: 'input_changed',
        },
        deps.now(),
      );
      await tx.save(running);
      return null;
    }
    await tx.save(running);
    return { root, running };
  });
  if (!claimed) return;
  const outcome = await generateDemandRequirements(
    client,
    claimed.root.inputText,
  ).catch(() => ({
    ok: false as const,
    kind: 'outcome_unknown' as const,
    retryable: false,
    metadata: metadataFor({ promptVersion: claimed.root.promptVersion }),
  }));
  await store.locked(payload.jobId, async (tx) => {
    const current = tx.record;
    if (
      !current ||
      current.attempt !== payload.attempt ||
      current.status !== 'running'
    )
      return;
    if (current.cancelRequestedAt !== null) {
      await tx.save(
        advanceJob(
          current,
          {
            status: 'cancelled',
            attempt: current.attempt,
            expectedRevision: current.revision,
          },
          deps.now(),
        ),
      );
      return;
    }
    if (current.revision !== claimed.running.revision) return;
    const root = await loadDemandRoot(tx.context, current.resourceId, true);
    if (!root) throw new Error('Missing demand job resource');
    const context = await currentContext(
      deps,
      tx.context,
      root.initiatorAccountId,
    );
    const unchanged =
      root.currentRevision === 0 &&
      root.promptVersion === DEMAND_PROMPT_VERSION &&
      inputVersion(root.inputText, root.promptVersion) === current.inputVersion;
    if (!context || !canWriteDemand(context, root) || !unchanged) {
      await tx.save(
        advanceJob(
          current,
          {
            status: 'failed',
            attempt: current.attempt,
            expectedRevision: current.revision,
            errorCode: 'input_changed',
          },
          deps.now(),
        ),
      );
      return;
    }
    if (!outcome.ok) {
      await tx.context
        .update(demandRoots)
        .set({
          retryable: outcome.retryable && outcome.kind !== 'outcome_unknown',
          failureKind: outcome.kind,
        })
        .where(eq(demandRoots.id, root.id));
      await tx.save(
        advanceJob(
          current,
          {
            status: 'failed',
            attempt: current.attempt,
            expectedRevision: current.revision,
            errorCode: 'processing_failed',
          },
          deps.now(),
        ),
      );
      return;
    }
    const demand = staffingDemandSchema.parse({
      id: root.id,
      projectId: root.projectId,
      revision: 1,
      inputText: root.inputText,
      status: 'draft',
      requirements: outcome.value.requirements.map((item) => ({
        ...item,
        id: randomUUID(),
      })),
    });
    await tx.context.insert(demandVersions).values({
      demandId: root.id,
      revision: 1,
      demand,
      promptVersion: root.promptVersion,
      modelMetadata: outcome.metadata,
      actorAccountId: root.initiatorAccountId,
      createdAt: deps.now(),
    });
    await tx.context
      .update(demandRoots)
      .set({ currentRevision: 1, retryable: false, failureKind: null })
      .where(eq(demandRoots.id, root.id));
    await tx.save(
      advanceJob(
        current,
        {
          status: 'completed',
          attempt: current.attempt,
          expectedRevision: current.revision,
          result: demand,
        },
        deps.now(),
      ),
    );
  });
}
export type DemandJob = JobRecord;
