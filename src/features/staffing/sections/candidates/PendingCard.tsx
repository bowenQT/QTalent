import { Avatar } from '@/components/ui/Avatar';
import type { PendingView } from '../../view';
import { pendingCaption } from '../../copy';
import { personHref } from '../../format';

const neutralHue = 220;

/** People whose required items mostly lack evidence; not a negative list. */
export function PendingCard({ pending }: { pending: PendingView[] }) {
  return (
    <article className="n-card" id="pending">
      <h4 className="n-section-title" style={{ fontSize: 'var(--t-sm)' }}>
        条件待确认 · {pending.length} 人
      </h4>
      {pending.length ? (
        <ul className="n-pending">
          {pending.map((item) => (
            <li key={item.person.id}>
              <Avatar name={item.person.name} hue={neutralHue} />
              <a className="nt-plink" href={personHref(item.person.id)}>
                {item.person.name}
              </a>
              <small>{item.missing.join('、')}资料不足</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nt-muted" style={{ margin: 0 }}>
          没有。
        </p>
      )}
      <p className="nt-caption">{pendingCaption}</p>
    </article>
  );
}
