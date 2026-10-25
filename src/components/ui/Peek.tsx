'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { Button } from './Button';
import { Icon } from './Icon';
/** 点这些区域里面不算“点击抽屉外”：抽屉自己、菜单、对话框、提示。 */
const insideSelector =
  '.n-peek, .n-menu, [role="menu"], dialog, [role="dialog"], .n-dialog-overlay, .n-toast, .n-cite__pop';
const EXIT_MS = 220;
const noSubscription = () => () => undefined;
function findTrigger(key: string, original: HTMLElement | null) {
  // 触发元素可能已随页面重绘被替换：按同一个 key 找回。跳过不可见的，优先和原来同类的
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('[data-peek]'),
  ].filter(
    (node) =>
      node.dataset.peek === key &&
      !node.closest('[aria-hidden="true"]') &&
      node.tabIndex >= 0 &&
      node.getClientRects().length,
  );
  return (
    candidates.find((node) => node.className === original?.className) ??
    candidates[0] ??
    null
  );
}
/**
 * 速览抽屉的开关状态与触发元素。
 * triggerProps(key) 铺到链接、头像等触发元素上：普通点击拉起（同一个 key 再点就关闭），
 * ⌘ / Ctrl / Shift 点击与非左键不拦截，照常打开详情页。
 */
export function usePeek() {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setOpenKey(null);
    // 焦点还在抽屉里或没有去处时才送回触发元素；点了别处的输入框、按钮就不抢回来
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('.n-peek'))
      return;
    const back = trigger.current?.isConnected
      ? trigger.current
      : openKey
        ? findTrigger(openKey, trigger.current)
        : null;
    back?.focus();
  }, [openKey]);
  const triggerProps = (key: string) => ({
    'data-peek': key,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      )
        return;
      event.preventDefault();
      if (openKey === key) close();
      else {
        trigger.current = event.currentTarget;
        setOpenKey(key);
      }
    },
  });
  return { openKey, open: openKey !== null, close, triggerProps };
}
/**
 * 速览抽屉的容器：桌面右侧、非模态。内容由调用方组装。
 * Esc、关闭按钮、点击抽屉外都会调用 onClose；打开和切换内容（contentKey 变化）时聚焦抽屉。
 * demo 是设计系统样张用的静态呈现：留在原位置，不聚焦、没有关闭按钮、不监听。
 */
export function Peek({
  open,
  onClose,
  labelledBy,
  label,
  contentKey,
  demo = false,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  /** 抽屉内标题元素的 id，和 label 二选一。 */
  labelledBy?: string;
  label?: string;
  contentKey?: string | null;
  demo?: boolean;
  children: ReactNode;
}) {
  const reduced = Boolean(useReducedMotion());
  const host = useSyncExternalStore(
    noSubscription,
    () => document.body,
    () => null,
  );
  const drawer = useRef<HTMLElement>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(false);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    setLeaving(!open);
    setShown(false);
  }
  const interactive = open && !demo;
  useEffect(() => {
    if (!interactive) return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [interactive]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), reduced ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving, reduced]);
  useEffect(() => {
    if (interactive && host) drawer.current?.focus();
  }, [interactive, host, contentKey]);
  useEffect(() => {
    if (!interactive || !onClose) return;
    const onClick = (event: globalThis.MouseEvent) => {
      // 触发元素自己处理（切换或关闭），这里不重复
      if ((event.target as Element | null)?.closest?.('[data-peek]')) return;
      // 用事件派发时的路径判断里外：抽屉里的按钮点完可能已被重绘替换，不能再用 target 判断
      const inside = event
        .composedPath()
        .some(
          (node) => node instanceof Element && node.matches(insideSelector),
        );
      if (!inside) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      // Radix 的菜单、对话框先处理 Esc 并 preventDefault；原生 dialog 打开时也让它先关
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open]')
      )
        onClose();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [interactive, onClose]);
  if (!demo && !open && !leaving) return null;
  const surface = (
    <aside
      ref={drawer}
      className={`n-peek${demo ? ' is-demo' : ''}${demo || shown ? ' is-open' : ''}`}
      role={demo ? undefined : 'dialog'}
      aria-modal={demo ? undefined : 'false'}
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={demo ? undefined : -1}
    >
      {onClose && !demo ? (
        <Button
          className="n-btn--ghost n-btn--icon n-peek__x"
          aria-label="关闭速览"
          onClick={onClose}
        >
          <Icon name="x" />
        </Button>
      ) : null}
      <div className="n-peek__body">{children}</div>
    </aside>
  );
  if (demo) return surface;
  return host ? createPortal(surface, host) : null;
}
