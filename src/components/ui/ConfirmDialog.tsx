'use client';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
export type ConfirmAction = {
  id: string;
  label: string;
  variant?: 'ghost' | 'ink' | 'seal';
  icon?: IconName;
  /**
   * 返回 false 或一句话时不执行 onSelect、弹窗不关闭：聚焦第一个空着的必填项，
   * 并在按钮栏上方提示；返回的话优先作为提示，其次是 hint。
   */
  validate?: (dialog: HTMLElement) => boolean | string;
  hint?: string;
  /** 弹窗不会自动关闭：取消、完成后由调用方把 open 设为 false。 */
  onSelect: () => void;
};
const variantClass = {
  ghost: 'n-btn--ghost',
  ink: 'n-btn--ink',
  seal: 'n-btn--seal',
};
export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** 弹窗里的事实列表，例如会影响到的记录。 */
  facts?: readonly ReactNode[];
  /** 需要填写的内容，例如带标签的 Textarea。 */
  children?: ReactNode;
  actions: readonly ConfirmAction[];
  busy?: boolean;
};
const textFields =
  'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])';
type TextField = HTMLInputElement | HTMLTextAreaElement;
function labelOf(field: TextField) {
  return field.closest('.n-field')?.querySelector('.n-field__label') ?? null;
}
function isOptional(field: TextField) {
  return (
    field.hasAttribute('data-optional') ||
    /可选/.test(labelOf(field)?.textContent ?? '')
  );
}
/** 校验没通过时：标出并聚焦第一个空着的必填项，返回按钮栏上方的提示。 */
function nudge(dialog: HTMLElement, message?: string) {
  // 弹窗里已经有可见的错误提示时不再重复
  const ownError = [
    ...dialog.querySelectorAll<HTMLElement>('[role="alert"]'),
  ].some(
    (node) =>
      !node.classList.contains('n-dialog__hint') &&
      !node.hidden &&
      node.textContent?.trim(),
  );
  if (ownError) return null;
  const empty = [...dialog.querySelectorAll<TextField>(textFields)].find(
    (field) => !field.value.trim() && !isOptional(field),
  );
  let text = message;
  if (empty) {
    empty.closest('.n-field')?.classList.add('is-error');
    empty.focus();
    if (!text) {
      const label = labelOf(empty)?.cloneNode(true) as Element | undefined;
      label?.querySelectorAll('small').forEach((small) => small.remove());
      const name = (
        label?.textContent ??
        empty.getAttribute('aria-label') ??
        ''
      )
        .replace(/[（(]必填[）)]/g, '')
        .trim();
      text = name ? `请先填写「${name}」` : '请先填写这一项';
    }
  }
  return text || '还有必填项没填';
}
function ConfirmBody({
  description,
  facts,
  children,
  actions,
  busy,
}: Pick<
  ConfirmDialogProps,
  'description' | 'facts' | 'children' | 'actions'
> & { busy: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState('');
  function run(action: ConfirmAction) {
    if (busy || !root.current) return;
    if (action.validate) {
      const result = action.validate(root.current);
      if (!result || typeof result === 'string') {
        setHint(
          nudge(
            root.current,
            typeof result === 'string' ? result : action.hint,
          ) ?? '',
        );
        return;
      }
    }
    action.onSelect();
  }
  function clearHint() {
    setHint('');
    // is-error 由 nudge 直接写在调用方渲染的字段外框上，输入后在这里摘掉
    root.current
      ?.querySelectorAll('.is-error')
      .forEach((node) => node.classList.remove('is-error'));
  }
  return (
    <div
      ref={root}
      style={{ display: 'contents' }}
      aria-busy={busy || undefined}
      onInput={clearHint}
    >
      {description ? <p>{description}</p> : null}
      {children ? <div className="nt-dlg-body">{children}</div> : null}
      {facts?.length ? (
        <ul className="n-dialog__facts">
          {facts.map((fact, index) => (
            <li key={index}>{fact}</li>
          ))}
        </ul>
      ) : null}
      {hint ? (
        <p className="n-dialog__hint" role="alert">
          {hint}
        </p>
      ) : null}
      <div className="n-dialog__bar">
        {actions.map((action) => (
          <Button
            key={action.id}
            className={action.variant ? variantClass[action.variant] : ''}
            disabled={busy}
            onClick={() => run(action)}
          >
            {action.icon ? <Icon name={action.icon} /> : null}
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
/**
 * 后果明确、需要停一下的确认弹窗：说明、事实列表、按钮栏。
 * busy 时 Esc 与点击弹窗外都不会关闭，按钮禁用。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  facts,
  children,
  actions,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} busy={busy}>
      <ConfirmBody
        description={description}
        facts={facts}
        actions={actions}
        busy={busy}
      >
        {children}
      </ConfirmBody>
    </Dialog>
  );
}
