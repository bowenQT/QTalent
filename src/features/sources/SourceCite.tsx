'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Cite, type CiteSourceKind } from '@/components/ui/Cite';
import { Badge } from '@/components/ui/Badge';
import {
  sourceReadResultSchema,
  type Source,
  type SourceReadInput,
  type SourceReadResult,
  type SourceReference,
} from '@/contracts/sources';
import { formatLocation, sourceTypeName } from './source-format';

/** 读取一条来源原文。由服务端页面把 Server Action 传下来，这里不引用 server/。 */
export type LoadSource = (input: SourceReadInput) => Promise<SourceReadResult>;

export type SourceCiteProps = {
  source: SourceReference;
  /** 角标上印的序号，或「原文」这样的短词。 */
  index: number | string;
  loadSource: LoadSource;
};

type Phase =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; source: Source }
  | { status: 'forbidden' | 'not_found' | 'conflict' }
  | { status: 'error' };

const CITE_KIND: Record<SourceReference['location']['kind'], CiteSourceKind> = {
  document: 'paragraph',
  spreadsheet: 'cell',
  recording: 'timestamp',
  snapshot_field: 'paragraph',
};

/** 唯一把引用转成读取入参的地方：只取两个标识，位置由服务端按标识解析，不信任客户端。 */
function toSourceReadInput(source: SourceReference): SourceReadInput {
  return {
    fragmentId: source.fragmentId,
    originalVersionId: source.originalVersionId,
  };
}

function settle(requested: SourceReference, result: SourceReadResult): Phase {
  const parsed = sourceReadResultSchema.safeParse(result);
  if (!parsed.success) return { status: 'error' };
  const value = parsed.data;
  if (value.status === 'success') {
    // 返回的不是请求的那一份，不展示。
    return value.source.fragmentId === requested.fragmentId &&
      value.source.originalVersionId === requested.originalVersionId
      ? { status: 'success', source: value.source }
      : { status: 'error' };
  }
  if (value.status === 'validation_error') return { status: 'error' };
  return { status: value.status };
}

function Note({ children }: { children: ReactNode }) {
  return <span role="status">{children}</span>;
}

/**
 * 引用角标：展开时才读取原文，把读取结果映射成 Cite 的各个状态。
 * 没有引用的条目不要渲染它；不要拿一段引文代替引用。
 */
export function SourceCite(props: SourceCiteProps) {
  // 换了一条引用就是另一份读取：重新挂载，旧结果、在途响应和「已读取」标记都不带过去。
  const { fragmentId, originalVersionId } = props.source;
  return (
    <SourceCiteReader
      key={`${fragmentId}\u0000${originalVersionId}`}
      {...props}
    />
  );
}

function SourceCiteReader({ source, index, loadSource }: SourceCiteProps) {
  const host = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>({ status: 'idle' });
  const alive = useRef(true);
  const started = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = () => {
    started.current = true;
    const mine = ++request.current;
    setPhase({ status: 'loading' });
    void (async () => {
      let next: Phase;
      try {
        next = settle(source, await loadSource(toSourceReadInput(source)));
      } catch {
        next = { status: 'error' };
      }
      // 卸载后或已有更新的请求时，晚到的响应直接丢弃。
      if (alive.current && mine === request.current) setPhase(next);
    })();
  };
  // 重试按钮会随读取中状态消失：先把焦点交回角标，Cite 内部的焦点状态才不会悬空。
  const retry = () => {
    host.current?.querySelector<HTMLElement>('.n-cite__mark')?.focus();
    read();
  };
  // 首次展开才读取；读取中、已有结果时重复展开不再请求，只有失败后点「重试」才重来。
  const first = () => {
    if (!started.current) read();
  };

  const kind = source.location.kind;
  const base = {
    index,
    markLabel: `${sourceTypeName(kind)}原文`,
    source: {
      kind: CITE_KIND[kind],
      title: sourceTypeName(kind),
      location: formatLocation(source.location),
    },
  };

  let cite: ReactNode;
  if (phase.status === 'forbidden') {
    cite = (
      <Cite {...base} access="locked" lockedText="原文在你的查看范围之外" />
    );
  } else if (phase.status === 'success') {
    const found = phase.source;
    const baseline = found.sourceCategory === 'prototype_baseline';
    cite = (
      <Cite
        {...base}
        access="granted"
        quote={
          baseline ? (
            <>
              <span
                style={{ display: 'block' }}
                title={
                  found.location.kind === 'snapshot_field'
                    ? found.location.fieldPath
                    : undefined
                }
              >
                <Badge tone="demo">演示</Badge> {found.displayNotice}
              </span>
              {found.excerpt}
            </>
          ) : (
            found.excerpt
          )
        }
      />
    );
  } else {
    cite = (
      <Cite
        {...base}
        access="granted"
        quote={
          phase.status === 'idle' || phase.status === 'loading' ? (
            <Note>读取原文中</Note>
          ) : phase.status === 'not_found' ? (
            <Note>原文已移除或链接失效</Note>
          ) : phase.status === 'conflict' ? (
            <Note>原文版本已更新，刷新页面后再看</Note>
          ) : (
            <>
              <Note>读取失败</Note>{' '}
              <button type="button" className="n-link" onClick={retry}>
                重试
              </button>
            </>
          )
        }
      />
    );
  }
  return (
    <span ref={host} onMouseEnter={first} onFocus={first} onClick={first}>
      {cite}
    </span>
  );
}
