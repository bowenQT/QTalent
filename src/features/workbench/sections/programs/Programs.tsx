import { Icon, type IconName } from '@/components/ui/Icon';
import type { ProgramKind, WatchProgram, WorkbenchView } from '../../view';
import { managerPending, programsEmpty } from '../../copy';
import { PendingCard } from '../../PendingCard';

const kindIcon: Record<ProgramKind, IconName> = {
  XEngineer: 'book',
  Landing: 'flag',
  校招: 'users',
  黑客松: 'spark',
};

function Row({ program }: { program: WatchProgram }) {
  return (
    <li>
      <span className="n-progs__icon">
        <Icon name={program.kind ? kindIcon[program.kind] : 'folder'} />
      </span>
      <div className="n-progs__main">
        <div className="n-progs__top">
          <a className="n-progs__name" href={program.href}>
            {program.name}
          </a>
          {program.stage ? (
            <span className="n-progs__when">{program.stage}</span>
          ) : null}
        </div>
        {program.notes.length || program.tags.length ? (
          <div className="n-progs__acts">
            {program.notes.map((text) => (
              <span className="n-progs__note" key={text}>
                {text}
              </span>
            ))}
            {program.tags.map((tag) =>
              tag.href ? (
                <a className="n-progs__tag" href={tag.href} key={tag.text}>
                  <Icon name="stamp" />
                  {tag.text}
                </a>
              ) : (
                <span className="n-progs__tag" key={tag.text}>
                  <Icon name="users" />
                  {tag.text}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** 值得关注的项目: programme cohorts, one row each, in the order the read returns them. */
export function Programs({ view }: { view: WorkbenchView }) {
  const block = view.manager?.programs;
  if (!block) return null;
  if (block.status !== 'ready')
    return (
      <PendingCard
        className="n-progs"
        id="progs"
        title="值得关注的项目"
        text={managerPending.programs}
      />
    );
  return (
    <article className="n-card n-progs" id="progs" aria-labelledby="progs-h">
      <h3 className="n-section-title" id="progs-h">
        值得关注的项目
        <span className="n-count is-quiet">{block.data.length} 期</span>
      </h3>
      {block.data.length ? (
        <ul className="n-progs__list">
          {block.data.map((program) => (
            <Row key={program.id} program={program} />
          ))}
        </ul>
      ) : (
        <div className="nt-empty">{programsEmpty}</div>
      )}
    </article>
  );
}
