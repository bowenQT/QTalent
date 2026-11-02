import { readRecordBatchAction } from '../../../../../server/actions/record-batch';
import { readResponse } from '../../read-response';

type Context = { params: Promise<{ batchId: string }> };

/** 记录页读取批次（整理进度、撤销后核实现状、载入最新版本）。 */
export async function GET(_request: Request, context: Context) {
  const { batchId } = await context.params;
  return readResponse(() => readRecordBatchAction({ batchId }));
}
