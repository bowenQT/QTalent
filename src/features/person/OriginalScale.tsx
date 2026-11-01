import styles from './original-scale.module.css';

const EXEMPT = '非管理岗免评';

/**
 * 历史评价的原量表，按原文逐项列出，样式与维度分（`.n-score`）分开，不换算成 1–5。
 * `separate` 给北森面评加「原量表 · 单独保存」标签；契约要等 BOW-906 才带出面评标记，
 * 在那之前档案不传。「非管理岗免评」这一项单独标出，写成「管理能力 · 非管理岗免评」。
 */
export function OriginalScale({
  items,
  separate = false,
}: {
  items: readonly (readonly [string, string])[];
  separate?: boolean;
}) {
  if (!items.length)
    throw new Error('An original scale needs at least one item');
  return (
    <div className="n-scale">
      {separate ? (
        <span className={`n-scale__tag ${styles.tag}`}>原量表 · 单独保存</span>
      ) : null}
      {items.map(([item, value], index) => {
        const exempt = value === EXEMPT;
        return (
          <span
            key={index}
            className={exempt ? `is-na ${styles.exempt}` : undefined}
          >
            {item}
            {exempt ? ' · ' : ' '}
            {value}
          </span>
        );
      })}
    </div>
  );
}
