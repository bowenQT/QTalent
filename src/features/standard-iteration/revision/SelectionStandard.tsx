'use client';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import type {
  EffectiveRuleVersion,
  SelectionManagerRevision,
  SelectionRevision,
} from '@/contracts/selection-standard';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { monthDay } from '../copy';
import type {
  HrRevisionPorts,
  ManagerRevisionPorts,
  SelectionStandardContent,
} from '../ports';
import { HrRevision } from './HrRevision';
import { ManagerRevision } from './ManagerRevision';
import {
  ChangeTable,
  PointList,
  RevisionStateTag,
  standardIntro,
  standardName,
} from './parts';
import '../standard-iteration.css';

export type RevisionView =
  | { audience: 'hr'; revision: SelectionRevision; ports: HrRevisionPorts }
  | {
      audience: 'manager';
      revision: SelectionManagerRevision;
      ports: ManagerRevisionPorts;
    };

function Header({
  back,
  sealed,
  sealTitle,
  children,
}: {
  back: { href: string; label: string } | null;
  sealed: boolean;
  sealTitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="nt-head">
      <div>
        <h1>{standardName}</h1>
        <p>{standardIntro}</p>
      </div>
      <div className="nt-head__acts">
        {back ? (
          <a className="n-btn n-btn--ghost" href={back.href}>
            <Icon name="back" />
            {back.label}
          </a>
        ) : null}
        {sealed ? (
          <span
            className="n-seal n-seal--sm is-stamping"
            id="seal"
            title={sealTitle}
          >
            定
          </span>
        ) : null}
        {children}
      </div>
    </header>
  );
}

/** The standard in force, before anyone drafts: revisions start from 判断对照. */
export function SelectionStandardCurrent({
  version,
  content,
  draftHref,
}: {
  version: EffectiveRuleVersion;
  content: SelectionStandardContent;
  /** HR only: where a revision can be drafted from a confirmed attribution. */
  draftHref: string | null;
}) {
  return (
    <>
      <ShellTitle title={standardName} />
      <Header back={null} sealed={false} sealTitle="">
        {draftHref ? (
          <a className="n-btn n-btn--ink" href={draftHref}>
            <Icon name="pen" />
            去判断对照起草
          </a>
        ) : null}
      </Header>
      <article className="n-card">
        <div className="nt-row" style={{ marginBottom: 'var(--s-2)' }}>
          <h3 className="n-section-title" style={{ margin: 0 }}>
            {standardName}
          </h3>
          <span className="n-rule">
            <Icon name="doc" />
            生效中 {version.versionId}
          </span>
        </div>
        <PointList points={content.reviewPoints} />
        <p className="nt-muted" style={{ margin: 'var(--s-2) 0 0' }}>
          {monthDay(version.effectiveFrom)} 起生效 · 之后新建期次的默认版本
        </p>
        {draftHref ? (
          <p className="nt-caption" style={{ margin: 'var(--s-2) 0 0' }}>
            修订从判断对照里发起：只有你已确认、归因含「评价标准」的结论可以起草。
          </p>
        ) : null}
      </article>
    </>
  );
}

/** A revision of the selection standard, as HR edits it or the manager confirms it. */
export function SelectionRevisionPage({
  view,
  base,
  back,
}: {
  view: RevisionView;
  base: SelectionStandardContent;
  back: { href: string; label: string };
}) {
  const [sealed, setSealed] = useState(false);
  const { revision } = view;
  const open =
    view.audience === 'hr' || revision.state === 'pending_confirmation';
  return (
    <>
      <ShellTitle title={standardName} />
      <Header
        back={back}
        sealed={sealed}
        sealTitle={`确认发布 ${revision.versionId}`}
      >
        {!open ? (
          <RevisionStateTag
            state={revision.state}
            versionId={revision.versionId}
          />
        ) : null}
      </Header>
      {view.audience === 'hr' ? (
        <HrRevision
          initial={view.revision}
          base={base.reviewPoints}
          ports={view.ports}
          judgeHref={back.href}
        />
      ) : view.revision.state === 'pending_confirmation' ? (
        <ManagerRevision
          initial={view.revision}
          base={base.reviewPoints}
          ports={view.ports}
          onSeal={setSealed}
        />
      ) : (
        <article className="n-card">
          <h3 className="n-section-title">
            改了什么
            <span
              className="nt-muted"
              style={{ marginLeft: 'auto', fontWeight: 400 }}
            >
              {view.revision.humanVersion?.changes.length ?? 0} 处
            </span>
          </h3>
          {view.revision.humanVersion ? (
            <ChangeTable changes={view.revision.humanVersion.changes} />
          ) : (
            <p className="nt-muted" style={{ margin: 0 }}>
              HR 编辑后，改动会出现在这里。
            </p>
          )}
        </article>
      )}
    </>
  );
}
