'use client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
export type MenuItem = {
  id: string;
  label: ReactNode;
  icon?: IconName;
  /** 标签下的一行小字。 */
  sub?: ReactNode;
  /** 破坏性操作，例如删除。 */
  danger?: boolean;
  /** 传入时是单选项，true 表示当前选中；同一菜单里只应有一个为 true。 */
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};
export type MenuEntry = MenuItem | 'separator';
/**
 * 更多操作菜单。弹层、键盘与焦点由 Radix 处理，外观沿用 n-menu。
 * trigger 是一个按钮元素，由调用方写好标签（图标按钮必须有 aria-label）。
 */
export function Menu({
  trigger,
  entries,
  align = 'end',
}: {
  trigger: ReactElement;
  entries: readonly MenuEntry[];
  align?: 'start' | 'center' | 'end';
}) {
  const items = entries.filter(
    (entry): entry is MenuItem => entry !== 'separator',
  );
  const hasRadio = items.some((item) => item.checked !== undefined);
  const rows = entries.map((entry, index) => {
    if (entry === 'separator')
      return (
        <DropdownMenu.Separator key={`separator-${index}`} asChild>
          <hr />
        </DropdownMenu.Separator>
      );
    const body = (
      <button type="button" className={entry.danger ? 'is-danger' : undefined}>
        {entry.icon ? <Icon name={entry.icon} size={15} /> : null}
        <span>
          {entry.label}
          {entry.sub ? <small>{entry.sub}</small> : null}
        </span>
        {entry.checked ? (
          <span className="n-menu__check" style={{ display: 'inline-flex' }}>
            <Icon name="check" size={14} />
          </span>
        ) : null}
      </button>
    );
    return entry.checked === undefined ? (
      <DropdownMenu.Item
        key={entry.id}
        asChild
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        {body}
      </DropdownMenu.Item>
    ) : (
      <DropdownMenu.RadioItem
        key={entry.id}
        asChild
        value={entry.id}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        {body}
      </DropdownMenu.RadioItem>
    );
  });
  return (
    <span className="n-menuwrap">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="n-menu" align={align} sideOffset={6}>
            {hasRadio ? (
              <DropdownMenu.RadioGroup
                value={items.find((item) => item.checked)?.id ?? ''}
              >
                {rows}
              </DropdownMenu.RadioGroup>
            ) : (
              rows
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}
