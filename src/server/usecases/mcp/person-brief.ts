import type { PersonData } from '../../queries/person-data';
import { quickViewFromData } from '../../queries/people';
import { talentSources, sourceKey } from '../talent-source-projection';
import type { StoredArrangeInput } from '../../modules/records';
import { EntryUsecaseError } from '../entry/context';

/** The native reader must provide ALL intake rows, including superseded rows
 * and other creators. Never pass a person-filtered graph or a client inventory.
 * talentSources includes the canonical intake union before this extra MCP gate.
 */
export type McpPersonData = PersonData & { intakeInputs: StoredArrangeInput[] };

export async function mcpPersonBriefFromData(data: McpPersonData, id: string) {
  if (!Array.isArray(data.intakeInputs))
    throw new EntryUsecaseError('unavailable');
  const sources = talentSources(data).filter((source) => {
    // HR's Web permission does not authorize personnel material to leave via MCP.
    if ([source.kind, ...(source.requiredKinds ?? [])].includes('performance'))
      return false;
    const version = data.versions.find(
      (row) => row.id === source.originalVersionId,
    );
    const original = data.originals.find(
      (row) => row.id === version?.originalId,
    );
    if (!original || !source.subjects.length) return false;
    if (original.kind === 'prototype_snapshot') {
      // The shared graph rejects unknown historical kinds and sourceFromData
      // checks demo provenance. Do not classify arbitrary original titles.
      return true;
    }
    // An unclassified ordinary original is not proved safe by a readable event.
    // Current native text intake carries the server-owned source nature; the
    // canonical union also validates its digest, binding and complete subjects.
    return data.intakeInputs.some(
      (input) =>
        input.inputSource && sourceKey(input.inputSource) === sourceKey(source),
    );
  });
  // Filtering precedes the single real projection: a suppressed source removes
  // its whole event and derived capability/quadrant contribution, not just URLs.
  return quickViewFromData(data, id, sources);
}
