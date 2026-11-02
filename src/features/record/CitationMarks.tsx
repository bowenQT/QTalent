'use client';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import type { RecordScore } from './types';
import { copy } from './copy';

type Citations = Extract<RecordScore, { state: 'suggested' }>['citations'];
type Citation = Citations[number];

/** 引用的是本页写下的原话（批次的文字材料）。 */
function fromInput(citation: Citation, inputFragmentId: string | undefined) {
  return (
    inputFragmentId !== undefined &&
    citation.reference.fragmentId === inputFragmentId
  );
}

/** 原话引用，照原型作为说明里的普通文字接在后面：「锚点 4 · 引用「……」」。 */
export function InputQuotes({
  citations,
  inputFragmentId,
}: {
  citations: Citations;
  inputFragmentId: string | undefined;
}) {
  return citations.map((citation) =>
    fromInput(citation, inputFragmentId)
      ? `${copy.cite.inline}「${citation.quote}」`
      : null,
  );
}

/** 其他来源（录音、附件）的引用角标，展开时才读取原文。 */
export function SourceMarks({
  citations,
  inputFragmentId,
  loadSource,
}: {
  citations: Citations;
  inputFragmentId: string | undefined;
  loadSource: LoadSource;
}) {
  return citations
    .filter((citation) => !fromInput(citation, inputFragmentId))
    .map((citation, position) => (
      <SourceCite
        key={`${citation.reference.fragmentId}:${citation.reference.originalVersionId}:${position}`}
        index={position + 1}
        source={citation.reference}
        loadSource={loadSource}
      />
    ));
}
