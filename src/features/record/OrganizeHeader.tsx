'use client';
import { Niu } from '@/components/brand/Niu';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { copy } from './copy';
import type { PersonOption, ProjectOption } from './types';

type NiuState = Parameters<typeof Niu>[0]['state'];

/** 整理中、待选择、待确认、已保存阶段的头部：人、项目、来源、小犇。 */
export function OrganizeHeader({
  personIds,
  people,
  project,
  origin,
  demo,
  niu,
}: {
  /** 草稿里已确定的人；识别前为空。 */
  personIds: readonly string[];
  people: readonly PersonOption[];
  project: ProjectOption | null;
  origin: 'text' | 'recording' | 'attachment';
  demo: boolean;
  niu: NiuState;
}) {
  const [first, ...others] = personIds;
  const main = people.find((person) => person.id === first);
  const names = others.map(
    (id) =>
      people.find((person) => person.id === id)?.name ??
      copy.header.unknownPerson,
  );
  return (
    <div className="n-event__head" id="ev-head">
      {first ? (
        <>
          {main ? (
            <Avatar name={main.name} hue={main.hue} photo={main.photo} />
          ) : null}
          <b className="n-event__who">
            {main?.name ?? copy.header.unknownPerson}
          </b>
        </>
      ) : (
        <span>{copy.live.organizing}</span>
      )}
      {project ? (
        <Badge icon="folder">
          {copy.header.project(project.kind, project.name)}
        </Badge>
      ) : null}
      {demo ? <Badge tone="demo">{copy.header.demo}</Badge> : null}
      {origin === 'recording' ? (
        <Badge>{copy.header.fromRecording}</Badge>
      ) : null}
      {origin === 'attachment' ? (
        <Badge>{copy.header.fromAttachment}</Badge>
      ) : null}
      {names.length > 0 ? (
        <Badge>{copy.header.alsoFor(names.join(copy.saved.peopleJoin))}</Badge>
      ) : null}
      <span className="n-event__ip">
        <Niu size={36} state={niu} />
      </span>
    </div>
  );
}
