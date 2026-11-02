import { materialUploadHandlersForServer } from '../../../../../server/queries/material-upload-runtime';

/** 材料投递：确认材料上传完成。同源、会话与权限都在服务端判断。 */
export async function POST(request: Request) {
  return materialUploadHandlersForServer().completeUpload(request);
}
