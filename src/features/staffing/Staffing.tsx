'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { StaffingCandidate, StaffingDemand } from '@/contracts/staffing';
import type { StaffingPorts } from './ports';
import { projectStatusTone, type ProjectHead } from './view';
import { projectHref } from './format';
import { hasDraft, sessionStorageOrNull, takeDraft } from './draft';
import { useJob } from './use-job';
import {
  conflictText,
  draftFailed,
  draftLost,
  draftRetrying,
  offline,
  saveFailed,
} from './copy';
import { Entry } from './sections/entry/Entry';
import { Generating, generationPhase } from './sections/generating/Generating';
import { DemandCard } from './sections/demand/DemandCard';
import {
  Candidates,
  pageFor,
  type JudgingTarget,
  type MatchingState,
} from './sections/candidates/Candidates';
import type { ManualJudgmentDraft } from './sections/candidates/ManualJudgment';

type Failure =
  | { status: 'validation_error'; fieldErrors: Record<string, string[]> }
  | { status: 'forbidden' | 'not_found' | 'conflict'; message: string };

/** What the viewer is told when a write is refused; the input stays where it was. */
export function failureText(result: Failure): string {
  if (result.status === 'conflict') return conflictText;
  if (result.status === 'validation_error')
    return Object.values(result.fieldErrors).flat()[0] ?? saveFailed;
  return result.message;
}

const operationId = () => crypto.randomUUID();
const judgedKey = (revision: number, personId: string, requirementId: string) =>
  `${revision}\u0000${personId}\u0000${requirementId}`;

/** A requirement added on the card is required; it goes before the bonus items. */
export function withRequirement(
  requirements: StaffingDemand['requirements'],
  text: string,
): StaffingDemand['requirements'] {
  const added = {
    id: `req-${operationId()}`,
    text,
    priority: 'required' as const,
  };
  const at = requirements.findIndex((item) => item.priority === 'bonus');
  return at < 0
    ? [...requirements, added]
    : [...requirements.slice(0, at), added, ...requirements.slice(at)];
}

// The workbench handoff is taken once and kept for re-renders of this page load; a new
// sentence handed over later (or another account) replaces it.
let handoff: { accountId: string; text: string | null } | undefined;
function readHandoff(accountId: string): string | null {
  const storage = sessionStorageOrNull();
  if (handoff?.accountId !== accountId || hasDraft(storage))
    handoff = { accountId, text: takeDraft(storage, accountId, Date.now()) };
  return handoff.text;
}
const noSubscribe = () => () => {};

function ProjectHeader({ project }: { project: ProjectHead }) {
  return (
    <header className="nt-head">
      <div>
        <h1>为「{project.name}」找人</h1>
        <p>{project.goal}</p>
      </div>
      <div className="nt-head__acts">
        <span
          className={`n-badge n-badge--${projectStatusTone[project.status]}`}
        >
          {project.status}
        </span>
        <a
          className="n-btn n-btn--sm n-btn--ghost"
          href={projectHref(project.id)}
        >
          项目详情
        </a>
      </div>
    </header>
  );
}

export type StaffingProps = {
  /** Null on the new-project entry, where the page binds the project on creation. */
  project: ProjectHead | null;
  demand: StaffingDemand | null;
  /** Matching job of a confirmed demand, when the page already knows it. */
  matchingJobId?: string | null;
  accountId: string;
  /** The URL said a workbench sentence is waiting (`draft=work`). */
  fromWorkbench?: boolean;
  ports: StaffingPorts;
  /** New-project entry only: called once the drafted demand exists. */
  onDemandReady?: (demand: StaffingDemand) => void;
};

/**
 * The find-people live document: one sentence, then the demand card, then — once the
 * demand is confirmed — candidates with the four states per requirement. The plan slots,
 * versions and confirmation of the prototype's right column are not rendered (the plan
 * contract is `not_connected`); their column is kept empty so the left column keeps its
 * width.
 */
