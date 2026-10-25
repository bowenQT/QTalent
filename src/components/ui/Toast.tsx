'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
/** 普通提示、带撤销的提示、撤销成功后「已撤销」停留的毫秒数。 */
export const TOAST_MS = 3200;
export const UNDO_MS = 5000;
export const UNDONE_MS = 1600;
export type ToastOptions = {
  /** 普通提示的停留毫秒数；带撤销的提示固定 5 秒。 */
  duration?: number;
  /**
   * 撤销。可以是异步的：处理中按钮禁用、不会重复触发；成功后才显示 undoneText，
   * 抛错或 reject 则留在提示里显示 failedText，并给出重试。
   * 组件不决定撤销语义：先提交再补偿，还是到期再提交，由调用方的契约决定。
   */
  onUndo?: () => void | Promise<void>;
  /** 提示到期自然消失时调用一次；撤销过、被 dismiss 或失败后关闭都不调用。 */
  onExpire?: () => void;
  undoneText?: string;
  failedText?: string;
  retryLabel?: string;
};
type Phase = 'idle' | 'undoing' | 'undone' | 'failed';
/** 单条提示及其计时。通常通过 useToast().show 使用；样张可以直接渲染。 */
export function Toast({
  message,
  duration = TOAST_MS,
  onUndo,
  onExpire,
  undoneText = '已撤销',
  failedText = '撤销没有成功',
  retryLabel = '重试',
  onClose,
}: ToastOptions & { message: string; onClose: () => void }) {
  const reduced = Boolean(useReducedMotion());
  const [phase, setPhase] = useState<Phase>('idle');
  const [counting, setCounting] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const expire = useEffectEvent(() => {
    onExpire?.();
    onClose();
  });
  const finish = useEffectEvent(() => onClose());
  const undoable = Boolean(onUndo);
  useEffect(() => {
    // 回调通过 useEffectEvent 取最新值；只有阶段或时长变化才重新计时
    const delay =
      phase === 'idle'
        ? undoable
          ? UNDO_MS
          : duration
        : phase === 'undone'
          ? UNDONE_MS
          : null;
    if (delay === null) return;
    const timer = setTimeout(phase === 'idle' ? expire : finish, delay);
    return () => clearTimeout(timer);
  }, [phase, duration, undoable]);
  useEffect(() => {
    // 减少动态时不做入场位移；没有 Web Animations 的环境（如 jsdom）直接出现
    if (reduced || typeof element.current?.animate !== 'function') return;
    element.current.animate(
      [
        { transform: 'translateY(8px)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }, [reduced]);
  useEffect(() => {
    if (!undoable || reduced) return;
    const frame = requestAnimationFrame(() => setCounting(true));
    return () => cancelAnimationFrame(frame);
  }, [undoable, reduced]);
  async function undo() {
    if (!onUndo) return;
    // 处理中按钮禁用、重试入口也已撤下，不会重复进入
    setPhase('undoing');
    try {
      await onUndo();
      setPhase('undone');
    } catch {
      setPhase('failed');
    }
  }
  return (
    <div
      ref={element}
      className={`n-toast${counting && phase === 'idle' ? ' is-counting' : ''}`}
    >
      <span>
        {phase === 'undone'
          ? undoneText
          : phase === 'failed'
            ? failedText
            : message}
      </span>
      {onUndo && (phase === 'idle' || phase === 'undoing') ? (
        <button
          type="button"
          className="n-toast__undo"
          disabled={phase === 'undoing'}
          aria-busy={phase === 'undoing' || undefined}
          onClick={() => void undo()}
        >
          <svg className="n-toast__ring" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="track" cx="10" cy="10" r="8" />
            <circle className="run" cx="10" cy="10" r="8" />
          </svg>
          撤销
        </button>
      ) : null}
      {phase === 'failed' ? (
        <>
          <button
            type="button"
            className="n-toast__undo"
            style={{ paddingLeft: 14 }}
            onClick={() => void undo()}
          >
            {retryLabel}
          </button>
          <button
            type="button"
            className="n-toast__undo"
            style={{ paddingLeft: 14 }}
            onClick={onClose}
          >
            关闭
          </button>
        </>
      ) : null}
    </div>
  );
}
type Entry = { id: number; message: string; options: ToastOptions };
const ToastContext = createContext<{
  show: (message: string, options?: ToastOptions) => () => void;
} | null>(null);
/** 提示容器（role=status、aria-live=polite）。放在工作台外壳里，全站一份。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback(
    (id: number) => setEntries((list) => list.filter((e) => e.id !== id)),
    [],
  );
  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = ++counter.current;
      setEntries((list) => [...list, { id, message, options }]);
      return () => dismiss(id);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext value={value}>
      {children}
      <div className="nt-toasts" role="status" aria-live="polite">
        {entries.map((entry) => (
          <Toast
            key={entry.id}
            {...entry.options}
            message={entry.message}
            onClose={() => dismiss(entry.id)}
          />
        ))}
      </div>
    </ToastContext>
  );
}
/** show 返回一个函数，调用即提前收起这条提示（不触发 onExpire）。 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 需要放在 ToastProvider 里使用');
  return context;
}
