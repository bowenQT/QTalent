'use client';
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Niu } from '@/components/brand/Niu';
import { Icon } from '@/components/ui/Icon';
import type { WorkbenchView } from '../../view';
import { composerPlaceholder, handoffFailed, suggestionsFor } from '../../copy';
import { MAX_INPUT_LENGTH } from '../../send';
import { useSend } from '../../use-send';
import { matchCommands, slashCommands } from './slash';

/**
 * HR and mentor one-line input: ⌘ / Ctrl + Enter sends, Enter is a new line, a leading
 * `/` opens the command menu. `uploadAnchor` is set by the upload section (BOW-861).
 */
export function Composer({
  view,
  uploadAnchor,
}: {
  view: WorkbenchView;
  uploadAnchor?: string;
}) {
  const router = useRouter();
  const field = useRef<HTMLTextAreaElement>(null);
  const { text, setText, send, failed, niu } = useSend(view, false);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const commands = slashCommands(view.entries);
  const matches = dismissed ? null : matchCommands(text, commands);
  const open = Boolean(matches?.length);
  const current = open ? matches![selected % matches!.length] : undefined;
  function change(value: string) {
    setText(value);
    setSelected(0);
    setDismissed(false);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === 'Enter' && !composing) {
      if (current) {
        event.preventDefault();
        router.push(current.href);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        send(field.current);
      }
      return;
    }
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const count = matches!.length;
      const index = selected % count;
      setSelected(
        (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count,
      );
    }
    if (open && event.key === 'Escape') setDismissed(true);
  }
  const mentor = view.role === 'mentor';
  return (
    <>
      <div
        className="n-composer"
        id="composer"
        style={{ marginBottom: 'var(--s-2)' }}
      >
        <Niu size={36} state={niu} />
        <textarea
          ref={field}
          className="n-composer__field"
          rows={2}
          id="composer-field"
          aria-label="描述你要做的事"
          aria-controls="slash"
          aria-activedescendant={current ? `slash-${current.id}` : undefined}
          placeholder={
            mentor ? composerPlaceholder.mentor : composerPlaceholder.record
          }
          maxLength={MAX_INPUT_LENGTH}
          value={text}
          onChange={(event) => change(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="n-composer__bar">
          {uploadAnchor ? (
            <a
              className="n-btn n-btn--ghost n-btn--icon"
              href={uploadAnchor}
              aria-label="上传材料"
            >
              <Icon name="clip" />
            </a>
          ) : null}
          <span className="spacer" />
          <span className="n-composer__hint">⌘ ↵ 发送</span>
          <button
            className="n-btn n-btn--ink n-btn--icon"
            type="button"
            id="composer-send"
            aria-label="发送"
            onClick={() => send(field.current)}
          >
            <Icon name="up" />
          </button>
        </div>
      </div>
      {failed ? (
        <p role="alert" className="nt-field-error">
          {handoffFailed}
        </p>
      ) : null}
      <div
        className="n-slash"
        id="slash"
        role="listbox"
        aria-label="命令"
        hidden={!open}
      >
        {(matches ?? commands).map((command) => (
          <a
            key={command.id}
            id={`slash-${command.id}`}
            className="n-slash__item"
            role="option"
            aria-selected={command === current}
            href={command.href}
          >
            <Icon name={command.icon} size={16} />
            {command.label}
            <kbd>/{command.key}</kbd>
          </a>
        ))}
      </div>
      <div className="n-asks" style={{ margin: 'var(--s-2) 0 var(--s-6)' }}>
        {suggestionsFor(view.role, view.namedExamples).map((example) => (
          <button
            key={example}
            className="n-ask"
            type="button"
            onClick={() => {
              change(example);
              field.current?.focus();
            }}
          >
            {example}
          </button>
        ))}
      </div>
    </>
  );
}
