import type { ReactNode } from 'react';
import { Niu } from '@/components/brand/Niu';
export function State({
  title,
  text,
  children,
}: {
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="n-state">
      <Niu size={56} state="confirm" />
      <h2 className="n-state__title">{title}</h2>
      {text ? <p className="n-state__text">{text}</p> : null}
      {children ? (
        <div className="nt-row" style={{ justifyContent: 'center' }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
