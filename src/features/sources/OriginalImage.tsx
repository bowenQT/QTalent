import styles from './source-viewer.module.css';
import { locatedProps, type Locate } from './located';
import type { At, Content } from './viewer-model';

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * 图片：按原图比例画出框选区域。区域是存原图时的归一化坐标，原图还没接入时也能在
 * 同比例的框里标出位置；接入后换成原图。
 */
export function ImageOriginal({
  location,
  content,
  locate,
}: {
  location: At<'image'>;
  content: Content<'image'> | null;
  locate: Locate;
}) {
  const { left, top, right, bottom } = location.region;
  const image = content?.image ?? null;
  const [width, height] = image ? [image.width, image.height] : [4, 3];
  // 竖长的截图也不超过七成屏高：宽度按比例收窄，整张图和框一屏看完。
  const frame = {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${((70 * width) / height).toFixed(2)}vh)`,
  };
  const where = `左 ${percent(left)}，上 ${percent(top)}，宽 ${percent(right - left)}，高 ${percent(bottom - top)}`;
  return (
    <figure className={styles.shot}>
      <div className={styles.frame} style={frame}>
        {image ? (
          // 授权的短时地址，交给浏览器直接读；不经过 next/image 的优化与缓存。
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.url} alt="图片原件" />
        ) : (
          <span className={styles.frameEmpty}>原图待接入</span>
        )}
        <div
          {...locatedProps(locate, styles.region)}
          role="img"
          aria-label={`引用的区域：${where}`}
          style={{
            left: `${left * 100}%`,
            top: `${top * 100}%`,
            width: `${(right - left) * 100}%`,
            height: `${(bottom - top) * 100}%`,
          }}
        />
      </div>
      <figcaption>蓝框是引用的区域</figcaption>
    </figure>
  );
}
