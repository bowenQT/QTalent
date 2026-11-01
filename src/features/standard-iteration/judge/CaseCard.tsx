import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Cite } from '@/components/ui/Cite';
import { Icon } from '@/components/ui/Icon';
import type { Source } from '@/contracts/sources';
import { formatLocation } from '@/features/sources/source-format';
import { hueOf, monthDay, stage } from '../copy';
import { outcomeState, outcomeText, type DisplayCase } from './comparison-view';

type Stage = DisplayCase['front'];

function SourceMark({ source, index }: { source: Source; index: number }) {
  return (
    <Cite
      index={index}
      markLabel={source.originalTitle}
      access="granted"
      quote={source.excerpt}
      source={{
        kind: 'cell',
        title: source.originalTitle,
        location: formatLocation(source.location),
        ...(source.recordedByName ? { by: source.recordedByName } : {}),
      }}
    />
  );
}

/** The stage outside the viewer's current relation: no grade, quote or source. */
function Denied({ side }: { side: 'front' | 'back' }) {
  return (
    <div className="n-jcase__deny">
      <Icon name="lock" size={12} />
      <span>
        <b>无权限</b>
        {stage[side]}这一段在你现在的评价关系之外
      </span>
    </div>
  );
}

function StageSide({
  side,
  value,
  standardVersionId,
  raterOnly,
  team,
}: {
  side: 'front' | 'back';
  value: Stage;
  standardVersionId: string;
  raterOnly: boolean;
  team: boolean;
}) {
  const present = value.state === 'present' ? value.judgment : null;
  // The rater sees the later stage's conclusion only: its quote stays hidden.
  const showSource = side === 'front' || !raterOnly;
  return (
    <div className="n-jcase__side">
      <div className="n-jcase__stage">
        <span>{stage[side]}</span>
        <span>
          {side === 'front'
            ? standardVersionId
            : present
              ? `评审 ${present.evaluator.name}`
              : ''}
        </span>
      </div>
      {value.state === 'withheld' ? (
        <Denied side={side} />
      ) : (
        <>
          <div className="n-jcase__val">
            <b>{present ? present.grade : '—'}</b>
            {present ? <span>{present.evaluator.name}</span> : null}
            {side === 'front' && team ? (
              <span className="n-jcase__team">
                <Icon name="users" size={12} />
                组队作品
              </span>
            ) : null}
          </div>
          {value.state === 'missing' ? <div>{value.reason}</div> : null}
          {present && showSource ? (
            <p className="n-jcase__note">
              {present.row.source.excerpt}
              <SourceMark
                source={present.row.source}
                index={side === 'front' ? 1 : 2}
              />
            </p>
          ) : null}
          {side === 'back' && raterOnly && present ? (
            <div className="nt-muted" style={{ marginTop: 'var(--s-1)' }}>
              评价人视角只显示后段的结论，评语和档案的其他内容已隐藏
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** One comparison case: both stages laid out the same way, the outcome between them. */
export function CaseCard({
  unit,
  mappingVersionId,
  raterOnly = false,
  batchName,
  focused = false,
}: {
  unit: DisplayCase;
  mappingVersionId: string;
  raterOnly?: boolean;
  /** Shown after the judgment name when cases from several batches share a list. */
  batchName?: string;
  focused?: boolean;
}) {
  const state = outcomeState(unit.outcome);
  return (
    <article
      className={`n-jcase${focused ? ' is-focus' : ''}`}
      id={`case-${unit.id}`}
      data-testid="judge-case"
    >
      <div className="n-jcase__head">
        <Avatar name={unit.person.name} hue={hueOf(unit.person.id)} />
        <b>{unit.person.name}</b>
        <Badge tone="demo">演示</Badge>
        <span className="nt-muted">
          {unit.judgment.name}
          {batchName ? ` · ${batchName}` : ''}
        </span>
      </div>
      <StageSide
        side="front"
        value={unit.front}
        standardVersionId={unit.selectionStandardVersionId}
        raterOnly={raterOnly}
        team={unit.work.kind === 'team'}
      />
      <div className="n-jcase__mid">
        <span className="n-jstate" data-s={state === 'deny' ? 'na' : state}>
          {outcomeText(unit.outcome)}
        </span>
        <span>按 {mappingVersionId}</span>
        {state === 'mid' ? <span>只看结营结论</span> : null}
      </div>
      <StageSide
        side="back"
        value={unit.back}
        standardVersionId={unit.selectionStandardVersionId}
        raterOnly={raterOnly}
        team={false}
      />
      {unit.outcome.state === 'not_comparable' ? (
        <div className="n-jcase__mark">
          <Icon name="pen" size={12} />
          标为不可比：
          <span className="n-jcase__why">{unit.outcome.reason}</span>·{' '}
          {unit.outcome.markedBy.name} {monthDay(unit.outcome.markedAt)}
        </div>
      ) : null}
    </article>
  );
}
