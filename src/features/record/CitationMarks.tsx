'use client';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import type { RecordScore } from './types';
import { copy } from './copy';

type Citations = Extract<RecordScore, { state: 'suggested' }>['citations'];

/**
 * 原话引用，照原型接在说明后面写成「锚点 4 · 引用「……」」。引文可以点，跳回「原话」
 * 高亮那段。放在说明所在的同一个元素里，note 的 flex 间距不会把它们隔开。
 */
export function InputQuotes({
  citations,
  onJumpInput,
}: {
  citations: Citations;
  onJumpInput: (range: { start: number; end: number; quote: string }) => void;
}) {
  return citations.map((citation) =>
    citation.kind === 'input' ? (
      <span key={`input:${citation.start}:${citation.end}`}>
        {copy.cite.inline}
        {/* 跳到同一页的「原话」：用页内链接，引文能像原型那样随文字折行。 */}
        <a
          className="n-score__quote"
          href="#ev-raw"
          title={copy.sbi.rawJump}
          onClick={(event) => {
            event.preventDefault();
            onJumpInput({
              start: citation.start,
              end: citation.end,
              quote: citation.quote,
            });
          }}
        >
          「{citation.quote}」
        </a>
      </span>
    ) : null,
  );
}

/** 来源引用（录音、附件整理出的草稿）的角标，展开时才读取原文。 */
export function SourceMarks({
  citations,
  loadSource,
}: {
  citations: Citations;
  loadSource: LoadSource;
}) {
  return citations
    .flatMap((citation) => (citation.kind === 'source' ? [citation] : []))
    .map((citation, position) => (
      <SourceCite
        key={`${citation.reference.fragmentId}:${citation.reference.originalVersionId}:${position}`}
        index={position + 1}
        source={citation.reference}
        loadSource={loadSource}
      />
    ));
}
