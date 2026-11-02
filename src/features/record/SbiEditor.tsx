'use client';
import type { SaveProblems } from './errors';
import { copy } from './copy';
import { EditableText } from './EditableText';
import type { RecordSbi } from './types';

type Field = keyof RecordSbi;

/** 标题与情境、行为、影响。标题与行为必填，情境和影响可以留空。 */
export function SbiEditor({
  sbi,
  editable,
  onChange,
  problems,
  required,
}: {
  sbi: RecordSbi;
  editable: boolean;
  onChange: (field: Field, value: string) => void;
  problems?: SaveProblems | null;
  /** 保存前校验没通过的必填项，显示提示并由页面聚焦第一处。 */
  required?: { title?: boolean; behavior?: boolean };
}) {
  const titleError =
    problems?.title ?? (required?.title ? copy.sbi.titleNeeded : undefined);
  const behaviorError =
    problems?.behavior ??
    (required?.behavior ? copy.sbi.behaviorNeeded : undefined);
  return (
    <>
      <h3 className="n-event__title">
        <EditableText
          field="title"
          label={copy.sbi.title}
          value={sbi.title}
          editable={editable}
          onChange={(value) => onChange('title', value)}
        />
      </h3>
      {titleError ? (
        <p className="nt-field-error" role="alert">
          {titleError}
        </p>
      ) : null}
      <dl className="n-event__sbar">
        <dt>{copy.sbi.situation}</dt>
        <dd>
          <EditableText
            field="situation"
            label={copy.sbi.situation}
            placeholder={copy.sbi.situationPlaceholder}
            value={sbi.situation}
            editable={editable}
            onChange={(value) => onChange('situation', value)}
          />
        </dd>
        <dt>{copy.sbi.behavior}</dt>
        <dd>
          <EditableText
            field="behavior"
            label={copy.sbi.behavior}
            value={sbi.behavior}
            editable={editable}
            onChange={(value) => onChange('behavior', value)}
          />
          {behaviorError ? (
            <p className="nt-field-error" role="alert">
              {behaviorError}
            </p>
          ) : null}
        </dd>
        <dt>{copy.sbi.impact}</dt>
        <dd>
          <EditableText
            field="impact"
            label={copy.sbi.impact}
            placeholder={copy.sbi.impactPlaceholder}
            value={sbi.impact}
            editable={editable}
            onChange={(value) => onChange('impact', value)}
          />
          {problems?.sbi ? (
            <p className="nt-field-error" role="alert">
              {problems.sbi}
            </p>
          ) : null}
        </dd>
      </dl>
    </>
  );
}
