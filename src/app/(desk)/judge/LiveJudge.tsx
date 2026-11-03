'use client';
import { useRouter } from 'next/navigation';
import type { ComparisonHrPage } from '@/contracts/judgment-comparison';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from '@/contracts/standard-attribution';
import { JudgeBatch } from '@/features/standard-iteration/judge/JudgeBatch';
import type {
  AttributionPorts,
  SelectionStandardContent,
} from '@/features/standard-iteration/ports';
import {
  confirmStandardAttributionAction,
  createSelectionRevisionAction,
  generateStandardHypothesesAction,
} from '@/server/actions/standard-attribution';

const ports: AttributionPorts = {
  generate: generateStandardHypothesesAction,
  confirm: confirmStandardAttributionAction,
  createRevision: createSelectionRevisionAction,
};

/** HR's comparison batch with the attribution and drafting actions wired in. */
export function LiveJudge({
  page,
}: {
  page: {
    page: ComparisonHrPage;
    standard: SelectionStandardContent;
    currentVersionId: string | null;
    hypotheses: StandardAttributionHypothesis[];
    attributions: ConfirmedStandardAttribution[];
  };
}) {
  const router = useRouter();
  return (
    <JudgeBatch
      page={page.page}
      standard={page.standard}
      currentStandardVersionId={
        page.currentVersionId ?? page.page.batch.selectionStandardVersionId
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
