import type { ImportRow } from './model';
import { notApplicableText, scaleTag } from './copy';

/**
 * The interview's own scale, item by item as read, in the original-scale style
 * (`.n-scale`), apart from dimension scores (`.n-score`) and never converted to 1–5.
 * An item the parser could not read shows「待补录」until HR fills it in.
 */
export function ImportScale({ row }: { row: ImportRow }) {
  return (
    <div className="n-scale n-ivscale">
      <span className="n-scale__tag">{scaleTag}</span>
      {row.scale.map(({ item, selection }) => {
        if (selection.status === 'not_applicable')
          return (
            <span key={item} className="is-na">
              {item} · {notApplicableText}
            </span>
          );
        if (selection.status === 'recognized')
          return (
            <span key={item}>
              {item} {selection.value}
            </span>
          );
        const filled = row.filled[item];
        return (
          <span key={item} className={filled ? undefined : 'is-miss'}>
            {item} {filled ?? '待补录'}
          </span>
        );
      })}
      <span>面试结论 {row.result}</span>
    </div>
  );
}
