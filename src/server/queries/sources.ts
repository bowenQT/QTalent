import 'server-only';
import { getDatabase } from '../db/client';
import { recordAudit } from '../platform/audit';
import {
  sourceReadInputSchema,
  type SourceReadResult,
} from '../../contracts/sources';
import { ForbiddenError } from '../usecases/project-context';
import { sourceKey } from './person-data';
import { sourceFromData } from '../usecases/source-projection';
export {
  sourceFromData,
  projectReadableSources,
  type SourceData,
} from '../usecases/source-projection';
import { loadCurrentPersonData } from './person-session';

export async function readSourceForCurrentUser(
  input: unknown,
): Promise<SourceReadResult> {
  const parsed = sourceReadInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      fieldErrors: { source: ['请提供有效的片段和原件版本'] },
      input,
    };
  try {
    const data = await loadCurrentPersonData();
    const result = await sourceFromData(data, parsed.data);
    if (result.status === 'success')
      await recordAudit(getDatabase(), {
        actorId: data.context.account.id,
        action: 'source.read',
        resourceId: sourceKey(parsed.data),
      });
    return result;
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'forbidden', message: '当前账号没有业务读取权限' };
    throw error;
  }
}
