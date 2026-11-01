import styles from './source-viewer.module.css';

/** 引用到的那一处挂上这个回调：查看器打开后把它滚到视口中间并移交焦点。 */
export type Locate = (element: HTMLElement | null) => void;

/** 被引用元素的公共属性：可编程聚焦、读屏念出「当前位置」，外观是蓝框。 */
export function locatedProps(locate: Locate, extra = '') {
  return {
    ref: locate,
    tabIndex: -1,
    'aria-current': 'location' as const,
    className: [styles.located, extra].filter(Boolean).join(' '),
  };
}
