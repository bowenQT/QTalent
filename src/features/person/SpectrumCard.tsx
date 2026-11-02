import type { Person } from '@/contracts/person';
import { MiniQuad } from '@/components/ui/MiniQuad';
import { Spectrum } from '@/components/ui/Spectrum';
import { BlockState } from './BlockState';
import {
  QUADRANT,
  QUADRANT_CENTER,
  ruleVersions,
  spectrumGroups,
} from './person-view';

type ManagerPerson = Extract<Person, { role: 'manager' | 'hr' }>;

/**
 * 小象限只画 2×2 和当前参考位置。校准轨迹还没接入，所以不画历次点，也不写
 * 「还没有正式校准」：未接入不等于没有。
 */
function ReferenceMiniQuad({
  position,
}: {
  position: ManagerPerson['referencePosition'];
}) {
  if (position.status !== 'ready')
    return (
      <MiniQuad
        calibrations={[]}
        reference={{ state: 'insufficient' }}
        emptyCaption={null}
      />
    );
  const quadrant = QUADRANT[position.data.quadrant];
  return (
    <MiniQuad
      calibrations={[]}
      reference={{ state: 'placed', quadrant, ...QUADRANT_CENTER[quadrant] }}
      emptyCaption={null}
    />
  );
}

/** 个人能力谱：每个维度自己的分布、均值和条数；导师视角没有小象限。 */
export function SpectrumCard({ data }: { data: Person }) {
  const profile = data.capabilityProfile;
  const quad =
    data.role === 'mentor' ? null : (
      <ReferenceMiniQuad position={data.referencePosition} />
    );
  const head = (count: number | null, versions: string) => (
    <>
      <div>
        <h3 className="n-section-title" style={{ margin: 0 }}>
          个人能力谱
        </h3>
        <div className="nt-muted">
          详细维度 · 近 12 个月
          {count === null ? null : <> · 已确认 {count} 条事件分</>} ·{' '}
          <span title={versions || undefined}>评价规则</span>
        </div>
      </div>
      {quad}
    </>
  );
  if (profile.status !== 'ready')
    return (
      <article className="n-card n-spectrum" id="spectrum">
        <div className="n-spectrum__head">{head(null, '')}</div>
        <BlockState block={profile} empty="确认后的事件分会出现在这里" />
      </article>
    );
  return (
    <div id="spectrum">
      <Spectrum
        groups={spectrumGroups(profile.data, data.person.level, data.asOf)}
        header={head(
          profile.data.scores.length,
          ruleVersions(profile.data).join('、'),
        )}
      />
    </div>
  );
}
