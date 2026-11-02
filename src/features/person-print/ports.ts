/**
 * What the profile print needs from the server. There is no print contract on main yet:
 * these shapes are the interface the print page assumes (BOW-911), for the server work
 * that re-checks the permission, records the audit and assembles the print. The person
 * read (BOW-837) carries neither quotes, source titles, rule version names nor the
 * formal quadrant position, so the print content comes from this call, not from it.
 *
 * Only confirmed content is printed: no AI suggested score, no score waiting for review
 * against a new rule version or still in score review, no unadopted AI summary and no
 * reference position. No total score, percentage or ranking.
 */

/** Where a score's quote sits; `exact` is false when only the event's sources fit. */
export type PrintSource = { exact: boolean; text: string };

export type PrintScore = {
  id: string;
  dimensionLabel: string;
  value: 1 | 2 | 3 | 4 | 5;
  anchor: string;
  /** The quote the score rests on, already wrapped as the print shows it. */
  quote: string | null;
  scoredByName: string;
  /** The rule version as people read it, e.g. 「评价规则 v1」; never an internal id. */
  ruleVersionLabel: string;
  source: PrintSource | null;
};

export type PrintEvent = {
  id: string;
  occurredOn: string;
  title: string;
  projectName: string | null;
  recorderName: string;
  scores: PrintScore[];
};

export type PersonPrintSheet = {
  person: {
    name: string;
    demo: boolean;
    teamPath: string;
    jobTitle: string;
    level: string | null;
    tenureLabel: string | null;
    batchName: string | null;
  };
  /** The server's business clock, `YYYY-MM-DD HH:mm`; the page never reads its own. */
  printedAt: string;
  printedByName: string;
  /** The adopted AI summary, with who adopted it; null when none was adopted. */
  summary: { text: string; adoptedByName: string; adoptedOn: string } | null;
  /** Absent for viewers without quadrant access. */
  formalPosition?:
    | {
        status: 'ready';
        quadrantLabel: string;
        calibrationLabel: string;
        frozenOn: string;
        confirmedByName: string;
      }
    | { status: 'pending' };
  /** Newest first; events without a confirmed score are left out. */
  events: PrintEvent[];
};

/** What the confirmation says will be printed and what stays in the system. */
export type PrintPreview = {
  eventCount: number;
  scoreCount: number;
  /** Scores left out: waiting for confirmation, for review, or still in score review. */
  skippedCount: number;
  hasSummary: boolean;
  hasFormalPosition: boolean;
  /** Some material is outside the viewer's permission; never a count. */
  hasHidden: boolean;
};

export type PrintPreviewResult =
  | { status: 'ready'; preview: PrintPreview }
  | { status: 'denied' }
  | { status: 'not_connected' };

/** `denied` and `printed` are both recorded in the audit log by the server. */
export type PrintResult =
  | { status: 'printed'; sheet: PersonPrintSheet }
  | { status: 'denied' }
  | { status: 'not_connected' };

export type PersonPrintPorts = {
  /** Checked against the current permission when the viewer opens the print. */
  preview(personId: string): Promise<PrintPreviewResult>;
  /** Checked again, recorded and assembled when the viewer confirms. */
  print(input: { operationId: string; personId: string }): Promise<PrintResult>;
};
