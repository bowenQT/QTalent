import 'server-only';
import type { Shell, NavigationId } from '../../contracts/shell';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { activeRoles, navigationFor, type AuthzContext } from '../authz';
import { readDirectory } from '../modules/directory';
import { ForbiddenError } from '../usecases/project-context';
const navigation: Record<
  NavigationId,
  { label: string; href: string; icon: string; group: string | null }
> = {
  work: { label: '工作台', href: '/work', icon: 'home', group: null },
  people: { label: '人才', href: '/people', icon: 'users', group: '人' },
  review: { label: '盘点', href: '/reviews', icon: 'layers', group: '人' },
  queue: { label: '评分复核', href: '/queue', icon: 'check2', group: '人' },
  programs: {
    label: '人才项目',
    href: '/programs',
    icon: 'book',
    group: '项目',
  },
  projects: {
    label: '项目与课题',
    href: '/projects',
    icon: 'folder',
    group: '项目',
  },
  rules: { label: '人才评价规则', href: '/rules', icon: 'grid', group: '规则' },
  judge: {
    label: '我的判断对照',
    href: '/judge?rater=me',
    icon: 'swap',
    group: '规则',
  },
  tags: { label: '标签库', href: '/tags', icon: 'tag', group: '规则' },
  admin: { label: '系统管理', href: '/admin', icon: 'lock', group: '系统' },
};
// Baseline account-menu copy from prototype/y/app/js/data.js ROLES.
// Presentation only: never used to grant a role or resolve a data scope.
const demoScopeLabels: Record<
  string,
  Partial<Record<Shell['role'], string>>
> = {
  'demo-ceo': { manager: '公司层：看人、找人，确认规则与方案' },
  'demo-hrbp': { hr: '人才项目：XEngineer、Landing、校招、黑客松' },
  'demo-mentor': { mentor: '分镜工厂 · 二组、口语搭子 · 一组的学员' },
  'demo-admin': { admin: '账号与权限、北森同步、集成与审计；看不到人才数据' },
};
export async function getShellForCurrentUser(): Promise<Shell> {
  const session = await requireSession();
  const directory = await readDirectory(getDatabase(), session.user.id);
  if (!directory) throw new ForbiddenError();
  const ctx: AuthzContext = {
    account: directory.account,
    grants: directory.grants,
    now: createClock(getEnv().APP_ENV).today(),
    people: [],
    projects: [],
    members: [],
    enrollments: [],
    assignments: [],
  };
  const roles = activeRoles(ctx);
  const role = directory.account.isSystemAdmin
    ? 'admin'
    : roles.includes('manager')
      ? 'manager'
      : roles.includes('hr')
        ? 'hr'
        : roles.includes('mentor')
          ? 'mentor'
          : null;
  if (!role) throw new ForbiddenError();
  const me = directory.people.find((p) => p.id === directory.account.personId);
  return {
    account: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      roles: role === 'admin' ? ['admin'] : roles,
      hue: me?.hue ?? 220,
      roleLabel: {
        manager: '管理者',
        hr: 'HR',
        mentor: '导师',
        admin: '系统管理员',
      }[role],
      scopeLabel:
        (getEnv().APP_ENV !== 'production'
          ? demoScopeLabels[session.user.id]?.[role]
          : undefined) ??
        (role === 'manager'
          ? '全公司'
          : role === 'admin'
            ? '账号、权限与系统配置'
            : role === 'hr'
              ? '负责的人才项目'
              : '所带学员'),
    },
    navigation: navigationFor(ctx).map((id) => ({
      id,
      ...navigation[id],
      ...(id === 'people' && role === 'mentor' ? { label: '所带学员' } : {}),
      ...(id === 'programs' && role === 'manager'
        ? { href: '/program-actions' }
        : {}),
    })),
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: role !== 'admin',
    isAdmin: role === 'admin',
    role,
  };
}

/** Expected authorization loss has a recoverable route state; infrastructure errors do not. */
export async function getShellPage(): Promise<Shell | null> {
  try {
    return await getShellForCurrentUser();
  } catch (error) {
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
}
