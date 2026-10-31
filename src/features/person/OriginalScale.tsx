/**
 * 面试等历史评价的原量表：照原文保留各项与取值，不换算成 1–5 的维度分，也不参与象限。
 * 样式与维度分（`.n-score`）分开，并写明「不是维度分」。BOW-898 评审合入后再接进档案。
 */
export function OriginalScale({
  items,
  scaleName,
}: {
  /** 原量表的项与取值，按原文顺序。 */
  items: readonly (readonly [string, string])[];
  /** 量表名称，例如「面试评价表」。 */
  scaleName: string;
}) {
  if (!items.length)
    throw new Error('An original scale needs at least one item');
  return (
    <div role="group" aria-label={`${scaleName}原量表，不是维度分`}>
      <div className="n-scale">
        {items.map(([item, value], index) => (
          <span key={index}>
            {item} {value}
          </span>
        ))}
      </div>
      <div className="n-tl__note">
        {scaleName}原量表，不是维度分：不换算成 1–5，也不参与象限。
      </div>
    </div>
  );
}
