import { Badge } from '@/components/ui/Badge';
import { Score } from '@/components/ui/Score';
import { Src } from '@/components/ui/Src';
import type { ScoreValue } from '@/components/ui/Score';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import {
  monthDay,
  sameSources,
  type EventScore,
  type KeyEvent,
} from './person-view';

const SBI: [
  keyof Pick<KeyEvent, 'situation' | 'behavior' | 'impact'>,
  string,
][] = [
  ['situation', '情境'],
  ['behavior', '行为'],
  ['impact', '影响'],
];

function ScoreRow({
  score,
  event,
  loadSource,
}: {
  score: EventScore;
  event: KeyEvent;
  loadSource: LoadSource;
}) {
  if (score.state === 'insufficient' || score.state === 'absent')
    return <Score state={score.state} dimension={score.dimensionLabel} />;
  if (score.state === 'conflict')
    // 证据冲突：列出各自的分与评价人，不取均值，也不进能力谱。
    return (
      <div className="n-score" data-state="confirmed">
        <span className="n-score__dim">{score.dimensionLabel}</span>
        <Badge tone="conflict" icon="split">
          证据冲突 {score.ratings.map((rating) => rating.value).join(' / ')}
        </Badge>
        <span className="n-score__note">
          {score.ratings.map((rating) => rating.scoredByName).join('、')}
          分差 ≥ 2 · 待 HR 复核
          {score.ratings.map((rating, index) => (
            <SourceCite
              key={rating.scoreId}
              source={rating.sources[0]}
              index={index + 1}
              loadSource={loadSource}
            />
          ))}
        </span>
      </div>
    );
  // 锚点与规则版本放进 title 供追溯；这个分自己的出处与事件出处不同时，才另画角标。
  return (
    <Score
      state="confirmed"
      dimension={score.dimensionLabel}
      value={score.value as ScoreValue}
      by={score.scoredByName}
      note={
        <span title={`${score.anchor} · ${score.ruleVersionId}`}>
          确认
          {sameSources(score.sources, event.sources)
            ? null
            : score.sources.map((source, index) => (
                <SourceCite
                  key={`${source.fragmentId}\u0000${source.originalVersionId}`}
                  source={source}
                  index={index + 1}
                  loadSource={loadSource}
                />
              ))}
        </span>
      }
    />
  );
}

/**
 * 时间线里展开的关键事件卡，结构同原型 `UI.eventCard`。分数只有契约给出的人工确认分、
 * 资料不足、未体现和证据冲突；AI 建议分不在这里出现。
 */
export function PersonEventCard({
  event,
  loadSource,
}: {
  event: KeyEvent;
  loadSource: LoadSource;
}) {
  return (
    <article className="n-card n-event nt-event">
      <div className="n-event__head">
        <Src kind="obs" />
        <span>
          {monthDay(event.occurredOn)} · {event.recorderName}记录
        </span>
        {event.projectName ? (
          <Badge icon="folder">项目：{event.projectName}</Badge>
        ) : null}
        {event.participants ? (
          <Badge>
            多人事件 ·{' '}
            {event.participants.map((person) => person.name).join('、')}
          </Badge>
        ) : null}
        {event.selfRole ? <Badge>本人：{event.selfRole}</Badge> : null}
      </div>
      <h3 className="n-event__title">
        {event.title}
        {event.sources.map((source, index) => (
          <SourceCite
            key={`${source.fragmentId}\u0000${source.originalVersionId}`}
            source={source}
            index={index + 1}
            loadSource={loadSource}
          />
        ))}
      </h3>
      <dl className="n-event__sbar">
        {SBI.map(([key, name]) => (
          <SbiRow key={key} name={name} text={event[key]} />
        ))}
      </dl>
      {event.scores.length ? (
        <div className="n-event__scores">
          {event.scores.map((score) => (
            <ScoreRow
              key={score.dimensionId}
              score={score}
              event={event}
              loadSource={loadSource}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SbiRow({ name, text }: { name: string; text: string | null }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{text || <span className="nt-muted">待补充</span>}</dd>
    </>
  );
}
