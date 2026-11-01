'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Src } from '@/components/ui/Src';
import styles from './source-viewer.module.css';
import { BackLink } from './BackLink';
import { CodeOriginal } from './OriginalCode';
import { ImageOriginal } from './OriginalImage';
import { MediaOriginal } from './OriginalMedia';
import { SheetOriginal } from './OriginalSheet';
import { DocumentOriginal, PdfOriginal, SlidesOriginal } from './OriginalText';
import { formatLocation, sourceTypeName, timeRange } from './source-format';
import {
  contentFor,
  type OriginalState,
  type ViewerSource,
} from './viewer-model';

export type SourceViewerProps = {
  source: ViewerSource;
  original: OriginalState;
};

const KIND_ICON: Record<ViewerSource['location']['kind'], IconName> = {
  document: 'doc',
  pdf: 'doc',
  spreadsheet: 'grid',
  presentation: 'doc',
  recording: 'wave',
  video: 'play',
  image: 'target',
  code: 'doc',
  snapshot_field: 'doc',
};

/** 原件还没接入时，写清接入后这里打开哪一处。 */
function pendingText(location: ViewerSource['location']): string {
  switch (location.kind) {
    case 'document':
      return `接入后在这里打开全文，标出${formatLocation(location)}`;
    case 'pdf':
      return `接入后在这里打开第 ${location.page} 页，标出引用的文字`;
    case 'spreadsheet':
      return `接入后在这里打开工作表「${location.sheet}」，标出 ${location.cell}`;
    case 'presentation':
      return `接入后在这里打开第 ${location.slide} 页`;
    case 'recording':
    case 'video':
      return `接入后在这里播放 ${timeRange(location.startMs, location.endMs)}，标出这一段转写`;
    // 图片、代码与基线来源各自有完整呈现，不走这里。
    case 'image':
    case 'code':
    case 'snapshot_field':
      return '';
  }
}

function Pending({ location }: { location: ViewerSource['location'] }) {
  return (
    <div className={styles.pending} role="status">
      <b>原件待接入</b>
      <small>{pendingText(location)}</small>
    </div>
  );
}

function provenanceTags(source: ViewerSource): ReactNode {
  const demo = source.demo ? <Badge tone="demo">演示</Badge> : null;
  switch (source.provenance.kind) {
    case 'original':
      return (
        <>
          <Src kind="fact" />
          {demo}
        </>
      );
    case 'historical_evaluation':
      return (
        <>
          <Src kind="fact" label="历史资料" />
          {demo}
        </>
      );
    case 'submitted_code_snapshot':
      return (
        <>
          <Src kind="fact" />
          <Badge>{source.provenance.notice}</Badge>
          {demo}
        </>
      );
    case 'prototype_baseline':
      return demo;
  }
}

/**
 * 原件与提取对照。左边是原件，打开时滚到引用的那一处并移交焦点；右边是提取出的原文。
 * 只接收已通过服务端授权的来源：读取被拒时页面根本不渲染它，也就没有内容可漏。
 */
