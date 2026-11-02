'use server';
import 'server-only';
import { headers } from 'next/headers';
import { jobAccount } from '../jobs/request';
import {
  talentExportService,
  talentExportFailure,
  readConfirmedPersonExportForCurrentUser,
} from '../queries/talent-export';
import type { ExportOutcome } from '../usecases/talent-export/types';
/** Structural match for BOW-841 ExportPort.generate(scopeId, range). */
export async function generateTalentExportAction(
  scopeId: unknown,
  range: unknown,
): Promise<ExportOutcome> {
  try {
    const h = await headers(),
      accountId = await jobAccount(h);
    if (!accountId) return { status: 'denied' };
    const file = await talentExportService().generate(accountId, {
      scopeId,
      range,
    });
    if ((await jobAccount(h)) !== accountId) return { status: 'denied' };
    if (!file) return { status: 'empty' };
    return {
      status: 'done',
      people: file.projection.people,
      rows: file.projection.rows,
      at: file.at,
      href:
        '/api/talent-export?' +
        new URLSearchParams({
          scopeId: file.projection.scopeId,
          range: file.projection.range,
        }),
      fileName: file.fileName,
    };
  } catch (error) {
    return talentExportFailure(error);
  }
}

/** Current authentication, permissions and review exclusion are rechecked.
 * No persistent file, token or complete PersonPrintSheet is fabricated here. */
export async function preparePersonPrintContentAction(personId: unknown) {
  return readConfirmedPersonExportForCurrentUser(personId);
}
