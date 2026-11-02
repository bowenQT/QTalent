import {
  uploadRequestSchema,
  type UploadRequest,
} from '../../../../contracts/media';
import type { UploadTransaction } from './types';

export interface UploadWriteSubject {
  evaluationNodeId: string;
  personId: string;
}
export interface UploadWriteContext {
  account: { id: string; isSystemAdmin: boolean };
  now: string;
}
export interface UploadWriteSnapshot<C extends UploadWriteContext> {
  context: C;
  /** Server-resolved event participants/record subjects and canonical nodes. */
  target: UploadRequest['target'];
  subjects: UploadWriteSubject[];
  complete: boolean;
}
export interface UploadTargetAuthorization<C extends UploadWriteContext> {
  /** Business clock, separate from the credential/ticket security clock. */
  authorizationNow(): string;
  loadWriteSnapshot(
    accountId: string,
    target: UploadRequest['target'],
    at: string,
    tx: UploadTransaction,
  ): Promise<UploadWriteSnapshot<C> | null>;
  /** Compose fixed BOW-899 canEvaluateNode and the server's explicit 835/846
   * staff record-WRITE policy. Read access is never a substitute or default.
   */
  canWriteNode(
    context: C,
    subject: UploadWriteSubject,
  ): boolean | Promise<boolean>;
}
function identity(target: UploadRequest['target']) {
  return JSON.stringify(
    target.kind === 'people'
      ? { kind: target.kind, personIds: [...target.personIds].sort() }
      : { kind: target.kind, eventId: target.eventId },
  );
}
/** Only resolves the legacy record target. Material/unassigned intake has a
 * separate frozen contract and cannot borrow a person/node write permission.
 */
export function createUploadTargetAuthorizer<C extends UploadWriteContext>(
  deps: UploadTargetAuthorization<C>,
) {
  return async (
    accountId: string,
    raw: unknown,
    tx: UploadTransaction,
  ): Promise<boolean> => {
    const input = uploadRequestSchema.shape.target.safeParse(raw);
    if (!accountId || !input.success) return false;
    const at = deps.authorizationNow();
    if (!Number.isFinite(Date.parse(at))) return false;
    const snapshot = await deps.loadWriteSnapshot(
      accountId,
      input.data,
      at,
      tx,
    );
    if (
      !snapshot ||
      !snapshot.complete ||
      snapshot.context.account.id !== accountId ||
      snapshot.context.account.isSystemAdmin ||
      Date.parse(snapshot.context.now) !== Date.parse(at) ||
      identity(snapshot.target) !== identity(input.data) ||
      !snapshot.subjects.length
    )
      return false;
    const keys = snapshot.subjects.map((subject) =>
      JSON.stringify([subject.evaluationNodeId, subject.personId]),
    );
    if (
      new Set(keys).size !== keys.length ||
      snapshot.subjects.some(
        (subject) =>
          !subject.evaluationNodeId.trim() || !subject.personId.trim(),
      )
    )
      return false;
    if (input.data.kind === 'people') {
      const resolved = new Set(
        snapshot.subjects.map((subject) => subject.personId),
      );
      if (
        resolved.size !== input.data.personIds.length ||
        input.data.personIds.some((personId) => !resolved.has(personId))
      )
        return false;
    }
    for (const subject of snapshot.subjects)
      if (!(await deps.canWriteNode(snapshot.context, subject))) return false;
    return true;
  };
}
