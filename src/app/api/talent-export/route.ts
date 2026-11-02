import { downloadTalentExport } from '../../../server/queries/talent-export';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return downloadTalentExport(request);
}
