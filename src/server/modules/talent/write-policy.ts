import { activeGrants, type AuthzContext } from '../../authz';
import { canReadTalent, type TalentSubject } from '../../authz/talent';

export type ConfirmationReviewReason =
  | 'ai_changed_without_reason'
  | 'score_gap';

/** Only already-authorized, active confirmations from the same event/dimension. */
export function confirmationReviewReasons(input: {
  value: number | null;
  aiValue: number | null;
  reason: string;
  evaluatorId: string;
  peers: { evaluatorId: string; value: number | null }[];
}): ConfirmationReviewReason[] {
  if (input.value === null) return [];
  const value = input.value;
  const reasons: ConfirmationReviewReason[] = [];
  if (
    input.aiValue !== null &&
    Math.abs(value - input.aiValue) >= 2 &&
    input.reason.trim() === ''
  ) {
    reasons.push('ai_changed_without_reason');
  }
  if (
    input.peers.some(
      (peer) =>
        peer.evaluatorId !== input.evaluatorId &&
        peer.value !== null &&
        Math.abs(value - peer.value) >= 2,
    )
  ) {
    reasons.push('score_gap');
  }
  return reasons;
}

/** Read access alone is not write access; each complete HR/mentor grant is checked. */
export function canConfirmOwnScore(
  context: AuthzContext,
  subject: TalentSubject,
  evaluatorId: string,
): boolean {
  if (context.account.personId !== evaluatorId) return false;
  return activeGrants(context).some(
    (grant) =>
      (grant.role === 'hr' || grant.role === 'mentor') &&
      canReadTalent(
        { ...context, grants: [grant] },
        { ...subject, kind: 'confirmed-score' },
        'person-profile',
      ),
  );
}

/** Server time only; reaching the deadline means the undo window has expired. */
export function isUndoWindowOpen(savedAt: number, now: number): boolean {
  return (
    Number.isFinite(savedAt) &&
    Number.isFinite(now) &&
    savedAt <= now &&
    now < savedAt + 5_000
  );
}
