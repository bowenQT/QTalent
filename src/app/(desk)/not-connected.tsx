import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { AdminNotice } from '@/features/standard-iteration/NotConnected';
import { getShellPage } from '@/server/queries/shell';

/**
 * Sidebar entries whose page has no read or action yet. Each keeps its prototype Y
 * place in the shell and says 待接通 with no sample, count or name.
 */
const pages = {
  reviews: {
    title: '盘点',
    text: '接通后，这里列出进行中和已确认的盘点，从固定范围、补资料缺口、校准象限到确认调整方案都从这里进入。',
    business: true,
  },
  queue: {
    title: '评分复核',
    text: '接通后，需要复核的维度分会列在这里，复核定下的分数和理由进入修订历史。',
    business: true,
  },
  programs: {
    title: '人才项目',
    text: '接通后，这里列出你负责的人才项目，各期学员、关键节点和评价安排从这里进入。',
    business: true,
  },
  'program-actions': {
    title: '关键节点复盘',
    text: '接通后，人才项目各关键节点的结论和由此产生的行动会在这里查看和跟进。',
    business: true,
  },
  tags: {
    title: '标签库',
    text: '接通后，这里显示记录事件时可用的标签，以及等待 HR 决定的候选标签。',
    business: true,
  },
  'review-guide': {
    title: '评审导览',
    text: '接通后，这里按三条主线列出评审要走的页面和顺序。',
    business: false,
  },
  m: {
    title: '手机版',
    text: '手机版接通前，请在电脑上使用 Niu-Talent。',
    business: false,
  },
} as const;

export function notConnectedRoute(id: keyof typeof pages) {
  const page = pages[id];
  return {
    async generateMetadata() {
      const shell = await getShellPage();
      return {
        title: `${!shell ? '查看权限已更新' : page.business && shell.isAdmin ? '这一页属于业务视角' : page.title} · Niu-Talent`,
      };
    },
    async Page() {
      const shell = await getShellPage();
      if (!shell) return <AccessDenied />;
      if (page.business && shell.isAdmin) return <AdminNotice />;
      return (
        <>
          <header className="nt-head">
            <div>
              <h1>{page.title}</h1>
            </div>
          </header>
          <State title={`${page.title}待接通`} text={page.text} />
        </>
      );
    },
  };
}
