import { notFound } from 'next/navigation';
import type { ShellData } from '@/contracts/shell';
import { Shell } from '@/features/shell/Shell';
import { SamplePersonNodes } from './SamplePersonNodes';

export const metadata = { title: '孟逸尘演示 · Niu-Talent' };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const ROLES = {
  manager: ['程远演示', '管理者', '业务成功部'],
  hr: ['苏晚演示', 'HR', '业务成功部'],
  mentor: ['叶青演示', '导师', '所带学员'],
} as const;
const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const shell = (role: keyof typeof ROLES): ShellData => {
  const [name, roleLabel, scopeLabel] = ROLES[role];
  return {
    account: {
      id: `sample-${role}`,
      name,
      email: `${role}@sample.test`,
      roles: [role],
      hue: 220,
      roleLabel,
      scopeLabel,
    },
    navigation: [
      { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
    ],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role,
  };
};

/**
 * 档案里三类节点记录的开发样张：`?role=manager|hr|mentor`，加 `&records=pending` 看接通前。
 * 三张后端卡合入前，正式路由只显示「待接入」；这里用于对照原型和视觉审查。生产构建返回 404。
 */
export default async function PersonNodesSample({ searchParams }: Props) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const role = Object.keys(ROLES).find((item) => item === one(params.role));
  if (!role) notFound();
  const key = role as keyof typeof ROLES;
  return (
    <Shell data={shell(key)}>
      <SamplePersonNodes role={key} records={one(params.records)} />
    </Shell>
  );
}
