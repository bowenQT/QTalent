import { z } from 'zod';
import {
  comparisonReadInputSchema,
  type ComparisonReadResult,
} from '@/contracts/judgment-comparison';
import { projectComparison } from './projection';
import { ComparisonInputError, type ComparisonReadPorts } from './ports';

export async function readJudgmentComparison(
  input: unknown,
  ports: ComparisonReadPorts,
): Promise<ComparisonReadResult> {
  const parsed = comparisonReadInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      fieldErrors: { input: ['请检查批次与评价人参数'] },
      input,
    };
  // Resolve each time. Neither audience, grants nor clock come from the caller.
  const access = await ports.loadCurrentAccess();
  if (
    !access ||
    (access.audience === 'rater' &&
      parsed.data.evaluatorId !== undefined &&
      parsed.data.evaluatorId !== access.viewerId) ||
    (access.audience === 'manager' && parsed.data.evaluatorId !== undefined)
  )
    return { status: 'forbidden', message: '当前账号无法读取此范围' };
  const data = await ports.loadBatch(parsed.data.batchId, access);
  if (!data) return { status: 'not_found', message: '未找到可读取的对照批次' };
  if (data.batch.id !== parsed.data.batchId)
    return { status: 'not_found', message: '未找到可读取的对照批次' };
  try {
    return {
      status: 'success',
      page: projectComparison(data, access, parsed.data.evaluatorId),
    };
  } catch (error) {
    if (error instanceof ComparisonInputError || error instanceof z.ZodError)
      return {
        status: 'validation_error',
        fieldErrors: { batch: ['对照事实或对应表待核对'] },
        input,
      };
    throw error;
  }
}
