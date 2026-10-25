'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import {
  createProjectInputSchema,
  type CreateProjectResult,
} from '../../contracts/projects';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { createProject, ConflictError } from '../usecases/create-project';
import { ForbiddenError } from '../usecases/project-context';
import { createClock } from '../../lib/clock';
import { getEnv } from '../env';
export async function createProjectAction(
  input: unknown,
): Promise<CreateProjectResult> {
  const parsed = createProjectInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'validation_error', fieldErrors, input };
  }
  const session = await requireSession();
  try {
    const result = await createProject(
      getDatabase(),
      session.user.id,
      parsed.data,
      createClock(getEnv().APP_ENV).today(),
    );
    revalidatePath('/projects');
    return { status: 'success', ...result };
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'forbidden', message: '你没有执行此操作的权限' };
    if (
      error instanceof ConflictError ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '40001')
    )
      return { status: 'conflict', message: '数据已变化，请重试' };
    throw error;
  }
}
