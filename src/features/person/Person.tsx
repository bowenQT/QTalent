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
