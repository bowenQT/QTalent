import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import type { CreateProjectInput } from '../../../contracts/projects';
import { projects, members, memberLogs, createRequests } from './schema';
import { normalizeMembers } from './create-policy';
export async function readStaffing(db: DbExecutor) {
  return {
    projects: await db
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder), asc(projects.id)),
    members: await db.select().from(members),
  };
}
export async function readCreateRequest(
  db: DbExecutor,
  accountId: string,
  requestId: string,
) {
  return (
    await db
      .select()
      .from(createRequests)
      .where(
        and(
          eq(createRequests.accountId, accountId),
          eq(createRequests.requestId, requestId),
        ),
      )
  )[0];
}
export async function insertProject(
  db: DbExecutor,
  input: CreateProjectInput,
  actor: { accountId: string; personId: string },
  today: string,
  fingerprint: string,
) {
  const id = randomUUID();
  await db.insert(projects).values({
    id,
    name: input.name,
    type: input.type,
    status: input.status,
    goal: input.goal || '目标待补充',
    organizationId: 'xe6',
    cohortId: 'b-xe6',
    isTopic: false,
    ownerId: input.ownerId,
    creatorId: actor.personId,
    from: today,
    to: '2026-12-31',
    sortOrder: -1,
  });
  const memberIds = normalizeMembers(input.ownerId, input.memberIds);
  if (memberIds.length)
    await db.insert(members).values(
      memberIds.map((personId) => ({
        id: randomUUID(),
        projectId: id,
        personId,
        role: personId === input.ownerId ? 'owner' : '成员',
        mode: '兼职',
        validFrom: today,
        validTo: null,
        by: actor.personId,
      })),
    );
  await db.insert(memberLogs).values({
    id: randomUUID(),
    projectId: id,
    at: today,
    text: '项目创建',
    by: actor.personId,
  });
  await db.insert(createRequests).values({
    id: randomUUID(),
    accountId: actor.accountId,
    requestId: input.requestId,
    fingerprint,
    projectId: id,
  });
  return id;
}
export { projects, members, memberLogs, createRequests } from './schema';

export { normalizeMembers, fingerprintSubmission } from './create-policy';
export { createDemandService, DemandAccessError } from './demand/service';
export { demandJobPolicy, runDemandGeneration } from './demand/job';
