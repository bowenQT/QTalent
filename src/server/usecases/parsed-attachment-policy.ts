import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../db/client';
import type { JobPolicy } from '../jobs/service';
import type { JobRecord } from '../jobs/state';
import { canReadTalent } from '../authz/talent';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { canWriteArrange, loadArrangeActor } from './record-arrange-context';
import { readIntakeTable, intakeMediaFacts } from './talent-source-projection';
import {
  readAttachmentArrangeMetadata,
  parsedAttachmentArrangeKind,
} from './parsed-attachment-state';
import type { NativeBatchDependencies } from './record-batch-arrange-store';

/**842 exposes status only. Raw sources, draft bodies and generation metadata
 * remain behind the batch reader. A failed/unknown provider outcome is not retried. */
export function createParsedAttachmentPolicy(
  deps: NativeBatchDependencies,
): JobPolicy<Transaction> {
  async function authorized(
    tx: Transaction,
    accountId: string,
    job: JobRecord,
  ) {
    const meta = readAttachmentArrangeMetadata(job);
    if (!meta || meta.generation.accountId !== accountId) return false;
    const [input] = await tx
      .select()
      .from(arrangeInputs)
      .where(
        and(
          eq(arrangeInputs.id, meta.generation.parentInputId),
          eq(arrangeInputs.inputVersion, meta.generation.parentInputVersion),
          isNull(arrangeInputs.supersededByInputId),
        ),
      );
    if (!input || !input.evaluationNodeId) return false;
    const actor = await loadArrangeActor(tx, accountId, deps.businessNow());
    if (
      actor.context.account.personId !== meta.arrange.actorPersonId ||
      !canWriteArrange(actor, [], null, input.evaluationNodeId)
    )
      return false;
    // These are read-only native facts: never acquire a parent/source write lock
    // after the generic job service has locked this child job.
    const facts = intakeMediaFacts(
      await readIntakeTable(tx, 'snapshot'),
    ).filter(
      (fact) =>
        fact.inputId === input.id &&
        fact.materialId === meta.generation.materialId &&
        fact.parseVersionId === meta.generation.parseVersionId,
    );
    return (
      facts.length > 0 &&
      facts.every((fact) =>
        fact.subjects.every(
          (subject) =>
            canWriteArrange(
              actor,
              [subject.personId],
              null,
              subject.evaluationNodeId!,
            ) &&
            [fact.kind, ...fact.requiredKinds].every((kind) =>
              canReadTalent(actor.context, { ...subject, kind }, 'source-read'),
            ),
        ),
      )
    );
  }
  return {
    kind: parsedAttachmentArrangeKind,
    resultSchema: z.null(),
    async can(tx, accountId, job, action) {
      if (!(await authorized(tx, accountId, job))) return false;
      if (action === 'read') return true;
      return (
        action === 'cancel' &&
        ['queued', 'running', 'partial'].includes(job.status) &&
        job.cancelRequestedAt === null
      );
    },
    canReplay: (tx, accountId, job, action) =>
      action === 'cancel'
        ? authorized(tx, accountId, job)
        : Promise.resolve(false),
    project: async () => ({ result: null, progress: null }),
    inputVersion: async (_tx, job) => job.inputVersion,
    canResume: async () => false,
    enqueue: (tx, job) => deps.enqueue(tx, job),
  };
}
