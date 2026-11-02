import type { SourceViewerPorts } from '@/features/sources/viewer-ports';
import { readSourceForCurrentUser } from '@/server/queries/sources';

/**
 * 原件查看页现在接通的读取。材料出处（BOW-866 / 873，#189、#186）和原件读取（BOW-873
 * 的授权读取票据，#186）合入后在这里接上，页面与查看器不用改。
 */
export const viewerPorts: SourceViewerPorts = {
  readSource: readSourceForCurrentUser,
  readMaterialSource: null,
  openOriginal: null,
};
