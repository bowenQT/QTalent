'use client';
import { Badge } from '@/components/ui/Badge';
import { copy } from './copy';
import type { AnchorFocus } from './ScoreList';
import type { AnchorMap, AnchorSet, DimensionOption } from './types';

/** 心性维度的锚点全公司一套，不随被记录人变；页面读取时一并给出。 */
export type IdleAnchor = { dimensionId: string; set: AnchorSet };

export type AnchorLoad =
  | { status: 'loading' }
  | { status: 'ready'; map: AnchorMap }
  | { status: 'error' };

/**
 * 右栏锚点面板：始终展开，悬停或聚焦某一分时命中对应档。
 * 五档文字按（规则版本、被记录人的岗位族、维度）读取；读取失败时说明并给重试，改分随之锁定。
 */
export function AnchorPanel({
  focus,
  load,
  dimensions,
  idle,
  onRetry,
}: {
  focus: AnchorFocus | null;
  load: AnchorLoad;
  dimensions: readonly DimensionOption[];
  /** 还没有分可看时（写原话、没有建议分）显示的一套，原型默认是内生动力。 */
  idle?: IdleAnchor;
  onRetry: () => void;
}) {
  const dimensionId = focus ? focus.dimensionId : idle?.dimensionId;
  const dimensionName =
    dimensions.find((d) => d.id === dimensionId)?.name ??
    copy.score.unknownDimension;
  const set = focus
    ? load.status === 'ready'
      ? load.map[focus.personId]?.[focus.dimensionId]
      : undefined
    : idle?.set;
  return (
    <div className="n-anchor" id="anchor">
      {set ? (
        <>
          <b>{copy.anchor.title(dimensionName)}</b>{' '}
          <Badge style={{ marginLeft: 6 }}>{set.ruleVersion}</Badge>
          {set.family ? (
            <p className="nt-muted" style={{ margin: '4px 0 0' }}>
              {set.family}
            </p>
          ) : null}
          <ol>
            {set.levels.map((text, index) => (
              <li
                key={index}
                data-v={index + 1}
                className={focus?.hit === index + 1 ? 'is-hit' : undefined}
              >
                <b>{index + 1}</b>
                {text}
              </li>
            ))}
          </ol>
        </>
      ) : load.status === 'error' && focus ? (
        <p role="alert" className="nt-muted">
          {copy.anchor.failed}{' '}
          <button type="button" className="n-link" onClick={onRetry}>
            {copy.anchor.retry}
          </button>
        </p>
      ) : (
        <p className="nt-muted" role={focus ? 'status' : undefined}>
          {focus && load.status === 'loading'
            ? copy.anchor.loading
            : copy.anchor.idle}
        </p>
      )}
    </div>
  );
}
