import Image from 'next/image';
import type { CSSProperties } from 'react';
export function Avatar({
  name,
  hue,
  photo,
  size = 'sm',
}: {
  name: string;
  hue: number;
  photo?: string | null;
  size?: 'sm' | 'lg' | '';
}) {
  return (
    <span
      aria-hidden="true"
      className={`n-avatar${size ? ` n-avatar--${size}` : ''}`}
      style={{ '--hue': hue } as CSSProperties}
    >
      {photo ? (
        <Image
          unoptimized
          width={36}
          height={36}
          src={`/avatars/${photo}.jpg`}
          alt=""
        />
      ) : null}
      {name[0]}
    </span>
  );
}
