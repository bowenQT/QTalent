'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { State } from '@/components/ui/State';
import { JudgeBatch } from '@/features/standard-iteration/judge/JudgeBatch';
import { JudgeManager } from '@/features/standard-iteration/judge/JudgeManager';
import { JudgeRater } from '@/features/standard-iteration/judge/JudgeRater';
import {
  SelectionRevisionPage,
  SelectionStandardCurrent,
} from '@/features/standard-iteration/revision/SelectionStandard';
import {
  createSampleStore,
  managerView,
  type SampleAi,
  type SampleSeed,
} from './sample-store';
import {
  sampleBatch,
  sampleHrPage,
  sampleHypotheses,
  sampleManagerPage,
  sampleRaterPage,
  sampleRaters,
  sampleStandard,
  sampleStandardVersion,
  type SampleRaterKey,
  type SampleRole,
} from './samples';

export type SampleQuery = {
  role: SampleRole;
  view: 'judge' | 'standard';
  rater: SampleRaterKey | null;
  seed: SampleSeed | null;
  ai: SampleAi;
};

const base = '/dev/standard-iteration';
export const sampleHref = (query: Record<string, string>) =>
  `${base}?${new URLSearchParams(query)}`;

/** Store and pages live on the client only: the walk is kept in this tab's session. */
export function SampleStandardIteration({ query }: { query: SampleQuery }) {
  const router = useRouter();
  const [store, setStore] = useState<ReturnType<
    typeof createSampleStore
  > | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only
    setStore(createSampleStore(query.seed, query.ai));
  }, [query.seed, query.ai]);
  if (!store) return <State kind="loading" title="载入中" />;
  const snapshot = store.snapshot();
  const judgeHref = sampleHref({ role: 'hr' });

  if (query.view === 'standard') {
    const revision = snapshot.revision;
    const open =
      revision && ['draft', 'pending_confirmation'].includes(revision.state);
    if (query.role === 'hr' && revision && open)
      return (
        <SelectionRevisionPage
          view={{ audience: 'hr', revision, ports: store.hr }}
          base={sampleStandard}
          back={{ href: `${judgeHref}#attrib`, label: '回到判断对照' }}
        />
      );
    if (query.role === 'manager' && revision?.state === 'pending_confirmation')
      return (
        <SelectionRevisionPage
          view={{
            audience: 'manager',
            revision: managerView(revision),
            ports: store.manager,
          }}
          base={sampleStandard}
          back={{ href: '/work', label: '回到工作台' }}
        />
      );
    return (
      <SelectionStandardCurrent
        version={
          revision?.state === 'active'
            ? {
                ...sampleStandardVersion,
                versionId: revision.versionId,
                provenance: 'published',
                effectiveFrom: revision.publishedAt,
              }
            : sampleStandardVersion
        }
        content={sampleStandard}
        draftHref={query.role === 'hr' ? `${judgeHref}#attrib` : null}
      />
    );
  }

  if (query.role === 'manager')
    return (
      <JudgeManager
        page={sampleManagerPage([
          ...new Set(snapshot.attributions.flatMap((a) => a.categories)),
        ])}
      />
    );
  if (query.role === 'rater') {
    const key = query.rater ?? 'ye';
    const page = sampleRaterPage(key);
    return (
      <JudgeRater
        self
        raterName={sampleRaters[key].name}
        cases={page.cases}
        sample={page.sample}
        mapping={sampleHrPage.mapping}
        batchNames={{ [sampleBatch.id]: sampleBatch.name }}
        back={{ href: '/work', label: '回到工作台' }}
      />
    );
  }
  if (query.rater) {
    const rater = sampleRaters[query.rater];
    const entry = sampleHrPage.raters.find((r) => r.evaluator.id === rater.id)!;
    return (
      <JudgeRater
        self={false}
        raterName={rater.name}
        cases={sampleHrPage.cases.filter(
          (unit) =>
            unit.front.state === 'present' &&
            unit.front.judgment.evaluator.id === rater.id,
        )}
        sample={entry.sample}
        mapping={sampleHrPage.mapping}
        batchNames={{ [sampleBatch.id]: sampleBatch.name }}
        back={{ href: judgeHref, label: '回到判断对照' }}
      />
    );
  }
  return (
    <JudgeBatch
      page={sampleHrPage}
      standard={sampleStandard}
      currentStandardVersionId={
        snapshot.revision?.state === 'active'
          ? snapshot.revision.versionId
          : sampleStandardVersion.versionId
      }
      initialHypotheses={
        query.ai === 'ok'
          ? { status: 'ready', items: sampleHypotheses }
          : { status: 'idle' }
      }
      initialAttributions={snapshot.attributions}
      ports={store.attribution}
      raterHref={(id) => {
        const key = (Object.keys(sampleRaters) as SampleRaterKey[]).find(
          (k) => sampleRaters[k].id === id,
        );
        return sampleHref({ role: 'hr', rater: key ?? '' });
      }}
      onDrafted={() =>
        router.push(sampleHref({ role: 'hr', view: 'standard' }))
      }
    />
  );
}
