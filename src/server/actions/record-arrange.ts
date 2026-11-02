'use server';
import 'server-only';
import { requireSession } from '../auth/next';
import { recordArrangeRequestsForServer } from '../usecases/record-arrange-runtime';

export async function startRecordArrangeAction(input: unknown) {
  const session = await requireSession();
  return recordArrangeRequestsForServer().create(session.user.id, input);
}
export async function selectRecordArrangePeopleAction(input: unknown) {
  const session = await requireSession();
  return recordArrangeRequestsForServer().select(session.user.id, input);
}
