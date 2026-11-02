import { State } from '@/components/ui/State';

/** A side card whose read is not on main yet: its title and 待接通, no count or sample. */
export function PendingCard({
  className,
  id,
  title,
  text,
}: {
  className: string;
  id: string;
  title: string;
  text: string;
}) {
  return (
    <article
      className={`n-card ${className}`}
      id={id}
      aria-labelledby={`${id}-h`}
    >
      <h3 className="n-section-title" id={`${id}-h`}>
        {title}
      </h3>
      <State title={`${title}待接通`} text={text} />
    </article>
  );
}
