import { createHash } from 'node:crypto';
export function normalizeMembers(
  ownerId: string | null,
  memberIds: string[],
): string[] {
  return [...new Set([...(ownerId ? [ownerId] : []), ...memberIds])];
}
export function fingerprintSubmission(input: {
  name: string;
  type: string;
  status: string;
  goal: string;
  ownerId: string | null;
  memberIds: string[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: input.name,
        type: input.type,
        status: input.status,
        goal: input.goal,
        ownerId: input.ownerId,
        memberIds: [...new Set(input.memberIds)].sort(),
      }),
    )
    .digest('hex');
}
