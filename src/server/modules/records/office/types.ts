/** Narrow extraction locators from BOW-897, not an authorization/source DTO. */
export const officeLocationContractSha =
  '0b20a913621121848219e0966ba4bf4844d1bdb3';
export type OfficeLocation =
  | { kind: 'presentation'; slide: number }
  | { kind: 'spreadsheet'; sheet: string; cell: string };
export type OfficeScalar =
  | { type: 'number' | 'text' | 'date' | 'error'; value: string; raw: string }
  | { type: 'boolean'; value: boolean; raw: string };
export type OfficeCellContent =
  | { kind: 'constant'; value: OfficeScalar }
  | {
      kind: 'formula';
      expression: string;
      formulaType: string;
      sharedIndex: string | null;
      range: string | null;
      cached: { state: 'present'; value: OfficeScalar } | { state: 'missing' };
    };
export type OfficeFragment =
  | {
      kind: 'slide_text' | 'speaker_notes';
      text: string;
      location: { kind: 'presentation'; slide: number };
    }
  | {
      kind: 'cell';
      text: string | null;
      location: { kind: 'spreadsheet'; sheet: string; cell: string };
      hidden: boolean;
      content: OfficeCellContent;
    };
export type ParsedOffice = {
  format: 'pptx' | 'xlsx';
  inputSha256: string;
  locationContractSha: typeof officeLocationContractSha;
  attribution: 'unresolved';
  fragments: OfficeFragment[];
};
export type OfficeParseFailure =
  | 'unsupported_format'
  | 'invalid_document'
  | 'unsupported_content'
  | 'limit_exceeded'
  | 'cancelled';
export class OfficeParseError extends Error {
  constructor(
    readonly kind: OfficeParseFailure,
    readonly reason: string,
    readonly location?: OfficeLocation,
  ) {
    super(`Office parsing failed: ${kind} (${reason})`);
  }
}
