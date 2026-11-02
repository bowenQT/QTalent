import type { Person } from '@/contracts/person';
import { Block } from '@/components/ui/Block';
import type { SourceReference } from '@/contracts/sources';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import { BlockState } from './BlockState';
import { monthDay } from './person-view';

function Cites({
  sources,
  loadSource,
}: {
  sources: readonly SourceReference[];
  loadSource: LoadSource;
}) {
  return sources.map((source, index) => (
    <SourceCite
      key={`${source.fragmentId}\u0000${source.originalVersionId}`}
      source={source}
      index={index + 1}
      loadSource={loadSource}
    />
  ));
}

/**
 * 摘要区只有两类：署名、有日期的人工结论（墨），和 AI 推断（光，不署名、不进分数）。
 * 不在客户端拼摘要；两块都没有内容时整块不出现。
 */
export function SummaryBlocks({
  summary,
  aiInferences,
  loadSource,
}: {
  summary: Person['summary'];
  aiInferences: Person['aiInferences'];
  loadSource: LoadSource;
}) {
  const parts = [
    summary.status === 'ready'
      ? summary.data.map((conclusion) => (
          <Block
            key={conclusion.id}
            authorship="human"
            signer={conclusion.authorName}
            meta={`${monthDay(conclusion.at)} 确认`}
          >
            {conclusion.text}
            <Cites sources={conclusion.sources} loadSource={loadSource} />
          </Block>
        ))
      : summary.status === 'empty'
        ? []
        : [<BlockState key="summary" block={summary} empty="" />],
    aiInferences.status === 'ready'
      ? aiInferences.data.map((inference) => (
          <Block
            key={inference.id}
            authorship="ai"
            label="AI 推断"
            basis={`依据 ${inference.sources.length} 条来源 · 只用你有权限查看的资料`}
          >
            {inference.text}
            <Cites sources={inference.sources} loadSource={loadSource} />
          </Block>
        ))
      : aiInferences.status === 'empty'
        ? []
        : [<BlockState key="ai" block={aiInferences} empty="" />],
  ].flat();
  if (!parts.length) return null;
  return (
    <div id="summary" className={parts.length > 1 ? 'nt-grid' : undefined}>
      {parts}
    </div>
  );
}
