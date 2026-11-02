import { useRef } from 'react';
import { newOperationId } from './ports';

/**
 * One intent, one operation id. Sending the same input again, after a refusal or a
 * lost response, reuses the id so the server can replay the first answer; a changed
 * input is a new intent and gets a new id.
 */
export function useOperation() {
  const last = useRef<{ key: string; id: string } | null>(null);
  return {
    idFor(kind: string, input: object) {
      const key = JSON.stringify([kind, input]);
      if (last.current?.key !== key)
        last.current = { key, id: newOperationId() };
      return last.current.id;
    },
    /** The intent got its answer; the next action starts a new one. */
    done() {
      last.current = null;
    },
  };
}
