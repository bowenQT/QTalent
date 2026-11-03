'use server';
import 'server-only';
import {
  publishSelectionRevisionResultSchema,
  returnSelectionRevisionResultSchema,
  saveSelectionRevisionResultSchema,
  selectionRevisionReadInputSchema,
  selectionRevisionReadResultSchema,
  submitSelectionRevisionResultSchema,
  undoSelectionPublicationResultSchema,
  withdrawSelectionRevisionResultSchema,
} from '../../contracts/selection-standard';
import { requireSession } from '../auth/next';
import { selectionLifecycle } from '../queries/rules';
import type { SelectionRevisionCommand } from '../usecases/selection-standard';

/* The selection-standard actions (BOW-918). The account is the session's; the
 * lifecycle re-checks role, cohort scope and revision numbers on every call. */
async function execute(
  action: SelectionRevisionCommand['action'],
  input: unknown,
) {
  const session = await requireSession();
  return selectionLifecycle().execute(session.user.id, { action, input });
}

export async function saveSelectionRevisionAction(input: unknown) {
  return saveSelectionRevisionResultSchema.parse(await execute('save', input));
}
export async function submitSelectionRevisionAction(input: unknown) {
  return submitSelectionRevisionResultSchema.parse(
    await execute('submit', input),
  );
}
export async function withdrawSelectionRevisionAction(input: unknown) {
  return withdrawSelectionRevisionResultSchema.parse(
    await execute('withdraw', input),
  );
}
export async function publishSelectionRevisionAction(input: unknown) {
  return publishSelectionRevisionResultSchema.parse(
    await execute('publish', input),
  );
}
export async function undoSelectionPublicationAction(input: unknown) {
  return undoSelectionPublicationResultSchema.parse(
    await execute('undo', input),
  );
}
export async function returnSelectionRevisionAction(input: unknown) {
  return returnSelectionRevisionResultSchema.parse(
    await execute('return', input),
  );
}
export async function readSelectionRevisionAction(input: unknown) {
  const { draftId } = selectionRevisionReadInputSchema.parse(input);
  const session = await requireSession();
  const page = await selectionLifecycle().readPage(session.user.id, draftId);
  if (page.status === 'forbidden')
    return selectionRevisionReadResultSchema.parse({
      status: 'forbidden',
      message: '当前账号无法读取这份修订',
    });
  if (page.status !== 'revision')
    return selectionRevisionReadResultSchema.parse({
      status: 'not_found',
      message: '这份修订已不在待处理状态',
    });
  return selectionRevisionReadResultSchema.parse({
    status: 'success',
    view: page.view,
  });
}
