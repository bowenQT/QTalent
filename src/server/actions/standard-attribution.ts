'use server';
import 'server-only';
import {
  confirmStandardAttributionResultSchema,
  generateStandardHypothesesResultSchema,
} from '../../contracts/standard-attribution';
import { createSelectionRevisionResultSchema } from '../../contracts/selection-standard';
import { requireSession } from '../auth/next';
import { selectionLifecycle } from '../queries/rules';
import { standardAttributionApp } from '../queries/standard-attribution';

/* The attribution actions on /judge (BOW-921). The account is the session's;
 * batch scope, citations and revisions are re-checked on every call. */
export async function generateStandardHypothesesAction(input: unknown) {
  const session = await requireSession();
  return generateStandardHypothesesResultSchema.parse(
    await standardAttributionApp().generateHypotheses(session.user.id, input),
  );
}

export async function confirmStandardAttributionAction(input: unknown) {
  const session = await requireSession();
  return confirmStandardAttributionResultSchema.parse(
    await standardAttributionApp().confirmAttribution(session.user.id, input),
  );
}

/**
 * Drafting a revision from a signed attribution: the AI proposal (921) becomes
 * the draft's untouched original (918). When the model gives no proposal the
 * draft starts empty and HR writes the changes; the attribution is the same.
 */
export async function createSelectionRevisionAction(input: unknown) {
  const session = await requireSession();
  const lifecycle = selectionLifecycle();
  const proposal = await standardAttributionApp().draftSelectionProposal(
    session.user.id,
    input,
  );
  if (proposal.status === 'success')
    return createSelectionRevisionResultSchema.parse(
      await lifecycle.adoptProposal(session.user.id, proposal.result.id, input),
    );
  if (proposal.status !== 'model_failed')
    return createSelectionRevisionResultSchema.parse(proposal);
  return createSelectionRevisionResultSchema.parse(
    await lifecycle.execute(session.user.id, { action: 'create', input }),
  );
}
