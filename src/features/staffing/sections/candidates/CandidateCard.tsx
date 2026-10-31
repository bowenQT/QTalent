'use client';
import { Avatar } from '@/components/ui/Avatar';
import { JudgeProgressBadge } from '@/components/ui/JudgeProgress';
import { MatchState } from '@/components/ui/MatchState';
import { Src } from '@/components/ui/Src';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import {
  citableSources,
  type CandidateView,
  type RequirementRow,
} from '../../view';
import { failedNote } from '../../copy';
import { formatDay, personHref } from '../../format';
import { ManualJudgment, type ManualJudgmentDraft } from './ManualJudgment';

// The Avatar contract needs a hue; avatars are not colored per person (v1.5 3.32),
// so this is the stylesheet's own default rather than an invented color.
const neutralHue = 220;

export type JudgingState = {
  requirementId: string;
  busy: boolean;
  error: string | null;
} | null;

function Bonus({ row }: { row: RequirementRow }) {
  return row.requirement.priority === 'bonus' ? (
    <span className="nt-muted">（加分项）</span>
  ) : null;
}

function Concluded({
  row,
  loadSource,
}: {
  row: Extract<RequirementRow, { kind: 'concluded' }>;
  loadSource: LoadSource;
}) {
  return (
    <>
      <MatchState state={row.state} />
      <span>
        {row.rationale}
        {row.sources.map((source, index) => (
          <SourceCite
            key={`${source.fragmentId}\u0000${source.originalVersionId}`}
            source={source}
            index={index + 1}
            loadSource={loadSource}
          />
        ))}
        {row.requirement.priority === 'bonus' ? ' ' : null}
        <Bonus row={row} />
        {row.by.kind === 'human' ? (
          <>
            <br />
            <Src kind="human" />{' '}
            <span className="nt-muted">
              {row.by.name} · {formatDay(row.by.at)}
            </span>
          </>
        ) : null}
      </span>
    </>
  );
}

/**
 * One candidate. Each requirement shows one of the four states with its evidence, or
 * where its judgment stands; a failed judgment is not one of the four states. The
 * prototype's dimension line, direction line, intent and release (`.n-cmeta`) and the
 * plan buttons have no contract fields and are not rendered.
 */
export function CandidateCard({
  view,
  loadSource,
  judging,
  onOpenJudgment,
  onSubmitJudgment,
  onCancelJudgment,
}: {
  view: CandidateView;
  loadSource: LoadSource;
  /** The requirement this card's manual judgment form is open for. */
  judging: JudgingState;
  /** Absent when the viewer cannot judge (for example while another save runs). */
  onOpenJudgment?: (requirementId: string) => void;
  onSubmitJudgment: (requirementId: string, draft: ManualJudgmentDraft) => void;
  onCancelJudgment: () => void;
}) {
  const { person } = view;
  const sources = citableSources(view);
  return (
    <article className="n-card" data-pid={person.id}>
      <div
        className="nt-row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <div className="n-person">
          <Avatar name={person.name} hue={neutralHue} size="" />
          <div>
            <div className="n-person__name">
              <a className="nt-plink" href={personHref(person.id)}>
                {person.name}
              </a>
            </div>
            <div className="n-person__meta">{person.orgName}</div>
          </div>
        </div>
      </div>
      {/* The progress list layout fits the wider progress badges (design system 处理进度). */}
      <ul
        className={
          view.rows.some((row) => row.kind === 'progress')
            ? 'n-reqs n-reqs--proc'
            : 'n-reqs'
        }
      >
        {view.rows.map((row) => (
          <li
            key={row.requirement.id}
            data-req={row.requirement.id}
            data-s={row.kind === 'concluded' ? row.state : undefined}
            data-progress={row.kind === 'progress' ? row.state : undefined}
          >
            {row.kind === 'concluded' ? (
              <Concluded row={row} loadSource={loadSource} />
            ) : (
              <>
                <JudgeProgressBadge state={row.state} />
                <span>
                  {row.requirement.text}
                  {row.requirement.priority === 'bonus' ? ' ' : null}
                  <Bonus row={row} />
                  {row.state === 'failed' ? (
                    <>
                      <br />
                      <small className="n-proc__note">{failedNote}</small>
                    </>
                  ) : null}
                  {row.state === 'review' &&
                  judging?.requirementId !== row.requirement.id &&
                  onOpenJudgment ? (
                    <>
                      <br />
                      <button
                        type="button"
                        className="n-btn n-btn--sm n-proc__retry"
                        onClick={() => onOpenJudgment(row.requirement.id)}
                      >
                        人工判断
                      </button>
                    </>
                  ) : null}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {judging
        ? (() => {
            const row = view.rows.find(
              (item) => item.requirement.id === judging.requirementId,
            );
            return row ? (
              <ManualJudgment
                requirement={row.requirement}
                personName={person.name}
                sources={sources}
                busy={judging.busy}
                error={judging.error}
                onSubmit={(draft) =>
                  onSubmitJudgment(row.requirement.id, draft)
                }
                onCancel={onCancelJudgment}
              />
            ) : null;
          })()
        : null}
      <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
        <a
          className="n-btn n-btn--sm n-btn--ghost"
          href={personHref(person.id)}
        >
          看档案
        </a>
      </div>
    </article>
  );
}
