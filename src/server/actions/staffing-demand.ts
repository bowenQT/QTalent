'use server';
import 'server-only';
import { requireSession } from '../auth/next';
import {
  createStaffingDemandInputSchema, editStaffingDemandInputSchema,
  confirmStaffingDemandInputSchema, staffingCreateDemandResultSchema, staffingDemandResultSchema,
} from '../../contracts/staffing';
import { staffingDemandRuntime } from '../queries/staffing-runtime';
import { DemandAccessError } from '../modules/staffing/demand/service';
import { DemandConflictError } from '../modules/staffing/demand/version';
import type { z } from 'zod';

function invalid(input: unknown, error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { status: 'validation_error' as const, fieldErrors, input };
}
function rejected(error: unknown, input: unknown) {
  if (error instanceof DemandAccessError)
    return { status: 'forbidden' as const, message: '你没有执行此操作的权限', input };
  if (error instanceof DemandConflictError)
    return { status: 'conflict' as const, message: '需求已变化，请保留输入并刷新', input };
  throw error;
}
export async function createStaffingDemandAction(input: unknown) {
  const parsed = createStaffingDemandInputSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  const session = await requireSession();
  try {
    const runtime = await staffingDemandRuntime();
    return staffingCreateDemandResultSchema.parse({
      status: 'success', ...await runtime.service.create(session.user.id, parsed.data),
    });
  } catch (error) {
    return staffingCreateDemandResultSchema.parse(rejected(error, parsed.data));
  }
}
export async function editStaffingDemandAction(input: unknown) {
  const parsed = editStaffingDemandInputSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  const session = await requireSession();
  try {
    const runtime = await staffingDemandRuntime();
    return staffingDemandResultSchema.parse({ status: 'success',
      ...await runtime.service.change(session.user.id, parsed.data,
        { action: 'edit', requirements: parsed.data.requirements }),
    });
  } catch (error) { return staffingDemandResultSchema.parse(rejected(error, parsed.data)); }
}
export async function confirmStaffingDemandAction(input: unknown) {
  const parsed = confirmStaffingDemandInputSchema.safeParse(input);
  if (!parsed.success) return invalid(input, parsed.error);
  const session = await requireSession();
  try {
    const runtime = await staffingDemandRuntime();
    return staffingDemandResultSchema.parse({ status: 'success',
      ...await runtime.service.change(session.user.id, parsed.data, { action: 'confirm' }),
    });
  } catch (error) { return staffingDemandResultSchema.parse(rejected(error, parsed.data)); }
}
