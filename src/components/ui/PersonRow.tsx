import Link from 'next/link';
import type { ReactNode } from 'react';
/**
 * 列表行：头像 + 姓名 + 元信息，右侧留一个插槽。只放认人所需的最少信息，不含业务字段。
 * 需要拉起速览时，name 传入带 triggerProps 的链接；只想跳详情页时传 href。
 */
export function PersonRow({
  avatar,
  name,
  href,
  nameAfter,
  meta,
  trailing,
}: {
  avatar: ReactNode;
  name: ReactNode;
  href?: string;
  /** 姓名后面的标记，例如「演示」徽标。 */
  nameAfter?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="n-person-row">
      <div className="n-person">
        {avatar}
        <div>
          <div className="n-person__name">
            {href ? (
              <Link className="nt-plink" href={href}>
                {name}
              </Link>
            ) : (
              name
            )}
            {nameAfter}
          </div>
          {meta ? <div className="n-person__meta">{meta}</div> : null}
        </div>
      </div>
      {trailing}
    </div>
  );
}
