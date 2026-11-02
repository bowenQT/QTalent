'use client';
import { useRouter } from 'next/navigation';
import { JudgeBatch } from '@/features/standard-iteration/judge/JudgeBatch';
import type { AttributionPorts } from '@/features/standard-iteration/ports';
import {
  confirmStandardAttributionAction,
  createSelectionRevisionAction,
  generateStandardHypothesesAction,
} from '@/server/actions/standard-attribution';
import type { JudgePage } from '@/server/queries/judge';

const ports: AttributionPorts = {
  generate: generateStandardHypothesesAction,
  confirm: confirmStandardAttributionAction,
  createRevision: createSelectionRevisionAction,
};

/** HR's comparison batch with the attribution and drafting actions wired in. */
export function LiveJudge({
  page,
}: {
  page: Extract<JudgePage, { status: 'hr' }>;
}) {
  const router = useRouter();
  return (
    <JudgeBatch
      page={page.page}
      standard={page.standard?.content ?? null}
      currentStandardVersionId={
        page.standard?.versionId ?? page.page.batch.selectionStandardVersionId
      }
      initialHypotheses={
        page.hypotheses.length
          ? { status: 'ready', items: page.hypotheses }
          : { status: 'idle' }
      }
      initialAttributions={page.attributions}
      ports={ports}
      raterHref={(id) => `/judge?${new URLSearchParams({ rater: id })}`}
      onDrafted={(draftId) =>
        router.push(
          `/rules?${new URLSearchParams({ r: 'front', line: 'xe-select', draft: draftId })}`,
        )
      }
    />
  );
}
