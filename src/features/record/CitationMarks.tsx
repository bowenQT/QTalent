'use client';
import { Cite } from '@/components/ui/Cite';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import type { RecordScore } from './types';
import { copy } from './copy';

type Citations = Extract<RecordScore, { state: 'suggested' }>['citations'];

/**
 * 分数行 note 里的引用角标。原话引用直接展示引文，并能跳回「原话」高亮那段；
 * 来源引用（录音、附件整理出的草稿）展开时才读取原文。
 */
export function CitationMarks({
  citations,
  loadSource,
  onJumpInput,
}: {
  citations: Citations;
  loadSource: LoadSource;
  onJumpInput: (range: { start: number; end: number; quote: string }) => void;
}) {
  return (
    <>
      {citations.map((citation, position) => {
        const index = position + 1;
        if (citation.kind === 'source')
          return (
            <SourceCite
              key={`${citation.reference.fragmentId}:${citation.reference.originalVersionId}:${index}`}
              index={index}
              source={citation.reference}
              loadSource={loadSource}
            />
          );
        const { start, end, quote } = citation;
        return (
          <Cite
            key={`input:${start}:${end}:${index}`}
            index={index}
            markLabel={copy.cite.mark}
            access="granted"
            source={{
              kind: 'paragraph',
              title: copy.cite.inputTitle,
              location: copy.cite.inputLocation(start, end),
            }}
            quote={`「${quote}」`}
            jump={{
              label: copy.sbi.rawJump,
              onSelect: () => onJumpInput({ start, end, quote }),
            }}
          />
        );
      })}
    </>
  );
}
