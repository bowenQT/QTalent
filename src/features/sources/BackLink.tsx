'use client';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/** 从站内点进来就回到原页面；单独打开的标签页没有上一页，回到首页。 */
export function BackLink() {
  return (
    <Link
      className="n-btn n-btn--sm"
      href="/"
      onClick={(event) => {
        if (window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      }}
    >
      <Icon name="back" />
      返回
    </Link>
  );
}
