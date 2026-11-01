'use client';
import type { Person as PersonData } from '@/contracts/person';
import type { LoadSource } from '@/features/sources/SourceCite';
import { FactsCard } from './FactsCard';
import { PersonHeader } from './PersonHeader';
import { ProjectsCard } from './ProjectsCard';
import { QuadrantCard } from './QuadrantCard';
import { SpectrumCard } from './SpectrumCard';
import { SummaryBlocks } from './SummaryBlocks';
import { Timeline } from './Timeline';

/**
 * 管理者与 HR 变体能看、但服务端还没有投影的三类记录：北森面评（BOW-906）、
 * 节点结论（BOW-902）、独立的管理观察（BOW-904）。契约里没有字段，导师变体的类别
 * 本来就不含它们。接通后从这里删掉对应一项。
 */
const MANAGEMENT_PENDING = ['北森面评', '节点结论', '独立管理观察'];

/**
 * 人员档案。哪些块出现只看服务端给的视角变体：导师变体在类型上就没有参考位置、
 * 校准与版本字段，这里不做任何权限判断。
 */
export function Person({
  data,
  loadSource,
}: {
  data: PersonData;
  loadSource: LoadSource;
}) {
  return (
    <>
      <PersonHeader data={data} />
      <div className="nt-split nt-split--wide">
        <div className="nt-grid">
          <FactsCard timeline={data.timeline} loadSource={loadSource} />
          <SummaryBlocks
            summary={data.summary}
            aiInferences={data.aiInferences}
            loadSource={loadSource}
          />
          <SpectrumCard data={data} />
          <Timeline
            timeline={data.timeline}
            asOf={data.asOf}
            pending={data.role === 'mentor' ? [] : MANAGEMENT_PENDING}
            loadSource={loadSource}
          />
        </div>
        <aside className="nt-grid">
          {data.role === 'mentor' ? null : (
            <QuadrantCard position={data.referencePosition} />
          )}
          <ProjectsCard projects={data.projects} />
        </aside>
      </div>
    </>
  );
}
