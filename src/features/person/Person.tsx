'use client';
import type { Person as PersonData } from '@/contracts/person';
import type { LoadSource } from '@/features/sources/SourceCite';
import { FactsCard } from './FactsCard';
import {
  NODE_RECORDS_NOT_CONNECTED,
  pendingNodeRecords,
  readyNodeRecords,
  type NodeRecords,
} from './node-records';
import { PersonHeader } from './PersonHeader';
import { ProjectsCard } from './ProjectsCard';
import { QuadrantCard } from './QuadrantCard';
import { SpectrumCard } from './SpectrumCard';
import { SummaryBlocks } from './SummaryBlocks';
import { Timeline } from './Timeline';

/**
 * 人员档案。哪些块出现只看服务端给的视角变体：导师变体在类型上就没有参考位置、
 * 校准与版本字段，这里不做任何权限判断。
 *
 * `nodeRecords` 是管理者与 HR 变体的三类节点记录：北森面评（BOW-906）、节点结论
 * （BOW-902）、独立管理观察（BOW-904）。没接通的类别列为「待接入」；导师变体的类别
 * 本来就不含它们，传了也不显示。
 */
export function Person({
  data,
  nodeRecords = NODE_RECORDS_NOT_CONNECTED,
  loadSource,
}: {
  data: PersonData;
  nodeRecords?: NodeRecords;
  loadSource: LoadSource;
}) {
  const mentor = data.role === 'mentor';
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
            records={mentor ? [] : readyNodeRecords(nodeRecords)}
            pending={mentor ? [] : pendingNodeRecords(nodeRecords)}
            loadSource={loadSource}
          />
        </div>
        <aside className="nt-grid">
          {mentor ? null : <QuadrantCard position={data.referencePosition} />}
          <ProjectsCard projects={data.projects} />
        </aside>
      </div>
    </>
  );
}
