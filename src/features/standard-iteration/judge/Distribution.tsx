'use client';
import type { ComparisonMapping } from '@/contracts/judgment-comparison';
import { CaseCard } from './CaseCard';
import {
  frontSpread,
  groupByJudgment,
  outcomeColumn,
  outcomeState,
  outcomeText,
  restText,
  sortCases,
  tallyText,
  type DisplayCase,
  type JudgmentGroup,
} from './comparison-view';

const columns = [
  '前段低两档+',
  '前段低一档',
  '一致',
  '前段高一档',
  '前段高两档+',
];

function Row({
  group,
  mapping,
  open,
  onToggle,
  focusCaseId,
}: {
  group: JudgmentGroup;
  mapping: ComparisonMapping;
  open: boolean;
  onToggle: () => void;
  focusCaseId: string | null;
}) {
  const summary = tallyText(group.cases, mapping);
  const rest = restText(group.cases);
  const small = [rest, frontSpread(group.cases, mapping)]
    .filter(Boolean)
    .join(' · ');
  const cells = columns.map((_, index) =>
    group.cases.filter((unit) => outcomeColumn(unit.outcome) === index),
  );
  return (
    <div role="listitem">
      <button
        className="n-jdist__row"
        type="button"
        data-dim={group.id}
        aria-expanded={open}
        aria-label={`${group.name}：${summary}${rest ? `，${rest}` : ''}。${open ? '收起' : '展开'}案例`}
        onClick={onToggle}
      >
        <span className="n-jdist__dim">{group.name}</span>
        {cells.map((units, index) => (
          <span
            key={columns[index]}
            className={`n-jdist__cell${index === 2 ? ' is-mid' : ''}`}
            aria-hidden="true"
          >
            {units.map((unit) => (
              <span
                key={unit.id}
                className="n-jdot"
                data-s={outcomeState(unit.outcome)}
                title={`${unit.person.name} · ${outcomeText(unit.outcome)}`}
              >
                {unit.person.name.slice(0, 1)}
              </span>
            ))}
          </span>
        ))}
        <span className="n-jdist__sum">
          {summary}
          {small ? <small>{small}</small> : null}
        </span>
      </button>
      {open ? (
        <div
          className="nt-grid"
          style={{ gap: 0, padding: 'var(--s-3) 0 var(--s-4)' }}
        >
          {sortCases(group.cases).map((unit) => (
            <CaseCard
              key={unit.id}
              unit={unit}
              mappingVersionId={mapping.versionId}
              focused={unit.id === focusCaseId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One row per judgment; a row opens its cases. Only HR receives cases at all. */
export function Distribution({
  cases,
  mapping,
  open,
  onOpen,
  focusCaseId,
}: {
  cases: readonly DisplayCase[];
  mapping: ComparisonMapping;
  open: string | null;
  onOpen: (judgmentId: string | null) => void;
  focusCaseId: string | null;
}) {
  return (
    <article className="n-card" id="dims">
      <h3 className="n-section-title">
        按维度
        <small
          className="nt-muted"
          style={{ fontWeight: 400, marginLeft: 'auto' }}
        >
          每个点是一个人 · 点一行看案例
        </small>
      </h3>
      <div className="n-jdist" role="list">
        <div className="n-jdist__head" aria-hidden="true">
          <span />
          {columns.map((label, index) => (
            <span key={label} className={index === 2 ? 'is-mid' : undefined}>
              {index === 2 ? '一致' : label}
            </span>
          ))}
        </div>
        {groupByJudgment(cases).map((group) => (
          <Row
            key={group.id}
            group={group}
            mapping={mapping}
            open={open === group.id}
            onToggle={() => onOpen(open === group.id ? null : group.id)}
            focusCaseId={focusCaseId}
          />
        ))}
      </div>
      <p className="nt-caption">
        前段和后段按对应表 {mapping.versionId}{' '}
        换算到同一档后对照，偏差人数只算可对照的案例。
      </p>
    </article>
  );
}

/** Lets a parent pick the open row for a case (from an attribution's citation). */
export function judgmentOf(
  cases: readonly DisplayCase[],
  caseId: string,
): string | null {
  return cases.find((unit) => unit.id === caseId)?.judgment.id ?? null;
}
