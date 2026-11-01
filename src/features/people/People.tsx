'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { PeopleList, QuickView } from '@/contracts/people';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Chips, Count } from '@/components/ui/Chips';
import { Peek, usePeek } from '@/components/ui/Peek';
import {
  allTeams,
  groups,
  kinds,
  monthDay,
  onlyBatch,
  reference,
  rowMeta,
  teams,
  visible,
  type Filter,
  type Kind,
} from './people-view';
import './people.css';

const profile = (id: string) => `/person?id=${encodeURIComponent(id)}`;
const peekKey = (id: string) => `p:${id}`;

function Demo({ view }: { view: QuickView }) {
  return view.person.demo ? <Badge tone="demo">演示</Badge> : null;
}

function Position({ view }: { view: QuickView }) {
  const position = reference(view);
  if (!position) return null;
  if (position.state === 'placed')
    return (
      <Badge
        tone="ai"
        icon="spark"
        title="还没有正式校准，这是系统按已确认分数算的参考位置"
      >
        参考：{position.label}
      </Badge>
    );
  return (
    <span title={position.reason}>
      <Badge tone="unknown" icon="dash">
        {position.state === 'insufficient' ? '资料不足' : '暂时无法判断'}
      </Badge>
    </span>
  );
}

/** One person's quick view, from the list payload only: no second read. */
function QuickViewBody({ view }: { view: QuickView }) {
  const { person, recentFacts, capabilityLines } = view;
  const href = profile(person.id);
  return (
    <>
      <header className="n-peek__head">
        <Avatar
          name={person.name}
          hue={person.hue}
          photo={person.photo}
          size="lg"
        />
        <div>
          <h2 id="peek-h">
            {person.name}
            <Demo view={view} />
          </h2>
          <p>
            {[person.teamName, person.jobTitle, person.tenureLabel]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>
      <section className="n-peek__sec">
        <h3>
          关键事实
          {recentFacts.status === 'ready' ? (
            <Link className="n-link" href={`${href}#timeline`}>
              查看全部
            </Link>
          ) : null}
        </h3>
        {recentFacts.status === 'ready' ? (
          <ol className="n-peek__facts">
            {recentFacts.data.map((fact) => (
              <li key={fact.eventId}>
                <span className="n-peek__date">
                  {monthDay(fact.occurredOn)}
                </span>
                <span>
                  {fact.title}
                  <small>
                    {[fact.projectName, `${fact.recorderName}记录`]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="nt-muted">
            {recentFacts.status === 'empty'
              ? '还没有你能看到的关键事件。'
              : recentFacts.reason}
          </p>
        )}
      </section>
      <section className="n-peek__sec">
        <h3>能力线索</h3>
        {capabilityLines.status === 'ready' ? (
          <>
            <ul className="n-peek__caps">
              {capabilityLines.data.lines.map((line) => (
                <li key={line.dimensionId}>
                  <b>{line.dimensionLabel}</b>
                  <span>{line.eventCount} 件事</span>
                  <small>{line.topAnchor}</small>
                </li>
              ))}
            </ul>
            {capabilityLines.data.uncoveredCount ? (
              <p className="nt-muted">
                其余 {capabilityLines.data.uncoveredCount}{' '}
                个维度资料不足，补充材料后出分。
              </p>
            ) : null}
          </>
        ) : (
          <p className="nt-muted">
            {capabilityLines.status === 'empty'
              ? '维度分待确认。'
              : capabilityLines.reason}
          </p>
        )}
      </section>
      <footer className="n-peek__foot">
        <Link className="n-btn n-btn--sm n-btn--ink" href={href}>
          打开档案
        </Link>
      </footer>
    </>
  );
}

/**
 * 人才 / 所带学员 (prototype people.html, the 人员 tab). Rows keep the server's
 * order (team, then name, by pinyin); no score, position or capability sorts them.
 * A plain click on a row opens the quick view; ⌘ / Ctrl / Shift click opens the profile.
 */
export function People({
  data,
  mentor,
}: {
  data: PeopleList;
  mentor: boolean;
}) {
  const [filter, setFilter] = useState<Filter>({
    query: '',
    teamId: allTeams,
    kind: 'all',
  });
  const peek = usePeek();
  const quad = data.role !== 'mentor';
  const teamList = teams(data.people);
  const shown = visible(data.people, filter);
  const opened = data.people.find(
    (view) => peekKey(view.person.id) === peek.openKey,
  );
  const batch = onlyBatch(data.people);
  const list = (
    <>
      <div className="nt-filter">
        <input
          className="n-input"
          type="search"
          placeholder="按姓名或岗位筛选"
          aria-label="按姓名或岗位筛选"
          value={filter.query}
          onChange={(event) =>
            setFilter({ ...filter, query: event.target.value })
          }
        />
        {teamList.length > 1 ? (
          <select
            className="n-select"
            aria-label="团队"
            value={filter.teamId}
            onChange={(event) =>
              setFilter({ ...filter, teamId: event.target.value })
            }
          >
            <option value={allTeams}>全部团队</option>
            {teamList.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        ) : null}
        <Chips
          label="筛选"
          items={kinds(data)}
          selected={[filter.kind]}
          onSelect={(kind) => setFilter({ ...filter, kind: kind as Kind })}
        />
      </div>
      <div id="plist">
        {shown.length ? (
          groups(shown).map((group) => (
            <div key={group.teamId}>
              <div className="nt-h2 nt-team">
                {group.teamPath} · {group.people.length} 人
              </div>
              <div className="n-card nt-rows">
                {group.people.map((view) => (
                  <Link
                    key={view.person.id}
                    className="n-person-row nt-plink"
                    href={profile(view.person.id)}
                    {...peek.triggerProps(peekKey(view.person.id))}
                  >
                    <div className="n-person">
                      <Avatar
                        name={view.person.name}
                        hue={view.person.hue}
                        photo={view.person.photo}
                        size=""
                      />
                      <div>
                        <div className="n-person__name">
                          {view.person.name}
                          <Demo view={view} />
                        </div>
                        <div className="n-person__meta">{rowMeta(view)}</div>
                      </div>
                    </div>
                    <Position view={view} />
                  </Link>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="nt-empty">
            {data.total
              ? '换个筛选条件试试。'
              : mentor
                ? '还没有分给你的学员。'
                : '你的查看范围里还没有人。'}
          </div>
        )}
      </div>
      {quad && data.total ? (
        <p className="nt-caption">
          右侧是系统按已确认分数算的参考位置，不是正式校准的结论。
        </p>
      ) : null}
    </>
  );
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{mentor ? '所带学员' : '人才'}</h1>
          <p>
            {mentor
              ? `你${batch ? `在 ${batch}` : ''}带的学员，每位学员的全部评价都在档案里。`
              : `你能查看的 ${data.total} 人，按团队和姓名排列。`}
          </p>
        </div>
      </header>
      {/* 重点跟踪 and 值得聊一聊 are other cards: the one tab left needs no switching. */}
      <div className="n-tabs" role="tablist" aria-label="人员">
        <button
          type="button"
          role="tab"
          id="pt-list"
          aria-selected="true"
          aria-controls="pp-list"
        >
          {mentor ? '学员' : '人员'}
          {data.total ? <Count tone="quiet">{data.total}</Count> : null}
        </button>
      </div>
      <div
        className="n-tabpanel"
        role="tabpanel"
        id="pp-list"
        aria-labelledby="pt-list"
      >
        {list}
      </div>
      <Peek
        open={Boolean(opened)}
        onClose={peek.close}
        labelledBy="peek-h"
        contentKey={peek.openKey}
      >
        {opened ? <QuickViewBody view={opened} /> : null}
      </Peek>
    </>
  );
}
