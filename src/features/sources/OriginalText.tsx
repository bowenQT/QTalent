import type { ReactNode } from 'react';
import styles from './source-viewer.module.css';
import { locatedProps, type Locate } from './located';
import { splitAt, splitExcerpt, type At, type Content } from './viewer-model';

function Marked({ parts }: { parts: [string, string, string] | null }) {
  if (!parts) return null;
  return (
    <>
      {parts[0]}
      <mark>{parts[1]}</mark>
      {parts[2]}
    </>
  );
}

function text(value: string, parts: [string, string, string] | null) {
  return parts ? <Marked parts={parts} /> : value;
}

export function DocumentOriginal({
  location,
  excerpt,
  content,
  locate,
}: {
  location: At<'document'>;
  excerpt: string;
  content: Content<'document'>;
  locate: Locate;
}) {
  const target = content.paragraphs.findIndex(
    (p) =>
      p.paragraph === location.paragraph &&
      (location.page === undefined || p.page === location.page),
  );
  // 连续同页的段落放在一组，组前写页码；没有页码的文档（TXT、DOCX）不分组、不写页。
  const groups: { page?: number; items: number[] }[] = [];
  content.paragraphs.forEach((p, i) => {
    const last = groups.at(-1);
    if (last && last.page === p.page) last.items.push(i);
    else groups.push({ page: p.page, items: [i] });
  });
  return (
    <div>
      {groups.map((group) => (
        <section key={group.items[0]}>
          {group.page === undefined ? null : (
            <p className={styles.pageMark}>第 {group.page} 页</p>
          )}
          <ol className={styles.paras}>
            {group.items.map((i) => {
              const p = content.paragraphs[i]!;
              const body: ReactNode = (
                <>
                  <span className={styles.gutter}>第 {p.paragraph} 段</span>
                  <span>
                    {i === target
                      ? text(p.text, splitExcerpt(p.text, excerpt))
                      : p.text}
                  </span>
                </>
              );
              return i === target ? (
                <li key={i} {...locatedProps(locate)}>
                  {body}
                </li>
              ) : (
                <li key={i}>{body}</li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function PdfOriginal({
  location,
  content,
  locate,
}: {
  location: At<'pdf'>;
  content: Content<'pdf'>;
  locate: Locate;
}) {
  return (
    <div className={styles.pages}>
      {content.pages.map((page) => {
        const caption = <figcaption>第 {page.page} 页</figcaption>;
        if (page.page !== location.page)
          return (
            <figure key={page.page} className={styles.page}>
              {caption}
              {page.text}
            </figure>
          );
        const { start, end } = location.textRange;
        return (
          <figure key={page.page} {...locatedProps(locate, styles.page)}>
            {caption}
            {text(page.text, splitAt(page.text, start, end))}
          </figure>
        );
      })}
    </div>
  );
}

export function SlidesOriginal({
  location,
  excerpt,
  content,
  locate,
}: {
  location: At<'presentation'>;
  excerpt: string;
  content: Content<'presentation'>;
  locate: Locate;
}) {
  return (
    <div className={`${styles.pages} ${styles.slides}`}>
      {content.slides.map((slide) => {
        const caption = <figcaption>第 {slide.slide} 页</figcaption>;
        const kinds = `${styles.page} ${styles.slide}`;
        return slide.slide === location.slide ? (
          <figure key={slide.slide} {...locatedProps(locate, kinds)}>
            {caption}
            {text(slide.text, splitExcerpt(slide.text, excerpt))}
          </figure>
        ) : (
          <figure key={slide.slide} className={kinds}>
            {caption}
            {slide.text}
          </figure>
        );
      })}
    </div>
  );
}
