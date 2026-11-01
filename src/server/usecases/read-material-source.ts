import 'server-only';
import {
  sourceReadInputSchema,
  type MaterialSourceReadResult,
} from '../../contracts/sources';
import type { Database } from '../db/client';
import { readAuthorizedMaterialSource } from '../modules/records';
import {
  loadPersonDataInTransaction,
  talentSources,
  sourceKey,
} from '../queries/person-data';
import { recordAudit } from '../platform/audit';
import { ForbiddenError } from './project-context';

/** accountId is the authenticated server session identity, never a request field.
 * No caller-supplied locator, graph, actor or permission decision is accepted. */
export async function readMaterialSource(
  db: Database,
  accountId: string,
  input: unknown,
  now: () => string = () => new Date().toISOString(),
): Promise<MaterialSourceReadResult> {
  const reference = sourceReadInputSchema.safeParse(input);
  if (!reference.success)
    return {
      status: 'validation_error',
      fieldErrors: { source: ['请提供有效的片段和原件版本'] },
      input: null,
    };
  try {
    return await db.transaction(
      async (tx) => {
        const data = await loadPersonDataInTransaction(tx, accountId, now());
        const result = await readAuthorizedMaterialSource(
          tx,
          {
            context: data.context,
            sources: talentSources(data),
          },
          reference.data,
        );
        if (result.status === 'success')
          await recordAudit(tx, {
            actorId: data.context.account.id,
            action: 'source.read',
            resourceId: sourceKey(reference.data),
          });
        return result;
      },
      { isolationLevel: 'repeatable read' },
    );
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'forbidden', message: '当前账号没有业务读取权限' };
    return { status: 'conflict', message: '来源暂时不可用，请稍后重试' };
  }
}
