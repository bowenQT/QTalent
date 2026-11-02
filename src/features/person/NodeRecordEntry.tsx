'use client';
import { Src } from '@/components/ui/Src';
import { formatLocation } from '@/features/sources/source-format';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import { OriginalScale } from './OriginalScale';
import type { NodeRecord } from './node-records';
import { monthDay } from './person-view';

function Cites({
  record,
  loadSource,
}: {
  record: NodeRecord;
  loadSource: LoadSource;
}) {
  return record.sources.map((source, index) => (
    <SourceCite
      key={`${source.fragmentId}-${index}`}
      source={source}
      index={index + 1}
      loadSource={loadSource}
    />
  ));
}

/**
 * 时间线里与评价节点相关的一条：北森面评（原量表单独保存）、节点结论（人工署名、按版本）、
 * 独立管理观察（写明谁、何时，不出分）。样式沿用原型 `person.js` 的时间线条目。
 */
export function NodeRecordEntry({
  record,
  loadSource,
}: {
  record: NodeRecord;
  loadSource: LoadSource;
}) {
  const cites = <Cites record={record} loadSource={loadSource} />;
  let dot = ' is-hist';
  let title: string;
  let meta;
  let body = null;
  if (record.kind === 'interview') {
    title = record.title;
    meta = (
      <>
        <Src kind="fact" label="历史资料" />
        {formatLocation(record.sources[0].location)}
        {cites}
        {` · 面试官 ${record.interviewerName}`}
        {record.interviewerUnconfirmed ? '（写的人待确认）' : null}
        {` · ${record.importedByName} ${monthDay(record.importedOn)} 导入`}
      </>
    );
    body = (
      <>
        <OriginalScale items={record.scale} separate />
        <div className="n-tl__note">
          北森面评原样保存，是档案里最早的一段判断；AI
          打分时可以引用其中的文字评价。
        </div>
      </>
    );
  } else if (record.kind === 'node_conclusion') {
    title = `节点结论 · ${record.conclusion}`;
    meta = (
      <>
        <Src kind="human" />
        {`${record.nodeName} · ${record.confirmedByName} ${monthDay(record.occurredOn)} 确认 · 第 ${record.version} 版`}
        {cites}
        {' · 人事动作另行办理'}
      </>
    );
    body = <div className="n-tl__note">{record.basis}</div>;
  } else {
    dot = '';
    title = record.text;
    meta = (
      <>
        <Src kind="obs" />
        {`${record.authorName} · ${monthDay(record.recordedOn)} 记录`}
        {cites}
      </>
    );
  }
  return (
    <li className="n-tl__item" id={`ev-${record.id}`}>
      <span className="n-tl__date">{monthDay(record.occurredOn)}</span>
      <span className={`n-tl__dot${dot}`}></span>
      <div className="n-tl__body">
        <div className="n-tl__title">{title}</div>
        <div className="n-tl__meta">{meta}</div>
        {body}
      </div>
    </li>
  );
}
