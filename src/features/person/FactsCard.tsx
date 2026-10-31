import type { Person } from '@/contracts/person';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import { BlockState } from './BlockState';
import { monthDay, topFacts } from './person-view';

/** 第一屏的「关键事件与证据」：最近 3 条已确认的关键事件，各带一处原文。 */
export function FactsCard({
  timeline,
  loadSource,
}: {
  timeline: Person['timeline'];
  loadSource: LoadSource;
}) {
  const entries = timeline.status === 'ready' ? timeline.data : [];
  const facts = topFacts(entries);
  return (
    <article className="n-card" id="facts">
      <h3 className="n-section-title">
        关键事件与证据
        {entries.some((entry) => entry.kind === 'key_event') ? (
          <a className="n-link" href="#timeline">
            查看全部
          </a>
        ) : null}
      </h3>
      {timeline.status !== 'ready' && timeline.status !== 'empty' ? (
        <BlockState block={timeline} empty="" />
      ) : facts.length ? (
        <ol className="n-peek__facts n-pfacts">
          {facts.map((event) => (
            <li key={event.id}>
              <span className="n-peek__date">{monthDay(event.occurredOn)}</span>
              <span>
                <a className="nt-plink" href={`#ev-${event.id}`}>
                  {event.title}
                </a>
                <SourceCite
                  source={event.sources[0]}
                  index="原文"
                  loadSource={loadSource}
                />
                <small>
                  {[event.projectName, `${event.recorderName}记录`]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="nt-empty">确认后的关键事件会出现在这里</div>
      )}
    </article>
  );
}
