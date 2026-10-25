import { createHash } from 'node:crypto';
import type { Source, SourceReference } from '../../../../contracts/sources';
import type { StaffingDemand } from '../../../../contracts/staffing';
import type { EvidenceUnit, ScopedCandidate } from './types';
import { JEV_PROMPT_VERSION } from '../../../integrations/jev';

export const MATCH_INPUT_VERSION = 'staffing-match-input-v1';
export function referenceKey(source: SourceReference): string {
  const location = source.location;
  return JSON.stringify([
    source.fragmentId,
    source.originalVersionId,
    location.kind === 'document'
      ? [location.kind, location.page ?? null, location.paragraph]
      : location.kind === 'spreadsheet'
        ? [location.kind, location.sheet, location.cell]
        : location.kind === 'recording'
          ? [location.kind, location.startMs, location.endMs]
          : [
              location.kind,
              location.fieldPath,
              location.originalLocation ?? null,
            ],
  ]);
}
export const sourceKey = (source: Source) =>
  JSON.stringify([
    referenceKey(source),
    source.excerpt,
    source.sourceCategory,
    source.sourceType,
    source.demo,
    source.sourceCategory === 'prototype_baseline'
      ? source.displayNotice
      : null,
  ]);
export const evidenceKey = (unit: EvidenceUnit) =>
  JSON.stringify([
    unit.eventId,
    unit.personId,
    unit.nature,
    unit.situation,
    unit.behavior,
    unit.impact,
    sourceKey(unit.source),
  ]);
export function demandInputVersion(demand: StaffingDemand): string {
  return createHash('sha256')
    .update(JSON.stringify([MATCH_INPUT_VERSION, JEV_PROMPT_VERSION, demand]))
    .digest('hex');
}
/** Structured scope is existing authorized data, never fabricated identity or model rationale. */
export function matchingInput(
  demand: StaffingDemand,
  requirement: StaffingDemand['requirements'][number],
  candidate: ScopedCandidate,
) {
  return {
    requirement: JSON.stringify({
      inputFormatVersion: MATCH_INPUT_VERSION,
      demandId: demand.id,
      demandRevision: demand.revision,
      personId: candidate.person.id,
      personName: candidate.person.name,
      requirementId: requirement.id,
      requirement: requirement.text,
    }),
    evidence: candidate.evidence.map((unit) => ({
      sourceRef: JSON.stringify([unit.eventId, referenceKey(unit.source)]),
      text: JSON.stringify({
        personId: unit.personId,
        nature: unit.nature,
        situation: unit.situation,
        behavior: unit.behavior,
        impact: unit.impact,
        excerpt: unit.source.excerpt,
      }),
    })),
  };
}
