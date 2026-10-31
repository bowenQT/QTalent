/** Unrotated page coordinates in PDF points, with the origin at the top left. */
export type PdfBox = readonly [number, number, number, number];
export type PdfRegion = { page: number; box: PdfBox };
export type PdfText = { text: string; box: PdfBox };
export type PdfCircle = {
  box: PdfBox;
  color: 'blue' | 'neutral' | 'other';
  filled: boolean;
  supported: boolean;
};
export type PdfLayoutPage = {
  page: number;
  width: number;
  height: number;
  text: PdfText[];
  circles: PdfCircle[];
};

export type ReadField = { value: string; sources: PdfRegion[] } | null;
export type Selection =
  | { status: 'recognized'; value: string; source: PdfRegion }
  | {
      status: 'unrecognized';
      reason:
        | 'missing_selection'
        | 'multiple_selections'
        | 'options_mismatch'
        | 'unsupported_graphics'
        | 'applicability_unknown';
      source: PdfRegion;
    }
  | { status: 'not_applicable'; reason: 'non_management_position' };

export type ParsedInterviewReview = {
  template: string;
  templateFingerprint: 'bow-896-synthetic-v1';
  demo: true;
  templateSource: PdfRegion;
  metadata: {
    interviewTime: ReadField;
    interviewType: ReadField;
    interviewer: ReadField;
    interviewResult: ReadField;
    overallComment: ReadField;
  };
  dimensions: { name: string; selection: Selection }[];
  interviewRating: Selection;
  suggestedLevel: Selection;
};

export type InterviewReviewResult =
  | {
      status: 'parsed' | 'needs_manual_input';
      reviews: ParsedInterviewReview[];
    }
  | {
      status: 'rejected';
      reason:
        | 'unknown_template'
        | 'fingerprint_mismatch'
        | 'no_detail_review'
        | 'unverified_template_profile';
      message: string;
      source?: PdfRegion;
    };

/** Supplied by the importing use case; the parser does not infer job applicability. */
export type InterviewReviewOptions = {
  positionKind: 'management' | 'non_management' | 'unknown';
  /** Explicit opt-in; also requires the PDF to be marked as a synthetic demonstration. */
  allowSyntheticDemo?: true;
};
