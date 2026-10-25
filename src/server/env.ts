import { z } from 'zod';
const environmentSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'demo', 'production']),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (value) => /^postgres(?:ql)?:/.test(value),
        'PostgreSQL URL required',
      ),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    DEMO_PASSWORD: z.string().min(12).optional(),
    WORKER_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
    ACCESS_ENFORCED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    ACCESS_ISSUER: z.string().url().optional(),
    ACCESS_AUDIENCE: z.string().min(1).optional(),
    QINIU_MAAS_API_KEY: z
      .string()
      .regex(/^[^\s]+$/)
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      ['demo', 'production'].includes(value.APP_ENV) &&
      !value.ACCESS_ENFORCED
    )
      context.addIssue({
        code: 'custom',
        path: ['ACCESS_ENFORCED'],
        message: 'Access is mandatory outside local/test environments',
      });
    if (value.ACCESS_ENFORCED) {
      if (!value.ACCESS_AUDIENCE)
        context.addIssue({
          code: 'custom',
          path: ['ACCESS_AUDIENCE'],
          message: 'Access audience required',
        });
      if (
        !value.ACCESS_ISSUER ||
        !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
          value.ACCESS_ISSUER,
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['ACCESS_ISSUER'],
          message: 'Canonical HTTPS Access team issuer required',
        });
    }
  });
export function parseEnv(input: Record<string, string | undefined>) {
  return environmentSchema.parse(input);
}
export function getEnv() {
  return parseEnv(process.env);
}
