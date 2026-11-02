import { readRecordSourceAction } from '../../../../server/actions/record-batch';
import { readResponse } from '../read-response';

/** 记录页打开引用的原文：只带片段和原件版本两个标识，位置由服务端解析。 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return readResponse(() =>
    readRecordSourceAction({
      fragmentId: params.get('fragmentId'),
      originalVersionId: params.get('originalVersionId'),
    }),
  );
}
