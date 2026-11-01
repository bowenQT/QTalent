import { notFound } from 'next/navigation';
import { AccessDenied } from '@/features/shell/AccessDenied';
import {
  AdminNotice,
  RulesDenied,
  StandardNotConnected,
} from '@/features/standard-iteration/NotConnected';
import { getShellPage } from '@/server/queries/shell';

type Search = Promise<Record<string, string | string[] | undefined>>;
// Only the XEngineer selection standard is in this slice (BOW-920); the rules
// overview and the other rule families keep the unified 404.
const isSelectionStandard = (params: Awaited<Search>) =>
  params.r === 'front' && params.line === 'xe-select';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}) {
  if (!isSelectionStandard(await searchParams)) return {};
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : 'XEngineer 入营选拔标准'} · Niu-Talent`,
  };
}

/**
 * /rules?r=front&line=xe-select[&draft=…]. The standard, revision and publication
 * reads and actions (BOW-918) have no entry yet; the page says 待接通 until they do.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  if (!isSelectionStandard(await searchParams)) notFound();
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  if (shell.isAdmin) return <AdminNotice />;
  if (shell.role === 'mentor') return <RulesDenied />;
  return <StandardNotConnected />;
}
