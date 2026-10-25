'use client';
import { useId, useState, type ReactNode } from 'react';

/**
 * The stylesheet recognises only these step states; callers map "in progress" to `active`.
 * A failed step is not designed yet and is added together with the prototype sync.
 */
export const trailStepStates = ['pending', 'active', 'done'] as const;
export type TrailStepState = (typeof trailStepStates)[number];

export type TrailStep = {
  id: string;
  label: ReactNode;
  state: TrailStepState;
  /** Small trailing note, e.g. the scope a step searched. */
  detail?: string;
};

/** Collapsible progress trail; a re-render with more steps keeps the same DOM nodes and focus. */
export function Trail({
  title,
  steps,
  defaultOpen = true,
}: {
  title: string;
  steps: readonly TrailStep[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();
  for (const step of steps)
    if (!trailStepStates.includes(step.state))
      throw new Error(`Unknown trail step state: ${String(step.state)}`);
  return (
    <div className="n-trail" data-open={open}>
      <button
        className="n-trail__head"
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <svg className="n-trail__chev" aria-hidden="true">
          <use href="#i-chev" />
        </svg>
        {title}
      </button>
      <ol className="n-trail__steps" id={listId}>
        {steps.map((step) => (
          <li
            key={step.id}
            className="n-trail__step"
            data-state={step.state}
            aria-current={step.state === 'active' ? 'step' : undefined}
          >
            {step.label}
            {step.detail ? (
              <>
                {' '}
                <small>{step.detail}</small>
              </>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
