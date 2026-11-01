'use client';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Niu } from '@/components/brand/Niu';
import { Icon } from '@/components/ui/Icon';
import {
  entryLede,
  entryPlaceholder,
  entrySayings,
  entryTitle,
  projectEntryLede,
  projectEntryPlaceholder,
  projectTitle,
} from '../../copy';

export const MAX_SENTENCE_LENGTH = 600;

/**
 * One sentence about the project and the person wanted. Templates (the prototype's
 * `.n-tpls`) are not rendered: target role templates have no contract yet. Entered from
 * a project, the entry names it and shows no sayings: the demand is saved under this
 * project, whatever the sentence names.
 */
export function Entry({
  projectName,
  text,
  onTextChange,
  onSend,
  sending,
  error,
  focusOnMount = false,
}: {
  /** The project the demand is saved under; null on the new-project entry. */
  projectName: string | null;
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
  /** Coming back from the drafting trail: the keyboard lands in the field. */
  focusOnMount?: boolean;
}) {
  const errorId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);
  const canSend = text.trim().length > 0 && !sending;
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }
  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{projectName ? projectTitle(projectName) : entryTitle}</h1>
          <p>{projectName ? projectEntryLede : entryLede}</p>
        </div>
      </header>
      <div className="n-composer" style={{ maxWidth: 720 }}>
        <Niu size={36} state={sending ? 'searching' : 'rest'} />
        <textarea
          ref={field}
          className="n-composer__field"
          id="sq"
          rows={2}
          aria-label="描述项目和要找的人"
          aria-describedby={error ? errorId : undefined}
          placeholder={projectName ? projectEntryPlaceholder : entryPlaceholder}
          maxLength={MAX_SENTENCE_LENGTH}
          value={text}
          readOnly={sending}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="n-composer__bar">
          <span className="spacer" />
          <button
            className="n-btn n-btn--ink n-btn--icon"
            type="button"
            id="sgo"
            aria-label="开始"
            disabled={sending}
            onClick={() => {
              if (canSend) onSend();
            }}
          >
            <Icon name="up" />
          </button>
        </div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="nt-field-error">
          {error}
        </p>
      ) : null}
      {projectName ? null : (
        <div className="n-asks" style={{ marginTop: 'var(--s-3)' }}>
          {entrySayings.map((saying) => (
            <button
              key={saying}
              className="n-ask"
              type="button"
              disabled={sending}
              onClick={() => onTextChange(saying)}
            >
              {saying}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
