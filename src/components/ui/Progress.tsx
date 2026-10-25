/**
 * 进度条。传 `value`（0–100）是确定进度；不传是不定进度，只表示「处理中」。
 * 减少动态时不定进度条由样式表静止，状态靠 `aria-valuetext` 和所在行的文字表达。
 */
export function Progress({ value, label }: { value?: number; label: string }) {
  if (value === undefined)
    return (
      <div
        className="n-progress is-indeterminate"
        role="progressbar"
        aria-label={label}
        aria-valuetext="处理中"
      >
        <i />
      </div>
    );
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      className="n-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}
