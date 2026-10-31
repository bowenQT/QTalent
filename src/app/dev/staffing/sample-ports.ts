import type {
  StaffingDemand,
  StaffingDemandJobSnapshot,
  StaffingJobSnapshot,
  StaffingPage,
} from '@/contracts/staffing';
import type { StaffingPorts } from '@/features/staffing/ports';
import {
  newDraft,
  newMatching,
  samplePages,
  sampleSources,
  type SampleScene,
} from './samples';

const at = '2026-09-04T02:00:00Z';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function snapshot<K extends 'staffing_demand' | 'staffing_match', R>(
  kind: K,
  jobId: string,
  revision: number,
  status: StaffingJobSnapshot['status'],
  result: R | null,
) {
  return {
    schemaVersion: 1 as const,
    jobId,
    kind,
    status,
    attempt: 1,
    revision,
    updatedAt: at,
    progress: null,
    result,
    error: null,
    canRetry: false,
    canCancel: status === 'queued' || status === 'running',
    cancelRequestedAt: null,
  };
}

/**
 * In-memory stand-ins for the find-people Server Actions and job reads, so the sample
 * page walks the whole flow without a server: drafting takes two reads, matching for the
 * new project settles on the second read. Revision checks follow the contract.
 */
export function samplePorts(
  scene: SampleScene,
  actor: { id: string; name: string },
  delay = 250,
): StaffingPorts {
  let current: StaffingDemand | null =
    scene === 'new' ? null : samplePages[scene].demand;
  let sentence: string | null = null;
  const reads = new Map<string, number>();
  const count = (jobId: string) => {
    const next = (reads.get(jobId) ?? 0) + 1;
    reads.set(jobId, next);
    return next;
  };
  const conflict = <I>(input: I) => ({
    status: 'conflict' as const,
    message: '需求已变化，请保留输入并刷新',
    input,
  });
  return {
    async createDemand(input) {
      await wait(delay);
      sentence = input.inputText;
      return {
        status: 'success',
        snapshot: snapshot<'staffing_demand', StaffingDemand>(
          'staffing_demand',
          `sample-demand-job-${input.operationId}`,
          1,
          'queued',
          null,
        ),
        replayed: false,
      };
    },
    async readDemandJob(jobId) {
      await wait(delay);
      const done = count(jobId) >= 2;
      // Requirements are the prepared voice-hardware draft; the quoted sentence is the
      // one sent.
      const drafted = {
        ...newDraft,
        inputText: sentence ?? newDraft.inputText,
      };
      if (done) current = drafted;
      const result: StaffingDemandJobSnapshot = snapshot(
        'staffing_demand',
        jobId,
        done ? 3 : 2,
        done ? 'completed' : 'running',
        done ? drafted : null,
      );
      return result;
    },
    async editDemand(input) {
      await wait(delay);
      if (!current || current.revision !== input.expectedRevision)
        return conflict(input);
      current = {
        id: current.id,
        projectId: current.projectId,
        inputText: current.inputText,
        revision: current.revision + 1,
        requirements: input.requirements,
        status: 'draft',
      };
      return { status: 'success', demand: current, replayed: false };
    },
    async confirmDemand(input) {
      await wait(delay);
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        current.status !== 'draft'
      )
        return conflict(input);
      current = {
        ...current,
        revision: current.revision + 1,
        status: 'confirmed',
        confirmedBy: actor,
        confirmedAt: at,
      };
      return { status: 'success', demand: current, replayed: false };
    },
    async openMatching({ demandId, revision }) {
      await wait(delay);
      return `sample-match-${demandId}-${revision}`;
    },
    async readMatchingJob(jobId) {
      await wait(delay);
      const demand = current;
      if (!demand) throw new Error('No demand to match');
      let page: StaffingPage;
      let status: StaffingJobSnapshot['status'] = 'completed';
      if (scene === 'new' || demand !== samplePages[scene].demand) {
        // Edited demands and the new project use the scripted new-project matching.
        const settled = count(jobId) >= 2;
        page = newMatching(demand, settled);
        status = settled ? 'awaiting_manual' : 'running';
      } else page = samplePages[scene];
      return snapshot('staffing_match', jobId, 1, status, page);
    },
    async judge(input) {
      await wait(delay);
      if (!current || current.revision !== input.expectedRevision)
        return conflict(input);
      return {
        status: 'success',
        demandId: input.demandId,
        personId: input.personId,
        revision: current.revision,
        match: {
          requirementId: input.requirementId,
          progress: 'completed',
          aiJudgment: null,
          humanJudgment: {
            conclusion: input.conclusion,
            rationale: input.rationale,
            sources: input.sources.flatMap((reference) => {
              const source = sampleSources.get(reference.fragmentId);
              return source ? [source] : [];
            }),
            judgedBy: actor,
            judgedAt: at,
          },
        },
        replayed: false,
      };
    },
    async loadSource(input) {
      await wait(delay);
      const source = sampleSources.get(input.fragmentId);
      return source && source.originalVersionId === input.originalVersionId
        ? { status: 'success', source }
        : { status: 'not_found', message: '来源已删除或链接有误' };
    },
  };
}
