import type { Pool } from 'pg';
import type { StaffingDemand } from '../../src/contracts/staffing';
import { DEMAND_PROMPT_VERSION } from '../../src/server/modules/staffing/demand/prompt';

/**
 * Writes a finished demand into the isolated test database, as BOW-852's drafting job
 * would after the model answered: browser checks run without a worker or a model, so
 * the drafted (and possibly confirmed) versions are written directly. Synthetic data
 * only; `versions` are the demand's revisions in order, the last one current.
 */
export async function seedDemand(pool: Pool, versions: StaffingDemand[]) {
  const first = versions[0];
  const current = versions[versions.length - 1];
  const at = '2026-09-01T02:00:00.000Z';
  await pool.query(
    `INSERT INTO staffing_demands (id, project_id, initiator_account_id, initiator_person_id, input_text, created_at, current_revision, prompt_version)
     VALUES ($1, $2, 'e2e-synthetic-initiator', 'p-suwan', $3, $4, $5, $6)`,
    [
      first.id,
      first.projectId,
      first.inputText,
      at,
      current.revision,
      DEMAND_PROMPT_VERSION,
    ],
  );
  for (const version of versions)
    await pool.query(
      `INSERT INTO staffing_demand_versions (demand_id, revision, demand, prompt_version, model_metadata, actor_account_id, created_at)
       VALUES ($1, $2, $3, $4, $5, 'e2e-synthetic-initiator', $6)`,
      [
        version.id,
        version.revision,
        JSON.stringify(version),
        DEMAND_PROMPT_VERSION,
        JSON.stringify({ synthetic: true }),
        at,
      ],
    );
}

/** A drafted demand and its confirmed revision, from one confirmed sample demand. */
export function draftThenConfirmed(
  confirmed: Extract<StaffingDemand, { status: 'confirmed' }>,
): StaffingDemand[] {
  const draft: StaffingDemand = {
    id: confirmed.id,
    projectId: confirmed.projectId,
    revision: confirmed.revision - 1,
    inputText: confirmed.inputText,
    requirements: confirmed.requirements,
    status: 'draft',
  };
  return [draft, confirmed];
}
