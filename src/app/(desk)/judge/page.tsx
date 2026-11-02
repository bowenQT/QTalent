import { AccessDenied } from '@/features/shell/AccessDenied';
import {
  AdminNotice,
  JudgeNotConnected,
} from '@/features/standard-iteration/NotConnected';
import { getJudgePage } from '@/server/queries/judge';

export async function generateMetadata() {
  const page = await getJudgePage();
  return {
    title: `${page.status === 'forbidden' ? '查看权限已更新' : page.status === 'admin' ? '这一页属于业务视角' : page.audience === 'rater' ? '我的判断对照' : '判断对照'} · Niu-Talent`,
  };
}

/**
 * /judge and /judge?rater=me. Who may read and in which audience is decided on the
 * server (BOW-919 access); no comparison batch is stored yet, so the page says
 * 待接通 instead of rendering an empty or made-up batch. Attribution actions
 * (BOW-921) wait for their action entry.
 */
export default async function JudgePage() {
  const page = await getJudgePage();
  if (page.status === 'forbidden') return <AccessDenied />;
  if (page.status === 'admin') return <AdminNotice />;
  return (
    <JudgeNotConnected
      role={page.audience === 'rater' ? 'mentor' : page.audience}
    />
  );
}
