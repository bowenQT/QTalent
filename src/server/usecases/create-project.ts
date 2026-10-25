import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { CreateProjectInput } from '../../contracts/projects';
import { canCreateProject, canReadFullPerson, canReadProject } from '../authz';
import { loadProjectContext, ForbiddenError } from './project-context';
import { insertProject, readCreateRequest } from '../modules/staffing';
import { normalizeMembers, fingerprintSubmission } from '../modules/staffing';
import { recordAudit } from '../platform/audit';
export class ConflictError extends Error {
  constructor(
    message = '同一提交编号不能用于不同内容',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConflictError';
  }
}
export async function createProject(
  db: Database,
  accountId: string,
  input: CreateProjectInput,
  today: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(
        async (tx) => {
          // Serialize retries before taking a fresh authorization snapshot; a retry must never bypass revocation.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${accountId + ':' + input.requestId},0))`,
          );
          const { context } = await loadProjectContext(tx, accountId, today);
          if (!canCreateProject(context)) throw new ForbiddenError();
          const fingerprint = fingerprintSubmission(input);
          const existing = await readCreateRequest(
            tx,
            accountId,
            input.requestId,
          );
          if (existing) {
            if (existing.fingerprint !== fingerprint) throw new ConflictError();
            const project = context.projects.find(
              (p) => p.id === existing.projectId,
            );
            if (!project || !canReadProject(context, project))
              throw new ForbiddenError();
            return { projectId: existing.projectId, replayed: true };
          }
          if (
            normalizeMembers(input.ownerId, input.memberIds).some(
              (id) => !canReadFullPerson(context, id),
            )
          )
            throw new ForbiddenError();
          const projectId = await insertProject(
            tx,
            input,
            { accountId, personId: context.account.personId },
            today,
            fingerprint,
          );
          await recordAudit(tx, {
            actorId: accountId,
            action: 'project.create',
            resourceId: projectId,
          });
          return { projectId, replayed: false };
        },
        { isolationLevel: 'serializable' },
      );
    } catch (error) {
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        (cause.code === '40001' ||
          (cause.code === '23505' &&
            'constraint' in cause &&
            cause.constraint === 'staffing_request_account_key_idx'))
      ) {
        if (attempt < 2) continue;
        throw new ConflictError('数据已变化，请重试', { cause: error });
      }
      throw error;
    }
  }
}
