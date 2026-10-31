import type { Workbench } from '@/contracts/workbench';

export type WorkbenchRole = Workbench['role'];

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
};

/**
 * Maps the merged contract (main, BOW-836 #77). Not yet in it, so passed on as unknown:
 * `asOf`, trainee `hue` / `photo` / `topic` / `activity` (contract revision #202).
 */
export function toWorkbenchView(
  data: Workbench,
  options: { accountId: string; namedExamples: boolean },
): WorkbenchView {
  const view: WorkbenchView = {
    role: data.role,
    displayName: data.greeting.displayName,
    asOf: null,
    entries: {
      record: data.entries.includes('record'),
      // A mentor never finds people, whatever the list says.
      findPeople:
        data.role !== 'mentor' && data.entries.includes('find_people'),
    },
    ...options,
  };
  if (data.role !== 'mentor') return view;
  const block = data.trainees;
  return {
    ...view,
    trainees:
      block.status === 'ready'
        ? {
            status: 'ready',
            data: block.data.map(({ person }) => ({
              id: person.id,
              name: person.name,
              hue: null,
              photo: null,
              topic: null,
              activity: { status: 'unknown' },
            })),
          }
        : block,
  };
}
