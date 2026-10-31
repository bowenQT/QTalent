import type { Person } from '@/contracts/person';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { headerFirstLine, headerSecondLine } from './person-view';

/** 头部只有身份；记一件事、关注、推荐、重点跟踪等动作等对应链路上线再加。 */
export function PersonHeader({ data }: { data: Person }) {
  const { person } = data;
  const second = headerSecondLine(data);
  return (
    <header className="nt-head" style={{ alignItems: 'center' }}>
      <div className="n-person">
        <Avatar
          name={person.name}
          hue={person.hue}
          photo={person.photo}
          size="lg"
        />
        <div>
          <div className="n-person__name" role="heading" aria-level={1}>
            {person.name}
            {person.demo ? <Badge tone="demo">演示</Badge> : null}
          </div>
          <div className="n-person__meta">{headerFirstLine(data)}</div>
          {second ? <div className="n-person__meta">{second}</div> : null}
        </div>
      </div>
    </header>
  );
}
