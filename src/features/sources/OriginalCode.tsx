import styles from './source-viewer.module.css';
import { locatedProps, type Locate } from './located';
import type { At } from './viewer-model';

/**
 * 代码出处只有提交的摘录：按提交时写明的起始行号排出来。仓库地址是提交的说明文字，
 * 不拼成链接，也不代表读过那个仓库。
 */
export function CodeOriginal({
  location,
  excerpt,
  locate,
}: {
  location: At<'code'>;
  excerpt: string;
  locate: Locate;
}) {
  const lines = excerpt.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return (
    <div
      {...locatedProps(locate, `${styles.code} ${styles.mono}`)}
      role="group"
      aria-label={`${location.path} 第 ${location.startLine}–${location.endLine} 行`}
    >
      <ol>
        {lines.map((line, i) => (
          <li key={i}>
            <span className={styles.gutter}>{location.startLine + i}</span>
            <code>{line}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}
