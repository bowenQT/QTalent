'use client';
import { useSyncExternalStore } from 'react';
import type { WorkbenchView } from '../../view';
import { dateLine, greetingFor, neutralGreeting } from './greeting-state';

const noSubscription = () => () => {};
const localHour = () => new Date().getHours();
const unknownHour = () => null;

/**
 * Greeting and date line. The greeting follows the viewer's local hour, so the server
 * renders a neutral one and hydration switches to the time of day. HR and mentor heading
 * lines in the prototype go on with programme status, which the contract does not carry
 * (D6).
 */
export function GreetingText({ view }: { view: WorkbenchView }) {
  const hour = useSyncExternalStore(noSubscription, localHour, unknownHour);
  return (
    <div>
      <h1>
        {hour === null
          ? neutralGreeting(view.displayName)
          : greetingFor(hour, view.displayName)}
      </h1>
      {view.asOf ? (
        <p>
          {dateLine(view.asOf)}
          {view.role === 'manager' ? ' · 全部人才项目' : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Page heading without actions; the export section draws its own around GreetingText. */
export function Greeting({ view }: { view: WorkbenchView }) {
  return (
    <header className="nt-head">
      <GreetingText view={view} />
    </header>
  );
}
