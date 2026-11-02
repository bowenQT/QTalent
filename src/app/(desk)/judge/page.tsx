import { AccessDenied } from '@/features/shell/AccessDenied';
import {
  AdminNotice,
  JudgeNotConnected,
} from '@/features/standard-iteration/NotConnected';
import { getShellPage } from '@/server/queries/shell';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : shell.role === 'mentor' ? '我的判断对照' : '判断对照'} · Niu-Talent`,
  };
}

/**
 * /judge and /judge?rater=me. The comparison reads (BOW-919) and attribution actions
 * (BOW-921) have no query or action entry yet; the page says 待接通 until they do.
 */
export default async function JudgePage() {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  if (shell.isAdmin) return <AdminNotice />;
  return <JudgeNotConnected role={shell.role} />;
}
