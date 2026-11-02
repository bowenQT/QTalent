import { notFound } from 'next/navigation';
import { State } from '@/components/ui/State';
import { BackLink } from '@/features/sources/BackLink';
import { SourceViewer } from '@/features/sources/SourceViewer';
import { sourceReadInputFrom } from '@/features/sources/source-href';
import { findSample } from '../samples';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 样张的查看页：和 /sources 一样只认地址里的两个标识，找不到就是链接失效。 */
export default async function SourceViewerSample({ searchParams }: Props) {
  if (process.env.NODE_ENV === 'production') notFound();
  const input = sourceReadInputFrom(await searchParams);
  const found = input ? findSample(input) : null;
  return (
    <main className="nt-body">
      {found ? (
        <SourceViewer source={found.source} original={found.original} />
      ) : (
        <State
          title="原件链接失效"
          text="可能已删除，链接有误，或超出你的查看范围。返回上一页重新进入。"
        >
          <BackLink />
        </State>
      )}
    </main>
  );
}
