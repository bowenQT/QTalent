import { isDeepStrictEqual } from 'node:util';
import { entryToolInputSchemas } from '../../../contracts/entry-tools';
import type { Transaction } from '../../db/client';
import { canReadTalent } from '../../authz/talent';
import { loadPersonDataInTransaction } from '../../queries/person-data';
import { canWriteDemand } from '../../modules/staffing/demand/policy';
import type { createDemandService } from '../../modules/staffing/demand/service';
import type { createRecordBatchArrangeRequests } from '../record-batch-arrange-requests';
import { loadArrangeActor, canWriteArrange } from '../record-arrange-context';
import { EntryUsecaseError } from '../entry/context';
import type { EntryToolHandler } from '../entry/tools';
import { mcpPersonBriefFromData } from './person-brief';

type Handler = EntryToolHandler<Transaction>;
/** Instances are constructed by the native composition from the real domain
 * factories. These handlers never accept an alternate authorize/execute port.
 * Both producers run in the entry transaction; their public owning-transaction
 * wrappers must NOT be passed here or wrapped in a fake Database/savepoint.
 */
export function createMcpDomainHandlers(input: {
  demands: ReturnType<typeof createDemandService>;
  records: ReturnType<typeof createRecordBatchArrangeRequests>;
}): Record<'record_moment' | 'person_brief' | 'draft_requirement', Handler> {
  const personBrief: Handler = {
    async authorize(_tx, current, args) {
      const { id } = entryToolInputSchemas.person_brief.parse(args);
      return canReadTalent(
        current,
        { personId: id, cohortId: null, kind: 'person' },
        'person-preview',
      );
    },
    async execute(tx, args, loadCurrent) {
      const current = await loadCurrent();
      const { id } = entryToolInputSchemas.person_brief.parse(args);
      const data = await loadPersonDataInTransaction(
        tx,
        current.account.id,
        current.now,
      );
      if (data.context.account.personId !== current.account.personId)
        throw new EntryUsecaseError('forbidden');
      const brief = await mcpPersonBriefFromData(data, id);
      if (!brief) throw new EntryUsecaseError('not_found');
      return brief;
    },
    async authorizeOutput(tx, current, args, payload) {
      const { id } = entryToolInputSchemas.person_brief.parse(args);
      const data = await loadPersonDataInTransaction(
        tx,
        current.account.id,
        current.now,
      );
      if (data.context.account.personId !== current.account.personId)
        return false;
      // Rebuild from current complete facts; never bless a cached DTO merely
      // because its visible source IDs still exist. Derived fields count too.
      const latest = await mcpPersonBriefFromData(data, id);
      return latest !== null && isDeepStrictEqual(latest, payload);
    },
  };
  const draftRequirement: Handler = {
    async authorize(_tx, current, args) {
      const parsed = entryToolInputSchemas.draft_requirement.parse(args);
      return canWriteDemand(current, {
        projectId: parsed.projectId,
        initiatorAccountId: '',
      });
    },
    async execute(tx, args, loadCurrent) {
      const current = await loadCurrent();
      const parsed = entryToolInputSchemas.draft_requirement.parse(args);
      return (
        await input.demands.createInTransaction(tx, current.account.id, parsed)
      ).snapshot;
    },
    async authorizeOutput(tx, current, args, payload) {
      const parsed = entryToolInputSchemas.draft_requirement.parse(args);
      // Native operation replay rechecks the actual root and current permission;
      // it cannot enqueue twice or resolve a different request fingerprint.
      const latest = await input.demands.createInTransaction(
        tx,
        current.account.id,
        parsed,
      );
      return latest.replayed && isDeepStrictEqual(latest.snapshot, payload);
    },
  };
  const recordMoment: Handler = {
    async authorize(tx, current, args) {
      const parsed = entryToolInputSchemas.record_moment.parse(args);
      const actor = await loadArrangeActor(tx, current.account.id, current.now);
      return (
        actor.context.account.personId === current.account.personId &&
        canWriteArrange(
          actor,
          parsed.personIds,
          parsed.projectId,
          parsed.evaluationNodeId,
        )
      );
    },
    async execute(tx, args, loadCurrent) {
      const current = await loadCurrent();
      const parsed = entryToolInputSchemas.record_moment.parse(args);
      const result = await input.records.createInTransaction(
        tx,
        current.account.id,
        parsed,
      );
      if (result.status !== 'success')
        throw new EntryUsecaseError(result.status);
      return result.result;
    },
    async authorizeOutput(tx, current, args, payload) {
      const parsed = entryToolInputSchemas.record_moment.parse(args);
      // Replay uses the native locked input/job, full source authorization and
      // receipt projection, including changed draft state on an older operation.
      const latest = await input.records.createInTransaction(
        tx,
        current.account.id,
        parsed,
      );
      return (
        latest.status === 'success' &&
        latest.replayed &&
        isDeepStrictEqual(latest.result, payload)
      );
    },
  };
  return {
    record_moment: recordMoment,
    person_brief: personBrief,
    draft_requirement: draftRequirement,
  };
}
