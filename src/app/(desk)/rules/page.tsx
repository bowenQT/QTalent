import { notFound, redirect } from 'next/navigation';
import { AccessDenied } from '@/features/shell/AccessDenied';
import {
  AdminNotice,
  RulesDenied,
  StandardNone,
} from '@/features/standard-iteration/NotConnected';
import { getSelectionStandardPage } from '@/server/queries/rules';
import { getShellPage } from '@/server/queries/shell';
import { LiveRules } from './LiveRules';

type Search = Promise<Record<string, string | string[] | undefined>>;
// Only the XEngineer selection standard is in this slice (BOW-920): the sidebar's
// bare /rules opens it, and the other rule families keep the unified 404.
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

const draftOf = (params: Awaited<Search>) =>
  typeof params.draft === 'string' ? params.draft : null;

/**
 * /rules?r=front&line=xe-select[&draft=…]. The standard in force, or the revision
 * the viewer works on (BOW-918): HR edits and submits, the manager publishes and
 * may undo within the window. Role and scope are decided on the server.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const params = await searchParams;
  if (Object.keys(params).length === 0)
    redirect('/rules?r=front&line=xe-select');
  if (!isSelectionStandard(params)) notFound();
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  if (shell.isAdmin) return <AdminNotice />;
  if (shell.role === 'mentor') return <RulesDenied />;
  const page = await getSelectionStandardPage(draftOf(params));
  if (page.status === 'admin') return <AdminNotice />;
  if (page.status === 'forbidden') return <AccessDenied />;
  if (page.status === 'not_found') notFound();
  if (page.status === 'none') return <StandardNone />;
  return <LiveRules page={page} />;
}
