import { Icon } from '@/components/ui/Icon';
import type {
  SelectionImpactPreview,
  SelectionReviewPointChange,
} from '@/contracts/selection-standard';
import { monthDay } from '../copy';
import {
  boundText,
  diffParts,
  keptResults,
  pointText,
  stateLabel,
  stateTone,
  type RevisionState,
} from './revision-view';

export const standardName = 'XEngineer 入营选拔标准';
export const standardIntro =
  '社招面试、入营选拔怎么评，和入职后的维度怎么对照；判断对照以它为准。';

export function Diff({ from, to }: { from: string; to: string }) {
  const { head, removed, added, tail } = diffParts(from, to);
  return (
    <span className="n-diff">
      {head}
      {removed ? <del>{removed}</del> : null}
      {added ? <ins>{added}</ins> : null}
      {tail}
    </span>
  );
}

export function RevisionStateTag({
  state,
  versionId,
}: {
  state: RevisionState;
  versionId?: string;
}) {
  return (
    <span className="n-rstate" data-s={stateTone[state]}>
      {stateLabel[state]}
      {versionId ? ` ${versionId}` : ''}
    </span>
  );
}

const kindLabel = { add: '新增要点', remove: '删除要点', edit: '修改要点' };

/** 改了什么: one row per changed review point. */
export function ChangeTable({
  changes,
}: {
  changes: readonly SelectionReviewPointChange[];
}) {
  return (
    <table className="nt-table">
      <tbody>
        {changes.map((change) => {
          const point = change.kind === 'add' ? change.after : change.before;
          return (
            <tr key={point.id}>
              <th scope="row" style={{ width: '1%', whiteSpace: 'nowrap' }}>
                {kindLabel[change.kind]}
              </th>
              <td>
                {change.kind === 'edit' ? (
                  <Diff
                    from={pointText(change.before)}
                    to={pointText(change.after)}
                  />
                ) : change.kind === 'add' ? (
                  <span className="n-diff">
                    <ins>{pointText(change.after)}</ins>
                  </span>
                ) : (
                  <span className="n-diff">
                    <del>{pointText(change.before)}</del>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 生效点 for the selection standard: published means default for cohorts created after. */
export function EffectText({
  preview,
  baseVersionId,
}: {
  preview: SelectionImpactPreview;
  baseVersionId: string;
}) {
  const bound = boundText(preview, baseVersionId);
  return (
    <>
      <b>确认发布即生效</b>
      ：成为之后新建期次的默认版本；已建立的期次保持建立时绑定的版本
      {bound ? `（${bound}保持 ${baseVersionId}）` : ''}。
      {preview.nextCohort.name}还在筹备，建立时绑定当时的默认版本。
    </>
  );
}

export const compatText = (baseVersionId: string) =>
  `选拔标准只影响之后新建的期次怎么评；已有的选拔记录和判断对照保持 ${baseVersionId}。`;

/**
 * Scope, kept cohorts and counts, summary basis. No names and no score changes: the
 * standard changes how later cohorts are judged, existing people and scores stay.
 */
export function ImpactPreview({
  preview,
  basisLines,
}: {
  preview: SelectionImpactPreview;
  basisLines: readonly string[];
}) {
  const bindings = preview.preservedBindings;
  return (
    <>
      <div className="n-scope" style={{ marginTop: 0 }}>
        <div>
          适用范围<b>之后新建的期次</b>
        </div>
        <div>
          保持原版本的期次<b>{bindings.length} 期</b>
        </div>
        <div>
          保持旧版的选拔记录<b>{keptResults(preview)} 条</b>
        </div>
        <div>
          汇总依据<b>{basisLines.length} 条</b>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 'var(--t-sm)', lineHeight: 1.7 }}>
        {preview.nextCohort.name}
        还在筹备，建立时绑定当时的默认版本。
        {bindings
          .map(
            (binding) =>
              `${binding.cohort.name}建立时绑定 ${binding.standardVersionId}`,
          )
          .join('，')}
        ，{keptResults(preview)}{' '}
        条选拔记录和已有的判断对照继续按原版本，结果保持当时的样子；下一次判断对照按选拔标准版本分组。
      </p>
      {basisLines.length ? (
        <ul className="n-impact__basis">
          {basisLines.map((line) => (
            <li key={line}>
              <Icon name="split" size={12} />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="nt-caption">
        影响预览只看适用范围、保持原版本的期次与条数和汇总依据；选拔标准改的是之后的期次怎么评，已有的人和分数保持原样。
      </p>
    </>
  );
}

export function ImpactCard({
  preview,
  basisLines,
  note,
}: {
  preview: SelectionImpactPreview;
  basisLines: readonly string[];
  note: string;
}) {
  return (
    <article className="n-card" id="impact">
      <h3 className="n-section-title">
        影响预览
        <span
          className="nt-muted"
          style={{ marginLeft: 'auto', fontWeight: 400 }}
        >
          {note} · {monthDay(preview.generatedAt)} 计算
        </span>
      </h3>
      <ImpactPreview preview={preview} basisLines={basisLines} />
    </article>
  );
}

/** Read-only review points of a version, numbered like anchors. */
export function PointList({
  points,
}: {
  points: readonly { id: string; title: string; description: string }[];
}) {
  return (
    <div
      className="n-anchor"
      style={{ boxShadow: 'none', padding: 0, background: 'none' }}
    >
      <ol>
        {points.map((point, index) => (
          <li key={point.id}>
            <b>{index + 1}</b>
            <span>{pointText(point)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