export function Staffing(props: StaffingProps) {
  const { ports, accountId } = props;
  const handed = useSyncExternalStore(
    noSubscribe,
    () => (props.fromWorkbench ? readHandoff(accountId) : null),
    () => null,
  );
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? handed ?? '';
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ text: string; jobId: string } | null>(
    null,
  );
  const demandJob = useJob(sent?.jobId ?? null, ports.readDemandJob);
  const demandSnapshot = demandJob?.snapshot ?? null;
  const generated =
    demandSnapshot?.status === 'completed' ? demandSnapshot.result : null;

  const [edited, setEdited] = useState<StaffingDemand | null>(null);
  const demand = edited ?? props.demand ?? generated;
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [matching, setMatching] = useState<{
    revision: number;
    jobId: string | null;
  } | null>(() =>
    props.demand?.status === 'confirmed' && props.matchingJobId
      ? { revision: props.demand.revision, jobId: props.matchingJobId }
      : null,
  );
  const confirmed = demand?.status === 'confirmed' ? demand : null;
  // The demand revision on screen, for answers that arrive after it changed.
  const shown = useRef<{ id: string; revision: number } | null>(null);
  useEffect(() => {
    shown.current = confirmed
      ? { id: confirmed.id, revision: confirmed.revision }
      : null;
  });
  const current =
    confirmed && matching?.revision === confirmed.revision ? matching : null;
  const matchJob = useJob(current?.jobId ?? null, ports.readMatchingJob);
  const [judged, setJudged] = useState<
    ReadonlyMap<string, StaffingCandidate['requirements'][number]>
  >(new Map());
  const [judging, setJudging] = useState<JudgingTarget>(null);

  const { onDemandReady } = props;
  useEffect(() => {
    if (generated && !props.project) onDemandReady?.(generated);
  }, [generated, props.project, onDemandReady]);

  // A confirmed demand whose matching job the page did not know: ask for it once.
  const toOpen =
    confirmed && !current
      ? { demandId: confirmed.id, revision: confirmed.revision }
      : null;
  useEffect(() => {
    if (!toOpen) return;
    let live = true;
    ports
      .openMatching(toOpen)
      .catch(() => null)
      .then((jobId) => {
        if (live) setMatching({ revision: toOpen.revision, jobId });
      });
    return () => {
      live = false;
    };
    // Keyed by the revision; `ports` is stable for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toOpen?.demandId, toOpen?.revision]);

  const matchingState: MatchingState = !current
    ? { kind: 'opening' }
    : current.jobId === null
      ? { kind: 'unavailable' }
      : { kind: 'job', job: matchJob };
  const page = confirmed ? pageFor(confirmed, matchingState) : null;
  const candidates = useMemo(
    () =>
      page?.candidates.map((candidate) => ({
        ...candidate,
        requirements: candidate.requirements.map(
          (match) =>
            judged.get(
              judgedKey(
                page.demand.revision,
                candidate.person.id,
                match.requirementId,
              ),
            ) ?? match,
        ),
      })) ?? null,
    [page, judged],
  );

  async function send() {
    const inputText = text.trim();
    if (!inputText || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const result = await ports.createDemand({
        operationId: operationId(),
        inputText,
      });
      if (result.status === 'success')
        setSent({ text: inputText, jobId: result.snapshot.jobId });
      else setSendError(failureText(result));
    } catch {
      setSendError(offline);
    } finally {
      setSending(false);
    }
  }

  async function change(
    run: (current: StaffingDemand) => ReturnType<StaffingPorts['editDemand']>,
  ): Promise<boolean> {
    if (!demand || busy) return false;
    setBusy(true);
    setEditError(null);
    try {
      const result = await run(demand);
      if (result.status !== 'success') {
        setEditError(failureText(result));
        return false;
      }
      setEdited(result.demand);
      setJudged(new Map());
      setJudging(null);
      return true;
    } catch {
      setEditError(offline);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const edit = (requirements: StaffingDemand['requirements']) =>
    change((current) =>
      ports.editDemand({
        operationId: operationId(),
        demandId: current.id,
        expectedRevision: current.revision,
        requirements,
      }),
    );

  async function judge(
    personId: string,
    requirementId: string,
    draft: ManualJudgmentDraft,
  ) {
    if (!confirmed) return;
    const target = {
      demandId: confirmed.id,
      revision: confirmed.revision,
      personId,
      requirementId,
    };
    // An answer counts only for the demand revision and requirement it was asked for.
    const stillShown = () =>
      shown.current?.id === target.demandId &&
      shown.current.revision === target.revision;
    const same = (other: JudgingTarget) =>
      other?.revision === target.revision &&
      other.personId === personId &&
      other.requirementId === requirementId;
    setJudging({ ...target, busy: true, error: null });
    let error: string;
    try {
      const result = await ports.judge({
        operationId: operationId(),
        demandId: target.demandId,
        expectedRevision: target.revision,
        personId,
        requirementId,
        ...draft,
      });
      if (!stillShown()) return;
      if (result.status === 'success') {
        if (
          result.demandId !== target.demandId ||
          result.revision !== target.revision ||
          result.personId !== personId ||
          result.match.requirementId !== requirementId
        )
          return;
        setJudged((map) =>
          new Map(map).set(
            judgedKey(target.revision, personId, requirementId),
            result.match,
          ),
        );
        setJudging((open) => (same(open) ? null : open));
        return;
      }
      error = failureText(result);
    } catch {
      if (!stillShown()) return;
      error = offline;
    }
    setJudging((open) =>
      same(open) ? { ...target, busy: false, error } : open,
    );
  }

  if (!demand || !props.project) {
    if (sent) {
      // Reading the job can end for good (signed out, permission changed, job gone):
      // the subscription stops, so the trail must stop too.
      const lost =
        demandJob?.connection === 'forbidden' ||
        demandJob?.connection === 'not_found';
      const failed = lost || generationPhase(demandSnapshot) === 'failed';
      const note = lost
        ? draftLost
        : failed
          ? draftFailed
          : demandJob?.connection === 'error'
            ? draftRetrying
            : null;
      return (
        <>
          <Generating
            text={sent.text}
            snapshot={demandSnapshot}
            stopped={lost}
          />
          {note ? (
            <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
              <span className="nt-muted" role={failed ? 'alert' : undefined}>
                {note}
              </span>
              <button
                type="button"
                className="n-btn n-btn--sm"
                onClick={() => {
                  setTyped(sent.text);
                  setSent(null);
                }}
              >
                回到输入框
              </button>
            </div>
          ) : null}
        </>
      );
    }
    return (
      <Entry
        text={text}
        onTextChange={setTyped}
        onSend={() => void send()}
        sending={sending}
        error={sendError}
      />
    );
  }

  return (
    <>
      <ProjectHeader project={props.project} />
      <div className="nt-split nt-split--wide">
        <div className="nt-grid">
          <DemandCard
            demand={demand}
            project={props.project}
            busy={busy}
            error={editError}
            onToggle={(id) =>
              void edit(
                demand.requirements.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        priority:
                          item.priority === 'required' ? 'bonus' : 'required',
                      }
                    : item,
                ),
              )
            }
            onAdd={(added) => edit(withRequirement(demand.requirements, added))}
            onConfirm={() =>
              void change((current) =>
                ports.confirmDemand({
                  operationId: operationId(),
                  demandId: current.id,
                  expectedRevision: current.revision,
                }),
              )
            }
          />
          {confirmed ? (
            <Candidates
              demand={confirmed}
              matching={matchingState}
              candidates={candidates}
              loadSource={ports.loadSource}
              judging={judging}
              onOpenJudgment={(personId, requirementId) =>
                setJudging({
                  demandId: confirmed.id,
                  revision: confirmed.revision,
                  personId,
                  requirementId,
                  busy: false,
                  error: null,
                })
              }
              onSubmitJudgment={(personId, requirementId, draft) =>
                void judge(personId, requirementId, draft)
              }
              onCancelJudgment={() => setJudging(null)}
            />
          ) : null}
        </div>
        <div aria-hidden="true" />
      </div>
    </>
  );
}
