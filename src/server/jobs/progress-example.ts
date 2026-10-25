import { z } from 'zod';
import { createJobSnapshotSchema } from '../../contracts/jobs';
import { createClock } from '../../lib/clock';
import { canReadProject } from '../authz';
import { getEnv } from '../env';
import type { Transaction } from '../db/client';
import {
  loadProjectContext,
  ForbiddenError,
} from '../usecases/project-context';
import type { JobPolicy } from './service';
// Synthetic progress only. This is not talent evidence and grants no write permission.
export const exampleResultSchema = z
  .object({
    units: z.array(
      z.object({ id: z.string(), label: z.string().max(200) }).strict(),
    ),
  })
  .strict();
export const exampleSnapshotSchema = createJobSnapshotSchema(
  'test-job',
  exampleResultSchema,
);
export function exampleJobPolicy(): JobPolicy<Transaction> {
  return {
    kind: 'test-job',
    resultSchema: exampleResultSchema,
    can: async (tx, accountId, job, action) => {
      if (action !== 'read') return false;
      try {
        const { context } = await loadProjectContext(
          tx,
          accountId,
          createClock(getEnv().APP_ENV).today(),
        );
        const project = context.projects.find(
          (item) => item.id === job.resourceId,
        );
        return project !== undefined && canReadProject(context, project);
      } catch (error) {
        if (error instanceof ForbiddenError) return false;
        throw error;
      }
    },
    project: async (_tx, _accountId, job) => {
      const result =
        job.result === null ? null : exampleResultSchema.parse(job.result);
      return {
        result,
        progress:
          result === null
            ? null
            : { completed: result.units.length, total: result.units.length },
      };
    },
    inputVersion: async () => null,
    canResume: async () => false,
    enqueue: async () => {
      throw new Error('No example control action is authorized');
    },
  };
}
