import type { Person } from '@/contracts/person';
import { Badge } from '@/components/ui/Badge';
import { quadrantNames } from '@/components/ui/MiniQuad';
import { QUADRANT } from './person-view';

type ManagerPerson = Extract<Person, { role: 'manager' | 'hr' }>;

/**
 * 能力象限：只有系统给出的参考位置（AI 徽标，不是正式位置）。正式位置、重新校准提示
 * 依赖冻结快照，校准接入前不渲染。
 */
export function QuadrantCard({
  position,
}: {
  position: ManagerPerson['referencePosition'];
}) {
  return (
    <article className="n-card">
      <h3 className="n-section-title">能力象限</h3>
      <dl className="nt-dl">
        <dt>参考位置</dt>
        <dd>
          {position.status === 'ready' ? (
            <>
              <Badge tone="ai" icon="spark">
                {quadrantNames[QUADRANT[position.data.quadrant]]}
              </Badge>
              {position.data.bonus ? (
                <>
                  {' '}
                  <Badge>加分项 ≥ 4</Badge>
                </>
              ) : null}{' '}
              <span className="nt-muted">按当前评价规则</span>
            </>
          ) : (
            <>
              <Badge tone="unknown" icon="dash">
                {position.status === 'unknown' ? '未知' : '资料不足'}
              </Badge>{' '}
              <span className="nt-muted">{position.reason}</span>
            </>
          )}
        </dd>
      </dl>
      {position.status === 'insufficient_evidence' ? (
        <p className="nt-caption">
          落位门槛：每条轴至少 2
          条来自不同事件的已确认分数，潜力核心三项至少两项有分。
        </p>
      ) : null}
    </article>
  );
}
