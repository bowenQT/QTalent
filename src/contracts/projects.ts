import { z } from 'zod';

export const projectStatusSchema = z.enum([
  '筹备中',
  '进行中',
  '已结束',
  '已归档',
]);
export const createProjectInputSchema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().trim().min(1, '请输入项目名称'),
    type: z.enum(['业务项目', '专项', '黑客松', '训练营课题']),
    status: z.enum(['筹备中', '进行中']),
    goal: z
      .string()
      .trim()
      .transform((value) => value || '目标待补充'),
    ownerId: z.string().min(1).nullable(),
    memberIds: z
      .array(z.string().min(1))
      .refine((ids) => new Set(ids).size === ids.length, '成员不能重复'),
  })
  .strict();
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export const personOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  orgName: z.string(),
  hue: z.number(),
  currentProjectCount: z.number().int().nonnegative(),
});
export const projectCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: projectStatusSchema,
  goal: z.string(),
  orgName: z.string(),
  from: z.string(),
  to: z.string(),
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hue: z.number(),
      photo: z.string().nullable(),
    }),
  ),
  memberCount: z.number().int().nonnegative(),
});
export const projectListSchema = z.object({
  projects: z.array(projectCardSchema),
  eligiblePeople: z.array(personOptionSchema),
  canCreate: z.boolean(),
});
export type PersonOption = z.infer<typeof personOptionSchema>;
export type ProjectCard = z.infer<typeof projectCardSchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
export const createProjectResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    projectId: z.string(),
    replayed: z.boolean(),
  }),
  z.object({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    input: z.unknown(),
  }),
  z.object({
    status: z.enum(['forbidden', 'not_found', 'conflict']),
    message: z.string(),
  }),
]);
export type CreateProjectResult = z.infer<typeof createProjectResultSchema>;
