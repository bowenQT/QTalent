import type { CSSProperties } from 'react';
import type { ProjectCard as Project } from '@/contracts/projects';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { formatProjectDate } from './project-state';
const statusClasses = {
  筹备中: 'prep',
  进行中: 'yes',
  已结束: 'ended',
  已归档: 'archived',
};
export function ProjectCard({
  project: p,
  canFindOwner,
}: {
  project: Project;
  canFindOwner: boolean;
}) {
  const ended = p.status === '已结束' || p.status === '已归档';
  return (
    <article className="n-card n-project" data-project-id={p.id}>
      <div className="n-project__head">
        <span
          className="n-avatar"
          style={{ '--hue': 220, borderRadius: 10 } as CSSProperties}
        >
          <Icon name="folder" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="n-project__name">
            <a
              className="nt-plink"
              href={`/project?id=${encodeURIComponent(p.id)}`}
            >
              {p.name}
            </a>
          </h3>
          <p className="n-project__goal">{p.goal}</p>
        </div>
        <span className={`n-badge n-badge--${statusClasses[p.status]}`}>
          {p.status === '已归档' ? <Icon name="archive" /> : null}
          {p.status}
        </span>
      </div>
      <div className="nt-muted" style={{ marginTop: 'var(--s-2)' }}>
        {p.type} · {p.orgName} · {formatProjectDate(p.from)} –{' '}
        {formatProjectDate(p.to)}
      </div>
      {p.owner ? (
        <div className="n-project__members">
          {p.members.slice(0, 6).map((person) => (
            <Avatar key={person.id} {...person} />
          ))}
          <span>
            owner {p.owner.name}
            {p.memberCount
              ? ` · ${p.memberCount} 人${ended ? '参与' : ''}`
              : ''}
          </span>
        </div>
      ) : (
        <div className="n-ownerless" style={{ marginTop: 'var(--s-4)' }}>
          <span className="n-slot__empty">
            <Icon name="plus" size={14} />
          </span>
          <div>
            <b>owner 待定</b>
            <div className="nt-muted">{p.status}</div>
          </div>
          {canFindOwner ? (
            <a
              className="n-btn n-btn--sm n-btn--light"
              href={`/staffing?project=${encodeURIComponent(p.id)}`}
            >
              <Icon name="spark" />
              发起找 owner
            </a>
          ) : null}
        </div>
      )}
    </article>
  );
}
