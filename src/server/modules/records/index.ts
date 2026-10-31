/** Events have one evaluated person. Participants and shared source fragments never imply a score. */
export {
  historicalEvaluations,
  historicalParticipants,
  originals,
  originalVersions,
  fragments,
  events,
  eventParticipants,
  eventSources,
  statements,
  importSnapshots,
} from './schema';
export type { SourceLocation } from './schema';
export { readEvidenceForTalent } from './read';
export { parseOfficeBytes } from './office/parse';
export { OfficeParseError } from './office/types';
export type {
  ParsedOffice,
  OfficeFragment,
  OfficeLocation,
  OfficeCellContent,
  OfficeScalar,
  OfficeParseFailure,
} from './office/types';
