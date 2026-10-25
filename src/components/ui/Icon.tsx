import { iconSymbols } from './icon-symbols';
export type IconName = keyof typeof iconSymbols;
export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size}>
      <use href={`#i-${name}`} />
    </svg>
  );
}
export function IconSprite() {
  return (
    <svg
      id="nt-sprite"
      width="0"
      height="0"
      style={{ position: 'absolute' }}
      aria-hidden="true"
    >
      <defs
        dangerouslySetInnerHTML={{
          __html: Object.values(iconSymbols).join(''),
        }}
      />
    </svg>
  );
}
