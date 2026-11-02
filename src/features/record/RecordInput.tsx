'use client';
import type { ReactNode, Ref } from 'react';
import { Niu } from '@/components/brand/Niu';
import { Icon } from '@/components/ui/Icon';
import { copy } from './copy';
import type { PersonOption } from './types';

/** 输入态：谁、原话、语音与附件入口、提示句、主按钮。附件入口由 attachmentSlot 接入（BOW-870），语音输入未接通。 */
export function RecordInput({
  people,
  personId,
  text,
  maxLength,
  submitting,
  showExample,
  hint,
  attachmentSlot,
  textareaRef,
  onText,
  onPerson,
  onSubmit,
}: {
  people: readonly PersonOption[];
  personId: string | null;
  text: string;
  maxLength: number;
  submitting: boolean;
  /** 非生产环境显示带化名的示例占位，生产用中性占位。 */
  showExample: boolean;
  /** 提示句位置的内容：默认提示，或识别不到人的提醒。 */
  hint?: ReactNode;
  attachmentSlot?: ReactNode;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onText: (text: string) => void;
  onPerson: (personId: string | null) => void;
  onSubmit: () => void;
}) {
  const tooLong = text.length > maxLength;
  return (
    <>
      <div className="n-event__head" id="ev-head">
        <span>{copy.input.who}</span>
        <select
          className="n-select"
          id="ev-person"
          style={{ width: 'auto', minHeight: 30 }}
          aria-label={copy.input.whoLabel}
          value={personId ?? ''}
          onChange={(event) => onPerson(event.target.value || null)}
        >
          <option value="">{copy.input.autoPerson}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} · {person.orgShort}
            </option>
          ))}
        </select>
        <span className="n-event__ip">
          <Niu size={36} state="rest" />
        </span>
      </div>
      <div id="ev-in">
        <label className="n-eventin__label" htmlFor="ev-text">
          {copy.input.label}
        </label>
        <textarea
          ref={textareaRef}
          className="n-eventin__field"
          id="ev-text"
          rows={5}
          value={text}
          readOnly={submitting}
          aria-invalid={tooLong || undefined}
          aria-describedby="ev-hint"
          placeholder={
            showExample
              ? copy.input.placeholderExample
              : copy.input.placeholderPlain
          }
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (!submitting) onSubmit();
            }
          }}
        />
        <div className="n-eventin__bar">
          {/* 按原型的位置留着；没接通时说明待接通，不假装能用。 */}
          <button
            className="n-btn n-btn--ghost n-btn--icon"
            type="button"
            id="ev-mic"
            aria-disabled="true"
            aria-label={copy.input.micPending}
            title={copy.input.micPending}
          >
            <Icon name="mic" />
          </button>
          {attachmentSlot ?? (
            <button
              className="n-btn n-btn--ghost n-btn--icon"
              type="button"
              aria-disabled="true"
              aria-label={copy.input.attachPending}
              title={copy.input.attachPending}
            >
              <Icon name="clip" />
            </button>
          )}
          <span className="n-eventin__hint" id="ev-hint">
            {tooLong
              ? copy.input.tooLong(maxLength)
              : (hint ?? copy.input.hint)}
          </span>
          <button
            className="n-btn n-btn--light"
            type="button"
            id="ev-shape"
            disabled={submitting || tooLong}
            aria-busy={submitting || undefined}
            onClick={onSubmit}
          >
            <Icon name="spark" />
            {submitting ? copy.input.submitting : copy.input.submit}
          </button>
        </div>
      </div>
    </>
  );
}
