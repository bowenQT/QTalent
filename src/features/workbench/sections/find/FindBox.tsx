'use client';
import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { Niu } from '@/components/brand/Niu';
import { Icon } from '@/components/ui/Icon';
import type { WorkbenchView } from '../../view';
import { findPlaceholder, handoffFailed, suggestionsFor } from '../../copy';
import { MAX_INPUT_LENGTH } from '../../send';
import { useSend } from '../../use-send';

/** The field grows with its text up to this height, then scrolls inside. */
export const FIT_MAX = 200;

/**
 * Manager's find box. The example panel shows only while the field is focused and still
 * empty; that is pure CSS (`:focus-within` and `:placeholder-shown`), so the field keeps
 * its placeholder. Role templates belong to the find-people contract (BOW-851).
 */
export function FindBox({ view }: { view: WorkbenchView }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const { text, setText, send, failed, niu } = useSend(view, true);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, FIT_MAX)}px`;
    element.style.overflowY =
      element.scrollHeight > FIT_MAX ? 'auto' : 'hidden';
  }, [text]);
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an input method is composing picks a word; it must not send.
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === 'Enter' && !composing && !event.shiftKey) {
      event.preventDefault();
      send(field.current);
    }
    if (event.key === 'Escape') event.currentTarget.blur();
  }
  return (
    <section className="n-find is-pop" aria-label="找人">
      <div className="n-composer is-hero" id="composer">
        <Niu size={36} state={niu} />
        <textarea
          ref={field}
          className="n-composer__field"
          rows={1}
          id="composer-field"
          aria-label="描述你要找什么样的人"
          placeholder={findPlaceholder}
          maxLength={MAX_INPUT_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="n-composer__bar">
          <span className="spacer" />
          <span className="n-composer__hint">↵ 发送 · ⇧ ↵ 换行</span>
          <button
            className="n-btn n-btn--ink"
            type="button"
            id="composer-send"
            onClick={() => send(field.current)}
          >
            <Icon name="search" />
            开始找人
          </button>
        </div>
      </div>
      {failed ? (
        <p role="alert" className="nt-field-error">
          {handoffFailed}
        </p>
      ) : null}
      <div className="n-find__more">
        <span className="n-find__label">试试这样说</span>
        <div className="n-find__asks">
          {suggestionsFor('manager', view.namedExamples).map((example) => (
            <button
              key={example}
              className="n-find__ask"
              type="button"
              onClick={() => {
                setText(example);
                field.current?.focus();
              }}
            >
              <Icon name="search" />
              <span>{example}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
