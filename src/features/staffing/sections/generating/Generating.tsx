import { Niu } from '@/components/brand/Niu';
import { Trail, type TrailStep } from '@/components/ui/Trail';
import type { StaffingDemandJobSnapshot } from '@/contracts/staffing';
import { generatingTitle } from '../../copy';

type Phase = 'waiting' | 'working' | 'done' | 'failed';

export function generationPhase(
  snapshot: StaffingDemandJobSnapshot | null,
): Phase {
  if (!snapshot || snapshot.status === 'queued') return 'waiting';
  if (snapshot.status === 'completed' && snapshot.result) return 'done';
  if (snapshot.status === 'failed' || snapshot.status === 'cancelled')
    return 'failed';
  return 'working';
}

/**
 * The demand job only drafts the card: matching starts after the card is confirmed, so
 * the trail has the two steps of this job, not the prototype's five.
 */
export function generationSteps(
  phase: Phase,
  failure: string | null,
): TrailStep[] {
  const understand: TrailStep['state'] =
    phase === 'waiting' ? 'active' : 'done';
  const split: TrailStep['state'] =
    phase === 'waiting'
      ? 'pending'
      : phase === 'working'
        ? 'active'
        : phase === 'done'
          ? 'done'
          : 'failed';
  return [
    { id: 'understand', label: '理解需求', state: understand },
    {
      id: 'split',
      label: '起草需求卡',
      state: split,
      ...(phase === 'failed' && failure ? { detail: failure } : {}),
    },
  ];
}

export function Generating({
  text,
  snapshot,
  stopped = false,
}: {
  text: string;
  snapshot: StaffingDemandJobSnapshot | null;
  /** Reading the job ended for good; the page says why next to the trail. */
  stopped?: boolean;
}) {
  const phase = stopped ? 'failed' : generationPhase(snapshot);
  const steps = generationSteps(phase, snapshot?.error?.message ?? null);
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{generatingTitle}</h1>
          <p>{text}</p>
        </div>
      </header>
      <div
        className="n-composer"
        style={{ maxWidth: 720, marginBottom: 'var(--s-4)' }}
      >
        <Niu
          size={36}
          state={
            phase === 'done'
              ? 'done'
              : phase === 'failed'
                ? 'error'
                : 'searching'
          }
        />
        <div className="n-composer__field" style={{ minHeight: 0 }}>
          {text}
        </div>
      </div>
      <div className="n-card" style={{ maxWidth: 720 }} aria-live="polite">
        <Trail title={`起草需求卡 · ${steps.length} 步`} steps={steps} />
      </div>
    </>
  );
}
