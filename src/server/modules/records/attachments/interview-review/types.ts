/** Unrotated page coordinates in PDF points, with the origin at the top left. */
export type PdfBox = readonly [number, number, number, number];
export type PdfTextRange = { start: number; end: number };
/** Box is internal graphics provenance; serialize only page/textRange to 897 location. */
export type PdfRegion = { page: number; box: PdfBox; textRange: PdfTextRange };
/**
 * This parser's own versioned page text: lines sorted by position, items joined by a space.
 * It is not the BOW-866 PDF page text (`pdf-page-text-v1`, PDF.js item order plus hasEOL), so
 * the same UTF-16 range can cut different characters there. Consumers must keep and slice
 * this snapshot (bound by `extractionVersion` and `sha256`), never another page text.
 */
export type InterviewPageText = {
  page: number;
  text: string;
  extractionVersion: 'interview-review-lines-v1';
  sha256: string;
};
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
  identity: { candidateName: ReadField; positionNumber: null };
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
      pageTexts: InterviewPageText[];
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
