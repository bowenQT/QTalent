import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import type { TraineeView, WorkbenchView } from '../../view';
import { studentsCaption, studentsEmpty } from '../../copy';
import { personHref, recordForPersonHref } from '../../send';
import { traineeLine } from './trainee-line';

// The Avatar contract needs a hue; avatars are not colored per person (v1.5 3.32),
// so this is the stylesheet's own default rather than an invented color.
const neutralHue = 220;

function Row({
  trainee,
  canRecord,
}: {
  trainee: TraineeView;
  canRecord: boolean;
}) {
  const href = personHref(trainee.id);
  const line = traineeLine(trainee);
  return (
    <li>
      <a href={href} tabIndex={-1} aria-hidden="true">
        <Avatar
          name={trainee.name}
          hue={trainee.hue ?? neutralHue}
          photo={trainee.photo}
          size=""
        />
      </a>
      <div>
        <a className="nt-plink" href={href}>
          <b>{trainee.name}</b>
        </a>
        {line ? <small>{line}</small> : null}
      </div>
      <div className="n-students__acts">
        {canRecord ? (
          <a
            className="n-btn n-btn--sm n-btn--ink"
            href={recordForPersonHref(trainee.id)}
          >
            <Icon name="pen" />
            记一件事
          </a>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Mentor's trainees, in the order the read returns them: no sorting, grouping or
 * scores here. Only `ready` shows a head count; other states say why, never "0 人".
 */
export function Students({ view }: { view: WorkbenchView }) {
  const block = view.trainees;
  if (!block) return null;
  return (
    <article
      className="n-card n-students"
      id="students"
      aria-labelledby="stu-h"
    >
      <h3 className="n-section-title" id="stu-h">
        我带的学员
        {block.status === 'ready' ? (
          <span className="n-count is-quiet">{block.data.length} 人</span>
        ) : null}
      </h3>
      {block.status === 'ready' ? (
        <ul className="n-students__list">
          {block.data.map((trainee) => (
            <Row
              key={trainee.id}
              trainee={trainee}
              canRecord={view.entries.record}
            />
          ))}
        </ul>
      ) : (
        <div className="nt-empty">
          {block.status === 'empty' ? studentsEmpty : block.reason}
        </div>
      )}
      <p className="nt-caption">{studentsCaption}</p>
    </article>
  );
}
