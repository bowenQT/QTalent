import styles from './source-viewer.module.css';

/** 原件一侧打不开时的说明：粗体写现状，小字写原因或下一步。 */
export function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.pending} role="status">
      <b>{title}</b>
      <small>{text}</small>
    </div>
  );
}
