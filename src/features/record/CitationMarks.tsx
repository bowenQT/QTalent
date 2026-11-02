'use client';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import type { RecordScore } from './types';
import { copy } from './copy';

type Citations = Extract<RecordScore, { state: 'suggested' }>['citations'];

/** 原话引用，照原型作为说明里的普通文字接在后面：「锚点 4 · 引用「……」」。 */
export function InputQuotes({ citations }: { citations: Citations }) {
  return citations.map((citation) =>
    citation.kind === 'input'
      ? `${copy.cite.inline}「${citation.quote}」`
      : null,
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
