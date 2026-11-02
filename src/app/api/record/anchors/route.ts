import { readRecordAnchorsAction } from '../../../../server/actions/record-batch';
import { readResponse } from '../read-response';

/** 记录页按草稿冻结的规则版本读锚点：`?ruleVersion=` 可重复。 */
export async function GET(request: Request) {
  const ruleVersions = new URL(request.url).searchParams.getAll('ruleVersion');
  return readResponse(() => readRecordAnchorsAction({ ruleVersions }));
}
