import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { Cite, type CiteSpec } from './Cite';
import { Icon } from './Icon';
import { Score, type ScoreProps } from './Score';
import { Src } from './Src';

/** Where the event came from: the person's own account, a manager's observation, or history. */
export type EventOrigin = 'self' | 'obs' | 'hist';

export type EventSbi = {
  situation?: string;
  behavior?: string;
  impact?: string;
};

type Common = {
  id?: string;
  /** Shown when several people's events share a list. */
  person?: { name: string; hue: number; photo?: string | null; demo?: boolean };
  origin: EventOrigin;
  /** Display date such as 10-21; absent means the date is unknown. */
  dateLabel?: string;
  recorder: string;
  /** Rule version the scores were given under. */
  ruleVersion?: string;
  /** Project or role badges assembled by the page. */
  badges?: ReactNode;
  title: string;
  sbi: EventSbi;
};

/**
 * Scores arrive as props because the page already filtered them by permission; when the
 * viewer may not see them the page passes `scoresHidden` instead and no score is rendered.
 */
export type EventCardProps = Common &
  (
    | { cites?: readonly CiteSpec[]; citeSlot?: never }
    /** Page-rendered citations, e.g. ones that load the original on demand. */
    | { citeSlot: ReactNode; cites?: never }
  ) &
  (
    | { scores?: readonly ScoreProps[]; scoresHidden?: never }
    | { scoresHidden: string; scores?: never }
  );

const sbiRows: [keyof EventSbi, string][] = [
  ['situation', '情境'],
  ['behavior', '行为'],
  ['impact', '影响'],
];

export function EventCard(props: EventCardProps) {
  const { person, origin, sbi } = props;
  const hasSbi = sbiRows.some(([key]) => sbi[key]);
  return (
    <article className="n-card n-event" id={props.id}>
      <div className="n-event__head">
        {person ? (
          <>
            <Avatar
              name={person.name}
              hue={person.hue}
              photo={person.photo}
              size="sm"
            />
            <b className="n-event__who">{person.name}</b>
            {person.demo ? <Badge className="n-badge--demo">演示</Badge> : null}
          </>
        ) : null}
        {origin === 'hist' ? (
          <Src kind="fact" label="历史资料" />
        ) : (
          <Src kind={origin} />
        )}
        <span>
          {props.dateLabel ?? '时间未知'} · {props.recorder}记录
        </span>
        {props.badges}
        {props.ruleVersion ? <Badge>规则 {props.ruleVersion}</Badge> : null}
      </div>
      <h3 className="n-event__title">
        {props.title}
        {props.citeSlot}
        {props.cites?.map((cite, index) => (
          <Cite key={index} index={index + 1} {...cite} />
        ))}
      </h3>
      {hasSbi ? (
        <dl className="n-event__sbar">
          {sbiRows.map(([key, name]) => (
            <SbiRow key={key} name={name} text={sbi[key]} />
          ))}
        </dl>
      ) : null}
      {props.scoresHidden ? (
        <div className="n-event__scores">
          <span className="n-lock">
            <Icon name="lock" />
            {props.scoresHidden}
          </span>
        </div>
      ) : props.scores?.length ? (
        <div className="n-event__scores">
          {props.scores.map((score) => (
            <Score key={score.dimension} {...score} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SbiRow({ name, text }: { name: string; text?: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{text || <span className="nt-muted">待补充</span>}</dd>
    </>
  );
}
