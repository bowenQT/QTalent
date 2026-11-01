/**
 * The interview import preview (prototype Y app/import.html): one row per candidate read
 * from a Beisen PDF; HR confirms row by row who it is before anything is imported.
 *
 * The facts use the BOW-906 decision vocabulary and the BOW-900 parser's selection
 * states, mirrored here because neither is on main and features may not import server
 * modules. 906 answers one reason per row (its first blocker); the preview shows every
 * blocker of a row at once (a row can wait for its interviewer and a missing score), so
 * the read behind this page returns the facts and the state is derived here:
 *
 * | 906 plan                                        | row state           |
 * | ----------------------------------------------- | ------------------- |
 * | skipped / not_hired                             | skip                |
 * | duplicate                                       | dup                 |
 * | not_ready / candidate_directory_missing         | unknown → sent      |
 * | needs_review (unknown_interviewer)              | verify              |
 * | not_ready / parser_manual_input (unrecognized)  | unread              |
 * | not_ready / candidate_match_unconfirmed         | confirm             |
 * | planned (HR confirmation stored)                | confirmed           |
 *
 * Import itself (906 has no persistence or profile projection yet) is not part of this
 * model: no row is ever "imported" here.
 */

/** Application status in the recruiting record (906 `candidates[].status`). */
export type CandidateStatus =
  'hired' | 'rejected' | 'offer_pending' | 'offer_declined';

/** Why the parser could not read a selection (900 `Selection.reason`). */
export type UnreadReason =
  | 'missing_selection'
  | 'multiple_selections'
  | 'options_mismatch'
  | 'unsupported_graphics'
  | 'applicability_unknown';

/** One item of the interview's own scale, kept as read; never a dimension score. */
export type Selection =
  | { status: 'recognized'; value: string }
  | {
      status: 'unrecognized';
      reason: UnreadReason;
      /** The PDF page the item is on, for the page image. */
      page: number;
      /** The template's options for this item, in order. */
      options: readonly string[];
      /** Options the page shows as marked. */
      marked: readonly string[];
    }
  | { status: 'not_applicable'; reason: 'non_management_position' };

export type DirectoryMatch = {
  personId: string;
  name: string;
  hue: number;
  photo: string | null;
  /** Short organization and position line, as the directory shows them. */
  org: string;
  title: string;
  /** ISO date the employment started. */
  joinedOn: string;
};

export type Interviewer =
  | { status: 'matched'; name: string }
  /** Not in the directory: a review item waits for HR to link a directory person. */
  | { status: 'pending'; observedName: string; reviewItemId: string };

export type ImportRow = {
  rowId: string;
  pages: { from: number; to: number };
  /** The candidate's name as the PDF prints it. */
  observedName: string;
  candidateStatus: CandidateStatus;
  template: { name: string; scale: string };
  /** ISO date of the interview. */
  interviewedOn: string;
  /** Directory person for this candidate; null when the directory has nobody. */
  match: DirectoryMatch | null;
  interviewer: Interviewer;
  scale: readonly { item: string; selection: Selection }[];
  /** The interview result (面试结论), as written. */
  result: string;
  comment: string | null;
  /** Education-related phrases removed from the comment. */
  redacted: number;
  /** An earlier import holds this same interview (906 `duplicate`). */
  duplicate: { importedOn: string } | null;
  /** A review item asks who this candidate is; null until HR sends the row there. */
  reviewItemId: string | null;
  /** HR's stored answer to「这是谁」(906 `confirmedCandidateId`). */
  confirmed: boolean;
  /** HR's entries for unread items, by item name. */
  filled: Readonly<Record<string, string>>;
};

export type ImportBatch = {
  id: string;
  file: string;
  pageCount: number;
  uploadedBy: string;
  /** ISO date-time of the upload. */
  uploadedAt: string;
  /** The same file was imported before, on this date. */
  prior: { importedOn: string } | null;
  rows: readonly ImportRow[];
};

export type RowState =
  | 'skip'
  | 'dup'
  | 'unknown'
  | 'sent'
  | 'verify'
  | 'unread'
  | 'confirm'
  | 'confirmed';

/** Items read as unrecognized and not yet filled in by HR. */
export function unreadItems(row: ImportRow) {
  return row.scale.filter(
    ({ item, selection }) =>
      selection.status === 'unrecognized' && !row.filled[item],
  );
}

/** The first thing a row waits for, in the prototype's order. */
export function rowState(row: ImportRow): RowState {
  // A rejected application stays out even when the person is in the directory (906).
  if (row.candidateStatus !== 'hired') return 'skip';
  if (row.duplicate) return 'dup';
  if (!row.match) return row.reviewItemId ? 'sent' : 'unknown';
  if (row.interviewer.status === 'pending') return 'verify';
  if (unreadItems(row).length) return 'unread';
  return row.confirmed ? 'confirmed' : 'confirm';
}

export const skipped = (state: RowState) => state === 'skip' || state === 'dup';

export type Summary = {
  live: number;
  confirm: number;
  confirmed: number;
  verify: number;
  unread: number;
  unknown: number;
  skipped: number;
};

export function summarize(rows: readonly ImportRow[]): Summary {
  const states = rows.map(rowState);
  const count = (state: RowState) => states.filter((s) => s === state).length;
  const out = states.filter(skipped).length;
  return {
    live: states.length - out,
    confirm: count('confirm'),
    confirmed: count('confirmed'),
    verify: count('verify'),
    unread: count('unread'),
    unknown: count('unknown'),
    skipped: out,
  };
}

/** The batch label: rows left to settle, or every row skipped. */
export function batchState(rows: readonly ImportRow[]) {
  return rows.some((row) => !skipped(rowState(row)))
    ? ({ s: 'confirm', label: '待逐行确认' } as const)
    : ({ s: 'skipped', label: '全部跳过' } as const);
}

/*
 * Row changes HR makes in the preview. The server owns them (the read returns rows with
 * these applied); they are here so a port can apply them the same way everywhere.
 */

/** Confirms or takes back「这是谁」; only a row that is otherwise ready can be confirmed. */
export function confirmRow(row: ImportRow, ok: boolean): ImportRow {
  const state = rowState(row);
  if (ok ? state !== 'confirm' : state !== 'confirmed') return row;
  return { ...row, confirmed: ok };
}

/** Fills in an unread item; clearing it also takes back the confirmation. */
export function fillItem(
  row: ImportRow,
  item: string,
  value: string,
): ImportRow {
  const entry = row.scale.find((x) => x.item === item);
  if (
    skipped(rowState(row)) ||
    entry?.selection.status !== 'unrecognized' ||
    (value && !entry.selection.options.includes(value))
  )
    return row;
  const filled = { ...row.filled };
  if (value) filled[item] = value;
  else delete filled[item];
  return { ...row, filled, confirmed: value ? row.confirmed : false };
}

/** Sends a row nobody in the directory matches to review; once per row. */
export function sendToReview(row: ImportRow, reviewItemId: string): ImportRow {
  return rowState(row) === 'unknown' ? { ...row, reviewItemId } : row;
}
