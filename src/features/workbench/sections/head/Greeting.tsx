'use client';
import { useSyncExternalStore } from 'react';
import type { WorkbenchView } from '../../view';
import { dateLine, greetingFor, neutralGreeting } from './greeting-state';
import { JudgeNotes } from './JudgeNotes';

const noSubscription = () => () => {};
const localHour = () => new Date().getHours();
const unknownHour = () => null;

/**
 * Greeting and date line. The greeting follows the viewer's local hour, so the server
 * renders a neutral one and hydration switches to the time of day. HR and mentor heading
 * lines in the prototype go on with programme status, which the contract does not carry
 * (D6). The manager's 判断提醒 sits beside the text, before the export entry.
 */
export function GreetingText({ view }: { view: WorkbenchView }) {
  const hour = useSyncExternalStore(noSubscription, localHour, unknownHour);
  return (
    <>
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
      <JudgeNotes view={view} />
    </>
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
