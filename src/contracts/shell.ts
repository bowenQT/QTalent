import { z } from 'zod';
export const navigationIdSchema = z.enum([
  'work',
  'people',
  'review',
  'queue',
  'programs',
  'projects',
  'rules',
  'judge',
  'tags',
  'admin',
]);
export type NavigationId = z.infer<typeof navigationIdSchema>;
export const shellSchema = z.object({
  account: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    roles: z.array(z.string()),
    hue: z.number(),
    roleLabel: z.string(),
    scopeLabel: z.string(),
  }),
  navigation: z.array(
    z.object({
      id: navigationIdSchema,
      label: z.string(),
      href: z.string(),
      icon: z.string(),
      group: z.string().nullable(),
    }),
  ),
  counts: z.object({ status: z.literal('not_connected') }),
  recent: z.object({ status: z.literal('not_connected') }),
  canSearch: z.boolean(),
  isAdmin: z.boolean(),
  role: z.enum(['manager', 'hr', 'mentor', 'admin']),
});
export type Shell = z.infer<typeof shellSchema>;

export type ShellData = Shell;
