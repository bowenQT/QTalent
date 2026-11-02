import { materialUploadHandlersForServer } from '../../../../server/queries/material-upload-runtime';

/** 材料投递：申请材料直传凭证。同源、会话与权限都在服务端判断。 */
export async function POST(request: Request) {
  return materialUploadHandlersForServer().requestUpload(request);
}
