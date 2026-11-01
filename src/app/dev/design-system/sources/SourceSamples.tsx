'use client';
import { Cite, type CiteSourceKind } from '@/components/ui/Cite';
import {
  formatLocation,
  sourceTypeName,
  type LocationKind,
} from '@/features/sources/source-format';
import { sourceHref } from '@/features/sources/source-href';
import { SAMPLE_VIEW, sample, sampleKeys } from './samples';

// 引用角标只有四种图标位置：页、段、单元格、时间点。
const CITE_KIND: Record<LocationKind, CiteSourceKind> = {
  document: 'paragraph',
  pdf: 'page',
  spreadsheet: 'cell',
  presentation: 'page',
  recording: 'timestamp',
  video: 'timestamp',
  image: 'page',
  code: 'paragraph',
  snapshot_field: 'paragraph',
};

function SampleCite({ name, index }: { name: string; index: number }) {
  const { source } = sample(name);
  const kind = source.location.kind;
  return (
    <Cite
      index={index}
      markLabel={`${sourceTypeName(kind)}原文`}
      source={{
        kind: CITE_KIND[kind],
        title: source.title ?? sourceTypeName(kind),
        location: formatLocation(source.location),
        by: source.recordedByName ?? undefined,
      }}
      access="granted"
      quote={source.excerpt}
      jump={{ label: '查看原件', href: sourceHref(source, SAMPLE_VIEW) }}
    />
  );
}

const ENTRIES = [
  { where: '档案 · 关键事件', text: '需求变更后重排剩余任务' },
  { where: '确认页 · 待确认的事', text: '按方案 B 拆分剩余任务' },
  { where: '找人 · 候选人证据', text: '能把变更拆成可验收的任务' },
] as const;

export function SourceSamples() {
  return (
    <>
      <section className="nt-sec" data-sample="entries">
        <h2>三个入口打开同一处</h2>
        <div className="nt-cols-3">
          {ENTRIES.map((entry) => (
            <article className="n-card" key={entry.where}>
              <h3 className="n-section-title">{entry.where}</h3>
              <p>
                {entry.text}
                <SampleCite name="document" index={1} />
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="nt-sec" data-sample="kinds">
        <h2>六种定位与其他出处</h2>
        <ul className="n-card nt-list" style={{ display: 'grid', gap: 12 }}>
          {sampleKeys.map((name, i) => (
            <li key={name} data-kind={name}>
              {sample(name).label}
              <SampleCite name={name} index={i + 1} />
            </li>
          ))}
        </ul>
      </section>
      <section className="nt-sec" data-sample="locked">
        <h2>查看范围以外的原件</h2>
        <p className="n-card">
          角标只显示出处
          <Cite
            index={1}
            markLabel="文档原文"
            source={{
              kind: 'paragraph',
              title: '文档',
              location: '第 4 段',
            }}
            access="locked"
            lockedText="原文在你的查看范围之外"
          />
          ；直接打开它的地址，
          <a
            className="n-link"
            href={sourceHref(
              {
                fragmentId: 'demo-frag-locked',
                originalVersionId: 'demo-ver-locked',
              },
              SAMPLE_VIEW,
            )}
          >
            得到链接失效
          </a>
          。
        </p>
      </section>
    </>
  );
}
