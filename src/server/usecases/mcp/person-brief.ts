import type { PersonData } from '../../queries/person-data';
import { quickViewFromData } from '../../queries/people';
import {
  completeTalentSources,
  intakeRows,
  sourceKey,
} from '../talent-source-projection';

/** PersonData carries the whole issued intake table (superseded rows and other
 * creators included); intakeRows refuses any table not issued by its reader.
 * completeTalentSources already applies the canonical intake union before this
 * extra MCP gate. */
export type McpPersonData = PersonData;

export async function mcpPersonBriefFromData(data: McpPersonData, id: string) {
  const intake = intakeRows(data.intake);
  const sources = completeTalentSources(data).filter((source) => {
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
    return intake.some(
      (input) =>
        input.inputSource && sourceKey(input.inputSource) === sourceKey(source),
    );
  });
  // Filtering precedes the single real projection: a suppressed source removes
  // its whole event and derived capability/quadrant contribution, not just URLs.
  return quickViewFromData(data, id, sources);
}
