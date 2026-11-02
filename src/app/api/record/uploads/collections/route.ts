import { materialUploadHandlersForServer } from '../../../../../server/queries/material-upload-runtime';

/** 材料投递：建未分配暂存集合。同源、会话与权限都在服务端判断。 */
export async function POST(request: Request) {
  return materialUploadHandlersForServer().createCollection(request);
}