export function SourceViewer({ source, original }: SourceViewerProps) {
  const { location, excerpt } = source;
  const target = useRef<HTMLElement | null>(null);
  const [located, setLocated] = useState(false);
  const locate = useCallback((element: HTMLElement | null) => {
    target.current = element;
    setLocated(element !== null);
  }, []);
  const reveal = useCallback(() => {
    const element = target.current;
    if (!element) return;
    const reduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    element.scrollIntoView({
      block: 'center',
      behavior: reduce ? 'auto' : 'smooth',
    });
    element.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    reveal();
  }, [reveal]);

  const kindName = sourceTypeName(location.kind);
  // 897 的材料来源不带原件标题：代码用路径，其余写「类型 + 原件」，PDF 与中文之间留空格。
  const title =
    source.title ??
    (location.kind === 'code'
      ? location.path
      : `${kindName}${/[A-Za-z]$/.test(kindName) ? ' ' : ''}原件`);

  let body: ReactNode;
  switch (location.kind) {
    case 'document': {
      const content = contentFor(original, 'document');
      body = content ? (
        <DocumentOriginal {...{ location, excerpt, content, locate }} />
      ) : (
        <Pending location={location} />
      );
      break;
    }
    case 'pdf': {
      const content = contentFor(original, 'pdf');
      body = content ? (
        <PdfOriginal {...{ location, content, locate }} />
      ) : (
        <Pending location={location} />
      );
      break;
    }
    case 'spreadsheet': {
      const content = contentFor(original, 'spreadsheet');
      body = content ? (
        <SheetOriginal {...{ location, content, locate }} />
      ) : (
        <Pending location={location} />
      );
      break;
    }
    case 'presentation': {
      const content = contentFor(original, 'presentation');
      body = content ? (
        <SlidesOriginal {...{ location, excerpt, content, locate }} />
      ) : (
        <Pending location={location} />
      );
      break;
    }
    case 'recording':
    case 'video': {
      const content =
        location.kind === 'video'
          ? contentFor(original, 'video')
          : contentFor(original, 'recording');
      body = content ? (
        <MediaOriginal {...{ location, content, locate }} />
      ) : (
        <Pending location={location} />
      );
      break;
    }
    case 'image':
      body = (
        <ImageOriginal
          location={location}
          content={contentFor(original, 'image')}
          locate={locate}
        />
      );
      break;
    case 'code':
      body = <CodeOriginal {...{ location, excerpt, locate }} />;
      break;
    case 'snapshot_field':
      // 基线来源只有固定原型里的这条快照，没有可打开的原表；写明出处和原表位置。
      body = (
        <div
          ref={locate}
          tabIndex={-1}
          aria-current="location"
          className={`${styles.located} ${styles.pending}`}
        >
          <b>
            {source.provenance.kind === 'prototype_baseline'
              ? source.provenance.notice
              : kindName}
          </b>
          {location.originalLocation ? (
            <small>原表位置：{location.originalLocation}</small>
          ) : null}
        </div>
      );
      break;
  }

  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{title}</h1>
          <p>
            {kindName} · {formatLocation(location)}
            {source.recordedByName ? ` · ${source.recordedByName}记录` : ''}
          </p>
        </div>
        <div className="nt-head__acts">
          <BackLink />
        </div>
      </header>
      <div className="nt-split">
        <section
          className={`n-card ${styles.column}`}
          aria-labelledby="source-original"
        >
          <h2 className="nt-h2" id="source-original">
            原件
          </h2>
          {body}
        </section>
        <aside className={`nt-sticky ${styles.column}`}>
          <section
            className={`n-card ${styles.extract}`}
            aria-labelledby="source-extract"
          >
            <h2 className="nt-h2" id="source-extract">
              提取
            </h2>
            <div className={styles.extractLoc}>{provenanceTags(source)}</div>
            <div className={styles.extractLoc}>
              <Icon name={KIND_ICON[location.kind]} size={14} />
              {kindName} · {formatLocation(location)}
            </div>
            {location.kind === 'code' ? (
              <CodeMeta location={location} />
            ) : (
              <blockquote className={`n-cite__quote ${styles.quote}`}>
                {excerpt}
              </blockquote>
            )}
            {located ? (
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ghost"
                onClick={reveal}
              >
                <Icon name="target" />
                定位到原文
              </button>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

function CodeMeta({
  location,
}: {
  location: Extract<ViewerSource['location'], { kind: 'code' }>;
}) {
  return (
    <dl className={styles.meta}>
      <dt>仓库</dt>
      <dd>{location.repository}</dd>
      <dt>提交</dt>
      <dd className={styles.mono}>{location.commit}</dd>
      <dt>路径</dt>
      <dd className={styles.mono}>{location.path}</dd>
      <dt>行</dt>
      <dd>
        {location.startLine === location.endLine
          ? `第 ${location.startLine} 行`
          : `第 ${location.startLine}–${location.endLine} 行`}
      </dd>
    </dl>
  );
}
