import { notFound } from 'next/navigation';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { JudgeManager } from '@/features/standard-iteration/judge/JudgeManager';
import { JudgeRater } from '@/features/standard-iteration/judge/JudgeRater';
import { AdminNotice } from '@/features/standard-iteration/NotConnected';
import { getJudgePage, type JudgePage as Page } from '@/server/queries/judge';
import { LiveJudge } from './LiveJudge';

type Search = { searchParams: Promise<{ rater?: string | string[] }> };

const raterOf = async (searchParams: Search['searchParams']) => {
  const rater = (await searchParams).rater;
  return typeof rater === 'string' && rater ? rater : null;
};

function titleOf(page: Page) {
  switch (page.status) {
    case 'forbidden':
      return '查看权限已更新';
    case 'admin':
      return '这一页属于业务视角';
    case 'not_found':
      return '判断对照';
    case 'rater':
      return '我的判断对照';
    case 'hr_rater':
      return `${page.page.raters.find((r) => r.evaluator.id === page.evaluatorId)?.evaluator.name ?? ''}的判断`;
    case 'empty':
      return page.audience === 'rater' ? '我的判断对照' : '判断对照';
    case 'hr':
      return page.page.batch.name;
    case 'manager':
      return '判断对照';
  }
}

export async function generateMetadata({ searchParams }: Search) {
  const page = await getJudgePage(await raterOf(searchParams));
  return { title: `${titleOf(page)} · Niu-Talent` };
}

/**
 * /judge and /judge?rater=…. Who may read, in which audience and which batches is
 * decided on the server; the page renders the stored comparison as read for this
 * viewer. A mentor always reads their own judgments; HR may open one rater.
 */
export default async function JudgePage({ searchParams }: Search) {
  const page = await getJudgePage(await raterOf(searchParams));
  switch (page.status) {
    case 'forbidden':
      return <AccessDenied />;
    case 'admin':
      return <AdminNotice />;
    case 'not_found':
      notFound();
    case 'empty': {
      const self = page.audience === 'rater';
      return (
        <>
          <header className="nt-head">
            <div>
              <h1>{self ? '我的判断对照' : '判断对照'}</h1>
            </div>
          </header>
          <State
            title="还没有可对照的批次"
            text={
              self
                ? '你作为评价人给出的判断有了结营评审结论后，会放在一起出现在这里。'
                : '入营选拔和结营评审都有结论的期次，会按批次出现在这里。'
            }
          />
        </>
      );
    }
    case 'manager':
      return <JudgeManager page={page.page} />;
    case 'rater':
      return (
        <JudgeRater
          self
          raterName={page.raterName}
          cases={page.page.cases}
          sample={page.page.sample}
          mapping={null}
          batchNames={page.batchNames}
          back={{ href: '/work', label: '回到工作台' }}
        />
      );
    case 'hr_rater': {
      const entry = page.page.raters.find(
        (r) => r.evaluator.id === page.evaluatorId,
      )!;
      return (
        <JudgeRater
          self={false}
          raterName={entry.evaluator.name}
          cases={page.page.cases.filter(
            (unit) =>
              unit.front.state === 'present' &&
              unit.front.judgment.evaluator.id === page.evaluatorId,
          )}
          sample={entry.sample}
          mapping={page.page.mapping}
          batchNames={page.batchNames}
          back={{ href: '/judge', label: '回到判断对照' }}
        />
      );
    }
    case 'hr':
      return <LiveJudge page={page} />;
  }
}
