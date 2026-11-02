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

/** Watch categories (requirements v1.4 3.20): 突出表现, 新发现, 需要介入. */
export type WatchCategory = 'top' | 'new' | 'act';

/** One person listed by a written watch rule; never a score, rank or quadrant. */
export type WatchPerson = {
  id: string;
  name: string;
  hue: number | null;
  photo: string | null;
  /** Direction under the name, e.g. 全栈方向. */
  title: string;
  /** 去向 X3D, or an open destination (部门待定, 未接受 offer); null when there is none. */
  fate: { text: string; open: boolean } | null;
  category: WatchCategory;
  /** One sentence in business language. */
  brief: string;
  /** Who verified it when the entry came from an AI clue; null otherwise. */
  verifiedBy: string | null;
  /** 需要介入 only: the short reason in the alert line, e.g. 未接受 offer. */
  concern: string | null;
};

export type ProgramKind = 'XEngineer' | 'Landing' | '校招' | '黑客松';

/** A programme cohort, one row each, listed by its latest reason. */
export type WatchProgram = {
  id: string;
  name: string;
  kind: ProgramKind | null;
  href: string;
  /** The latest stage, without a date. */
  stage: string | null;
  notes: string[];
  /** Follow-ups that link on; `href` null when the tag only names the follow-up. */
  tags: { text: string; href: string | null }[];
};

/** A confirmed update about someone the viewer follows. */
export type FollowUpdate = {
  personId: string;
  name: string;
  hue: number | null;
  photo: string | null;
  text: string;
  /** YYYY-MM-DD */
  on: string;
  kind: string;
  by: string | null;
};

/** The viewer's own follow list; nobody else sees it (v1.5 3.26.2). */
export type FollowsView = {
  people: {
    id: string;
    name: string;
    hue: number | null;
    photo: string | null;
    /** YYYY-MM-DD */
    followedOn: string;
    latest: string | null;
  }[];
  /** Newest first, at most five. */
  updates: FollowUpdate[];
};

/** One line in the heading: a comparison mismatch or a revision to confirm. */
export type JudgeNote = {
  kind: 'comparison' | 'revision';
  text: string;
  href: string;
  /** Hover detail; the target page has the rest. */
  detail: string | null;
};

/** The manager home blocks (版本 Y DY-04); each is connected on its own. */
export type ManagerBlocks = {
  notes: Connected<JudgeNote[]>;
  watch: Connected<WatchPerson[]>;
  programs: Connected<WatchProgram[]>;
  follows: Connected<FollowsView>;
};

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
  /** Manager only; absent for other roles. */
  manager?: ManagerBlocks;
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
  // The watch rules, the follow list and the cohort stages have no read on main; the
  // comparison batches and revisions to confirm wait for their reads (be-iter, BOW-918).
  if (data.role === 'manager')
    return {
      ...view,
      manager: {
        notes: notConnected,
        watch: notConnected,
        programs: notConnected,
        follows: notConnected,
      },
    };
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
