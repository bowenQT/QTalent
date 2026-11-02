import type { Workbench } from '@/contracts/workbench';

export type WorkbenchRole = Workbench['role'];

/** A block whose read is not on main yet: the page renders nothing for it, never 0. */
export type NotConnected = { status: 'not_connected' };
export type Connected<T> = { status: 'ready'; data: T } | NotConnected;

/** Only `ready` carries a recorded count; `unknown` never shows as 0. */
export type TraineeActivity =
  | {
      status: 'ready';
      data: { recordedThisWeek: number; lastRecordedOn: string | null };
    }
  | { status: 'unknown' };

export type TraineeView = {
  id: string;
  name: string;
  /** Avatars are not colored per person (v1.5 3.32); kept for the Avatar contract. */
  hue: number | null;
  photo: string | null;
  topic: string | null;
  activity: TraineeActivity;
};

export type TraineesView =
  | { status: 'ready'; data: TraineeView[] }
  | { status: 'empty' }
  | { status: 'insufficient_evidence' | 'unknown'; reason: string };

/** The four kinds of material checks HR sees on the workbench (BOW-897). */
export type VerifyKind =
  'speaker' | 'unknown_person' | 'image_scope' | 'unknown_interviewer';

export type VerifyItem = {
  id: string;
  kind: VerifyKind;
  /** The question as the check asks it, e.g. 录像里的「说话人 2」是谁 */
  question: string;
  source: string;
  location: string;
  deferred: boolean;
  href: string;
};

/** A defense node whose conclusion HR confirms (BOW-902). */
export type ConclusionItem = {
  id: string;
  nodeName: string;
  personName: string;
  /** Judges who have not confirmed their own scores yet; empty when all have. */
  waitingJudges: string[];
  href: string;
};

/** Work left by an evaluator whose relation ended (BOW-899), grouped per evaluator. */
export type ReassignSummary = {
  items: number;
  /** Previous evaluators in read order; null when the directory has no name. */
  evaluators: (string | null)[];
};

/**
 * HR to-do groups in prototype order. Each group is connected on its own; a group that
 * is not connected is left out, and the heading carries no total while any group is.
 */
export type TodosView = {
  verify: Connected<VerifyItem[]>;
  conclusion: Connected<ConclusionItem[]>;
  reassign: Connected<ReassignSummary>;
};

export type ExportRange = 'all' | 'last12Months' | 'last3Months';

export type ExportPreview = {
  people: number;
  /** Confirmed dimension scores in range. */
  rows: number;
  /** Scores still awaiting confirmation, re-review or score review. */
  skipped: number;
};

export type ExportScope = {
  id: string;
  label: string;
  people: number;
  previews: Record<ExportRange, ExportPreview>;
};

/** Batch export of confirmed content (BOW-912); managers and HR only. */
export type ExportView = { scopes: ExportScope[] };

/**
 * What the workbench sections render. It is the page's projection of the contract, so a
 * contract revision changes `toWorkbenchView` and nothing in the sections.
 */
export type WorkbenchView = {
  role: WorkbenchRole;
  displayName: string;
  /** Business day (YYYY-MM-DD); null when the contract does not provide one. */
  asOf: string | null;
  entries: { record: boolean; findPeople: boolean };
  accountId: string;
  /** Example sentences naming demo people are shown only outside production. */
  namedExamples: boolean;
  /** Mentor only; absent for other roles. */
  trainees?: TraineesView;
  /** HR only; absent for other roles. */
  todos?: TodosView;
  exportable: Connected<ExportView>;
};

/** Reads besides the workbench contract, each passed on as the page got it. */
export type WorkbenchExtras = {
  /** HR only: `readEvaluationReassignmentsForCurrentUser`. */
  reassignments?:
    | {
        status: 'success';
        items: {
          previousEvaluator: { id: string; displayName: string | null };
        }[];
      }
    | { status: 'forbidden' };
};

const notConnected = { status: 'not_connected' } as const;

/** Previous evaluators in read order, each once. */
function summarize(
  items: { previousEvaluator: { id: string; displayName: string | null } }[],
): ReassignSummary {
  const evaluators = new Map<string, string | null>();
  for (const { previousEvaluator } of items)
    if (!evaluators.has(previousEvaluator.id))
      evaluators.set(previousEvaluator.id, previousEvaluator.displayName);
  return { items: items.length, evaluators: [...evaluators.values()] };
}

/**
 * Maps the workbench read (BOW-838 on the BOW-836 contract). Material checks (BOW-897
 * reads), node conclusions (BOW-902) and export (BOW-912) have no read on main and stay
 * not connected; reassignments come from BOW-899.
 */
export function toWorkbenchView(
  data: Workbench,
  options: { accountId: string; namedExamples: boolean },
  extras: WorkbenchExtras = {},
): WorkbenchView {
  const view: WorkbenchView = {
    role: data.role,
    displayName: data.greeting.displayName,
    asOf: data.asOf,
    entries: {
      record: data.entries.includes('record'),
      // A mentor never finds people, whatever the list says.
      findPeople:
        data.role !== 'mentor' && data.entries.includes('find_people'),
    },
    ...options,
    exportable: notConnected,
  };
  if (data.role === 'hr') {
    const read = extras.reassignments;
    return {
      ...view,
      todos: {
        verify: notConnected,
        conclusion: notConnected,
        // HR whose grant does not cover reassignment has nothing to hand over here.
        reassign:
          read?.status === 'success'
            ? { status: 'ready', data: summarize(read.items) }
            : notConnected,
      },
    };
  }
  if (data.role !== 'mentor') return view;
  const block = data.trainees;
  return {
    ...view,
    trainees:
      block.status === 'ready'
        ? {
            status: 'ready',
            data: block.data.map(({ person, topic, activity }) => ({
              id: person.id,
              name: person.name,
              hue: person.hue,
              photo: person.photo,
              topic,
              activity:
                activity.status === 'ready'
                  ? activity
                  : { status: 'unknown' as const },
            })),
          }
        : block,
  };
}
