'use server';
import 'server-only';
import { requireSession } from '../auth/next';
import { parsedAttachmentRequestsForServer } from '../usecases/parsed-attachment-runtime';

/** Existing strict897 attribution commands, not a scope capture/approval API. */
export async function resolveMaterialPersonReviewAction(input: unknown) {
  const session = await requireSession();
  return parsedAttachmentRequestsForServer().resolve(session.user.id, input);
}
export async function undoMaterialPersonReviewAction(input: unknown) {
  const session = await requireSession();
  return parsedAttachmentRequestsForServer().undo(session.user.id, input);
}
